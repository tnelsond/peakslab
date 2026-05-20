#include <stdarg.h>
#include <stddef.h>

// Stub out all stdio - we don't need filesystem in the decoder
int printf(const char *fmt, ...) { return 0; }
int fprintf(void *f, const char *fmt, ...) { return 0; }
int vfprintf(void *f, const char *fmt, va_list ap) { return 0; }
int sprintf(char *s, const char *fmt, ...) { return 0; }
int snprintf(char *s, size_t n, const char *fmt, ...) { return 0; }
void *fopen(const char *path, const char *mode) { return 0; }
int fclose(void *f) { return 0; }
size_t fwrite(const void *ptr, size_t size, size_t n, void *f) { return 0; }
size_t fread(void *ptr, size_t size, size_t n, void *f) { return 0; }
void *stderr = 0;
void *stdout = 0;
