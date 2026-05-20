CC      = gcc
EMCC    = emcc
D       = src/codebook
WASM_BUILD = wasm_build

CODEBOOK_SRCS = \
	codebooknewamp1.c \
	codebooknewamp1_energy.c

LIB_SRCS = \
	src/codec2_fft.c \
	src/sine.c \
	src/phase.c \
	src/postfilter.c \
	src/kiss_fft.c \
	src/kiss_fftr.c \
	newamp1-new.c \
	src/quantise.c \
	src/mbest.c \
	src/linreg.c \
	src/pack.c \
	nlp_stub.c \
	noop-io.c \
	dump_stub.c \
	codec2-culled.c

SRCS = codec2_wasm.c $(CODEBOOK_SRCS) $(LIB_SRCS)

EMCC_FLAGS = \
	-I src \
	-I $(WASM_BUILD) \
	-Oz \
	-flto \
	-ffast-math \
	-fomit-frame-pointer \
	-fno-exceptions \
	-fno-rtti \
	-fno-stack-protector \
	-DDO_NOT_USE_FPRINTF \
	-DDISABLE_STDIO \
	-DNDEBUG \
	--no-entry \
	-s ENVIRONMENT=web \
	-s FILESYSTEM=0 \
	-s NO_FILESYSTEM=1 \
	-s ASSERTIONS=0 \
	-s EXPORTED_FUNCTIONS='["_decode_to_wav","_malloc","_free"]' \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s STANDALONE_WASM=1 \
	-DCODEC2_MODE_EN_DEFAULT=0 \
	-DFREEDV_MODE_EN_DEFAULT=0 \
	-DCODEC2_MODE_700C_EN=1

.PHONY: all clean

all: codec2.wasm

# --- Native codebook generator ---
generate_codebook: generate_codebook-new.c
	$(CC) $< -o $@ -lm

# --- Generated codebook sources ---
codebooknewamp1.c: generate_codebook $(D)/train_120_1.txt $(D)/train_120_2.txt
	./generate_codebook newamp1vq_cb $(D)/train_120_1.txt $(D)/train_120_2.txt > $@

codebooknewamp1_energy.c: generate_codebook $(D)/newamp1_energy_q.txt
	./generate_codebook newamp1_energy_cb $(D)/newamp1_energy_q.txt > $@

# --- Generated version header ---
$(WASM_BUILD)/codec2/version.h:
	mkdir -p $(WASM_BUILD)/codec2
	@VERSION=$$(grep -oP '(?<=CODEC2_VERSION ")[^"]+' CMakeLists.txt || echo "1.2.0"); \
	printf '#define CODEC2_VERSION "%s"\n#define CODEC2_VERSION_MAJOR 1\n#define CODEC2_VERSION_MINOR 2\n#define CODEC2_VERSION_PATCH 0\n' $$VERSION > $@

# --- Final WASM build ---
codec2.wasm: $(SRCS) $(WASM_BUILD)/codec2/version.h
	$(EMCC) $(SRCS) $(EMCC_FLAGS) -o codec2.wasm
	du -b codec2.wasm

clean:
	rm -f generate_codebook codebooknewamp1.c codebooknewamp1_energy.c codec2.wasm
	rm -rf $(WASM_BUILD)
