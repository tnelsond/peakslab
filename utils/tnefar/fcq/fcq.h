/* fcq.h - FARGAN feature codec quantizer (non-streaming, per-speaker codebooks)
 *
 * Feature layout (FARGAN, 20 floats / 10 ms frame):
 *   [0]      c0 (energy)            -> scalar, delta coded
 *   [1..17]  cepstrum 1..17         -> RVQ (int8 codebooks, variable stages)
 *   [18]     pitch (log-period)     -> delta coded; coarse delta vs. the held pitch at unvoiced anchors
 *   [19]     voicing / correlation  -> threshold flag + small scalar
 */
#ifndef FCQ_H
#define FCQ_H
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#define NFEAT 20
#define NCEP 17
#define F_PITCH 18
#define F_CORR 19
#define FPS 100

#define MAXST 6
#define MAXBITS 10
#define MAXBEAM 8
#define MAXGAP 16
#define LONGN 32   /* extra gap range reachable through the escape symbol (silence runs) */
#define NCORR 16
#define C0NF (4 + 2 * 17)   /* features of the linear c0 predictor */
#define PNF (7 + 17)        /* features of the linear pitch predictor */
#define C0MAX 24
#define PDMAX 31
#define PIDX_BITS 12
#define PIDX_MAX 4095
#define PUMAX 20    /* unvoiced-anchor pitch: delta symbols -PUMAX..PUMAX in steps of pustep */

/* ---------------- adaptive models + range coder ---------------- */
typedef struct { int n, inc; uint32_t total; uint16_t *f; } model_t;
enum { CAT_GAP, CAT_TYPE, CAT_VOICE, CAT_C0, CAT_PITCH, CAT_CORR, CAT_RVQ, CAT_NS, CAT_NUDGE, CAT_N };

typedef struct {
  int dec;
  uint8_t *buf; size_t cap, pos;
  uint64_t low; uint32_t range, code; uint8_t cache; uint64_t cache_size;
  double bits[CAT_N];                      /* ideal-cost accounting per category */
} rc_t;

void fcq_init(void);
float fcq_lg(uint32_t v);
void model_init(model_t *m, int n, int init, int inc, const uint16_t *prior);
void model_free(model_t *m);
float model_cost(const model_t *m, int s);
void rc_enc_init(rc_t *r);
void rc_dec_init(rc_t *r, const uint8_t *buf, size_t len);
size_t rc_finish(rc_t *r, uint8_t **data);   /* data points into r->buf */
void rc_free(rc_t *r);
int rc_sym(rc_t *r, model_t *m, int v, int cat);   /* enc: codes v, dec: returns symbol */
int rc_bits(rc_t *r, int v, int nbits, int cat);

/* ---------------- residual VQ ---------------- */
typedef struct {
  int nst, bits[MAXST];
  int8_t *cb[MAXST];            /* int8 codewords, K*NCEP */
  float scale[MAXST][NCEP];     /* per-stage, per-dimension dequant scale */
  float *cbf[MAXST];            /* dequantized cache (not stored) */
  float *cbt[MAXST];            /* same, transposed NCEP x K (fast search) */
  uint16_t *prior[MAXST];       /* initial symbol frequencies for the range coder */
  float dq[MAXST + 1];          /* mean distortion after s stages (scaled domain) */
  float ent[MAXST];             /* mean entropy (bits) of stage index */
} rvq_t;

void rvq_alloc(rvq_t *q, int nst, const int *bits);
void rvq_free(rvq_t *q);
void rvq_finalize(rvq_t *q);
void rvq_train(rvq_t *q, const float *x, int n, int nst, const int *bits,
               int kmiters, int ft_epochs, uint32_t seed, int verbose);
/* flags: 1 = dq/ent, 2 = priors */
void rvq_stats(rvq_t *q, const float *x, int n, int flags);
void rvq_refine(rvq_t *q, const float *x, int n, int iters, int ft, uint32_t seed, int verbose);
/* M-best search. models (optional, per stage) + inv_lambda give rate-aware choice. */
float rvq_encode(const rvq_t *q, int stages, int beam, const float *t,
                 const model_t *models, float inv_lambda, int *idx, float *recon);
void rvq_encode_prog(const rvq_t *q, int stages, int beam, const float *t,
                     const model_t *models, float inv_lambda,
                     int pidx[][MAXST], float *pdist, float *prate);
void rvq_decode(const rvq_t *q, int stages, const int *idx, float *out);

/* ---------------- codebook (one per speaker) ---------------- */
typedef struct {
  float mean[NFEAT];
  float wsqrt[NCEP];            /* sqrt of cepstral dimension weights */
  float c0step, pmin, pstep, cstep, vthresh, unv_corr, pmean;
  float c0w[NCEP];              /* c0 prediction weights on the cepstrum change (already shrunk; bootstrap) */
  float c0lin;                  /* != 0: use the linear c0 predictor c0lw (learned on decoded anchors) */
  float c0lw[2][C0NF];          /* [voiced][feature]: 1, prev c0, cep(17), prev cep(17), log gap, type */
  float plin;                   /* != 0: use the linear pitch predictor pw */
  float dleak[MAXGAP + 2][NCEP];  /* delta prediction: prev + dleak[gap][i] * (mean - prev); row MAXGAP+1 = longer gaps */
  float dgain[MAXGAP + 2];      /* delta residual scale per gap row (residual / dgain is quantized); 0 = 1 */
  float pw[2][PNF];             /* [onset][feature]: last, 2nd last, mean8, mean32, log(since)*(last-mean32), dc0, 1, dcep(17) */
  float silc0;                  /* c0 at/below which an unvoiced frame counts as silence */
  float wc0, wp, wcor;          /* distortion weights for non-cepstral features */
  float side_bits;              /* avg non-RVQ bits per anchor, excluding the gap (for RDO planning) */
  float gapcost[MAXGAP + 2];    /* bits of gap g = 1..gmax, [gmax+1] = long-gap escape (planner) */
  float nrho, nbits;            /* nudges: fraction of interpolation error removed, bits per interpolated frame */
  float pustep;                 /* pitch step at unvoiced anchors (FARGAN uses pitch in unvoiced speech too) */
  float wpu;                    /* distortion weight of pitch in non-silent unvoiced frames */
} cbparams_t;

