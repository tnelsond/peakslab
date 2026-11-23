#!/usr/bin/env python3
"""Link each English Wiktionary sense (with translations) to an Open English WordNet synset.

Usage: link.py <src.pkl> <emb.npz> <out links.pkl>

Candidates: the synsets of the sense's word in its part of speech. Each scored by
  T  translations: in each OMW language, does the sense translate as one of the synset's lemmas?
     (a language's credit is split among the candidates it matches, so a word every sense shares counts little)
  E  gloss: cosine of the Wiktionary gloss and the synset's lemmas + definition (bge-small)
  S  Wiktionary's synonyms that are lemmas of the synset
  R  WordNet's order (commonest sense first)
links[i] = (synset id or None, confidence, [(synset, score)...]) for wk[i].
"""
import sys, pickle, unicodedata, numpy as np

SRC, EMB, OUT = sys.argv[1:4]
d = pickle.load(open(SRC, 'rb'))
syn, idx, omw, wk = d['syn'], d['idx'], d['omw'], d['wk']
e = np.load(EMB)
es = e['syn'].astype(np.float32)
ew = dict(zip(e['wki'].tolist(), e['wk'].astype(np.float32)))
row = {s: i for i, s in enumerate(e['ids'])}
LANG = {'cmn': 'zh', 'no': 'nb'}

def norm(w):
	w = unicodedata.normalize('NFKD', w.lower().replace('_', ' '))
	return ''.join(c for c in w if not unicodedata.combining(c)).strip()

ON = {i: {l: {norm(w) for w in ws} for l, ws in v.items()} for i, v in omw.items()}

def cands(w, p):
	return [s for q in ([p] if p in ('n', 'v', 'a', 'r') else 'nvar') for s in idx.get((w.lower(), q), [])]

W_T, W_E, W_S, W_R = 0.5, 8.0, 1.0, 0.15
LINK = 6.0  # below it, no synset: the sense is its own concept (hand gold: precision .91, recall .63)

def score(i):
	w, p, g, sy, wd, tr = wk[i][:6]
	C = cands(w, p)
	if not C:
		return None, 0, []
	tw = {}
	for l, ws in tr.items():
		l = LANG.get(l, l)
		tw.setdefault(l, set()).update(norm(x) for x in ws)
	T = np.zeros(len(C))
	for l, ws in tw.items():
		m = np.array([bool(ws & ON.get(syn[c][0], {}).get(l, set())) for c in C], float)
		if m.sum():
			T += m / m.sum()
	E = np.array([float(ew[i] @ es[row[c]]) if c in row else 0 for c in C])
	S = np.array([len({x.lower() for x in sy} & {x.lower() for x in syn[c][2]}) for c in C], float)
	R = np.arange(len(C), dtype=float)
	sc = W_T * np.minimum(T, 4) + W_E * E + W_S * np.minimum(S, 2) - W_R * np.minimum(R, 6)
	o = np.argsort(-sc)
	ranked = [(C[j], round(float(sc[j]), 3), round(float(T[j]), 2), round(float(E[j]), 3)) for j in o]
	margin = sc[o[0]] - (sc[o[1]] if len(C) > 1 else 0) if len(C) > 1 else 9
	return (C[o[0]] if sc[o[0]] >= LINK else None), float(margin), ranked

links = [score(i) for i in range(len(wk))]
pickle.dump(links, open(OUT, 'wb'), protocol=5)
print(sum(1 for l in links if l[0]), 'linked of', len(links), file=sys.stderr)
