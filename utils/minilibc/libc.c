/* Minimal libc for peak.wasm (clang --target=wasm32, no Emscripten).
   With -mbulk-memory, __builtin_memcpy/memmove/memset compile to the single
   memory.copy / memory.fill instructions. */
#include <string.h>
#include <stdlib.h>
void *memcpy(void *restrict d, const void *restrict s, size_t n){ return __builtin_memcpy(d, s, n); }
void *memmove(void *d, const void *s, size_t n){ return __builtin_memmove(d, s, n); }
void *memset(void *d, int c, size_t n){ return __builtin_memset(d, c, n); }
int memcmp(const void *a, const void *b, size_t n){
  const unsigned char *x = a, *y = b;
  for (; n; --n, ++x, ++y) if (*x != *y) return *x - *y;
  return 0;
}
size_t strlen(const char *s){ const char *p = s; while (*p) ++p; return p - s; }
void *calloc(size_t n, size_t m){ void *p = malloc(n * m); if (p) __builtin_memset(p, 0, n * m); return p; }
void abort(void){ __builtin_trap(); }
