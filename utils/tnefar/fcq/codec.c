/* codec.c - codebook I/O, bitstream syntax, RDO planning, encoder, decoder */
#include "fcq.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>

/* exponent of the coded-frame span weight (a coded frame also stands in for its interpolated neighbours) */
static const double g_alpha = 0.75;
static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
static inline double sq(double v) { return v * v; }

/* ---------------- vector sets (training collectors) ---------------- */
static void vs_push(vecset_t *v, const float *x) {
  if (v->n == v->cap) {
    v->cap = v->cap ? v->cap * 2 : 1024;
    v->d = (float *)realloc(v->d, sizeof(float) * NCEP * (size_t)v->cap);
  }
  memcpy(v->d + (size_t)v->n * NCEP, x, sizeof(float) * NCEP);
  v->n++;
}
void vs_append(vecset_t *v, const float *x) { vs_push(v, x); }
void vs_free(vecset_t *v) { free(v->d); memset(v, 0, sizeof *v); }

/* ---------------- codebook file ---------------- */
typedef struct { FILE *fp; int w, err; } io_t;
static void xfer(io_t *o, void *p, size_t sz, size_t n) {
  if (o->w) { if (fwrite(p, sz, n, o->fp) != n) o->err = 1; }
  else if (fread(p, sz, n, o->fp) != n) o->err = 1;
}
static void io_rvq(io_t *o, rvq_t *q) {
  int nst = q->nst, bits[MAXST];
  memcpy(bits, q->bits, sizeof bits);
  xfer(o, &nst, 4, 1); xfer(o, bits, 4, MAXST);
  if (!o->w) {
    if (o->err || nst < 0 || nst > MAXST) { o->err = 1; return; }   /* 0: empty (no nudge codebook) */
    for (int s = 0; s < nst; s++) if (bits[s] < 1 || bits[s] > MAXBITS) { o->err = 1; return; }
    rvq_alloc(q, nst, bits);
  }
  for (int s = 0; s < nst; s++) {
    size_t K = (size_t)1 << q->bits[s];
    xfer(o, q->cb[s], 1, K * NCEP);
    xfer(o, q->scale[s], 4, NCEP);
    xfer(o, q->prior[s], 2, K);
  }
  xfer(o, q->dq, 4, MAXST + 1);
  xfer(o, q->ent, 4, MAXST);
  if (!o->w && !o->err) rvq_finalize(q);
}
static uint32_t fnv(uint32_t h, const void *p, size_t n) {
  const uint8_t *b = (const uint8_t *)p;
  while (n--) { h ^= *b++; h *= 16777619u; }
  return h;
}
static uint32_t cb_hash(const Codebook *cb) {
  uint32_t h = 2166136261u;
  h = fnv(h, &cb->p, sizeof cb->p);
  const rvq_t *rs[4] = { &cb->key, &cb->delta, &cb->interp, &cb->keyu };
  for (int r = 0; r < 4; r++)
    for (int s = 0; s < rs[r]->nst; s++) {
      h = fnv(h, rs[r]->cb[s], ((size_t)1 << rs[r]->bits[s]) * NCEP);
      h = fnv(h, rs[r]->scale[s], sizeof rs[r]->scale[s]);
    }
  return h;
}
static void io_cb(io_t *o, Codebook *cb) {
  uint32_t magic = 0x37514346u; /* "FCQ7" */
  xfer(o, &magic, 4, 1);
  if (!o->w && magic != 0x37514346u) { o->err = 1; return; }
  xfer(o, &cb->id, 4, 1);
  xfer(o, &cb->p, sizeof cb->p, 1);
  io_rvq(o, &cb->key);
  if (!o->err) { io_rvq(o, &cb->delta); if (!o->w && cb->key.nst < 1) o->err = 1; }
  if (!o->err) io_rvq(o, &cb->interp);
  if (!o->err) io_rvq(o, &cb->keyu);
  int ns = cb->nside;
  xfer(o, &ns, 4, 1);
  if (!o->w) {
    if (o->err || ns < 0 || ns > 100000) { o->err = 1; return; }
    cb->nside = ns; cb->side = ns ? (uint16_t *)malloc(2 * (size_t)ns) : NULL;
  }
  if (ns) xfer(o, cb->side, 2, ns);
}
int codebook_save(Codebook *cb, const char *path) {
  cb->id = cb_hash(cb);
  io_t o = { fopen(path, "wb"), 1, 0 };
  if (!o.fp) return -1;
  io_cb(&o, cb); fclose(o.fp);
  return o.err ? -1 : 0;
}
Codebook *codebook_load(const char *path) {
  io_t o = { fopen(path, "rb"), 0, 0 };
  if (!o.fp) return NULL;
  Codebook *cb = (Codebook *)calloc(1, sizeof *cb);
  io_cb(&o, cb); fclose(o.fp);
  if (o.err) { free(cb); return NULL; }
  return cb;
}
void codebook_free(Codebook *cb) {
  if (!cb) return;
  rvq_free(&cb->key); rvq_free(&cb->delta); rvq_free(&cb->interp); rvq_free(&cb->keyu); free(cb->side); free(cb);
}

/* ---------------- shared bitstream syntax ----------------
 * Anchors (coded frames) in time order. Per anchor: gap, voicing, type, stage count, RVQ indices, c0, then pitch + corr
 * (voiced) or a coarse pitch delta vs. the held pitch (unvoiced). Pitch is interpolated linearly between all anchors.
 * Type: key (absolute cepstrum) or delta (cepstrum vs. the previous anchor). After every
 * anchor, each interpolated frame of the gap it closes (gap <= gmax) gets one "nudge" symbol: 0 = plain
 * interpolation, k = add entry k of a small cepstral correction codebook. */
typedef struct { float f[NFEAT]; int voiced; } frame_t;
typedef struct { int type, gap, voiced, c0q, pidx, cidx, pu, ns, idx[MAXST]; } fsyms_t;

#define NPGB 5    /* previous-gap buckets */
#define NGCTX (NPGB * 3)
typedef struct {
  const Codebook *cb;
  int ks, ds, gmax, maxchain;
  model_t m_type[4], m_voice[16], m_c0[2][4][3], m_pd[4][4], m_corr[NCORR + 1], m_gap[NGCTX], m_long;
  model_t m_ns[2][2][MAXST + 1];               /* [key, delta][voiced][previous count] */
  model_t m_nudge[2][4];                        /* [previous frame nudged][gap bucket] */
  model_t m_pu[2][4];                           /* unvoiced-anchor pitch delta: [previous anchor voiced][gap bucket] */
  model_t m_ik[MAXST], m_id[MAXST], m_iku[MAXST];
  int prev_c0q, prev_pd, prev_nz;
  int pos, tlv, ph[32], nph;                    /* anchor position, position of the last voiced anchor, pitch history */
  int prev_gap, chain, prev_voiced, last_pidx, prev_cidx, prev_ns, have_prev;
  frame_t prev;
  float last_pitch, prev_rate;                  /* weighted cepstral change per frame over the previous gap */
} cstate_t;

static inline int gbucket(int g) { return g <= 1 ? 0 : g == 2 ? 1 : g <= 4 ? 2 : 3; }
static inline int pgbucket(int g) { return g <= 1 ? 0 : g == 2 ? 1 : g <= 4 ? 2 : g <= 8 ? 3 : 4; }
/* class of the previous anchor: 0 silence (unvoiced and quiet), 1 unvoiced, 2 voiced */
static inline int anchor_class(const cstate_t *s) {
  if (s->prev_voiced) return 2;
  return s->prev.f[0] <= s->cb->p.silc0 ? 0 : 1;
}
/* key codebook for a frame of the given voicing */
static inline const rvq_t *keycb(const Codebook *cb, int voiced) { return !voiced && cb->keyu.nst ? &cb->keyu : &cb->key; }
static inline int nudge_k(const Codebook *cb) { return cb->interp.nst ? 1 << cb->interp.bits[0] : 0; }

/* all side-info models in a fixed order (trained priors are stored in this order) */
static int bank_list(cstate_t *s, model_t **L) {
  int n = 0;
  for (int i = 0; i < 4; i++) L[n++] = &s->m_type[i];
  for (int i = 0; i < 16; i++) L[n++] = &s->m_voice[i];
  for (int t = 0; t < 2; t++) for (int g = 0; g < 4; g++) for (int q = 0; q < 3; q++) L[n++] = &s->m_c0[t][g][q];
  for (int i = 0; i < 4; i++) for (int q = 0; q < 4; q++) L[n++] = &s->m_pd[i][q];
  for (int i = 0; i <= NCORR; i++) L[n++] = &s->m_corr[i];
  for (int i = 0; i < NGCTX; i++) L[n++] = &s->m_gap[i];
  L[n++] = &s->m_long;
  for (int t = 0; t < 2; t++) for (int v = 0; v < 2; v++) for (int p = 0; p <= MAXST; p++) L[n++] = &s->m_ns[t][v][p];
  for (int a = 0; a < 2; a++) for (int g = 0; g < 4; g++) L[n++] = &s->m_pu[a][g];
  if (nudge_k(s->cb)) for (int a = 0; a < 2; a++) for (int g = 0; g < 4; g++) L[n++] = &s->m_nudge[a][g];
  return n;
}
#define PRIOR_TOTAL 1024.0
/* adaptation step of the RVQ index models (priors total 16384): large = follow the current file quickly */
#define RVQ_INC 128

