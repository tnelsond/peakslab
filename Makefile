comma := ,
all : peakgen peakgen.wasm sw.js peak.wasm peak 404.html files.json

# Find .tsv files - clean paths without leading ./
TSV_FILES := $(shell find . -path '*/src/*' -name '*.tsv' ! -path '*/meta/*' 2>/dev/null | sed 's|^\./||' | sort)

# Map to meta/ (strip /src/)
META_FILES := $(foreach f,$(TSV_FILES),$(subst /src/,/,$(patsubst %.tsv,meta/%.meta,$(f))))

files-src.json: meta peakgen $(META_FILES) abbreviations.json
	./createdictlist.sh

files.json: files-src.json
	minify files-src.json > files.json

# Rule
$(META_FILES): peakgen
	@src=$$(find . -path '*/src/*' -name '$(notdir $(@:.meta=.tsv))' ! -path '*/meta/*' | sed 's|^\./||' | head -1); \
	if [ -z "$$src" ]; then echo "No source for $@"; exit 1; fi; \
	if [ ! -f "$@" ] || [ "$$src" -nt "$@" ]; then \
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
peak : peak_cli.c peak.h peak.c zstddeclib.c
	gcc -Wall -DDEBUG peak_cli.c -o peak
404.html : peakworker.js peak.html app.js style.css
	node build.mjs --minify
	./createmeta.sh 404.html
	cp 404.html index.html
sw.js : sw-src.js
	minify sw-src.js > sw.js

