/* pf.c - feature postfilter network: 1-D convolution stack, forward/backward, file I/O, whole-file apply. */
#include "pf.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define PF_MAGIC 0x3246584e   /* "NXF2": float weights */
#define PF_MAGIC_Q 0x3346584e /* "NXF3": int8 weights + per-output-channel scales */
#define PF_BLOCK 4096         /* output frames per block in pf_apply */

typedef float v8 __attribute__((vector_size(32), aligned(4)));

/* C[i][j] += sum_p A[i][p] * B[p][j]; 4 rows x 16 columns register block */
void pf_gemm(int M, int K, int N, const float *A, int lda, const float *B, int ldb, float *C, int ldc) {
  int i = 0;
  for (; i + 4 <= M; i += 4) {
    const float *a0 = A + (size_t)i * lda, *a1 = a0 + lda, *a2 = a1 + lda, *a3 = a2 + lda;
    float *c0 = C + (size_t)i * ldc, *c1 = c0 + ldc, *c2 = c1 + ldc, *c3 = c2 + ldc;
    int j = 0;
    for (; j + 16 <= N; j += 16) {
      v8 x00 = *(v8 *)(c0 + j), x01 = *(v8 *)(c0 + j + 8), x10 = *(v8 *)(c1 + j), x11 = *(v8 *)(c1 + j + 8);
      v8 x20 = *(v8 *)(c2 + j), x21 = *(v8 *)(c2 + j + 8), x30 = *(v8 *)(c3 + j), x31 = *(v8 *)(c3 + j + 8);
      const float *b = B + j;
      for (int p = 0; p < K; p++, b += ldb) {
        v8 b0 = *(const v8 *)b, b1 = *(const v8 *)(b + 8);
        float s;
        s = a0[p]; x00 += s * b0; x01 += s * b1;
        s = a1[p]; x10 += s * b0; x11 += s * b1;
        s = a2[p]; x20 += s * b0; x21 += s * b1;
        s = a3[p]; x30 += s * b0; x31 += s * b1;
      }
      *(v8 *)(c0 + j) = x00; *(v8 *)(c0 + j + 8) = x01; *(v8 *)(c1 + j) = x10; *(v8 *)(c1 + j + 8) = x11;
      *(v8 *)(c2 + j) = x20; *(v8 *)(c2 + j + 8) = x21; *(v8 *)(c3 + j) = x30; *(v8 *)(c3 + j + 8) = x31;
    }
    for (; j + 8 <= N; j += 8) {
      v8 x0 = *(v8 *)(c0 + j), x1 = *(v8 *)(c1 + j), x2 = *(v8 *)(c2 + j), x3 = *(v8 *)(c3 + j);
      const float *b = B + j;
      for (int p = 0; p < K; p++, b += ldb) {
        v8 b0 = *(const v8 *)b;
        x0 += a0[p] * b0; x1 += a1[p] * b0; x2 += a2[p] * b0; x3 += a3[p] * b0;
      }
      *(v8 *)(c0 + j) = x0; *(v8 *)(c1 + j) = x1; *(v8 *)(c2 + j) = x2; *(v8 *)(c3 + j) = x3;
    }
    for (; j < N; j++) {
      float x0 = c0[j], x1 = c1[j], x2 = c2[j], x3 = c3[j];
      const float *b = B + j;
      for (int p = 0; p < K; p++, b += ldb) { x0 += a0[p] * *b; x1 += a1[p] * *b; x2 += a2[p] * *b; x3 += a3[p] * *b; }
      c0[j] = x0; c1[j] = x1; c2[j] = x2; c3[j] = x3;
    }
  }
  for (; i < M; i++) {
    const float *a = A + (size_t)i * lda; float *c = C + (size_t)i * ldc;
    for (int p = 0; p < K; p++) {
      float s = a[p]; if (s == 0) continue;
      const float *b = B + (size_t)p * ldb;
      for (int j = 0; j < N; j++) c[j] += s * b[j];
    }
  }
}

