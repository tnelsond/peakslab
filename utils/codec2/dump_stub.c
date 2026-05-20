// dump_stub.c - empty stubs to replace dump.c when DUMP is not defined
#include "src/dump.h"
void dump_on(char f[]) {} void dump_off() {}
void dump_Sn(int m, float s[]) {} void dump_Sw(COMP s[]) {} void dump_Sw_(COMP s[]) {}
void dump_Ew(COMP e[]) {} void dump_softdec(float *s, int n) {}
void dump_model(MODEL *m) {} void dump_quantised_model(MODEL *m) {}
void dump_Pwn(COMP p[]) {} void dump_Pw(float p[]) {} void dump_Rw(float r[]) {}
void dump_lsp(float l[]) {} void dump_weights(float w[], int n) {} void dump_lsp_(float l[]) {}
void dump_mel(float m[], int o) {} void dump_mel_indexes(int m[], int o) {}
void dump_ak(float a[], int o) {} void dump_ak_(float a[], int o) {}
void dump_E(float e) {} void dump_lpc_snr(float s) {} void dump_snr(float s) {}
void dump_phase(float p[], int l) {} void dump_phase_(float p[], int l) {}
void dump_hephase(int i[], int d) {} void dump_sq(int m, float s[]) {}
void dump_dec(COMP f[]) {} void dump_Fw(COMP f[]) {} void dump_e(float e[]) {}
void dump_bg(float e, float b, float p) {} void dump_Pwb(float p[]) {}