static void cstate_init(cstate_t *s, const Codebook *cb, int ks, int ds, int gmax, int maxchain) {
  fcq_init();
  memset(s, 0, sizeof *s);
  s->cb = cb; s->ks = ks; s->ds = ds; s->gmax = gmax; s->maxchain = maxchain;
  for (int i = 0; i < 4; i++) {
    model_init(&s->m_type[i], 2, 4, 32, NULL);
    for (int q = 0; q < 4; q++) model_init(&s->m_pd[i][q], 2 * PDMAX + 2, 2, 32, NULL);
    for (int t = 0; t < 2; t++) for (int q = 0; q < 3; q++) model_init(&s->m_c0[t][i][q], 2 * C0MAX + 1, 2, 32, NULL);
  }
  for (int i = 0; i < 16; i++) model_init(&s->m_voice[i], 2, 4, 32, NULL);
  for (int i = 0; i <= NCORR; i++) model_init(&s->m_corr[i], NCORR, 2, 32, NULL);
  for (int i = 0; i < NGCTX; i++) model_init(&s->m_gap[i], gmax + 1, 2, 32, NULL);   /* last symbol = long-gap escape */
  model_init(&s->m_long, LONGN, 2, 32, NULL);
  for (int t = 0; t < 2; t++) for (int v = 0; v < 2; v++) for (int p = 0; p <= MAXST; p++)
    model_init(&s->m_ns[t][v][p], (t ? cb->delta.nst : keycb(cb, v)->nst) + 1, 2, 32, NULL);
  if (nudge_k(cb)) for (int a = 0; a < 2; a++) for (int g = 0; g < 4; g++) model_init(&s->m_nudge[a][g], nudge_k(cb) + 1, 2, 32, NULL);
  for (int a = 0; a < 2; a++) for (int g = 0; g < 4; g++) model_init(&s->m_pu[a][g], 2 * PUMAX + 1, 2, 32, NULL);
  for (int st = 0; st < cb->key.nst; st++) model_init(&s->m_ik[st], 1 << cb->key.bits[st], 4, RVQ_INC, cb->key.prior[st]);
  for (int st = 0; st < cb->keyu.nst; st++) model_init(&s->m_iku[st], 1 << cb->keyu.bits[st], 4, RVQ_INC, cb->keyu.prior[st]);
  for (int st = 0; st < cb->delta.nst; st++) model_init(&s->m_id[st], 1 << cb->delta.bits[st], 4, RVQ_INC, cb->delta.prior[st]);
  s->prev_gap = 1; s->last_pidx = -1; s->prev_cidx = NCORR; s->last_pitch = cb->p.pmean;
  /* trained priors (skipped automatically when the model layout differs, e.g. other gmax) */
  model_t *L[256]; int n = bank_list(s, L), tot = 0;
  for (int i = 0; i < n; i++) tot += L[i]->n;
  if (cb->side && cb->nside == tot) {
    const uint16_t *p = cb->side;
    for (int i = 0; i < n; i++) {
      L[i]->total = 0;
      for (int k = 0; k < L[i]->n; k++) { L[i]->f[k] = *p ? *p : 1; p++; L[i]->total += L[i]->f[k]; }
    }
  }
}
/* flatten adapted side models into normalized priors */
static void harvest_side(cstate_t *s, uint16_t **out, int *nout) {
  model_t *L[256]; int n = bank_list(s, L), tot = 0;
  for (int i = 0; i < n; i++) tot += L[i]->n;
  uint16_t *o = (uint16_t *)malloc(2 * (size_t)tot), *p = o;
  for (int i = 0; i < n; i++)
    for (int k = 0; k < L[i]->n; k++) {
      double f = L[i]->f[k] * PRIOR_TOTAL / L[i]->total;
      *p++ = (uint16_t)(f < 1 ? 1 : f + 0.5);
    }
  free(*out); *out = o; *nout = tot;
}
static void cstate_free(cstate_t *s) {
  model_t *L[256]; int n = bank_list(s, L);
  for (int i = 0; i < n; i++) model_free(L[i]);
  for (int st = 0; st < s->cb->key.nst; st++) model_free(&s->m_ik[st]);
  for (int st = 0; st < s->cb->keyu.nst; st++) model_free(&s->m_iku[st]);
  for (int st = 0; st < s->cb->delta.nst; st++) model_free(&s->m_id[st]);
}

/* delta prediction: the previous anchor pulled toward the speaker mean by a learned per-gap, per-dimension factor
 * (the longer the gap, the less the previous anchor says about this one) */
static inline int leak_row(int gap) { return gap < 1 ? 1 : gap > MAXGAP ? MAXGAP + 1 : gap; }
static inline float dgain(const cbparams_t *p, int gap) { float g = p->dgain[leak_row(gap)]; return g > 0 ? g : 1.0f; }
static void delta_base(const cbparams_t *p, const float *prev, int gap, float *out) {
  const float *a = p->dleak[leak_row(gap)];
  for (int i = 0; i < NCEP; i++) out[i] = prev[1 + i] + a[i] * (p->mean[1 + i] - prev[1 + i]);
}

/* decoded cepstrum of a frame (feature domain) and the c0 prediction derived from its change */
static void recon_cep(const cstate_t *s, const fsyms_t *y, float *cep) {
  const cbparams_t *p = &s->cb->p; float r[NCEP];
  if (y->type == 0) {
    rvq_decode(keycb(s->cb, y->voiced), y->ns, y->idx, r);
    for (int i = 0; i < NCEP; i++) cep[i] = p->mean[1 + i] + r[i] / p->wsqrt[i];
  } else {
    rvq_decode(&s->cb->delta, y->ns, y->idx, r);
    float b[NCEP], gs = dgain(p, y->gap); delta_base(p, s->prev.f, y->gap, b);
    for (int i = 0; i < NCEP; i++) cep[i] = b[i] + r[i] * gs / p->wsqrt[i];
  }
}
/* features of the linear c0 predictor: everything the decoder knows when c0 is decoded */
static void c0_feats(const cstate_t *s, const float *cep, int gap, int type, float *f) {
  f[0] = 1; f[1] = s->prev.f[0];
  for (int i = 0; i < NCEP; i++) { f[2 + i] = cep[i]; f[2 + NCEP + i] = s->prev.f[1 + i]; }
  f[2 + 2 * NCEP] = logf((float)(gap > 0 ? gap : 1)); f[3 + 2 * NCEP] = (float)type;
}
static float pred_c0(const cstate_t *s, const float *cep, int gap, int type, int voiced) {
  const cbparams_t *p = &s->cb->p;
  if (!s->have_prev) return p->mean[0];
  if (p->c0lin != 0) {
    float f[C0NF], pr = 0;
    c0_feats(s, cep, gap, type, f);
    for (int i = 0; i < C0NF; i++) pr += p->c0lw[voiced][i] * f[i];
    return pr;
  }
  float pr = s->prev.f[0];
  for (int i = 0; i < NCEP; i++) pr += p->c0w[i] * (cep[i] - s->prev.f[1 + i]);
  return pr;
}
/* pitch prediction from the decoded history and the current anchor's decoded cepstrum/c0 change */
static inline int sbucket(int since) { return since <= 4 ? 0 : since <= 12 ? 1 : since <= 50 ? 2 : 3; }
static void pitch_feats(const cstate_t *s, const float *cep, float c0, int since, float *f) {
  int n = s->nph, last = s->last_pidx;
  float p2 = n > 1 ? (float)s->ph[(n - 2) & 31] : (float)last, m8 = 0, m32 = 0;
  int k8 = n < 8 ? n : 8, k32 = n < 32 ? n : 32;
  for (int i = 1; i <= k32; i++) { float v = (float)s->ph[(n - i) & 31]; m32 += v; if (i <= k8) m8 += v; }
  m8 /= k8; m32 /= k32;
  f[0] = (float)last; f[1] = p2; f[2] = m8; f[3] = m32;
  f[4] = logf((float)(since > 0 ? since : 1)) * ((float)last - m32);
  f[5] = c0 - s->prev.f[0]; f[6] = 1;
  for (int i = 0; i < NCEP; i++) f[7 + i] = cep[i] - s->prev.f[1 + i];
}
static int pred_pidx_anchor(const cstate_t *s, const float *cep, float c0, int since) {
  const cbparams_t *p = &s->cb->p;
  if (p->plin == 0 || s->nph < 1) return s->last_pidx;
  float f[PNF], pr = 0; int onset = !s->prev_voiced;
  pitch_feats(s, cep, c0, since, f);
  for (int i = 0; i < PNF; i++) pr += p->pw[onset][i] * f[i];
  return clampi((int)lrintf(pr), 0, PIDX_MAX);
}
static float recon_c0(const cstate_t *s, const fsyms_t *y, const float *cep);

/* one routine for both directions: encoder passes symbols in, decoder gets them out */
static void code_frame(cstate_t *s, rc_t *r, fsyms_t *y) {
  const cbparams_t *p = &s->cb->p;
  int first = !s->have_prev, gb = 0;
  if (!first) {
    int gc = pgbucket(s->prev_gap) * 3 + anchor_class(s);
    int sym = rc_sym(r, &s->m_gap[gc], y->gap > s->gmax ? s->gmax : y->gap - 1, CAT_GAP);
    if (sym == s->gmax) y->gap = s->gmax + 1 + rc_sym(r, &s->m_long, y->gap - s->gmax - 1, CAT_GAP);
    else y->gap = sym + 1;
    gb = gbucket(y->gap);
  } else y->gap = 0;
  int quiet = (first ? p->mean[0] : s->prev.f[0]) <= p->silc0;   /* c0 comes last: use the previous anchor's level */
  y->voiced = rc_sym(r, &s->m_voice[(s->prev_voiced * 2 + quiet) * 4 + gb], y->voiced, CAT_VOICE);
  if (first || s->chain >= s->maxchain) y->type = 0;   /* forced keyframe: no flag */
  else y->type = rc_sym(r, &s->m_type[s->chain < 3 ? s->chain : 3], y->type, CAT_TYPE);
  /* number of RVQ stages actually sent for this frame (0 = hold / mean) */
  y->ns = rc_sym(r, &s->m_ns[y->type][y->voiced][s->prev_ns], y->ns, CAT_NS);
  model_t *mk = !y->voiced && s->cb->keyu.nst ? s->m_iku : s->m_ik;
  if (y->type == 0) for (int st = 0; st < y->ns; st++) y->idx[st] = rc_sym(r, &mk[st], y->idx[st], CAT_RVQ);
  else for (int st = 0; st < y->ns; st++) y->idx[st] = rc_sym(r, &s->m_id[st], y->idx[st], CAT_RVQ);
  /* c0 last: residual vs. prediction from the decoded cepstrum change */
  y->c0q = rc_sym(r, &s->m_c0[y->type][gb][s->prev_c0q < 0 ? 0 : (s->prev_c0q == 0 ? 1 : 2)], y->c0q + C0MAX, CAT_C0) - C0MAX;
  /* pitch last: residual vs. the prediction from the pitch history and this anchor's decoded cepstrum/c0 */
  if (y->voiced) {                              /* unvoiced: pitch + corr not coded */
    if (s->last_pidx >= 0) {
      float cep[NCEP]; recon_cep(s, y, cep);
      int since = s->pos + y->gap - s->tlv;
      int pp = pred_pidx_anchor(s, cep, recon_c0(s, y, cep), since), d = y->pidx - pp;
      int sym = (d >= -PDMAX && d <= PDMAX) ? d + PDMAX : 2 * PDMAX + 1;
      sym = rc_sym(r, &s->m_pd[gb][sbucket(since)], sym, CAT_PITCH);
      if (sym == 2 * PDMAX + 1) y->pidx = rc_bits(r, y->pidx, PIDX_BITS, CAT_PITCH);
      else y->pidx = pp + sym - PDMAX;
    } else y->pidx = rc_bits(r, y->pidx, PIDX_BITS, CAT_PITCH);
    y->pidx = clampi(y->pidx, 0, PIDX_MAX);
    y->cidx = rc_sym(r, &s->m_corr[s->prev_cidx], y->cidx, CAT_CORR);
  } else y->pu = rc_sym(r, &s->m_pu[s->prev_voiced][gb], y->pu + PUMAX, CAT_PITCH) - PUMAX;   /* 0 = hold */
}
static float recon_c0(const cstate_t *s, const fsyms_t *y, const float *cep) {
  return pred_c0(s, cep, y->gap, y->type, y->voiced) + y->c0q * s->cb->p.c0step;
}

static void recon_frame(const cstate_t *s, const fsyms_t *y, frame_t *o) {
  const cbparams_t *p = &s->cb->p;
  o->voiced = y->voiced;
  float cep[NCEP];
  recon_cep(s, y, cep);
  o->f[0] = recon_c0(s, y, cep);
  if (y->voiced) {
    o->f[F_PITCH] = p->pmin + y->pidx * p->pstep;
    o->f[F_CORR] = p->vthresh + y->cidx * p->cstep;
  } else {                                      /* defined fallback for FARGAN */
    o->f[F_PITCH] = s->last_pitch + y->pu * p->pustep;
    o->f[F_CORR] = p->unv_corr;
  }
  for (int i = 0; i < NCEP; i++) o->f[1 + i] = cep[i];
}

static void finish_frame(cstate_t *s, const fsyms_t *y, frame_t *out) {
  int first = !s->have_prev;
  recon_frame(s, y, out);
  s->prev_gap = first ? 1 : y->gap;
  s->chain = y->type ? s->chain + 1 : 0;
  s->prev_voiced = y->voiced;
  s->prev_ns = y->ns;
  s->prev_c0q = y->c0q;
  if (y->voiced && s->last_pidx >= 0) s->prev_pd = y->pidx - s->last_pidx;
  s->pos = first ? 0 : s->pos + y->gap;
  if (y->voiced) { s->last_pidx = y->pidx; s->ph[s->nph++ & 31] = y->pidx; s->tlv = s->pos; }
  s->last_pitch = out->f[F_PITCH];
  s->prev_cidx = y->voiced ? y->cidx : NCORR;
  if (!first) {
    double d = 0;
    for (int i = 0; i < NCEP; i++) { double e = (out->f[1 + i] - s->prev.f[1 + i]) * s->cb->p.wsqrt[i]; d += e * e; }
    s->prev_rate = (float)(d / y->gap);
  }
  s->prev = *out; s->have_prev = 1;
}

/* zero-bit interpolated frames between two coded frames (both sides use this) */
static void interp_frames(const frame_t *a, const frame_t *b, int g, float *out) {
  for (int k = 1; k < g; k++) {
    float u = (float)k / g, *o = out + (size_t)(k - 1) * NFEAT;
    for (int i = 0; i < NFEAT; i++) o[i] = (1 - u) * a->f[i] + u * b->f[i];
  }
}

/* ---------------- nudges: <= ~2 bits per interpolated frame ----------------
 * out = interpolation (already in out) + entry sym-1 of the one-stage interp codebook (cepstrum only). */
static int code_nudge(cstate_t *s, rc_t *r, int sym, int g) {
  sym = rc_sym(r, &s->m_nudge[s->prev_nz][gbucket(g)], sym, CAT_NUDGE);
  s->prev_nz = sym != 0;
  return sym;
}
static void apply_nudge(const Codebook *cb, int sym, float *out) {
  if (!sym) return;
  const float *c = cb->interp.cbf[0] + (size_t)(sym - 1) * NCEP;
  for (int i = 0; i < NCEP; i++) out[1 + i] += c[i] / cb->p.wsqrt[i];
}

/* ---------------- header ---------------- */
/* Header: [id8] [varint (N<<1 | custom)] [ks/ds byte, gmax/maxchain byte only if custom].
 * "custom" = anything other than the codebook's full stage caps with DEF_GMAX/DEF_MAXCHAIN. */
#define DEF_GMAX 12
#define DEF_MAXCHAIN 8
static int is_default(const Codebook *cb, const encparams_t *ep) {
  return ep->ks == cb->key.nst && ep->ds == cb->delta.nst && ep->gmax == DEF_GMAX && ep->maxchain == DEF_MAXCHAIN;
}
static int write_header(uint8_t *h, uint32_t N, const encparams_t *ep, const Codebook *cb) {
  int n = 0, custom = !is_default(cb, ep); uint32_t v = (N << 1) | custom;
  h[n++] = cb->id & 255;
  while (v >= 128) { h[n++] = (uint8_t)((v & 127) | 128); v >>= 7; }
  h[n++] = (uint8_t)v;
  if (custom) {
    h[n++] = (uint8_t)((ep->ks << 4) | ep->ds);
    h[n++] = (uint8_t)(((ep->gmax - 1) << 4) | ep->maxchain);
  }
  return n;
}
static int read_header(const uint8_t *b, size_t len, const Codebook *cb, uint32_t *N, encparams_t *ep) {
  size_t n = 0; uint32_t v = 0; int sh = 0;
  if (len < 2) return -1;
  if (b[n++] != (cb->id & 255)) return -2;
  for (;;) {
    if (n >= len || sh > 28) return -1;
    uint8_t c = b[n++]; v |= (uint32_t)(c & 127) << sh; sh += 7;
    if (!(c & 128)) break;
  }
  *N = v >> 1;
  if (v & 1) {
    if (n + 2 > len) return -1;
    ep->ks = b[n] >> 4; ep->ds = b[n] & 15; n++;
    ep->gmax = (b[n] >> 4) + 1; ep->maxchain = b[n] & 15; n++;
  } else { ep->ks = cb->key.nst; ep->ds = cb->delta.nst; ep->gmax = DEF_GMAX; ep->maxchain = DEF_MAXCHAIN; }
  return (int)n;
}

/* ---------------- distortion + planning ---------------- */
static inline int pclass(const cbparams_t *p, const float *f) {
  return f[F_CORR] > p->vthresh ? 1 : (f[0] > p->silc0 ? 2 : 0);
}
static inline double pweight(const cbparams_t *p, int pc) { return pc == 1 ? p->wp : (pc == 2 ? p->wpu : 0.0); }
static double fdist(const cbparams_t *p, const float *a, const float *b, int pc) {
  double d = p->wc0 * sq(a[0] - b[0]);
  for (int i = 0; i < NCEP; i++) d += sq(p->wsqrt[i]) * sq(a[1 + i] - b[1 + i]);
  d += pweight(p, pc) * sq(a[F_PITCH] - b[F_PITCH]);
  d += p->wcor * sq(a[F_CORR] - b[F_CORR]);
  return d;
}

/* DP over which frames get coded (everything else is interpolated). Open-loop
 * estimates: interpolation error from originals, quantization cost from training stats. */
/* per-frame importance from loudness (c0): w = clamp(1 + ewt * z, 0.25, 3), z = standardized c0 */
static void make_weights(const float *x, int N, float ewt, float *fw) {
  double m = 0, v = 0;
  for (int t = 0; t < N; t++) m += x[(size_t)t * NFEAT];
  m /= N;
  for (int t = 0; t < N; t++) v += sq(x[(size_t)t * NFEAT] - m);
  double sd = sqrt(v / N) + 1e-6;
  for (int t = 0; t < N; t++) {
    double w = 1.0 + ewt * (x[(size_t)t * NFEAT] - m) / sd;
    fw[t] = (float)(w < 0.25 ? 0.25 : (w > 3.0 ? 3.0 : w));
  }
}

/* Least-squares anchor targets for c0 + cepstrum: with anchors fixed, choose their values so the
 * piecewise-linear reconstruction (what the decoder will interpolate) best fits ALL frames, weighted
 * by fw. Tridiagonal normal equations, solved per dimension. theta blends with the raw frame values. */
static const float g_theta = 1.0f;
static const float g_ptheta = 1.0f;
static float *ls_targets(const cbparams_t *p, const float *x, int N, const uint8_t *coded, const float *fw) {
  float *xt = (float *)malloc(sizeof(float) * (size_t)N * NFEAT);
  memcpy(xt, x, sizeof(float) * (size_t)N * NFEAT);
  int m = 0; for (int t = 0; t < N; t++) m += coded[t];
  if (m < 3 || g_theta <= 0) return xt;
  int *kp = (int *)malloc(sizeof(int) * m); m = 0;
  for (int t = 0; t < N; t++) if (coded[t]) kp[m++] = t;
  double *dg = (double *)calloc(m, sizeof(double)), *od = (double *)calloc(m, sizeof(double));
  for (int i = 0; i + 1 < m; i++)
    for (int t = kp[i]; t < kp[i + 1]; t++) {
      double u = (double)(t - kp[i]) / (kp[i + 1] - kp[i]), w = fw[t];
      dg[i] += w * (1 - u) * (1 - u); od[i] += w * (1 - u) * u; dg[i + 1] += w * u * u;
    }
  dg[m - 1] += fw[kp[m - 1]];
  double *b = (double *)malloc(sizeof(double) * m), *cp = (double *)malloc(sizeof(double) * m), *dp = (double *)malloc(sizeof(double) * m);
  for (int d = 0; d <= NCEP; d++) {
    for (int i = 0; i < m; i++) b[i] = 0;
    for (int i = 0; i + 1 < m; i++)
      for (int t = kp[i]; t < kp[i + 1]; t++) {
        double u = (double)(t - kp[i]) / (kp[i + 1] - kp[i]), w = fw[t], v = x[(size_t)t * NFEAT + d];
        b[i] += w * (1 - u) * v; b[i + 1] += w * u * v;
      }
    b[m - 1] += fw[kp[m - 1]] * x[(size_t)kp[m - 1] * NFEAT + d];
    /* Thomas algorithm (symmetric tridiagonal: sub = super = od) */
    cp[0] = od[0] / dg[0]; dp[0] = b[0] / dg[0];
    for (int i = 1; i < m; i++) {
      double den = dg[i] - od[i - 1] * cp[i - 1];
      cp[i] = (i + 1 < m ? od[i] : 0) / den; dp[i] = (b[i] - od[i - 1] * dp[i - 1]) / den;
    }
    double a = dp[m - 1];
    for (int i = m - 1; i >= 0; i--) {
      if (i < m - 1) a = dp[i] - cp[i] * a;
      float raw = x[(size_t)kp[i] * NFEAT + d];
      xt[(size_t)kp[i] * NFEAT + d] = (1 - g_theta) * raw + g_theta * (float)a;
    }
  }
  /* pitch: same idea. Decoder pitch = linear between ALL anchors (unvoiced anchors carry a coarse pitch too).
   * Frames count with their pitch weight: voiced wp, non-silent unvoiced wpu, silence 0. Anchors without any
   * weighted frame keep their raw value. */
  if (g_ptheta > 0) {
    for (int i = 0; i < m; i++) { dg[i] = 0; od[i] = 0; b[i] = 0; }
    for (int i = 0; i + 1 < m; i++)
      for (int t = kp[i]; t < kp[i + 1]; t++) {
        const float *f = x + (size_t)t * NFEAT;
        double w = fw[t] * pweight(p, pclass(p, f)) / p->wp, v = f[F_PITCH];
        if (w <= 0) continue;
        double u = (double)(t - kp[i]) / (kp[i + 1] - kp[i]);
        dg[i] += w * (1 - u) * (1 - u); od[i] += w * (1 - u) * u; dg[i + 1] += w * u * u;
        b[i] += w * (1 - u) * v; b[i + 1] += w * u * v;
      }
    { const float *f = x + (size_t)kp[m - 1] * NFEAT; double w = fw[kp[m - 1]] * pweight(p, pclass(p, f)) / p->wp;
      dg[m - 1] += w; b[m - 1] += w * f[F_PITCH]; }
    char *act = (char *)malloc(m);
    for (int i = 0; i < m; i++) { act[i] = dg[i] > 1e-9; dg[i] += 1e-9; }
    cp[0] = od[0] / dg[0]; dp[0] = b[0] / dg[0];
    for (int i = 1; i < m; i++) {
      double den = dg[i] - od[i - 1] * cp[i - 1];
      cp[i] = (i + 1 < m ? od[i] : 0) / den; dp[i] = (b[i] - od[i - 1] * dp[i - 1]) / den;
    }
    double a = dp[m - 1];
    for (int i = m - 1; i >= 0; i--) {
      if (i < m - 1) a = dp[i] - cp[i] * a;
      if (!act[i]) continue;
      float raw = x[(size_t)kp[i] * NFEAT + F_PITCH];
      xt[(size_t)kp[i] * NFEAT + F_PITCH] = (1 - g_ptheta) * raw + g_ptheta * (float)a;
    }
    free(act);
  }
  free(kp); free(dg); free(od); free(b); free(cp); free(dp);
  return xt;
}

/* Lambda- and plan-independent part of the planner: for every frame k and every allowed gap g,
 * the weighted interpolation error of the frames strictly inside (k-g, k) and the cepstral change
 * fraction. Computed once per input and reused by every (plan, lambda) of a rate search. */
typedef struct { int *off; double *di, *fr; uint8_t *vk; } plancache_t;   /* vk: frame voiced */

static void plan_prep(const Codebook *cb, const float *x, int N, int gmax, const float *fw, plancache_t *pc) {
  const cbparams_t *p = &cb->p;
  int *nons = (int *)malloc(sizeof(int) * (N + 1));
  nons[0] = 0;
  for (int t = 0; t < N; t++) {
    const float *f = x + (size_t)t * NFEAT;
    nons[t + 1] = nons[t] + !(f[F_CORR] <= p->vthresh && f[0] <= p->silc0);
  }
  pc->vk = (uint8_t *)malloc(N);
  for (int t = 0; t < N; t++) pc->vk[t] = x[(size_t)t * NFEAT + F_CORR] > p->vthresh;
  pc->off = (int *)malloc(sizeof(int) * (N + 1));
  pc->off[0] = 0;
  for (int k = 0; k < N; k++) {   /* same break rule as the DP: count the reachable predecessors */
    int c = 0;
    if (k > 0)
      for (int j = k - 1; j >= 0; j--) {
        int g = k - j;
        if (g > gmax && (g > gmax + LONGN || nons[k + 1] - nons[j] > 0)) break;
        c++;
      }
    pc->off[k + 1] = pc->off[k] + c;
  }
  size_t tot = (size_t)pc->off[N];
  pc->di = (double *)malloc(sizeof(double) * (tot ? tot : 1));
  pc->fr = (double *)malloc(sizeof(double) * (tot ? tot : 1));
  double kvar = cb->key.dq[0] > 1e-9 ? cb->key.dq[0] : 1e-9;
  /* anchor values as the decoder sees them: an unvoiced anchor carries the fixed unvoiced correlation */
  float *xa = (float *)malloc(sizeof(float) * (size_t)N * NFEAT);
  memcpy(xa, x, sizeof(float) * (size_t)N * NFEAT);
  for (int t = 0; t < N; t++) if (!(xa[(size_t)t * NFEAT + F_CORR] > p->vthresh)) xa[(size_t)t * NFEAT + F_CORR] = p->unv_corr;
  #pragma omp parallel for schedule(dynamic, 1024)
  for (int k = 1; k < N; k++) {
    const float *b = xa + (size_t)k * NFEAT;
    int c = pc->off[k + 1] - pc->off[k];
    for (int g = 1; g <= c; g++) {
      int j = k - g;
      const float *a = xa + (size_t)j * NFEAT;
      double di = 0;
      for (int t = j + 1; t < k; t++) {
        float u = (float)(t - j) / g, tmp[NFEAT];
        for (int i = 0; i < NFEAT; i++) tmp[i] = (1 - u) * a[i] + u * b[i];
        const float *o = x + (size_t)t * NFEAT;
        di += fw[t] * fdist(p, o, tmp, pclass(p, o));
      }
      double dc = 0;
      for (int i = 0; i < NCEP; i++) dc += sq(p->wsqrt[i]) * sq(b[1 + i] - a[1 + i]);
      double fr = dc / kvar; if (fr > 1) fr = 1;
      pc->di[pc->off[k] + g - 1] = di; pc->fr[pc->off[k] + g - 1] = fr;
    }
  }
  free(nons); free(xa);
}
static void plan_free(plancache_t *pc) { free(pc->off); free(pc->di); free(pc->fr); free(pc->vk); }

/* DP over which frames are anchors (everything else is interpolated, plus an optional nudge). Open-loop
 * estimates: interpolation error from the originals (cached), reduced by the trained nudge gain; key/delta cost blended
 * by how far the cepstrum moved; quantization error and bits from training statistics; gap bits from trained costs. */
static void plan_positions(const Codebook *cb, int N, int ks, int ds, int gmax, double lam,
                           const float *fw, const plancache_t *pc, uint8_t *coded) {
  const cbparams_t *p = &cb->p;
  memset(coded, 0, N);
  double kbv[2] = {0}, kdv[2], dbits = 0;
  for (int v = 0; v < 2; v++) {
    const rvq_t *kq = keycb(cb, v); int kl = ks < kq->nst ? ks : kq->nst;
    for (int s = 0; s < kl; s++) kbv[v] += kq->ent[s];
    kdv[v] = kq->dq[kl];
  }
  for (int s = 0; s < ds; s++) dbits += cb->delta.ent[s];
  double ddq = cb->delta.dq[ds];
  int gm = gmax < MAXGAP ? gmax : MAXGAP;
  double ngain = 1.0 - p->nrho;
  double *cost = (double *)malloc(sizeof(double) * N);
  int *prv = (int *)malloc(sizeof(int) * N);
  cost[0] = p->side_bits + kbv[pc->vk[0]] + lam * kdv[pc->vk[0]] * fw[0]; prv[0] = -1;
  for (int k = 1; k < N; k++) {
    double best = 1e300; int bj = k - 1;
    double kbits = kbv[pc->vk[k]], kdq = kdv[pc->vk[k]];
    const double *di = pc->di + pc->off[k], *fr = pc->fr + pc->off[k];
    int c = pc->off[k + 1] - pc->off[k];
    for (int g = 1; g <= c; g++) {
      int j = k - g;
      double f = fr[g - 1];                      /* 1 = key, 0 = delta */
      double bits = p->side_bits + dbits + (kbits - dbits) * f + p->gapcost[g <= gm ? g : gm + 1] + (g > gmax ? 3.0 : 0.0);
      double dq = ddq + (kdq - ddq) * f;
      double interior = g <= gmax ? ngain * di[g - 1] : di[g - 1];
      if (g <= gmax) bits += (g - 1) * p->nbits;
      double cc = cost[j] + bits + lam * (interior + dq * fw[k]);
      if (cc < best) { best = cc; bj = j; }
    }
    cost[k] = best; prv[k] = bj;
  }
  for (int k = N - 1; k >= 0; k = prv[k]) coded[k] = 1;
  free(cost); free(prv);
}

/* ---------------- closed-loop encode ---------------- */
static FILE *g_dump, *g_dump2;
void fcq_set_dump(FILE *f) { g_dump = f; }
void fcq_set_dump2(FILE *f) { g_dump2 = f; }
static void cat_add(double *acc, const rc_t *r, const double *before) {
  for (int c = 0; c < CAT_N; c++) acc[c] += r->bits[c] - before[c];
}
static double side_bits_now(const rc_t *r) {
  double b = 0;
  for (int c = 0; c < CAT_N; c++) if (c != CAT_RVQ && c != CAT_GAP && c != CAT_NUDGE) b += r->bits[c];
  return b;
}
/* Nudges for the interpolated frames of gap (a, a+g), whose plain interpolation is already in rec:
 * per frame, RD choice of the nudge symbol (0 = none) with the live adaptive model. */
static void encode_nudges(const Codebook *cb, cstate_t *s, rc_t *rc, const float *x, const float *fw, double lambda,
                          int a, int g, float *rec, encstats_t *st, vecsets_t *vs) {
  const cbparams_t *p = &cb->p;
  int K = nudge_k(cb);
  const float *cbf = cb->interp.cbf[0];
  for (int m = a + 1; m < a + g; m++) {
    float *o = rec + (size_t)m * NFEAT;
    const float *xo = x + (size_t)m * NFEAT;
    float t[NCEP];
    for (int i = 0; i < NCEP; i++) t[i] = (xo[1 + i] - o[1 + i]) * p->wsqrt[i];
    if (vs) vs_push(&vs->interp, t);
    /* decision with FIXED rate estimates (none ~free, an index ~1 + log2 K bits): with the adaptive costs the
     * greedy choice locks onto one cheap entry and applies it everywhere */
    double lam = lambda * fw[m], d0 = 0, kb = 1.0 + log2((double)K);
    for (int i = 0; i < NCEP; i++) d0 += t[i] * t[i];
    double bestJ = lam * d0, bd = d0; int bk = 0;
    for (int k = 0; k < K; k++) {
      double d = 0;
      for (int i = 0; i < NCEP; i++) { double e = t[i] - cbf[(size_t)k * NCEP + i]; d += e * e; }
      double J = kb + lam * d;
      if (J < bestJ) { bestJ = J; bk = k + 1; bd = d; }
    }
    code_nudge(s, rc, bk, g);
    apply_nudge(cb, bk, o);
    st->ninterp++; st->nnz += bk != 0;
    st->nd0 += fw[m] * d0; st->nd1 += fw[m] * bd;
  }
}