int pf_parse(pf_model *m, const char *spec) {
  memset(m, 0, sizeof *m);
  int cin = PF_NIN; const char *s = spec;
  while (*s) {
    if (m->nl >= PF_MAXL) return -1;
    pf_layer *l = &m->L[m->nl];
    int k, d = 1, co, n = 0; char a = 'n';
    if (sscanf(s, "%d%n", &k, &n) != 1) return -1;
    s += n;
    if (*s == '/') { s++; if (sscanf(s, "%d%n", &d, &n) != 1) return -1; s += n; }
    if (*s++ != ':' || sscanf(s, "%d%n", &co, &n) != 1) return -1;
    s += n;
    if (*s == ':') { s++; a = *s++; }
    l->res = 0;
    if (*s == ':') { s++; if (*s == '+' || *s == 'p') { l->res = 1; s++; } }
    if (*s == ',') s++;
    if (k < 1 || !(k & 1) || d < 1 || co < 1 || co > 4096) return -1;
    l->cin = cin; l->cout = co; l->k = k; l->dil = d;
    l->act = a == 'r' ? PF_RELU : a == 't' ? PF_TANH : PF_LIN;
    if (l->res && l->cin != l->cout) return -1;
    m->R += (k - 1) / 2 * d;
    cin = co; m->nl++;
  }
  if (!m->nl || cin != PF_NOUT) return -1;
  for (int i = 0; i < m->nl; i++) {
    pf_layer *l = &m->L[i];
    l->w = (float *)calloc((size_t)l->k * l->cin * l->cout, sizeof(float));
    l->b = (float *)calloc(l->cout, sizeof(float));
  }
  for (int i = 0; i < 20; i++) { m->mu[i] = 0; m->sd[i] = 1; }
  for (int i = 0; i < PF_NOUT; i++) { m->esd[i] = 1; m->keep[i] = 0; }
  return 0;
}

int pf_nparams(const pf_model *m) {
  int n = 0;
  for (int i = 0; i < m->nl; i++) n += m->L[i].k * m->L[i].cin * m->L[i].cout + m->L[i].cout;
  return n;
}

void pf_free(pf_model *m) {
  if (!m) return;
  for (int i = 0; i < m->nl; i++) { free(m->L[i].w); free(m->L[i].b); m->L[i].w = m->L[i].b = NULL; }
  m->nl = 0;
}

/* per-output-channel int8 scales of layer l: sc[j] = max_i |w[i][j]| / 127 */
static void layer_scales(const pf_layer *l, float *sc) {
  size_t rows = (size_t)l->k * l->cin;
  for (int j = 0; j < l->cout; j++) {
    float m = 0;
    for (size_t i = 0; i < rows; i++) { float a = fabsf(l->w[i * l->cout + j]); if (a > m) m = a; }
    sc[j] = m > 0 ? m / 127.0f : 1.0f;
  }
}

void pf_quantize(pf_model *m) {
  for (int i = 0; i < m->nl; i++) {
    pf_layer *l = &m->L[i]; float *sc = (float *)malloc(sizeof(float) * l->cout);
    layer_scales(l, sc);
    for (size_t r = 0; r < (size_t)l->k * l->cin; r++)
      for (int j = 0; j < l->cout; j++) l->w[r * l->cout + j] = sc[j] * (float)lrintf(l->w[r * l->cout + j] / sc[j]);
    free(sc);
  }
}

