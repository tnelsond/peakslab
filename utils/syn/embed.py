#!/usr/bin/env python3
"""Embed Wiktionary glosses and WordNet synsets for gloss similarity, with the static model2vec
model minishlab/potion-base-32M (MIT; a sentence is the mean of its tokens' vectors, fast on any CPU).

Usage: embed.py <src.pkl> <out.npz> [label|gloss|both]
Texts: a Wiktionary sense "word: its table's label" (or gloss, or both); a synset "lemma, lemma: definition".
Only senses with a candidate synset, and those synsets, are embedded.
"""
import sys, pickle, numpy as np
from huggingface_hub import snapshot_download
from tokenizers import Tokenizer
from safetensors.numpy import load_file

SRC, OUT = sys.argv[1:3]
d = pickle.load(open(SRC, 'rb'))
syn, idx, wk = d['syn'], d['idx'], d['wk']

def cands(w, p):
	ps = [p] if p in ('n', 'v', 'a', 'r') else 'nvar'
	return [s for q in ps for s in idx.get((w.lower(), q), [])]

need = sorted({s for w, p, *_ in wk for s in cands(w, p)})
have = [i for i, (w, p, *_) in enumerate(wk) if cands(w, p)]
TEXT = sys.argv[3] if len(sys.argv) > 3 else 'label'
def text(x):  # (a translation table's label says what its words mean; the sense wiktextract put it under may not)
	return f'{x[0]}: ' + {'gloss': x[2], 'label': x[6] or x[2], 'both': '; '.join(dict.fromkeys(filter(None, (x[6], x[2]))))}[TEXT]
texts = [text(wk[i]) for i in have] + [', '.join(syn[s][2][:4]) + ': ' + syn[s][3] for s in need]
print(len(have), 'senses', len(need), 'synsets', file=sys.stderr)

M = snapshot_download('minishlab/potion-base-32M')
tok = Tokenizer.from_file(f'{M}/tokenizer.json')
E = next(iter(load_file(f'{M}/model.safetensors').values())).astype(np.float32)
vec = np.zeros((len(texts), E.shape[1]), np.float16)
for j, enc in enumerate(tok.encode_batch(texts, add_special_tokens=False)):
	ids = [i for i in enc.ids if i < len(E)]
	if ids:
		v = E[ids].mean(0)
		vec[j] = v / (np.linalg.norm(v) or 1)
np.savez(OUT, wk=vec[:len(have)], wki=np.array(have), syn=vec[len(have):], ids=np.array(need))
