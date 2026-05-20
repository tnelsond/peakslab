#include <stddef.h>
#include <stdarg.h>

int codec2_noop_fprintf(void *f, const char *fmt, ...) { return 0; }
size_t codec2_noop_fwrite(const void *p, size_t s, size_t n, void *f) { return 0; }
size_t codec2_noop_fread(void *p, size_t s, size_t n, void *f) { return 0; }
void *codec2_noop_fopen(const char *path, const char *mode) { return 0; }
int codec2_noop_fclose(void *f) { return 0; }