int pf_save(const pf_model *m, const char *path, int quant) {
  FILE *f = fopen(path, "wb"); if (!f) return -1;
  int hdr[2] = { quant ? PF_MAGIC_Q : PF_MAGIC, m->nl };
  fwrite(hdr, 4, 2, f);
  for (int i = 0; i < m->nl; i++) {
    const pf_layer *l = &m->L[i];
    int d[6] = { l->cin, l->cout, l->k, l->dil, l->act, l->res };
    fwrite(d, 4, 6, f);
  }
  fwrite(m->mu, 4, 20, f); fwrite(m->sd, 4, 20, f); fwrite(m->esd, 4, PF_NOUT, f); fwrite(m->keep, 4, PF_NOUT, f);
  for (int i = 0; i < m->nl; i++) {
    const pf_layer *l = &m->L[i]; size_t n = (size_t)l->k * l->cin * l->cout;
    if (quant) {
      float *sc = (float *)malloc(sizeof(float) * l->cout); int8_t *q = (int8_t *)malloc(n);
      layer_scales(l, sc);
      for (size_t r = 0; r < n; r++) { long v = lrintf(l->w[r] / sc[r % l->cout]); q[r] = (int8_t)(v > 127 ? 127 : v < -127 ? -127 : v); }
      fwrite(sc, 4, l->cout, f); fwrite(q, 1, n, f);
      free(sc); free(q);
    } else fwrite(l->w, 4, n, f);
    fwrite(l->b, 4, l->cout, f);
  }
  return fclose(f) ? -1 : 0;
}

pf_model *pf_load(const char *path) {
  FILE *f = fopen(path, "rb"); if (!f) return NULL;
  int hdr[2];
  pf_model *m = (pf_model *)calloc(1, sizeof *m);
  int ok = fread(hdr, 4, 2, f) == 2 && (hdr[0] == PF_MAGIC || hdr[0] == PF_MAGIC_Q) && hdr[1] > 0 && hdr[1] <= PF_MAXL;
  int quant = ok && hdr[0] == PF_MAGIC_Q, cin = PF_NIN;
  for (int i = 0; ok && i < hdr[1]; i++) {
    int d[6]; pf_layer *l = &m->L[i];
    ok = fread(d, 4, 6, f) == 6 && d[0] == cin && d[1] > 0 && d[1] <= 4096 && d[2] >= 1 && (d[2] & 1) &&
         d[3] >= 1 && d[3] <= 256 && d[4] >= 0 && d[4] <= 2 && (!d[5] || d[0] == d[1]);
    if (!ok) break;
    l->cin = d[0]; l->cout = d[1]; l->k = d[2]; l->dil = d[3]; l->act = d[4]; l->res = d[5];
    m->R += (l->k - 1) / 2 * l->dil; cin = l->cout; m->nl = i + 1;
  }
  ok = ok && cin == PF_NOUT && fread(m->mu, 4, 20, f) == 20 && fread(m->sd, 4, 20, f) == 20 &&
       fread(m->esd, 4, PF_NOUT, f) == PF_NOUT && fread(m->keep, 4, PF_NOUT, f) == PF_NOUT;
  for (int i = 0; ok && i < m->nl; i++) {
    pf_layer *l = &m->L[i]; size_t n = (size_t)l->k * l->cin * l->cout;
    l->w = (float *)malloc(4 * n); l->b = (float *)malloc(4 * (size_t)l->cout);
    if (quant) {   /* int8 weights, per-output-channel scale */
      float *sc = (float *)malloc(4 * (size_t)l->cout); int8_t *q = (int8_t *)malloc(n);
      ok = fread(sc, 4, l->cout, f) == (size_t)l->cout && fread(q, 1, n, f) == n;
      for (size_t r = 0; ok && r < n; r++) l->w[r] = sc[r % l->cout] * q[r];
      free(sc); free(q);
    } else ok = fread(l->w, 4, n, f) == n;
    ok = ok && fread(l->b, 4, l->cout, f) == (size_t)l->cout;
  }
  fclose(f);
  if (!ok) { pf_free(m); free(m); return NULL; }
  return m;
}

void pf_ws_init(pf_ws *w, const pf_model *m, int Tin) {
  memset(w, 0, sizeof *w);
  w->cap = Tin;
  int maxc = PF_NIN; size_t maxw = 0;
  for (int i = 0; i < m->nl; i++) {
    const pf_layer *l = &m->L[i];
    if (l->cout > maxc) maxc = l->cout;
    size_t n = (size_t)l->k * l->cin * l->cout; if (n > maxw) maxw = n;
  }
  w->a[0] = (float *)malloc(sizeof(float) * (size_t)Tin * PF_NIN);
  for (int i = 0; i < m->nl; i++) {
    w->a[i + 1] = (float *)malloc(sizeof(float) * (size_t)Tin * m->L[i].cout);
    w->h[i] = (float *)malloc(sizeof(float) * (size_t)Tin * m->L[i].cout);
  }
  w->g[0] = (float *)malloc(sizeof(float) * (size_t)Tin * maxc);
  w->g[1] = (float *)malloc(sizeof(float) * (size_t)Tin * maxc);
  w->wt = (float *)malloc(sizeof(float) * (maxw > (size_t)Tin * maxc ? maxw : (size_t)Tin * maxc));
}

