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
peak.wasm : peak.c zstddeclib.c peak.h
	emcc utils/walloc-master/walloc.c peak.c \
	-DHUF_FORCE_DECOMPRESS_X1 \
	-DZSTD_FORCE_DECOMPRESS_SEQUENCES_SHORT \
	-DZSTD_NO_UNUSED_FUNCTIONS \
	-s MALLOC="none" \
	-Oz \
	-flto \
	-msimd128 \
	-mrelaxed-simd \
	-s ENVIRONMENT=worker \
	-msse4.2 -mavx -mavx2 \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s EXPORTED_FUNCTIONS='["_load_peak","_peak_init","_init_search","_continue_search","_get_result","_free_peak","_malloc","_free","_switchstate"]' \
	--no-entry \
	-o peak.wasm
	du -b peak.wasm
peak2.wasm : peak.c zstddeclib.c peak.h Makefile
	clang --target=wasm32 -Wl,--no-entry -Wl,--export-all -Oz peak.c -o peak2.wasm
peak_tui : peak_cli2.c peak.h peak.c zstddeclib.c
	gcc -DTB_IMPL -lreadline -ltinfo peak_cli2.c -o peak_tui
peak : peak_cli.c peak.h peak.c zstddeclib.c
	gcc -Wall -DDEBUG peak_cli.c -o peak

all : peakgen peakgen.wasm peak.wasm peak
