/* rc.c - LZMA-style carry-propagating range coder with multi-symbol adaptive models */
#include "fcq.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

static float g_lg[65537];
static int g_ok;
void fcq_init(void) {
  if (g_ok) return;
  g_lg[0] = 0;
  for (int i = 1; i <= 65536; i++) g_lg[i] = log2f((float)i);
  g_ok = 1;
}
float fcq_lg(uint32_t v) { return g_lg[v]; }

void model_init(model_t *m, int n, int init, int inc, const uint16_t *prior) {
  fcq_init();
  m->n = n; m->inc = inc; m->total = 0;
  m->f = (uint16_t *)malloc(sizeof(uint16_t) * n);
  for (int i = 0; i < n; i++) {
    uint16_t f = prior ? (prior[i] ? prior[i] : 1) : (uint16_t)init;
    m->f[i] = f; m->total += f;
  }
}
void model_free(model_t *m) { free(m->f); m->f = NULL; }
float model_cost(const model_t *m, int s) { return g_lg[m->total] - g_lg[m->f[s]]; }

static void model_update(model_t *m, int s) {
  if (m->total + m->inc > 65535) {
    uint32_t t = 0;
    for (int i = 0; i < m->n; i++) { m->f[i] = (m->f[i] + 1) >> 1; t += m->f[i]; }
    m->total = t;
  }
  m->f[s] += m->inc; m->total += m->inc;
}

/* ---- encoder ---- */
static void put(rc_t *r, uint8_t b) {
  if (r->pos == r->cap) { r->cap = r->cap ? r->cap * 2 : 4096; r->buf = (uint8_t *)realloc(r->buf, r->cap); }
  r->buf[r->pos++] = b;
}
static void shift_low(rc_t *r) {
  if ((uint32_t)r->low < 0xFF000000u || (r->low >> 32) != 0) {
    uint8_t carry = (uint8_t)(r->low >> 32), tmp = r->cache;
    do { put(r, (uint8_t)(tmp + carry)); tmp = 0xFF; } while (--r->cache_size);
    r->cache = (uint8_t)((r->low >> 24) & 0xFF);
  }
  r->cache_size++;
  r->low = (r->low & 0x00FFFFFFu) << 8;
}
void rc_enc_init(rc_t *r) {
  memset(r, 0, sizeof *r);
  r->range = 0xFFFFFFFFu; r->cache_size = 1;
}
static void rc_encode(rc_t *r, uint32_t cum, uint32_t freq, uint32_t total) {
  r->range /= total;
  r->low += (uint64_t)cum * r->range;
  r->range *= freq;
  while (r->range < (1u << 24)) { r->range <<= 8; shift_low(r); }
}
size_t rc_finish(rc_t *r, uint8_t **data) {
  /* any value in [low, low+range) decodes correctly: pick the one with the most trailing zero bits,
   * since trailing zero bytes are stripped below (decoder reads zeros past the end) */
  { uint64_t lo = r->low, hi = lo + r->range - 1;
    for (int b = 32; b > 0; b--) { uint64_t v = hi & ~((1ull << b) - 1); if (v >= lo) { r->low = v; break; } } }
  for (int i = 0; i < 5; i++) shift_low(r);
  size_t n = r->pos - 1;                 /* first byte is always 0: dropped */
  while (n > 0 && r->buf[n] == 0) n--;   /* decoder reads zeros past the end */
  *data = r->buf + 1;
  return n;
}
void rc_free(rc_t *r) { if (!r->dec) free(r->buf); r->buf = NULL; }

/* ---- decoder ---- */
static uint8_t next_byte(rc_t *r) { return r->pos < r->cap ? r->buf[r->pos++] : (r->pos++, 0); }
void rc_dec_init(rc_t *r, const uint8_t *buf, size_t len) {
  memset(r, 0, sizeof *r);
  r->dec = 1; r->buf = (uint8_t *)buf; r->cap = len;
  r->range = 0xFFFFFFFFu;
  for (int i = 0; i < 4; i++) r->code = (r->code << 8) | next_byte(r);
}
static uint32_t dec_target(rc_t *r, uint32_t total) {
  r->range /= total;
  uint32_t v = r->code / r->range;
  return v < total ? v : total - 1;
}
static void dec_update(rc_t *r, uint32_t cum, uint32_t freq) {
  r->code -= cum * r->range;
  r->range *= freq;
  while (r->range < (1u << 24)) { r->code = (r->code << 8) | next_byte(r); r->range <<= 8; }
}

int rc_sym(rc_t *r, model_t *m, int v, int cat) {
  uint32_t cum = 0;
  if (!r->dec) {
    for (int i = 0; i < v; i++) cum += m->f[i];
    r->bits[cat] += g_lg[m->total] - g_lg[m->f[v]];
    rc_encode(r, cum, m->f[v], m->total);
  } else {
    uint32_t t = dec_target(r, m->total);
    int i = 0;
    while (i < m->n - 1 && cum + m->f[i] <= t) { cum += m->f[i]; i++; }
    dec_update(r, cum, m->f[i]);
    v = i;
  }
  model_update(m, v);
  return v;
}

int rc_bits(rc_t *r, int v, int nbits, int cat) {
  uint32_t total = 1u << nbits;
  if (!r->dec) {
    r->bits[cat] += nbits;
    rc_encode(r, (uint32_t)v, 1, total);
    return v;
  }
  uint32_t t = dec_target(r, total);
  dec_update(r, t, 1);
  return (int)t;
}