/* key: absolute, delta: vs. the previous anchor, interp: one-stage nudge codebook for interpolated frames;
 * side = trained priors of the side-info models */
typedef struct { uint32_t id; cbparams_t p; rvq_t key, delta, interp, keyu; uint16_t *side; int nside; } Codebook;  /* keyu: key codebook of unvoiced frames (nst 0 = use key) */

Codebook *codebook_load(const char *path);
int codebook_save(Codebook *cb, const char *path);
void codebook_free(Codebook *cb);

/* ---------------- encoder / decoder ---------------- */
typedef struct { float *d; int n, cap; } vecset_t;       /* NCEP-dim vectors */
typedef struct { float *d; int n, cap; } c0rows_t;      /* C0NF features + target per row */
typedef struct { vecset_t chosen, cand, key, keyu, interp; c0rows_t c0[2], pr[2]; double lxy[MAXGAP + 2][NCEP], lxx[MAXGAP + 2][NCEP], dres[MAXGAP + 2], dcnt[MAXGAP + 2]; uint16_t *side; int nside; } vecsets_t; /* training collectors */
void vs_free(vecset_t *v);
void vs_append(vecset_t *v, const float *x);

/* ewt: loudness weighting of distortion (0 = off): frames louder than the file average get more bits */
/* ks/ds = max RVQ stages per frame (actual count is chosen per frame by RD cost);
 * kp/dp = stage levels assumed by the open-loop frame planner (0 = same as ks/ds) */
typedef struct { int ks, ds, gmax, maxchain, beam; double lambda; float ewt; int kp, dp; } encparams_t;
typedef struct {
  double cat[CAT_N]; double dist; int ncoded, nkey, ndelta, ninterp; size_t bytes;
  double kside;                 /* non-RVQ, non-gap bits spent on anchors */
  double tcat[4][CAT_N];        /* bits by frame type (key, delta, nudges, unused) x category */
  int nnz;                      /* nudged interpolated frames (ninterp = all nudge symbols) */
  double nd0, nd1;              /* interpolated-frame distortion before / after nudges (gaps that carry nudges) */
  int gaphist[MAXGAP + 2];      /* gap symbol histogram (planner gap costs) */
} encstats_t;

/* plan keyframe/coded positions (DP) then closed-loop encode at a fixed lambda */
size_t encode_at(const Codebook *cb, const float *x, int N, const encparams_t *ep,
                 uint8_t **out, float *recon, encstats_t *st, vecsets_t *vs);
void fcq_set_dump(FILE *f);
void fcq_set_dump2(FILE *f);   /* per-anchor prediction-analysis dump */   /* structure dump of the next encode_at (analysis) */
/* search stages + lambda to hit target_bps (fix_ks/fix_ds = 0 -> search) */
int encode_target(const Codebook *cb, const float *x, int N, double target_bps,
                  const encparams_t *base, int fix_ks, int fix_ds,
                  uint8_t **out, size_t *len, float *recon, encstats_t *st,
                  encparams_t *chosen, int verbose);
int decode_stream(const Codebook *cb, const uint8_t *buf, size_t len, float **out, int *N);
/* same, also returns the per-frame anchor mask (caller frees *mask) for the postfilter */
int decode_stream_ex(const Codebook *cb, const uint8_t *buf, size_t len, float **out, int *N, uint8_t **mask);

/* ---------------- learned postfilter (decoder side) ---------------- */
typedef struct nnf nnf_t;
nnf_t *nnf_load(const char *path);
void nnf_free(nnf_t *n);
void nnf_apply(const nnf_t *n, float *feat, const uint8_t *coded, int N);
/* streaming: frames t0..t0+T-1 of what nnf_apply would make, into out (T x NFEAT), from the unfiltered
 * in (N x NFEAT); only frames within the filter's reach are read. -1: not a single conv filter (use nnf_apply) */
int nnf_apply_range(const nnf_t *n, const float *in, const uint8_t *coded, int N, int t0, int T, float *out);

/* ---------------- trainer ---------------- */
typedef struct {
  int knst, kbits[MAXST], dnst, dbits[MAXST], inst, ibits[MAXST], unst, ubits[MAXST];
  int kmiter, ft, cl, gmax, maxchain, verbose;
  int clmode, nclr, c0lin, plin, dleak, dscale; float clr[4];   /* closed loop: 0 priors only, 1 delta from scratch, 2 warm refine key+delta; extra rates */
  float c0step, pstep, cstep, vthresh, wpow, wp_mul, wcor_mul, wc0, clbps, ewt, c0g, pustep, wpu_mul;
  uint32_t seed;
} trainopt_t;
Codebook *train_codebook(const float *x, int N, const trainopt_t *o);

#endif