static size_t encode_pass(const Codebook *cb, const float *x, int N, const uint8_t *coded,
                          const encparams_t *ep, const float *fw, uint8_t **out, float *recon,
                          encstats_t *st, vecsets_t *vs) {
  const cbparams_t *p = &cb->p;
  cstate_t s; cstate_init(&s, cb, ep->ks, ep->ds, ep->gmax, ep->maxchain);
  rc_t rc; rc_enc_init(&rc);
  float *rec = recon ? recon : (float *)malloc(sizeof(float) * (size_t)N * NFEAT);
  uint8_t *vf = (uint8_t *)calloc(N, 1);
  encstats_t local; if (!st) st = &local;
  memset(st, 0, sizeof *st);
  float *xt = ls_targets(&cb->p, x, N, coded, fw);
  int K = nudge_k(cb);
  double lam = ep->lambda, il = (float)(1.0 / lam);
  int prevp = -1;
  for (int t = 0; t < N; t++) {
    if (!coded[t]) continue;
    /* a coded frame also carries the error of the interpolated frames around it:
     * weight its distortion by the span it covers (half of each neighbouring gap) */
    int nxt = t + 1; while (nxt < N && !coded[nxt]) nxt++;
    double span = ((prevp >= 0 ? t - prevp : 0) + (nxt < N ? nxt - t : 0)) * 0.5;
    if (span < 1) span = 1;
    lam = ep->lambda * fw[t] * pow(span, g_alpha); il = (float)(1.0 / lam);   /* loudness-weighted tradeoff */
    const float *xf = xt + (size_t)t * NFEAT;
    fsyms_t y; memset(&y, 0, sizeof y);
    int first = !s.have_prev;
    y.gap = first ? 0 : t - prevp;
    y.voiced = xf[F_CORR] > p->vthresh;
    if (y.voiced) {
      y.pidx = clampi((int)lrintf((xf[F_PITCH] - p->pmin) / p->pstep), 0, PIDX_MAX);
      y.cidx = clampi((int)lrintf((xf[F_CORR] - p->vthresh) / p->cstep), 0, NCORR - 1);
    } else   /* unvoiced: coarse pitch delta vs. the decoder's held pitch (the previous anchor's decoded pitch) */
      y.pu = clampi((int)lrintf((xf[F_PITCH] - s.last_pitch) / p->pustep), -PUMAX, PUMAX);
    /* key or delta (delta only when the voicing continues), and how many stages each: real RD cost with the live
     * adaptive models. One progressive beam search gives the best path for every stage count. */
    float tk[NCEP], td[NCEP];
    int pk[MAXST + 1][MAXST], pd_[MAXST + 1][MAXST]; float dk[MAXST + 1], rk[MAXST + 1], dd[MAXST + 1], rd[MAXST + 1];
    int can_delta = !first && s.chain < s.maxchain;
    double Jk = 1e300; int Lk = 0;
    for (int i = 0; i < NCEP; i++) tk[i] = (xf[1 + i] - p->mean[1 + i]) * p->wsqrt[i];
    const rvq_t *kq = keycb(cb, y.voiced);
    int kcap = ep->ks < kq->nst ? ep->ks : kq->nst;
    rvq_encode_prog(kq, kcap, ep->beam, tk, kq == &cb->keyu ? s.m_iku : s.m_ik, (float)il, pk, dk, rk);
    for (int L = 0; L <= kcap; L++) {
      double J = rk[L] + model_cost(&s.m_ns[0][y.voiced][s.prev_ns], L) + lam * dk[L];
      if (J < Jk) { Jk = J; Lk = L; }
    }
    if (can_delta) Jk += model_cost(&s.m_type[s.chain < 3 ? s.chain : 3], 0);
    int use_delta = 0, Ld = 0;
    if (can_delta) {
      float db[NCEP]; delta_base(p, s.prev.f, y.gap, db);
      float gs = dgain(p, y.gap);
      for (int i = 0; i < NCEP; i++) td[i] = (xf[1 + i] - db[i]) * p->wsqrt[i] / gs;
      if (vs) { double e = 0; for (int i = 0; i < NCEP; i++) e += (double)td[i] * td[i] * gs * gs;
                vs->dres[leak_row(y.gap)] += e; vs->dcnt[leak_row(y.gap)] += 1; }
      if (vs) {   /* closed-loop statistics for the leak factors */
        int lr = leak_row(y.gap);
        for (int i = 0; i < NCEP; i++) {
          double X = p->mean[1 + i] - s.prev.f[1 + i], Y = xf[1 + i] - s.prev.f[1 + i];
          vs->lxy[lr][i] += X * Y; vs->lxx[lr][i] += X * X;
        }
      }
      rvq_encode_prog(&cb->delta, ep->ds, ep->beam, td, s.m_id, (float)(il / (gs * gs)), pd_, dd, rd);
      for (int L = 0; L <= ep->ds; L++) dd[L] *= gs * gs;
      double Jd = 1e300;
      for (int L = 0; L <= ep->ds; L++) {
        double J = rd[L] + model_cost(&s.m_ns[1][y.voiced][s.prev_ns], L) + lam * dd[L];
        if (J < Jd) { Jd = J; Ld = L; }
      }
      Jd += model_cost(&s.m_type[s.chain < 3 ? s.chain : 3], 1);
      use_delta = Jd < Jk;
      static int la = -1; if (la < 0) { const char *e = getenv("FCQ_LOOKAHEAD"); la = e ? atoi(e) : 0; }
      if (la && nxt < N && Ld + 0 >= 0) {
        /* one-anchor look-ahead: this anchor's reconstruction is the delta base of the next one. Re-rank key/delta and
         * stage count (+-1 around the greedy choices) by own cost + best cost of the next anchor. */
        int gn = nxt - t, nn = nxt + 1; while (nn < N && !coded[nn]) nn++;
        double spn = (gn + (nn < N ? nn - nxt : 0)) * 0.5; if (spn < 1) spn = 1;
        double lamn = ep->lambda * fw[nxt] * pow(spn, g_alpha); float iln = (float)(1.0 / lamn);
        const float *xn = xt + (size_t)nxt * NFEAT; int vn = xn[F_CORR] > p->vthresh;
        float tkn[NCEP]; int pkn[MAXST + 1][MAXST]; float dkn[MAXST + 1], rkn[MAXST + 1];
        for (int i = 0; i < NCEP; i++) tkn[i] = (xn[1 + i] - p->mean[1 + i]) * p->wsqrt[i];
        const rvq_t *kqn = keycb(cb, vn); int kcn = ep->ks < kqn->nst ? ep->ks : kqn->nst;
        rvq_encode_prog(kqn, kcn, 1, tkn, kqn == &cb->keyu ? s.m_iku : s.m_ik, iln, pkn, dkn, rkn);
        double Jkn = 1e300;
        for (int L = 0; L <= kcn; L++) { double J = rkn[L] + lamn * dkn[L]; if (J < Jkn) Jkn = J; }
        float gsn = dgain(p, gn);
        double bestT = 1e300; int bt = use_delta, bl = use_delta ? Ld : Lk;
        for (int ty = 0; ty < 2; ty++) {
          int L0 = ty ? Ld : Lk, cap = ty ? ep->ds : kcap;
          for (int L = ty ? L0 : L0; L <= (ty ? L0 + 1 : L0); L++) {   /* key: greedy count; delta: greedy and +1 */
            if (L < 0 || L > cap) continue;
            double Jc = ty ? rd[L] + model_cost(&s.m_ns[1][y.voiced][s.prev_ns], L) + lam * dd[L] + model_cost(&s.m_type[s.chain < 3 ? s.chain : 3], 1)
                           : rk[L] + model_cost(&s.m_ns[0][y.voiced][s.prev_ns], L) + lam * dk[L] + model_cost(&s.m_type[s.chain < 3 ? s.chain : 3], 0);
            float r[NCEP], fc[NFEAT];
            if (ty) { rvq_decode(&cb->delta, L, pd_[L], r); for (int i = 0; i < NCEP; i++) fc[1 + i] = db[i] + r[i] * gs / p->wsqrt[i]; }
            else { rvq_decode(kq, L, pk[L], r); for (int i = 0; i < NCEP; i++) fc[1 + i] = p->mean[1 + i] + r[i] / p->wsqrt[i]; }
            double Jn = Jkn;
            int nchain = ty ? s.chain + 1 : 0;
            if (nchain < s.maxchain) {
              float dbn[NCEP], tdn[NCEP]; int pdn[MAXST + 1][MAXST]; float ddn[MAXST + 1], rdn[MAXST + 1];
              delta_base(p, fc, gn, dbn);
              for (int i = 0; i < NCEP; i++) tdn[i] = (xn[1 + i] - dbn[i]) * p->wsqrt[i] / gsn;
              rvq_encode_prog(&cb->delta, ep->ds, 1, tdn, s.m_id, (float)(iln / (gsn * gsn)), pdn, ddn, rdn);
              for (int Ln = 0; Ln <= ep->ds; Ln++) { double J = rdn[Ln] + lamn * ddn[Ln] * gsn * gsn; if (J < Jn) Jn = J; }
            }
            if (Jc + Jn < bestT) { bestT = Jc + Jn; bt = ty; bl = L; }
          }
        }
        use_delta = bt; if (bt) Ld = bl; else Lk = bl;
      }
      if (vs) { vs_push(&vs->cand, td); if (use_delta) vs_push(&vs->chosen, td); }
    }
    if (vs && !use_delta) vs_push(kq == &cb->keyu ? &vs->keyu : &vs->key, tk);
    y.type = use_delta;
    y.ns = use_delta ? Ld : Lk;
    for (int q = 0; q < y.ns; q++) y.idx[q] = use_delta ? pd_[Ld][q] : pk[Lk][q];
    { float cep[NCEP]; recon_cep(&s, &y, cep);
      float c0p = pred_c0(&s, cep, y.gap, y.type, y.voiced);
      y.c0q = clampi((int)lrintf((xf[0] - c0p) / p->c0step), -C0MAX, C0MAX);
      static int c0rd = -1; if (c0rd < 0) { const char *e = getenv("FCQ_C0RD"); c0rd = e ? atoi(e) : 0; }
      if (c0rd && !first) {   /* rate-aware rounding: also try +-1 step, RD on bits + weighted c0 error */
        int gb = gbucket(y.gap); const model_t *mc = &s.m_c0[y.type][gb][s.prev_c0q < 0 ? 0 : (s.prev_c0q == 0 ? 1 : 2)];
        double bJ = 1e300; int bq = y.c0q;
        for (int q = y.c0q - 1; q <= y.c0q + 1; q++) {
          if (q < -C0MAX || q > C0MAX) continue;
          double e = xf[0] - (c0p + q * p->c0step);
          double J = model_cost(mc, q + C0MAX) + lam * p->wc0 * e * e;
          if (J < bJ) { bJ = J; bq = q; }
        }
        y.c0q = bq;
      }
      if (vs && y.voiced && s.last_pidx >= 0 && s.nph >= 1) {   /* training rows for the linear pitch predictor */
        c0rows_t *pr = &vs->pr[!s.prev_voiced];
        if (pr->n == pr->cap) { pr->cap = pr->cap ? 2 * pr->cap : 4096; pr->d = (float *)realloc(pr->d, sizeof(float) * (PNF + 1) * (size_t)pr->cap); }
        float *row = pr->d + (size_t)pr->n * (PNF + 1);
        pitch_feats(&s, cep, recon_c0(&s, &y, cep), t - s.tlv, row); row[PNF] = (float)y.pidx; pr->n++;
      }
      if (vs && !first) {   /* training rows for the linear c0 predictor (decoded inputs, LS target) */
        c0rows_t *cr = &vs->c0[y.voiced];
        if (cr->n == cr->cap) { cr->cap = cr->cap ? 2 * cr->cap : 4096; cr->d = (float *)realloc(cr->d, sizeof(float) * (C0NF + 1) * (size_t)cr->cap); }
        float *row = cr->d + (size_t)cr->n * (C0NF + 1);
        c0_feats(&s, cep, y.gap, y.type, row); row[C0NF] = xf[0]; cr->n++;
      } }
    int d_pv = s.prev_voiced, d_pg = s.prev_gap, d_pt = s.chain > 0, d_pns = s.prev_ns, d_chain = s.chain;
    float d_pc0 = s.prev.f[0], d_pcorr = s.prev.f[F_CORR], d_rate = s.prev_rate, d_dc0 = s.prev_c0q;
    double sb = side_bits_now(&rc), cb0[CAT_N];
    memcpy(cb0, rc.bits, sizeof cb0);
    code_frame(&s, &rc, &y);
    cat_add(st->tcat[y.type], &rc, cb0);
    st->kside += side_bits_now(&rc) - sb;
    if (!first) st->gaphist[y.gap <= ep->gmax ? y.gap : ep->gmax + 1]++;
    if (g_dump)   /* structure dump: anchor t, its symbols, and what the decoder knew before it */
      fprintf(g_dump, "%d %d %d %d %d %d %d %d %d %.3f %.3f %d %d %.4f %.3f\n", t, y.gap, y.type, y.ns, y.voiced,
              d_pv, d_pg, d_pt, d_pns, d_pc0, d_pcorr, d_chain, first, d_rate, d_dc0);
    frame_t a; memcpy(&a, &s.prev, sizeof a);   /* previous anchor (before finish_frame) */
    static _Thread_local frame_t g_pp; static _Thread_local int g_pg;   /* analysis dump: anchor two back, previous gap */
    if (first) { g_pp = a; g_pg = 1; }
    frame_t cur; finish_frame(&s, &y, &cur);
    if (g_dump2) {   /* prediction analysis: target c0/voicing, decoded current cepstrum, previous anchor */
      fprintf(g_dump2, "%d %d %d %d %d %d %.4f %.4f %.4f %.4f", t, first, y.gap, y.type, y.voiced, a.voiced, xf[0], x[(size_t)t * NFEAT], a.f[0], cur.f[0]);
      fprintf(g_dump2, " %.4f %.4f %d", x[(size_t)t * NFEAT + F_CORR], a.f[F_CORR], y.ns);
      for (int i = 0; i < NCEP; i++) fprintf(g_dump2, " %.4f", cur.f[1 + i]);
      for (int i = 0; i < NCEP; i++) fprintf(g_dump2, " %.4f", a.f[1 + i]);
      fprintf(g_dump2, " %d %d %.4f %.4f", y.voiced ? y.pidx : -1, y.voiced ? y.cidx : -1, x[(size_t)t * NFEAT + F_PITCH], cur.f[0]);
      for (int i = 0; i < NCEP; i++) fprintf(g_dump2, " %.4f", xf[1 + i]);
      for (int i = 0; i < NCEP; i++) fprintf(g_dump2, " %.4f", g_pp.f[1 + i]);
      fprintf(g_dump2, " %d", g_pg);
      fprintf(g_dump2, "\n");
    }
    g_pp = a; g_pg = first ? 1 : y.gap;
    memcpy(rec + (size_t)t * NFEAT, cur.f, sizeof cur.f);
    vf[t] = (uint8_t)cur.voiced;
    st->ncoded++; if (use_delta) st->ndelta++; else st->nkey++;
    if (!first && t - prevp > 1) {
      interp_frames(&a, &cur, t - prevp, rec + (size_t)(prevp + 1) * NFEAT);
      if (K && t - prevp <= ep->gmax) {
        memcpy(cb0, rc.bits, sizeof cb0);
        encode_nudges(cb, &s, &rc, x, fw, ep->lambda, prevp, t - prevp, rec, st, vs);
        cat_add(st->tcat[2], &rc, cb0);
      }
    }
    prevp = t;
  }
  uint8_t *pl; size_t plen = rc_finish(&rc, &pl);
  uint8_t hdr[16]; int hn = write_header(hdr, (uint32_t)N, ep, cb);
  *out = (uint8_t *)malloc(hn + plen);
  memcpy(*out, hdr, hn); memcpy(*out + hn, pl, plen);
  if (vs) harvest_side(&s, &vs->side, &vs->nside);
  for (int i = 0; i < CAT_N; i++) st->cat[i] = rc.bits[i];
  st->bytes = hn + plen;
  for (int t = 0; t < N; t++)
    st->dist += fw[t] * fdist(p, x + (size_t)t * NFEAT, rec + (size_t)t * NFEAT, pclass(p, x + (size_t)t * NFEAT));
  cstate_free(&s); rc_free(&rc); free(vf); free(xt);
  if (!recon) free(rec);
  return st->bytes;
}