void pf_ws_free(pf_ws *w) {
  for (int i = 0; i <= PF_MAXL; i++) free(w->a[i]);
  for (int i = 0; i < PF_MAXL; i++) free(w->h[i]);
  free(w->g[0]); free(w->g[1]); free(w->wt);
  memset(w, 0, sizeof *w);
}

void pf_forward(const pf_model *m, pf_ws *w, const float *in, int Tin) {
  memcpy(w->a[0], in, sizeof(float) * (size_t)Tin * PF_NIN);
  w->T[0] = Tin;
  for (int i = 0; i < m->nl; i++) {
    const pf_layer *l = &m->L[i];
    int Ti = w->T[i], To = Ti - (l->k - 1) * l->dil, ci = l->cin, co = l->cout;
    const float *x = w->a[i]; float *h = w->h[i], *y = w->a[i + 1];
    for (int t = 0; t < To; t++) memcpy(h + (size_t)t * co, l->b, sizeof(float) * co);
    for (int kk = 0; kk < l->k; kk++)
      pf_gemm(To, ci, co, x + (size_t)kk * l->dil * ci, ci, l->w + (size_t)kk * ci * co, co, h, co);
    size_t n = (size_t)To * co;
    if (l->act == PF_RELU) for (size_t j = 0; j < n; j++) h[j] = h[j] > 0 ? h[j] : 0;
    else if (l->act == PF_TANH) for (size_t j = 0; j < n; j++) h[j] = tanhf(h[j]);
    if (l->res) {
      const float *xc = x + (size_t)((l->k - 1) / 2 * l->dil) * ci;
      for (size_t j = 0; j < n; j++) y[j] = h[j] + xc[j];
    } else memcpy(y, h, sizeof(float) * n);
    w->T[i + 1] = To;
  }
}

void pf_backward(const pf_model *m, pf_ws *w, const float *gout, float *grad) {
  size_t off[PF_MAXL], o = 0;
  for (int i = 0; i < m->nl; i++) { off[i] = o; o += (size_t)m->L[i].k * m->L[i].cin * m->L[i].cout + m->L[i].cout; }
  int cur = 0;
  memcpy(w->g[0], gout, sizeof(float) * (size_t)w->T[m->nl] * PF_NOUT);
  for (int i = m->nl - 1; i >= 0; i--) {
    const pf_layer *l = &m->L[i];
    int Ti = w->T[i], To = w->T[i + 1], ci = l->cin, co = l->cout;
    float *gz = w->g[cur], *gx = w->g[cur ^ 1];
    const float *x = w->a[i], *h = w->h[i];
    if (i > 0) {
      memset(gx, 0, sizeof(float) * (size_t)Ti * ci);
      if (l->res) {
        float *gxc = gx + (size_t)((l->k - 1) / 2 * l->dil) * ci;
        for (size_t j = 0; j < (size_t)To * co; j++) gxc[j] += gz[j];
      }
    }
    size_t n = (size_t)To * co;
    if (l->act == PF_RELU) for (size_t j = 0; j < n; j++) { if (!(h[j] > 0)) gz[j] = 0; }
    else if (l->act == PF_TANH) for (size_t j = 0; j < n; j++) gz[j] *= 1 - h[j] * h[j];
    float *gw = grad + off[i], *gb = gw + (size_t)l->k * ci * co;
    for (int t = 0; t < To; t++) { const float *g = gz + (size_t)t * co; for (int j = 0; j < co; j++) gb[j] += g[j]; }
    for (int kk = 0; kk < l->k; kk++) {
      /* dW_kk += X_kk^T dZ : transpose the shifted input into wt (ci x To) */
      const float *xs = x + (size_t)kk * l->dil * ci;
      float *xt = w->wt;
      for (int t = 0; t < To; t++) for (int p = 0; p < ci; p++) xt[(size_t)p * To + t] = xs[(size_t)t * ci + p];
      pf_gemm(ci, To, co, xt, To, gz, co, gw + (size_t)kk * ci * co, co);
    }
    if (i > 0) {
      for (int kk = 0; kk < l->k; kk++) {
        const float *wk = l->w + (size_t)kk * ci * co; float *wt = w->wt;
        for (int p = 0; p < ci; p++) for (int j = 0; j < co; j++) wt[(size_t)j * ci + p] = wk[(size_t)p * co + j];
        pf_gemm(To, co, ci, gz, co, wt, ci, gx + (size_t)kk * l->dil * ci, ci);
      }
    }
    cur ^= 1;
  }
}

