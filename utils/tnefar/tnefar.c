/* tnefar.c - the tnefar audio decoder: fcq feature bitstream -> learned postfilter -> FARGAN speech.
 *
 * A .tnefar file is an fcq bitstream (zclaude/ in the opus2 tree): quantized FARGAN feature frames
 * for one speaker's codebook. Decoding is two steps:
 *   1. tnefar_open: the whole bitstream to features (cheap: range decoding + a small int8 conv
 *      postfilter), then FARGAN is primed.
 *   2. tnefar_run: FARGAN synthesis, a few 10 ms frames at a time (the expensive part), so the
 *      caller can play the first piece while the rest is still being made.
 *
 * Built in: only FARGAN's weights (int8 matrices, opus' weights_blob.bin). The speaker's voice comes
 * with their recordings (the slab's tnefar.voice): [u32 codebook bytes][codebook .fcq][postfilter .nnf],
 * both int8, trained together (README.md). The caller passes it to tnefar_open.
 *
 * The codec's loaders read files (fopen); here those are the voice in memory (fmemopen), so the
 * codec sources are used unchanged (the Makefile compiles them with -Dfopen=tnefar_fopen). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "fcq/fcq.h"
#include "opus/fargan.h"
#include "opus/lpcnet.h"

#define CHUNK_MAX 64            /* frames per tnefar_run call, at most */
#define FRAME 160               /* samples per 10 ms frame at 16 kHz */

static const unsigned char fargan_blob[] __attribute__((aligned(64))) = {
#embed "fargan.bin"
};

/* Voices loaded (by where the caller keeps them: it passes the same one each time). A stream holds its
 * voice (users) so another voice loading can't free a filter it's still using (a paused chapter). */
typedef struct { const uint8_t *v; int len, users; Codebook *cb; nnf_t *pf; } voice_t;
#define NVOICE 4
static voice_t voices[NVOICE];
static const uint8_t *part; static size_t part_len;   /* what tnefar_fopen opens */

FILE *tnefar_fopen(const char *path, const char *mode) {
  (void)path; (void)mode;
  return part_len ? fmemopen((void *)part, part_len, "rb") : NULL;
}
/* the codec's debugging switches (FCQ_* environment variables) are all off */
char *tnefar_getenv(const char *name) { (void)name; return NULL; }

static voice_t *load_voice(const uint8_t *v, int len) {
  voice_t *free_slot = NULL;
  for (int i = 0; i < NVOICE; i++) {
    if (voices[i].cb && voices[i].v == v && voices[i].len == len) return &voices[i];
    if (!voices[i].users && (!free_slot || !voices[i].cb)) free_slot = &voices[i];
  }
  if (!free_slot || !v || len < 4) return NULL;
  voice_t *o = free_slot;
  if (o->cb) codebook_free(o->cb);
  if (o->pf) nnf_free(o->pf);
  memset(o, 0, sizeof *o);
  uint32_t n = v[0] | v[1] << 8 | v[2] << 16 | (uint32_t)v[3] << 24;
  if (n > (uint32_t)len - 4) return NULL;
  part = v + 4; part_len = n; o->cb = codebook_load("codebook");
  part = v + 4 + n; part_len = len - 4 - n; o->pf = part_len ? nnf_load("postfilter") : NULL;   /* (none: no postfilter) */
  part_len = 0;
  if (!o->cb) { if (o->pf) nnf_free(o->pf); o->pf = NULL; return NULL; }
  o->v = v; o->len = len;
  return o;
}

static FARGAN g_model;          /* FARGAN's layers (pointers into fargan_blob), shared by every stream */
static int g_ready;
static int init(void) {
  if (g_ready) return g_ready;
  fcq_init();
  FARGANState st;
  g_ready = fargan_load_model(&st, fargan_blob, sizeof fargan_blob) ? -1 : 1;
  if (g_ready > 0) g_model = st.model;
  return g_ready;
}

typedef struct tnefar {
  FARGANState fg;
  voice_t *voice;
  float *feat;                  /* N x NFEAT features: decoded, then postfiltered up to frame done */
  float *raw; uint8_t *mask;    /* (with a postfilter) the decoded features and their anchors */
  int N, t, stop, skip, done;
  float out[CHUNK_MAX * FRAME];
} tnefar_t;

