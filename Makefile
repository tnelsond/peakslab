peakgen : peakgen.c peak.h
	gcc -DDEBUG -Wall -O3 -D_GNU_SOURCE -lzstd peakgen.c -o peakgen
peakgen.wasm : peakgen.c peak.h
	emcc peakgen.c \
  -Oz \
	-flto \
	-msimd128 \
	-mrelaxed-simd \
  -msse4.2 -mavx -mavx2 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='peakgen' \
  -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","UTF8ToString","stringToNewUTF8"]' \
  -o peakgen.js
peak.wasm : peak.c zstddeclib.c peak.h
	emcc peak.c \
  -Oz \
	-flto \
	-msimd128 \
	-mrelaxed-simd \
  -msse4.2 -mavx -mavx2 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='peak' \
  -s EXPORTED_FUNCTIONS='["_load_peak","_peak_init","_init_search","_get_result","_free_peak","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","UTF8ToString","stringToNewUTF8"]' \
  -o peak.js
peak : peak.c peak.h zstddeclib.c
	gcc -DDEBUG peak.c -o peak

all : peakgen peakgen.wasm peak.wasm peak
