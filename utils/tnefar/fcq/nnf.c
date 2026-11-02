/* nnf.c - learned feature postfilter (decoder side): small MLP that corrects the decoded cepstrum
 * using a window of decoded frames, the anchor mask and the position inside the gap.
 * Weights come from a .nnf file written by export_nnf.py (trained offline, per speaker/codec). */
#include "fcq.h"
#include "pf.h"
#define PF_MAXENS 8   /* --nnf a.nnf,b.nnf,... : NXF2 ensemble, corrections averaged */
#include <stdlib.h>
#include <string.h>
#include <math.h>

struct nnf { int W, nin, h1, h2, nout; float mu[NFEAT], sd[NFEAT], esd[NFEAT - 1], keep[NFEAT - 1];
             float *w1, *b1, *w2, *b2, *w3, *b3; pf_model *pf[PF_MAXENS]; int npf; };

nnf_t *nnf_load(const char *path) {
  if (strchr(path, ',')) {   /* ensemble of NXF2 filters */
    nnf_t *n = (nnf_t *)calloc(1, sizeof *n);
    char *s = strdup(path), *sv = NULL;
    for (char *t = strtok_r(s, ",", &sv); t; t = strtok_r(NULL, ",", &sv)) {
      pf_model *pm = n->npf < PF_MAXENS ? pf_load(t) : NULL;
      if (!pm) { free(s); nnf_free(n); return NULL; }
      n->pf[n->npf++] = pm;
    }
    free(s); return n;
  }
  pf_model *pm = pf_load(path);   /* NXF2: convolutional filter trained by pftrain */
  if (pm) { nnf_t *n = (nnf_t *)calloc(1, sizeof *n); n->pf[0] = pm; n->npf = 1; return n; }
  FILE *f = fopen(path, "rb"); if (!f) return NULL;
  int hdr[6];
  if (fread(hdr, 4, 6, f) != 6 || hdr[0] != 0x3146584e /* "NXF1" */ || hdr[5] != NFEAT - 1) { fclose(f); return NULL; }
  nnf_t *n = (nnf_t *)calloc(1, sizeof *n);
  n->W = hdr[1]; n->nin = hdr[2]; n->h1 = hdr[3]; n->h2 = hdr[4]; n->nout = hdr[5];
  if (n->nin != (2 * n->W + 1) * (NFEAT + 1) + 5 || n->W < 0 || n->W > 64 || n->h1 > 4096 || n->h2 > 4096) { free(n); fclose(f); return NULL; }
  int ok = fread(n->mu, 4, NFEAT, f) == NFEAT && fread(n->sd, 4, NFEAT, f) == NFEAT &&
           fread(n->esd, 4, NFEAT - 1, f) == NFEAT - 1 && fread(n->keep, 4, NFEAT - 1, f) == NFEAT - 1;
  size_t s1 = (size_t)n->nin * n->h1, s2 = (size_t)n->h1 * n->h2, s3 = (size_t)n->h2 * n->nout;
  n->w1 = (float *)malloc(4 * s1); n->b1 = (float *)malloc(4 * n->h1);
  n->w2 = (float *)malloc(4 * s2); n->b2 = (float *)malloc(4 * n->h2);
  n->w3 = (float *)malloc(4 * s3); n->b3 = (float *)malloc(4 * n->nout);
  ok = ok && fread(n->w1, 4, s1, f) == s1 && fread(n->b1, 4, n->h1, f) == (size_t)n->h1 &&
       fread(n->w2, 4, s2, f) == s2 && fread(n->b2, 4, n->h2, f) == (size_t)n->h2 &&
       fread(n->w3, 4, s3, f) == s3 && fread(n->b3, 4, n->nout, f) == (size_t)n->nout;
  fclose(f);
  if (!ok) { nnf_free(n); return NULL; }
  return n;
}
void nnf_free(nnf_t *n) {
  if (!n) return;
  for (int i = 0; i < n->npf; i++) { pf_free(n->pf[i]); free(n->pf[i]); }
  free(n->w1); free(n->b1); free(n->w2); free(n->b2); free(n->w3); free(n->b3); free(n);
}