/* postfilter frames up to (not including) upto: a block at a time, just ahead of FARGAN */
static void filter_to(tnefar_t *d, int upto) {
  if (upto > d->N) upto = d->N;
  while (d->done < upto) {
    int T = d->done ? 256 : 32;   /* (a small first block: the sound starts sooner) */
    if (T > d->N - d->done) T = d->N - d->done;
    nnf_apply_range(d->voice->pf, d->raw, d->mask, d->N, d->done, T, d->feat + (size_t)d->done * NFEAT);
    d->done += T;
  }
}

/* A stream for one file in the voice v (its slab's tnefar.voice, which must stay where it is while
 * it's used). <0 on error: -1 no FARGAN (or memory), -2 not the voice's file (or no voice), -3 bad file */
__attribute__((used)) intptr_t tnefar_open(const uint8_t *buf, int len, const uint8_t *v, int vlen) {
  if (init() < 0) return -1;
  voice_t *vo = load_voice(v, vlen);
  if (!vo) return -2;
  float *feat; int N; uint8_t *mask = NULL;
  int r = decode_stream_ex(vo->cb, buf, (size_t)len, &feat, &N, &mask);
  if (r) return r == -2 ? -2 : -3;
  tnefar_t *d = (tnefar_t *)calloc(1, sizeof *d);
  if (!d) { free(feat); free(mask); return -1; }
  d->voice = vo; vo->users++;
  d->N = N; d->t = 1; d->skip = FRAME / 2;
  if (vo->pf && nnf_apply_range(vo->pf, feat, mask, N, 0, 0, feat) == 0) {   /* streaming filter */
    d->raw = feat; d->mask = mask; d->feat = (float *)malloc(sizeof(float) * (size_t)N * NFEAT);
    filter_to(d, 1);
  } else {
    if (vo->pf) nnf_apply(vo->pf, feat, mask, N);   /* (an old-style filter: all of it now) */
    free(mask); d->feat = feat; d->done = N;
  }
  /* as opus' fargan_demo: FARGAN continues from silence, primed with the first frame */
  fargan_init(&d->fg);
  d->fg.model = g_model;
  float f5[5 * NB_FEATURES], zeros[FARGAN_CONT_SAMPLES] = {0};
  for (int i = 0; i < 5; i++) memcpy(f5 + i * NB_FEATURES, d->feat, sizeof(float) * NB_FEATURES);
  fargan_cont(&d->fg, zeros, f5);
  return (intptr_t)d;
}

/* Frames in the file (100 a second): its length is tnefar_frames * 160 samples at 16 kHz */
__attribute__((used)) int tnefar_frames(tnefar_t *d) { return d->N; }

/* Synthesize up to n frames into tnefar_pcm: the number of samples made, 0 at the end */
__attribute__((used)) int tnefar_run(tnefar_t *d, int n) {
  int k = 0;
  if (n > CHUNK_MAX) n = CHUNK_MAX;
  for (int i = 0; i < n && d->stop < 2; i++) {
    int fi = d->t < d->N ? d->t : d->N - 1;
    filter_to(d, fi + 1);
    const float *f = d->feat + (size_t)fi * NFEAT;
    if (d->t < d->N) d->t++; else d->stop++;
    float pcm[FRAME];
    fargan_synthesize(&d->fg, pcm, f);
    int end = d->stop == 2 ? d->skip + FRAME / 2 : FRAME;   /* the last frame: half (FARGAN's lookahead) */
    for (int j = d->skip; j < end; j++) d->out[k++] = pcm[j] > 1.f ? 1.f : pcm[j] < -1.f ? -1.f : pcm[j];
    d->skip = 0;
  }
  return k;
}
/* (testing: the decoded features, N x 20) */
__attribute__((used)) float *tnefar_feat(tnefar_t *d) { filter_to(d, d->N); return d->feat; }
__attribute__((used)) float *tnefar_pcm(tnefar_t *d) { return d->out; }
__attribute__((used)) void tnefar_close(tnefar_t *d) {
  if (!d) return;
  d->voice->users--;
  free(d->feat); free(d->raw); free(d->mask); free(d);
}