static size_t encode_at_pc(const Codebook *cb, const float *x, int N, const encparams_t *ep, const float *fw,
                           const plancache_t *pc, uint8_t **out, float *recon, encstats_t *st, vecsets_t *vs) {
  uint8_t *coded = (uint8_t *)malloc(N);
  plan_positions(cb, N, ep->kp ? ep->kp : ep->ks, ep->dp ? ep->dp : ep->ds, ep->gmax, ep->lambda, fw, pc, coded);
  size_t n = encode_pass(cb, x, N, coded, ep, fw, out, recon, st, vs);
  free(coded);
  return n;
}

size_t encode_at(const Codebook *cb, const float *x, int N, const encparams_t *ep,
                 uint8_t **out, float *recon, encstats_t *st, vecsets_t *vs) {
  float *fw = (float *)malloc(sizeof(float) * N);
  make_weights(x, N, ep->ewt, fw);
  plancache_t pc; plan_prep(cb, x, N, ep->gmax, fw, &pc);
  size_t n = encode_at_pc(cb, x, N, ep, fw, &pc, out, recon, st, vs);
  plan_free(&pc); free(fw);
  return n;
}

/* Quality knob = target bitrate. Searches stage counts and bisects lambda.
 * target_bps <= 0: constant quality instead, at base->lambda (the bitrate follows the content). */