void pf_inputs(const pf_model *m, const float *feat, const uint8_t *coded, int N, float *out) {
  int last = -1;
  for (int t = 0; t < N; t++) {
    float *x = out + (size_t)t * PF_NIN;
    for (int i = 0; i < 20; i++) x[i] = (feat[(size_t)t * 20 + i] - m->mu[i]) / m->sd[i];
    x[20] = coded[t] ? 1.0f : 0.0f;
    if (coded[t]) last = t;
    x[21] = last >= 0 ? (float)(t - last < 16 ? t - last : 16) : 16.0f;   /* dp, finished below */
  }
  last = -1;
  for (int t = N - 1; t >= 0; t--) {
    float *x = out + (size_t)t * PF_NIN;
    if (coded[t]) last = t;
    float dp = x[21], dn = last >= 0 ? (float)(last - t < 16 ? last - t : 16) : 16.0f, g = dp + dn;
    x[21] = dp / 16; x[22] = dn / 16; x[23] = g / 16; x[24] = g > 0 ? dp / (g > 1 ? g : 1) : 0.0f;
  }
}

void pf_apply(const pf_model *m, float *feat, const uint8_t *coded, int N) {
  if (N <= 0) return;
  float *inp = (float *)malloc(sizeof(float) * (size_t)N * PF_NIN);
  pf_inputs(m, feat, coded, N, inp);
  int R = m->R, B = N < PF_BLOCK ? N : PF_BLOCK;
  float *blk = (float *)malloc(sizeof(float) * (size_t)(B + 2 * R) * PF_NIN);
  float *delta = (float *)malloc(sizeof(float) * (size_t)N * PF_NOUT);
  pf_ws ws; pf_ws_init(&ws, m, B + 2 * R);
  for (int t0 = 0; t0 < N; t0 += B) {
    int T = N - t0 < B ? N - t0 : B;
    for (int t = 0; t < T + 2 * R; t++) {
      int j = t0 + t - R; if (j < 0) j = 0; if (j > N - 1) j = N - 1;
      memcpy(blk + (size_t)t * PF_NIN, inp + (size_t)j * PF_NIN, sizeof(float) * PF_NIN);
    }
    pf_forward(m, &ws, blk, T + 2 * R);
    const float *o = ws.a[m->nl];
    for (int t = 0; t < T; t++) for (int j = 0; j < PF_NOUT; j++) {
      float d = o[(size_t)t * PF_NOUT + j] * m->esd[j] * m->keep[j];
      if (j == 18 && !(feat[(size_t)(t0 + t) * 20 + 19] > 0)) d = 0;   /* pitch only where decoded voiced */
      delta[(size_t)(t0 + t) * PF_NOUT + j] = d;
    }
  }
  for (int t = 0; t < N; t++) for (int j = 0; j < PF_NOUT; j++) feat[(size_t)t * 20 + j] += delta[(size_t)t * PF_NOUT + j];
  pf_ws_free(&ws); free(blk); free(inp); free(delta);
}
