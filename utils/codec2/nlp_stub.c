// nlp_stub.c - NLP is encoder-only, stub it out for decoder-only WASM build
#include "src/nlp.h"

void *nlp_create(C2CONST *c2const){return (void *)1;}
void nlp_destroy(void *nlp_state){}
float nlp(void *nlp_state, float Sn[], int n, float *pitch_samples, COMP Sw[], float W[], float *prev_f0){return 0.0f;}