int encode_target(const Codebook *cb, const float *x, int N, double target_bps,
                  const encparams_t *base, int fix_ks, int fix_ds,
                  uint8_t **out, size_t *len, float *recon_out, encstats_t *st_out,
                  encparams_t *chosen, int verbose) {
  double dur = N / (double)FPS;
  size_t rn = (size_t)N * NFEAT * sizeof(float);
  float *scratch = (float *)malloc(rn), *bestrec = (float *)malloc(rn), *fbrec = (float *)malloc(rn);
  uint8_t *bestbuf = NULL, *fbbuf = NULL; size_t bestlen = 0, fblen = 0;
  double bestdist = 1e300; encstats_t beststat, fbstat; encparams_t bestp, fbp;
  memset(&beststat, 0, sizeof beststat); memset(&fbstat, 0, sizeof fbstat);
  memset(&bestp, 0, sizeof bestp); memset(&fbp, 0, sizeof fbp);
  int have = 0, have_fb = 0;
  /* stage counts are chosen per frame by RD cost, up to the caps; the loops below only vary
   * what the open-loop frame planner assumes (a fixed ks/ds pins both cap and plan level).
   * Plans are independent: they run in parallel and are merged in plan order, so the result is
   * identical to the sequential search. */
  int kcap = fix_ks ? fix_ks : cb->key.nst, dcap = fix_ds ? fix_ds : cb->delta.nst;
  int pks[MAXST * MAXST], pds[MAXST * MAXST], np = 0;
  for (int ks = 1; ks <= kcap; ks++) {
    int ds_hi = ks < dcap ? ks : dcap;
    for (int ds = 1; ds <= ds_hi; ds++) {
      if (fix_ks && ks != kcap) continue;
      if (fix_ds && ds != dcap) continue;
      pks[np] = ks; pds[np] = ds; np++;
    }
  }
  typedef struct { uint8_t *buf, *fbuf; size_t len, flen; double dist; encstats_t st, fst; encparams_t ep, fep;
                   float *rec, *frec; int have, have_fb; } plan_res;
  plan_res *pr = (plan_res *)calloc(np, sizeof *pr);
  fcq_init();
  float *fw = (float *)malloc(sizeof(float) * N);
  make_weights(x, N, base->ewt, fw);
  plancache_t pc; plan_prep(cb, x, N, base->gmax, fw, &pc);
  #pragma omp parallel for schedule(dynamic)
  for (int pi = 0; pi < np; pi++) {
    plan_res *P = &pr[pi];
    float *scr = (float *)malloc(rn);
    P->rec = (float *)malloc(rn); P->frec = (float *)malloc(rn); P->dist = 1e300;
    encparams_t ep = *base; ep.ks = kcap; ep.ds = dcap; ep.kp = pks[pi]; ep.dp = pds[pi];
    /* Safeguarded secant on (ln lambda, ln bps): bps grows smoothly with lambda (~lambda^0.5).
     * Keeps the bracket [lo: bps <= target, hi: bps > target]; stops once the best in-budget
     * encode is within tol of the target. */
    if (target_bps <= 0) {   /* constant quality: this lambda, the plan with the lowest lambda*D + R */
      ep.lambda = base->lambda;
      uint8_t *buf; encstats_t st;
      size_t n = encode_at_pc(cb, x, N, &ep, fw, &pc, &buf, scr, &st, NULL);
      P->buf = buf; P->len = n; P->dist = ep.lambda * st.dist + 8.0 * n;
      P->st = st; P->ep = ep; memcpy(P->rec, scr, rn); P->have = 1;
      free(scr);
      continue;
    }
    double tol = 0.001 * target_bps; if (tol < 12.0 / dur) tol = 12.0 / dur;
    double lt = log(target_bps), ll = 0, fl = 0, lh = 0, fh = 0; int hl = 0, hh = 0;
    double l = log(3.0);
    for (int it = 0; it < 14; it++) {
      ep.lambda = exp(l);
      uint8_t *buf; encstats_t st;
      size_t n = encode_at_pc(cb, x, N, &ep, fw, &pc, &buf, scr, &st, NULL);
      double bps = n * 8.0 / dur, f = log(bps > 1 ? bps : 1) - lt;
      if (bps <= target_bps) {
        if (!hl || l > ll) { ll = l; fl = f; hl = 1; }
        if (st.dist < P->dist) {
          free(P->buf); P->buf = buf; P->len = n; P->dist = st.dist;
          P->st = st; P->ep = ep; memcpy(P->rec, scr, rn); P->have = 1;
        } else free(buf);
        if (target_bps - bps <= tol) break;
      } else {
        if (!hh || l < lh) { lh = l; fh = f; hh = 1; }
        if (!P->have_fb || n < P->flen) {
          free(P->fbuf); P->fbuf = buf; P->flen = n; P->fst = st; P->fep = ep; memcpy(P->frec, scr, rn); P->have_fb = 1;
        } else free(buf);
      }
      double aim = -0.5 * tol / target_bps;     /* aim slightly below the target */
      if (hl && hh) {
        double nl = fh > fl ? ll + (aim - fl) * (lh - ll) / (fh - fl) : 0.5 * (ll + lh);
        double m = 0.1 * (lh - ll);              /* stay strictly inside the bracket */
        if (nl < ll + m) nl = ll + m;
        if (nl > lh - m) nl = lh - m;
        l = nl;
      } else {
        double step = (aim - f) / 0.5;           /* extrapolate with the typical slope */
        if (step > 3) step = 3;
        if (step < -3) step = -3;
        l += step;
      }
      if (l < log(1e-2)) l = log(1e-2);
      if (l > log(1e8)) l = log(1e8);
    }
    free(scr);
    if (verbose) fprintf(stderr, "  plan ks=%d ds=%d done\n", pks[pi], pds[pi]);
  }
  for (int pi = 0; pi < np; pi++) {   /* merge in the sequential order */
    plan_res *P = &pr[pi];
    if (P->have && P->dist < bestdist) {
      free(bestbuf); bestbuf = P->buf; P->buf = NULL; bestlen = P->len; bestdist = P->dist;
      beststat = P->st; bestp = P->ep; memcpy(bestrec, P->rec, rn); have = 1;
    }
    if (P->have_fb && (!have_fb || P->flen < fblen)) {
      free(fbbuf); fbbuf = P->fbuf; P->fbuf = NULL; fblen = P->flen; fbstat = P->fst; fbp = P->fep;
      memcpy(fbrec, P->frec, rn); have_fb = 1;
    }
    free(P->buf); free(P->fbuf); free(P->rec); free(P->frec);
  }
  free(pr); plan_free(&pc); free(fw);
  int ok = have;
  const float *src = bestrec;
  if (!have) {
    if (verbose) fprintf(stderr, "warning: target %.0f bps not reachable, using lowest rate found\n", target_bps);
    free(bestbuf); bestbuf = fbbuf; fbbuf = NULL;
    bestlen = fblen; beststat = fbstat; bestp = fbp; src = fbrec;
  }
  *out = bestbuf; *len = bestlen;
  if (recon_out) memcpy(recon_out, src, rn);
  if (st_out) *st_out = beststat;
  if (chosen) *chosen = bestp;
  free(fbbuf); free(scratch); free(bestrec); free(fbrec);
  return ok ? 0 : 1;
}

/* ---------------- decoder ---------------- */
int decode_stream_ex(const Codebook *cb, const uint8_t *buf, size_t len, float **out, int *Nout, uint8_t **maskout) {
  uint32_t N; encparams_t ep;
  int hn = read_header(buf, len, cb, &N, &ep);
  if (hn == -2) { fprintf(stderr, "codebook id mismatch\n"); return -2; }
  if (hn < 0 || N == 0 || N > 100000000u) return -1;
  if (ep.ks < 1 || ep.ks > cb->key.nst || ep.ds < 1 || ep.ds > cb->delta.nst) return -3;
  cstate_t s; cstate_init(&s, cb, ep.ks, ep.ds, ep.gmax, ep.maxchain);
  rc_t rc; rc_dec_init(&rc, buf + hn, len - hn);
  float *o = (float *)calloc((size_t)N * NFEAT, sizeof(float));
  uint8_t *vf = (uint8_t *)calloc(N, 1), *coded = (uint8_t *)calloc(N, 1);
  int pos = 0, err = 0, K = nudge_k(cb);
  for (;;) {
    fsyms_t y; memset(&y, 0, sizeof y);
    int first = !s.have_prev;
    frame_t a; memcpy(&a, &s.prev, sizeof a);
    code_frame(&s, &rc, &y);
    if (!first) pos += y.gap;
    if (pos >= (int)N) { err = -4; break; }
    frame_t cur; finish_frame(&s, &y, &cur);
    memcpy(o + (size_t)pos * NFEAT, cur.f, sizeof cur.f);
    vf[pos] = (uint8_t)cur.voiced; coded[pos] = 1;
    if (!first && y.gap > 1) {
      interp_frames(&a, &cur, y.gap, o + (size_t)(pos - y.gap + 1) * NFEAT);
      if (K && y.gap <= ep.gmax)
        for (int m = pos - y.gap + 1; m < pos; m++) apply_nudge(cb, code_nudge(&s, &rc, 0, y.gap), o + (size_t)m * NFEAT);
    }
    if (pos == (int)N - 1) break;
  }
  cstate_free(&s); free(vf);
  if (err) { free(o); free(coded); return err; }
  *out = o; *Nout = (int)N;
  if (maskout) *maskout = coded; else free(coded);
  return 0;
}
int decode_stream(const Codebook *cb, const uint8_t *buf, size_t len, float **out, int *Nout) {
  return decode_stream_ex(cb, buf, len, out, Nout, NULL);
}
