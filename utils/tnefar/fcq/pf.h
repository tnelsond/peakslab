/* pf.h - feature postfilter network (NXF2): a stack of 1-D convolutions over the decoded frame sequence.
 * Shared by the decoder (fcq decode --nnf) and the trainer (pftrain). The older NXF1 window-MLP is the
 * special case "15:192:r,1:96:r,1:19:n" and is still loaded by nnf.c. */
#ifndef PF_H
#define PF_H
#include <stdint.h>

#define PF_NIN 25        /* per-frame input: 20 normalized features, anchor flag, dp, dn, gap, position */
#define PF_NOUT 19       /* corrections for c0, cepstrum 1..17, pitch (scaled by esd, masked by keep) */
#define PF_MAXL 16
enum { PF_LIN = 0, PF_RELU = 1, PF_TANH = 2 };

typedef struct {
  int cin, cout, k, dil, act, res;   /* res: output += centre-cropped input (cin == cout) */
  float *w;                          /* [k][cin][cout] */
  float *b;                          /* [cout] */
} pf_layer;

typedef struct {
  int nl, R;                         /* R: receptive radius (frames each side) */
  pf_layer L[PF_MAXL];
  float mu[20], sd[20], esd[PF_NOUT], keep[PF_NOUT];
} pf_model;

/* activations of one forward pass over Tin input frames (layer l has T[l] frames) */
typedef struct {
  int cap, T[PF_MAXL + 1];
  float *a[PF_MAXL + 1];             /* a[0] = input, a[l+1] = output of layer l */
  float *h[PF_MAXL];                 /* act(z) of layer l (needed when res is set) */
  float *g[2], *wt;                  /* backward scratch: two gradient buffers + transposed weights */
} pf_ws;

int pf_parse(pf_model *m, const char *spec);           /* "k[/dil]:cout:act[:res],..." e.g. "15:192:r,1:96:r,1:19:n" */
int pf_nparams(const pf_model *m);
void pf_free(pf_model *m);
int pf_save(const pf_model *m, const char *path, int quant);   /* quant: int8 weights (NXF3, ~4x smaller) */
pf_model *pf_load(const char *path);                   /* NXF2 or NXF3 */
void pf_quantize(pf_model *m);                         /* round weights to their int8 grid in place */

/* C[i][j] += sum_p A[i][p] * B[p][j] */
void pf_gemm(int M, int K, int N, const float *A, int lda, const float *B, int ldb, float *C, int ldc);

void pf_ws_init(pf_ws *w, const pf_model *m, int Tin);
void pf_ws_free(pf_ws *w);
/* in: Tin x PF_NIN. Output (Tin - 2R) x PF_NOUT lands in w->a[m->nl]. */
void pf_forward(const pf_model *m, pf_ws *w, const float *in, int Tin);
/* gout: (Tin - 2R) x PF_NOUT gradient of the loss w.r.t. the output. Accumulates into grad (pf_nparams floats,
 * same layout as pf_params order: per layer w then b). */
void pf_backward(const pf_model *m, pf_ws *w, const float *gout, float *grad);

/* per-frame network input for a whole sequence: out is N x PF_NIN */
void pf_inputs(const pf_model *m, const float *feat, const uint8_t *coded, int N, float *out);
/* correct decoded features in place (whole file) */
void pf_apply(const pf_model *m, float *feat, const uint8_t *coded, int N);
#endif
