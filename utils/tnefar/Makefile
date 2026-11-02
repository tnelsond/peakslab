# tnefar.wasm: the tnefar audio decoder (fcq features + int8 postfilter + int8 FARGAN), see README.md.
# Needs Emscripten (emcc). `make` builds ../../tnefar.wasm; `make native` a native test decoder.
#
# FARGAN's kernels are opus' SSE ones (vec_avx.h, -msse4.2), which Emscripten turns into wasm SIMD:
# several times faster than its plain C (and than a hand-written wasm SIMD version).
EMCC ?= emcc
CC ?= gcc
FCQ_SRC = fcq/codec.c fcq/rc.c fcq/rvq.c fcq/pf.c fcq/nnf.c
OPUS_SRC = opus/fargan.c opus/fargan_init.c opus/nnet.c opus/nnet_default.c opus/parse_lpcnet_weights.c
SRC = tnefar.c $(FCQ_SRC) $(OPUS_SRC)
DEPS = $(SRC) fargan.bin $(wildcard fcq/*.h opus/*.h)
# The codec's loaders read the voice in memory (tnefar_fopen); NDEBUG drops opus' asserts.
# -ffp-contract=off: the decoder's predictions must round exactly as the encoder's did.
CFLAGS = -DHAVE_CONFIG_H -DNDEBUG -Dfopen=tnefar_fopen -Dgetenv=tnefar_getenv -Iopus -I. -Wno-c23-extensions -ffp-contract=off
EXPORTS = tnefar_open tnefar_frames tnefar_run tnefar_feat tnefar_pcm tnefar_close malloc free
WASM_FLAGS = -O3 -flto -msimd128 -msse4.2 -fno-exceptions -fno-stack-protector \
	--no-entry -s STANDALONE_WASM=1 -s FILESYSTEM=0 -s ASSERTIONS=0 -s ENVIRONMENT=web \
	-s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=4MB -s STACK_SIZE=256KB \
	-s EXPORTED_FUNCTIONS='[$(subst $() ,$(comma),$(patsubst %,"_%",$(EXPORTS)))]'

all: ../../tnefar.wasm
../../tnefar.wasm: $(DEPS)
	$(EMCC) $(CFLAGS) $(SRC) -o $@ $(WASM_FLAGS)
	du -b $@
	cd ../.. && ./createmeta.sh tnefar.wasm && $(MAKE) filelist

# A voice for a slab (its tnefar.voice): [u32 codebook bytes][codebook][postfilter]
%.voice: %.fcq %.nnf
	python3 -c "import struct,sys; c=open(sys.argv[1],'rb').read(); open(sys.argv[3],'wb').write(struct.pack('<I',len(c))+c+open(sys.argv[2],'rb').read())" $^ $@

# The same decoder natively (opus' SSE kernels): ./tnefar_cli voice/x.voice in.tnefar out.wav
native: tnefar_cli
tnefar_cli: tnefar_cli.c $(DEPS)
	$(CC) -O2 -msse4.2 $(CFLAGS) tnefar_cli.c $(SRC) -o $@ -lm

comma := ,
.PHONY: all native