/* feat: N x NFEAT decoded features, corrected in place. coded: per-frame anchor flags (decoder known). */
void nnf_apply(const nnf_t *n, float *feat, const uint8_t *coded, int N) {
  if (N <= 0) return;
  if (n->npf == 1) { pf_apply(n->pf[0], feat, coded, N); return; }
  if (n->npf > 1) {
    size_t sz = sizeof(float) * (size_t)N * NFEAT;
    float *tmp = (float *)malloc(sz), *acc = (float *)calloc((size_t)N * NFEAT, sizeof(float));
    for (int i = 0; i < n->npf; i++) {
      memcpy(tmp, feat, sz); pf_apply(n->pf[i], tmp, coded, N);
      for (size_t j = 0; j < (size_t)N * NFEAT; j++) acc[j] += tmp[j] - feat[j];
    }
    for (size_t j = 0; j < (size_t)N * NFEAT; j++) feat[j] += acc[j] / n->npf;
    free(tmp); free(acc); return;
  }
  int W = n->W, nw = 2 * W + 1;
  float *norm = (float *)malloc(sizeof(float) * (size_t)N * NFEAT);
  int *pa = (int *)malloc(sizeof(int) * N), *na = (int *)malloc(sizeof(int) * N);
  for (int t = 0; t < N; t++) for (int i = 0; i < NFEAT; i++) norm[(size_t)t * NFEAT + i] = (feat[(size_t)t * NFEAT + i] - n->mu[i]) / n->sd[i];
  int last = -1; for (int t = 0; t < N; t++) { if (coded[t]) last = t; pa[t] = last; }
  last = -1;     for (int t = N - 1; t >= 0; t--) { if (coded[t]) last = t; na[t] = last; }
  float *x = (float *)malloc(sizeof(float) * n->nin), *h1 = (float *)malloc(sizeof(float) * n->h1),
        *h2 = (float *)malloc(sizeof(float) * n->h2), *o = (float *)malloc(sizeof(float) * n->nout);
  float *delta = (float *)calloc((size_t)N * (NFEAT - 1), sizeof(float));
  for (int t = 0; t < N; t++) {
    int p = 0;
    for (int k = 0; k < nw; k++) {
      int j = t - W + k; if (j < 0) j = 0; if (j > N - 1) j = N - 1;
      memcpy(x + p, norm + (size_t)j * NFEAT, sizeof(float) * NFEAT); p += NFEAT;
    }
    for (int k = 0; k < nw; k++) {
      int j = t - W + k; if (j < 0) j = 0; if (j > N - 1) j = N - 1;
      x[p++] = coded[j] ? 1.0f : 0.0f;
    }
    float dp = pa[t] >= 0 ? (float)(t - pa[t] < 16 ? t - pa[t] : 16) : 16.0f;
    float dn = na[t] >= 0 ? (float)(na[t] - t < 16 ? na[t] - t : 16) : 16.0f;
    float g = dp + dn;
    x[p++] = dp / 16; x[p++] = dn / 16; x[p++] = g / 16; x[p++] = g > 0 ? dp / (g > 1 ? g : 1) : 0.0f; x[p++] = coded[t] ? 1.0f : 0.0f;
    memcpy(h1, n->b1, sizeof(float) * n->h1);
    for (int i = 0; i < n->nin; i++) { float xi = x[i]; if (xi == 0) continue; const float *w = n->w1 + (size_t)i * n->h1; for (int j = 0; j < n->h1; j++) h1[j] += xi * w[j]; }
    for (int j = 0; j < n->h1; j++) if (h1[j] < 0) h1[j] = 0;
    memcpy(h2, n->b2, sizeof(float) * n->h2);
    for (int i = 0; i < n->h1; i++) { float xi = h1[i]; if (xi == 0) continue; const float *w = n->w2 + (size_t)i * n->h2; for (int j = 0; j < n->h2; j++) h2[j] += xi * w[j]; }
    for (int j = 0; j < n->h2; j++) if (h2[j] < 0) h2[j] = 0;
    memcpy(o, n->b3, sizeof(float) * n->nout);
    for (int i = 0; i < n->h2; i++) { float xi = h2[i]; if (xi == 0) continue; const float *w = n->w3 + (size_t)i * n->nout; for (int j = 0; j < n->nout; j++) o[j] += xi * w[j]; }
    for (int j = 0; j < NFEAT - 1; j++) {
      float d = o[j] * n->esd[j] * n->keep[j];
      if (j == F_PITCH && !(feat[(size_t)t * NFEAT + F_CORR] > 0)) d = 0;   /* pitch only where decoded voiced */
      delta[(size_t)t * (NFEAT - 1) + j] = d;
    }
  }
  for (int t = 0; t < N; t++) for (int j = 0; j < NFEAT - 1; j++) feat[(size_t)t * NFEAT + j] += delta[(size_t)t * (NFEAT - 1) + j];
  free(norm); free(pa); free(na); free(x); free(h1); free(h2); free(o); free(delta);
}
