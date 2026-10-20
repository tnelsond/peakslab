comma := ,
all : peakgen peakgen.wasm sw.js media.js peak.wasm peak 404.html files.json

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

# The core files (404.html, peak.wasm, ...) too, so a rebuilt app reaches the service worker
files-src.json: meta peakgen $(META_FILES) $(SLAB_META_FILES) $(filter-out meta/files.json.meta,$(wildcard meta/*.meta)) abbreviations.json
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

# g2k.tsv is made: ipa.tsv in G2K's phonetics, then the words only nath2022 has
dict_src/khmer/phonetics/g2k.tsv: dict_src/khmer/phonetics/ipa.tsv dict_src/khmer/dict/nath2022.tsv utils/ipatog2k.py utils/nathtog2k.pl
	perl utils/nathtog2k.pl dict_src/khmer/dict/nath2022.tsv > $@.nath
	python3 utils/ipatog2k.py dict_src/khmer/phonetics/ipa.tsv $@ $@.nath
	rm $@.nath

# The Lao pronunciation dictionaries are made from pat's and kerr's
dict_src/lao/phonetics/laoipa.tsv dict_src/lao/phonetics/laosouth.tsv &: dict_src/lao/dict/pat.tsv dict_src/lao/dict/kerr.tsv utils/laophonetics.py
	mkdir -p dict_src/lao/phonetics
	python3 utils/laophonetics.py dict_src/lao/dict/pat.tsv dict_src/lao/dict/kerr.tsv dict_src/lao/phonetics

# The Greek and Hebrew interlinear Bibles and their lexicons are made from
# STEPBible's data (https://github.com/STEPBible/STEPBible-Data: the TAGNT,
# TAHOT, TBESG and TBESH .txt files in dict_src/stepbible)
STEP_TSV := dict_src/greek/bible/text/grc-tagnt.tsv dict_src/greek/bible/dict/tbesg.tsv dict_src/hebrew/bible/text/hbo-tahot.tsv dict_src/hebrew/bible/dict/tbesh.tsv
$(STEP_TSV) &: $(wildcard dict_src/stepbible/*.txt) utils/stepbibletotsv.py
	python3 utils/stepbibletotsv.py dict_src/stepbible dict_src

# The KJV with Strong's numbers, from eBible's eng-kjv2006 USFM (dict_src/ebible/eng-kjv2006)
dict_src/english/bible/text/eng-kjvs.tsv: $(wildcard dict_src/ebible/eng-kjv2006/*.usfm) utils/usfmstrongstotsv.py
	python3 utils/usfmstrongstotsv.py $@ 'King James Version (1769) with Strong’s numbers: tap a word for its Greek or Hebrew. Public domain, from <a href="https://ebible.org/find/details.php?id=eng-kjv2006">eBible</a>' $(sort $(wildcard dict_src/ebible/eng-kjv2006/*.usfm))

# The Hammond 1954 New Testament with Strong's numbers, matched to the Greek
# by utils/alignstrongs.py (pip install eflomal), learning the words from the
# other Khmer Bibles too, with the Khmer dictionaries saying which parts make a word
KHMER_BIBLES := $(addprefix dict_src/khmer/bible/text/,khsv.tsv khov2016.tsv khmus.tsv kcb.tsv gkb.tsv)
KHMER_WORDS := $(addprefix dict_src/khmer/dict/,h97.tsv nath2022.tsv aakanee.tsv kmwiktionary.tsv sonv.tsv seacount.tsv) $(addprefix dict_src/khmer/bible/dict/,bible.tsv biblewordkm.tsv)
dict_src/khmer/bible/text/khovs.tsv: dict_src/khmer/bible/text/khov.tsv dict_src/greek/bible/text/grc-tagnt.tsv $(KHMER_BIBLES) $(KHMER_WORDS) utils/alignstrongs.py
	python3 utils/alignstrongs.py dict_src/greek/bible/text/grc-tagnt.tsv $< $@ 'Hammond 1954 Khmer New Testament with Strong’s numbers (a trial): tap a word for its Greek. The words were matched to the Greek automatically, so some are wrong and some are left out. Text from <a href="https://ebible.org/study/content/texts/khm-h/">eBible</a>' 2 $(KHMER_BIBLES) --words $(KHMER_WORDS)

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
# wasm-opt (binaryen) is optional and shaves ~2 kB if installed. (Not -all:
# it can use features browsers don't have yet. --low-memory-unused: the
# stack is first, growing down to 0, so the lowest 1 kB is never used short
# of a stack overflow.)
# -DZSTD_NO_INLINE: a third smaller; zstddeclib.c still inlines its inner
# loop (ZSTD_HOT_INLINE), so dictionaries load only ~5% slower.
CLANG ?= clang
WASM_OPT ?= $(shell command -v wasm-opt 2>/dev/null)
PEAK_EXPORTS = load_peak peak_init init_search continue_search get_result free_peak malloc free switchstate match_at last_match last_index render_match head_at
peak.wasm : peak.c zstddeclib.c peak.h utils/walloc-master/walloc.c $(wildcard utils/minilibc/*)
	$(CLANG) --target=wasm32 -Oz -flto -nostdlib -isystem utils/minilibc \
	-mbulk-memory -msimd128 -Wno-pointer-sign \
	-DNDEBUG \
	-DHUF_FORCE_DECOMPRESS_X1 \
	-DZSTD_FORCE_DECOMPRESS_SEQUENCES_SHORT \
	-DZSTD_NO_UNUSED_FUNCTIONS -DZSTD_NO_INLINE \
	-Wl,--no-entry -Wl,--gc-sections -Wl,--strip-all \
	$(addprefix -Wl$(comma)--export=,$(PEAK_EXPORTS)) \
	-o peak.wasm peak.c utils/walloc-master/walloc.c utils/minilibc/libc.c
	$(if $(WASM_OPT),$(WASM_OPT) -Oz --converge --low-memory-unused --strip-debug --strip-producers --strip-target-features peak.wasm -o peak.wasm)
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
# The media decoders' code, loaded with their wasm when first used
media.js : media-src.js
	node_modules/.bin/terser media-src.js --module --compress --mangle -o media.js
	./createmeta.sh media.js
sw.js : sw-src.js
	node_modules/.bin/terser sw-src.js --compress passes=2 --mangle --toplevel -o sw.js

.PHONY: FORCE
FORCE:
