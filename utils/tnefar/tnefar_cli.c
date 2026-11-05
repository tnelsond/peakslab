/* tnefar_cli.c - decode a .tnefar file to a 16 kHz WAV with the same code as tnefar.wasm.
 * usage: tnefar_cli voice in.tnefar out.wav [chunk frames [speed]]   (voice: a slab's tnefar.voice) */
#undef fopen /* (the Makefile points the codec's at the built-in files, not this one's) */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <math.h>

typedef struct tnefar tnefar_t;
intptr_t tnefar_open(const uint8_t *buf, int len, const uint8_t *filter, int filter_len);
int tnefar_frames(tnefar_t *d);
int tnefar_run(tnefar_t *d, int n);
void tnefar_speed(tnefar_t *d, float rate);
float *tnefar_pcm(tnefar_t *d);
void tnefar_close(tnefar_t *d);

static uint8_t *slurp(const char *path, long *n) {
  FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(1); }
  fseek(f, 0, SEEK_END); *n = ftell(f); fseek(f, 0, SEEK_SET);
  uint8_t *b = malloc(*n); if (fread(b, 1, *n, f) != (size_t)*n) exit(1); fclose(f);
  return b;
}
static void u32(FILE *f, uint32_t v) { fputc(v, f); fputc(v >> 8, f); fputc(v >> 16, f); fputc(v >> 24, f); }
static void u16(FILE *f, uint16_t v) { fputc(v, f); fputc(v >> 8, f); }

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: tnefar_cli voice in.tnefar out.wav [chunk]\n"); return 1; }
  long vn, n; uint8_t *v = slurp(argv[1], &vn), *b = slurp(argv[2], &n);
  intptr_t h = tnefar_open(b, (int)n, v, (int)vn);
  if (h < 0) { fprintf(stderr, "%s: tnefar_open failed (%ld)\n", argv[2], (long)h); return 1; }
  tnefar_t *d = (tnefar_t *)h;
  int N = tnefar_frames(d), chunk = argc > 4 ? atoi(argv[4]) : 10, total = 0, k;
  float speed = argc > 5 ? atof(argv[5]) : 1;
  tnefar_speed(d, speed);
  int16_t *pcm = malloc(sizeof(int16_t) * (size_t)((N + 3) / speed) * 160);
  while ((k = tnefar_run(d, chunk)) > 0) {
    const float *p = tnefar_pcm(d);
    for (int i = 0; i < k; i++) pcm[total++] = (int16_t)floorf(.5f + 32767.f * p[i]);
  }
  tnefar_close(d);
  FILE *o = fopen(argv[3], "wb"); if (!o) { perror(argv[3]); return 1; }
  fputs("RIFF", o); u32(o, 36 + 2 * total); fputs("WAVEfmt ", o); u32(o, 16); u16(o, 1); u16(o, 1);
  u32(o, 16000); u32(o, 32000); u16(o, 2); u16(o, 16); fputs("data", o); u32(o, 2 * total);
  fwrite(pcm, 2, total, o); fclose(o);
  fprintf(stderr, "%d frames -> %d samples\n", N, total);
  return 0;
}
