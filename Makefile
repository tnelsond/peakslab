comma := ,
all : peakgen peakgen.wasm sw.js peak.wasm peak 404.html files.json

# Find .tsv files - clean paths without leading ./
# A big file split into x.tsv.1, x.tsv.2, ... (see utils/splittsv.sh) is listed
# by its first part and built as one dictionary
TSV_FILES := $(shell find dict_src -name '*.tsv' -o -name '*.tsv.1' 2>/dev/null | sort)

# Map dict_src/<lang>/... to meta/<lang>/...
META_FILES := $(patsubst dict_src/%.tsv,meta/%.meta,$(patsubst dict_src/%.tsv.1,meta/%.meta,$(TSV_FILES)))

# A media slab is a directory of files with its description in zzz.meta,
# e.g. dict_src/khmer/media/audio/ -> khmer/media/audio.slab
SLAB_DIRS := $(patsubst %/zzz.meta,%,$(shell find dict_src -name zzz.meta 2>/dev/null | sort))
SLAB_META_FILES := $(patsubst dict_src/%,meta/%.meta,$(SLAB_DIRS))

files-src.json: meta peakgen $(META_FILES) $(SLAB_META_FILES) abbreviations.json
	./createdictlist.sh

files.json: files-src.json
	minify files-src.json > files.json

# Rule: each .meta depends on its source (x.tsv, or every part x.tsv.1, x.tsv.2, ...)
# so editing a source rebuilds it. A newer peakgen alone doesn't rebuild anything,
# the recipe checks the sources itself.
.SECONDEXPANSION:
$(META_FILES): peakgen $$(wildcard $$(patsubst meta/%.meta,dict_src/%.tsv,$$@) $$(patsubst meta/%.meta,dict_src/%.tsv.[0-9]*,$$@))
	@base=$(patsubst meta/%.meta,dict_src/%.tsv,$@); \
	if [ -f "$$base" ]; then src=$$base; parts=$$base; \
	elif [ -f "$$base.1" ]; then src=$$base.1; parts=$$(ls "$$base".[0-9]*); \
	else echo "No source for $@"; exit 1; fi; \
	if [ ! -f "$@" ] || [ -n "$$(find $$parts -newer "$@")" ]; then \
		mkdir -p $(dir $@); \
		./peakgen "$$src"; \
		touch "$@"; \
		echo "✓ Generated $@"; \
	else \
		echo "Up to date: $@"; \
	fi

# Media file names can have spaces, which make can't take as prerequisites, so
# this always runs and find decides (the directory's mtime covers removed files)
$(SLAB_META_FILES): peakgen FORCE
	@src=$(patsubst meta/%.meta,dict_src/%,$@); \
	if [ ! -f "$@" ] || [ -n "$$(find "$$src" -newer "$@")" ]; then \
		mkdir -p $(dir $@); \
		./peakgen "$$src"; \
		touch "$@"; \
		echo "✓ Generated $@"; \
	else \
		echo "Up to date: $@"; \
	fi

meta:
	mkdir -p meta
peakgen : peakgen.c peak.h zstd.o zstd.h
	gcc -DDEBUG -Wall -O3 -D_GNU_SOURCE peakgen.c zstd.o -o peakgen
zstd.o : zstd.c
	gcc -Wall -O3 -D_GNU_SOURCE zstd.c -c
zstd.o.wasm : zstd.c
	emcc zstd.c -c -Oz -flto -o zstd.o.wasm
peakgen.wasm : peakgen.c peak.h zstd.o.wasm
	emcc peakgen.c zstd.o.wasm -o peakgen.js \
  -Oz \
	-flto \
	-s MALLOC="emmalloc" \
	-s ENVIRONMENT=web \
  -s EXPORTED_FUNCTIONS="['_peakslab_gen','_peakslab_getsize','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['HEAPU8']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
	-s FILESYSTEM=0 \
  -s EXPORT_NAME="peakgen" \
	--no-entry
# peak.wasm is built with plain clang + wasm-ld (no Emscripten): any clang with
# the wasm32 target works (e.g. Debian/Ubuntu: apt install clang lld).
# utils/minilibc supplies the few libc functions needed; malloc is walloc.
# wasm-opt (binaryen) is optional and shaves ~2 kB if installed.
# -DZSTD_NO_INLINE would make it ~11 kB smaller but zstd decompression
# (i.e. dictionary load time) about twice as slow, so it's not used.
CLANG ?= clang
WASM_OPT ?= $(shell command -v wasm-opt 2>/dev/null)
PEAK_EXPORTS = load_peak peak_init init_search continue_search get_result free_peak malloc free switchstate
peak.wasm : peak.c zstddeclib.c peak.h utils/walloc-master/walloc.c $(wildcard utils/minilibc/*)
	$(CLANG) --target=wasm32 -Oz -flto -nostdlib -isystem utils/minilibc \
	-mbulk-memory -msimd128 -Wno-pointer-sign \
	-DNDEBUG \
	-DHUF_FORCE_DECOMPRESS_X1 \
	-DZSTD_FORCE_DECOMPRESS_SEQUENCES_SHORT \
	-DZSTD_NO_UNUSED_FUNCTIONS \
	-Wl,--no-entry -Wl,--gc-sections -Wl,--strip-all \
	$(addprefix -Wl$(comma)--export=,$(PEAK_EXPORTS)) \
	-o peak.wasm peak.c utils/walloc-master/walloc.c utils/minilibc/libc.c
	$(if $(WASM_OPT),$(WASM_OPT) -Oz --converge --strip-debug --strip-producers -all peak.wasm -o peak.wasm)
	du -b peak.wasm
	./createmeta.sh peak.wasm
peak_tui : peak_cli2.c peak.h peak.c zstddeclib.c
	gcc -DTB_IMPL -lreadline -ltinfo peak_cli2.c -o peak_tui
# The terminal interface: peak.c is #included unchanged, termbox2 is header only.
# The zstd flags are peak.wasm's (decoder variants we don't need); with
# -DDYNAMIC_BMI2=0 zstd isn't compiled twice for CPUs with and without BMI2.
peakterm : peakterm.c peak.h peak.c zstddeclib.c utils/termbox2/termbox2.h
	gcc -Wall -O2 -flto=auto -pthread -D_GNU_SOURCE -Wno-pointer-sign -Wno-missing-braces -Wno-unused-variable -Wno-unused-function \
	-DNDEBUG -DHUF_FORCE_DECOMPRESS_X1 -DZSTD_FORCE_DECOMPRESS_SEQUENCES_SHORT -DZSTD_NO_UNUSED_FUNCTIONS \
	-DDYNAMIC_BMI2=0 -DZSTD_DISABLE_ASM \
	-ffunction-sections -fdata-sections -Wl,--gc-sections -s \
	peakterm.c -o peakterm
	du -b peakterm
peak : peak_cli.c peak.h peak.c zstddeclib.c
	gcc -Wall -DDEBUG peak_cli.c -o peak
404.html : peakworker.js peak.html app.js style.css
	node build.mjs --minify
	./createmeta.sh 404.html
	cp 404.html index.html
sw.js : sw-src.js
	minify sw-src.js > sw.js

.PHONY: FORCE
FORCE:
