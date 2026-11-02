/* rvq.c - residual vector quantizer with int8 codebooks, variable stage count */
#include "fcq.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>

static uint32_t rnd(uint32_t *s) { uint32_t x = *s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; return *s = x; }
static float rndf(uint32_t *s) { return (rnd(s) >> 8) * (1.0f / 16777216.0f); }

void rvq_alloc(rvq_t *q, int nst, const int *bits) {
  memset(q, 0, sizeof *q);
  q->nst = nst;
  for (int s = 0; s < nst; s++) {
    size_t K = (size_t)1 << bits[s];
    q->bits[s] = bits[s];
    q->cb[s] = (int8_t *)calloc(K * NCEP, 1);
    q->cbf[s] = (float *)calloc(K * NCEP, sizeof(float));
    q->cbt[s] = (float *)calloc(K * NCEP, sizeof(float));
    q->prior[s] = (uint16_t *)calloc(K, sizeof(uint16_t));
    for (int d = 0; d < NCEP; d++) q->scale[s][d] = 1.0f;
    for (size_t k = 0; k < K; k++) q->prior[s][k] = 1;
  }
}
void rvq_free(rvq_t *q) {
  for (int s = 0; s < q->nst; s++) { free(q->cb[s]); free(q->cbf[s]); free(q->cbt[s]); free(q->prior[s]); }
  memset(q, 0, sizeof *q);
}
static void stage_dequant(rvq_t *q, int s) {
  size_t K = (size_t)1 << q->bits[s];
  for (size_t k = 0; k < K; k++)
    for (int d = 0; d < NCEP; d++)
      q->cbt[s][d * K + k] = q->cbf[s][k * NCEP + d] = (float)q->cb[s][k * NCEP + d] * q->scale[s][d];
}
void rvq_finalize(rvq_t *q) { for (int s = 0; s < q->nst; s++) stage_dequant(q, s); }

/* quantize a float stage codebook to int8 with per-dimension scale */
static void rvq_set_stage(rvq_t *q, int s, const float *c) {
  size_t K = (size_t)1 << q->bits[s];
  for (int d = 0; d < NCEP; d++) {
    float m = 0;
    for (size_t k = 0; k < K; k++) { float a = fabsf(c[k * NCEP + d]); if (a > m) m = a; }
    float sc = m / 127.0f; if (sc < 1e-7f) sc = 1e-7f;
    q->scale[s][d] = sc;
    for (size_t k = 0; k < K; k++) {
      long v = lrintf(c[k * NCEP + d] / sc);
      if (v > 127) v = 127; if (v < -127) v = -127;
      q->cb[s][k * NCEP + d] = (int8_t)v;
    }
  }
  stage_dequant(q, s);
}
static void rvq_copy(rvq_t *d, const rvq_t *s) {
  for (int st = 0; st < s->nst; st++) {
    size_t K = (size_t)1 << s->bits[st];
    memcpy(d->cb[st], s->cb[st], K * NCEP);
    memcpy(d->cbf[st], s->cbf[st], K * NCEP * sizeof(float));
    memcpy(d->cbt[st], s->cbt[st], K * NCEP * sizeof(float));
    memcpy(d->scale[st], s->scale[st], sizeof s->scale[st]);
  }
}
static void rvq_clone(rvq_t *d, const rvq_t *s) { rvq_alloc(d, s->nst, s->bits); rvq_copy(d, s); }

/* ---------------- k-means (LBG splitting, dead-cell reseeding) ---------------- */
static void assign(const float *x, int n, const float *cent, int k, int *asg, float *dist) {
#pragma omp parallel for schedule(static)
  for (int i = 0; i < n; i++) {
    const float *xi = x + (size_t)i * NCEP;
    float best = 1e30f; int bj = 0;
    for (int j = 0; j < k; j++) {
      const float *c = cent + (size_t)j * NCEP; float d = 0;
      for (int e = 0; e < NCEP; e++) { float t = xi[e] - c[e]; d += t * t; }
      if (d < best) { best = d; bj = j; }
    }
    asg[i] = bj; dist[i] = best;
  }
}

static void kmeans(const float *x, int n, int K, float *cent, int iters, uint32_t *rng) {
  int *asg = (int *)malloc(sizeof(int) * n);
  float *dist = (float *)malloc(sizeof(float) * n);
  double *sum = (double *)malloc(sizeof(double) * (size_t)K * NCEP);
  int *cnt = (int *)malloc(sizeof(int) * K);
  double mean[NCEP] = {0}, sd[NCEP] = {0};
  for (int i = 0; i < n; i++) for (int e = 0; e < NCEP; e++) mean[e] += x[(size_t)i * NCEP + e];
  for (int e = 0; e < NCEP; e++) mean[e] /= n;
  for (int i = 0; i < n; i++) for (int e = 0; e < NCEP; e++) { double t = x[(size_t)i * NCEP + e] - mean[e]; sd[e] += t * t; }
  for (int e = 0; e < NCEP; e++) { sd[e] = sqrt(sd[e] / n); cent[e] = (float)mean[e]; }
  int k = 1;
  for (;;) {
    for (int it = 0; it < iters; it++) {
      assign(x, n, cent, k, asg, dist);
      memset(sum, 0, sizeof(double) * (size_t)k * NCEP); memset(cnt, 0, sizeof(int) * k);
      for (int i = 0; i < n; i++) {
        int j = asg[i]; cnt[j]++;
        for (int e = 0; e < NCEP; e++) sum[(size_t)j * NCEP + e] += x[(size_t)i * NCEP + e];
      }
      for (int j = 0; j < k; j++) {
        if (cnt[j] > 0) {
          for (int e = 0; e < NCEP; e++) cent[(size_t)j * NCEP + e] = (float)(sum[(size_t)j * NCEP + e] / cnt[j]);
        } else { /* dead entry: steal the worst-fit point */
          int far = 0; float fd = -1;
          for (int i = 0; i < n; i++) if (dist[i] > fd) { fd = dist[i]; far = i; }
          memcpy(cent + (size_t)j * NCEP, x + (size_t)far * NCEP, sizeof(float) * NCEP);
          dist[far] = 0;
        }
      }
    }
    if (k >= K) break;
    for (int j = 0; j < k; j++)
      for (int e = 0; e < NCEP; e++) {
        float d = 0.02f * (float)sd[e] * (2 * rndf(rng) - 1);
        cent[(size_t)(j + k) * NCEP + e] = cent[(size_t)j * NCEP + e] - d;
        cent[(size_t)j * NCEP + e] += d;
      }
    k *= 2;
  }
  free(asg); free(dist); free(sum); free(cnt);
}

/* plain Lloyd iterations from the given K centroids (no splitting); empty cells keep their centroid */
static void lloyd(const float *x, int n, int K, float *cent, int iters) {
  int *asg = (int *)malloc(sizeof(int) * n);
  float *dist = (float *)malloc(sizeof(float) * n);
  double *sum = (double *)malloc(sizeof(double) * (size_t)K * NCEP);
  int *cnt = (int *)malloc(sizeof(int) * K);
  for (int it = 0; it < iters; it++) {
    assign(x, n, cent, K, asg, dist);
    memset(sum, 0, sizeof(double) * (size_t)K * NCEP); memset(cnt, 0, sizeof(int) * K);
    for (int i = 0; i < n; i++) {
      int j = asg[i]; cnt[j]++;
      for (int e = 0; e < NCEP; e++) sum[(size_t)j * NCEP + e] += x[(size_t)i * NCEP + e];
    }
    for (int j = 0; j < K; j++)
      if (cnt[j] > 0)
        for (int e = 0; e < NCEP; e++) cent[(size_t)j * NCEP + e] = (float)(sum[(size_t)j * NCEP + e] / cnt[j]);
  }
  free(asg); free(dist); free(sum); free(cnt);
}

/* ---------------- search ---------------- */
typedef struct { float res[NCEP]; int idx[MAXST]; float rate, score; } bm_t;
typedef struct { float score, rate; int parent, k; } cand_t;

void rvq_decode(const rvq_t *q, int stages, const int *idx, float *out) {
  for (int d = 0; d < NCEP; d++) out[d] = 0;
  for (int s = 0; s < stages; s++)
    for (int d = 0; d < NCEP; d++)
      out[d] += (float)q->cb[s][(size_t)idx[s] * NCEP + d] * q->scale[s][d];
}

/* Progressive M-best search: after every stage the best-scoring beam entry is recorded,
 * so one search yields the best path for every stage count 0..stages.
 * pidx[L][0..L-1], pdist[L], prate[L] (bits of the indices under the supplied models). */
void rvq_encode_prog(const rvq_t *q, int stages, int beam, const float *t,
                     const model_t *models, float il,
                     int pidx[][MAXST], float *pdist, float *prate) {
  if (beam < 1) beam = 1;
  if (beam > MAXBEAM) beam = MAXBEAM;
  if (stages > q->nst) stages = q->nst;
  bm_t A[MAXBEAM], B[MAXBEAM];
  bm_t *cur = A, *nxt = B; int nc = 1;
  memcpy(cur[0].res, t, sizeof(float) * NCEP);
  cur[0].rate = 0; cur[0].score = 0;
  { float d = 0; for (int e = 0; e < NCEP; e++) d += t[e] * t[e]; pdist[0] = d; prate[0] = 0; }
  for (int s = 0; s < stages; s++) {
    int K = 1 << q->bits[s];
    const float *cbf = q->cbf[s];
    cand_t c[MAXBEAM * MAXBEAM]; int ncand = 0;
    /* distances for all codewords at once (transposed codebook; per-codeword summation order unchanged) */
    const float *cbt = q->cbt[s];
    float dk[1 << MAXBITS], lgk[1 << MAXBITS], lgt = 0;
    if (models) { lgt = fcq_lg(models[s].total); for (int k = 0; k < K; k++) lgk[k] = fcq_lg(models[s].f[k]); }
    for (int b = 0; b < nc; b++) {
      cand_t top[MAXBEAM]; int nt = 0;
      for (int k = 0; k < K; k++) dk[k] = 0;
      for (int e = 0; e < NCEP; e++) {
        const float x = cur[b].res[e], *cw = cbt + (size_t)e * K;
        for (int k = 0; k < K; k++) { float y = x - cw[k]; dk[k] += y * y; }
      }
      for (int k = 0; k < K; k++) {
        float d = dk[k];
        float r = cur[b].rate;
        if (models) r += lgt - lgk[k];
        float sc = d + il * r;
        if (nt < beam || sc < top[nt - 1].score) {
          int pos = nt < beam ? nt : beam - 1;
          if (nt < beam) nt++;
          while (pos > 0 && top[pos - 1].score > sc) { top[pos] = top[pos - 1]; pos--; }
          top[pos].score = sc; top[pos].rate = r; top[pos].parent = b; top[pos].k = k;
        }
      }
      for (int i = 0; i < nt; i++) c[ncand++] = top[i];
    }
    int nn = 0;
    for (; nn < beam && nn < ncand; nn++) {
      int m = nn;
      for (int i = nn + 1; i < ncand; i++) if (c[i].score < c[m].score) m = i;
      cand_t tmp = c[nn]; c[nn] = c[m]; c[m] = tmp;
    }
    for (int i = 0; i < nn; i++) {
      bm_t *o = &nxt[i]; const bm_t *p = &cur[c[i].parent];
      memcpy(o->idx, p->idx, sizeof o->idx);
      o->idx[s] = c[i].k; o->rate = c[i].rate; o->score = c[i].score;
      for (int e = 0; e < NCEP; e++) o->res[e] = p->res[e] - cbf[(size_t)c[i].k * NCEP + e];
    }
    bm_t *tmp = cur; cur = nxt; nxt = tmp; nc = nn;
    float d = 0;
    for (int e = 0; e < NCEP; e++) d += cur[0].res[e] * cur[0].res[e];
    pdist[s + 1] = d; prate[s + 1] = cur[0].rate;
    for (int i = 0; i <= s; i++) pidx[s + 1][i] = cur[0].idx[i];
  }
}

float rvq_encode(const rvq_t *q, int stages, int beam, const float *t,
                 const model_t *models, float il, int *idx, float *recon) {
  int pidx[MAXST + 1][MAXST]; float pd[MAXST + 1], pr[MAXST + 1];
  if (stages > q->nst) stages = q->nst;
  rvq_encode_prog(q, stages, beam, t, models, il, pidx, pd, pr);
  for (int s = 0; s < stages; s++) idx[s] = pidx[stages][s];
  if (recon) rvq_decode(q, stages, idx, recon);
  return pd[stages];
}

/* ---------------- training ---------------- */
static double metric(const rvq_t *q, const float *x, int n, int step) {
  double tot = 0; int cnt = 0, idx[MAXST];
  for (int i = 0; i < n; i += step) {
    for (int L = 1; L <= q->nst; L++) tot += rvq_encode(q, L, 1, x + (size_t)i * NCEP, NULL, 0, idx, NULL);
    cnt++;
  }
  return tot / cnt;
}

/* Joint refinement: random stage truncation per vector, coordinate-descent centroid
 * updates against the full reconstruction. Keeps a result only if the
 * truncation-averaged distortion improves. */
static void finetune(rvq_t *q, const float *x, int n, int epochs, uint32_t *rng, int verbose) {
  int S = q->nst;
  if (S < 2) return;
  int step = n / 20000 + 1;
  rvq_t best; rvq_clone(&best, q);
  double bm = metric(q, x, n, step);
  if (verbose) fprintf(stderr, "  finetune start: truncation-avg dist %.5f\n", bm);
  int *L = (int *)malloc(sizeof(int) * n);
  int *idx = (int *)malloc(sizeof(int) * (size_t)n * MAXST);
  for (int ep = 0; ep < epochs; ep++) {
    for (int i = 0; i < n; i++) {
      L[i] = 1 + (int)(rnd(rng) % S);
      rvq_encode(q, L[i], 1, x + (size_t)i * NCEP, NULL, 0, idx + (size_t)i * MAXST, NULL);
    }
    for (int s = 0; s < S; s++) {
      size_t K = (size_t)1 << q->bits[s];
      double *sum = (double *)calloc(K * NCEP, sizeof(double));
      int *cnt = (int *)calloc(K, sizeof(int));
      for (int i = 0; i < n; i++) {
        if (L[i] <= s) continue;
        float t[NCEP];
        memcpy(t, x + (size_t)i * NCEP, sizeof t);
        for (int tt = 0; tt < L[i]; tt++) {
          if (tt == s) continue;
          const float *cw = q->cbf[tt] + (size_t)idx[(size_t)i * MAXST + tt] * NCEP;
          for (int e = 0; e < NCEP; e++) t[e] -= cw[e];
        }
        int k = idx[(size_t)i * MAXST + s]; cnt[k]++;
        for (int e = 0; e < NCEP; e++) sum[(size_t)k * NCEP + e] += t[e];
      }
      float *cent = (float *)malloc(K * NCEP * sizeof(float));
      for (size_t k = 0; k < K; k++)
        for (int e = 0; e < NCEP; e++)
          cent[k * NCEP + e] = cnt[k] ? (float)(sum[k * NCEP + e] / cnt[k]) : q->cbf[s][k * NCEP + e];
      rvq_set_stage(q, s, cent);
      free(cent); free(sum); free(cnt);
    }
    double m = metric(q, x, n, step);
    if (verbose) fprintf(stderr, "  finetune epoch %d: %.5f %s\n", ep + 1, m, m < bm ? "(kept)" : "(reverted)");
    if (m < bm) { bm = m; rvq_copy(&best, q); }
    else { rvq_copy(q, &best); break; }
  }
  rvq_free(&best); free(L); free(idx);
}

void rvq_train(rvq_t *q, const float *x, int n, int nst, const int *bits,
               int iters, int ft, uint32_t seed, int verbose) {
  rvq_alloc(q, nst, bits);
  uint32_t rng = seed ? seed : 1;
  float *res = (float *)malloc(sizeof(float) * (size_t)n * NCEP);
  memcpy(res, x, sizeof(float) * (size_t)n * NCEP);
  int *asg = (int *)malloc(sizeof(int) * n);
  float *dist = (float *)malloc(sizeof(float) * n);
  for (int s = 0; s < nst; s++) {
    int K = 1 << bits[s];
    float *cent = (float *)malloc(sizeof(float) * (size_t)K * NCEP);
    kmeans(res, n, K, cent, iters, &rng);
    rvq_set_stage(q, s, cent);      /* residual below uses the int8-dequantized stage */
    free(cent);
    assign(res, n, q->cbf[s], K, asg, dist);
    double tot = 0;
    for (int i = 0; i < n; i++) {
      tot += dist[i];
      for (int e = 0; e < NCEP; e++) res[(size_t)i * NCEP + e] -= q->cbf[s][(size_t)asg[i] * NCEP + e];
    }
    if (verbose) fprintf(stderr, "  stage %d (%d bits): residual energy %.5f\n", s, bits[s], tot / n);
  }
  free(res); free(asg); free(dist);
  if (ft > 0) finetune(q, x, n, ft, &rng, verbose);
}

/* Warm-start refinement on a new training set (e.g. the vectors the encoder actually coded):
 * stage by stage, Lloyd iterations from the current centroids on the greedy residuals, then the
 * joint fine-tune. Keeps the structure learned on the large open-loop set where the new set is thin. */
void rvq_refine(rvq_t *q, const float *x, int n, int iters, int ft, uint32_t seed, int verbose) {
  uint32_t rng = seed ? seed : 1;
  float *res = (float *)malloc(sizeof(float) * (size_t)n * NCEP);
  memcpy(res, x, sizeof(float) * (size_t)n * NCEP);
  int *asg = (int *)malloc(sizeof(int) * n);
  float *dist = (float *)malloc(sizeof(float) * n);
  for (int s = 0; s < q->nst; s++) {
    int K = 1 << q->bits[s];
    float *cent = (float *)malloc(sizeof(float) * (size_t)K * NCEP);
    memcpy(cent, q->cbf[s], sizeof(float) * (size_t)K * NCEP);
    lloyd(res, n, K, cent, iters);
    rvq_set_stage(q, s, cent);
    free(cent);
    assign(res, n, q->cbf[s], K, asg, dist);
    double tot = 0;
    for (int i = 0; i < n; i++) {
      tot += dist[i];
      for (int e = 0; e < NCEP; e++) res[(size_t)i * NCEP + e] -= q->cbf[s][(size_t)asg[i] * NCEP + e];
    }
    if (verbose) fprintf(stderr, "  refine stage %d: residual energy %.5f\n", s, tot / n);
  }
  free(res); free(asg); free(dist);
  if (ft > 0) finetune(q, x, n, ft, &rng, verbose);
}

void rvq_stats(rvq_t *q, const float *x, int n, int flags) {
  if (n <= 0) return;
  double *hist[MAXST]; double dq[MAXST + 1] = {0};
  for (int s = 0; s < q->nst; s++) hist[s] = (double *)calloc((size_t)1 << q->bits[s], sizeof(double));
  for (int i = 0; i < n; i++) {
    float res[NCEP];
    memcpy(res, x + (size_t)i * NCEP, sizeof res);
    for (int e = 0; e < NCEP; e++) dq[0] += res[e] * res[e];
    for (int s = 0; s < q->nst; s++) {
      int K = 1 << q->bits[s], bj = 0; float bd = 1e30f;
      for (int k = 0; k < K; k++) {
        const float *cw = q->cbf[s] + (size_t)k * NCEP; float d = 0;
        for (int e = 0; e < NCEP; e++) { float t = res[e] - cw[e]; d += t * t; }
        if (d < bd) { bd = d; bj = k; }
      }
      hist[s][bj] += 1;
      for (int e = 0; e < NCEP; e++) res[e] -= q->cbf[s][(size_t)bj * NCEP + e];
      dq[s + 1] += bd;
    }
  }
  for (int s = 0; s < q->nst; s++) {
    size_t K = (size_t)1 << q->bits[s];
    double tot = n + 0.5 * K;
    if (flags & 1) {
      double h = 0;
      for (size_t k = 0; k < K; k++) { double p = (hist[s][k] + 0.5) / tot; h -= p * log2(p); }
      q->ent[s] = (float)h;
    }
    if (flags & 2) {
      for (size_t k = 0; k < K; k++) {
        double f = (hist[s][k] + 0.5) / tot * 16384.0;
        q->prior[s][k] = (uint16_t)(f < 1 ? 1 : (f + 0.5));
      }
    }
    free(hist[s]);
  }
  if (flags & 1) for (int s = 0; s <= q->nst; s++) q->dq[s] = (float)(dq[s] / n);
}
