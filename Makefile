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
	emcc peak.c \
	-DHUF_FORCE_DECOMPRESS_X1 \
	-DZSTD_FORCE_DECOMPRESS_SEQUENCES_SHORT \
	-DZSTD_NO_UNUSED_FUNCTIONS \
	-Oz \
	-flto \
	-msimd128 \
	-mrelaxed-simd \
	-msse4.2 -mavx -mavx2 \
	-s MALLOC="emmalloc" \
	-s ENVIRONMENT=web \
	-s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORT_NAME="peak" \
	-s EXPORTED_FUNCTIONS='["_load_peak","_peak_init","_init_search","_continue_search","_get_result","_free_peak","_malloc","_free","_switchstate"]' \
  -s EXPORTED_RUNTIME_METHODS="['HEAPU8', 'UTF8ToString']" \
	--no-entry \
	-o peak.js
peak : peak_cli.c peak.h peak.c zstddeclib.c
	gcc -O3 -DDEBUG peak_cli.c -o peak

all : peakgen peakgen.wasm peak.wasm peak
