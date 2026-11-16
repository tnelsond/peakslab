#!/usr/bin/env python3
"""How Khmer and Chinese match through English, verse by verse: in each Bible verse (and ALT sentence) both have, an
English word's aligned Khmer (kmen2's eflomal alignment of the English and Khmer Bibles, a word's pieces side by side
joined) and the Chinese the English word was aligned with there (zh_pivot.py's: BSB, ASV, ULB and the Chinese Union
Version, simplified). Out: {English: {Khmer: {Chinese: weight}}}, a verse's Chinese words sharing one count.
Usage: zhpairs.py <kmen2 dir> <zh.pkl> <out.json>"""
import json, pickle, sys
from collections import defaultdict
W, ZH, OUT = sys.argv[1:4]
zh = pickle.load(open(ZH, 'rb'))
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()
C = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
n = used = 0
for le, lk, lm, la in zip(open(f'{W}/corpus.en', encoding='utf-8'), open(f'{W}/corpus.km', encoding='utf-8'),
                          open(f'{W}/corpus.meta.jsonl', encoding='utf-8'), open(f'{W}/fwd.align')):
    n += 1
    key = lm[2:lm.index('"', 2)]
    v = zh.get(key)
    if not v:
        continue
    en = le.split()
    if not any(t in v for t in en):
        continue
    km = lk.split()
    al = defaultdict(list)
    for p in la.split():
        k, e = p.split('-')
        al[int(e)].append(int(k))
    for i, t in enumerate(en):
        z = v.get(t)
        if not z or i not in al:
            continue
        parts, last = [], -9
        for k in sorted(al[i]):
            if k == last + 1:
                parts[-1] += km[k]
            else:
                parts.append(km[k])
            last = k
        tot = sum(z.values())
        for p in parts:
            for w, c in z.items():
                C[t][norm(p)][w] += c / tot / len(parts)
        used += 1
print(n, 'lines;', used, 'English words with Khmer and Chinese;', len(C), 'English words', file=sys.stderr)
json.dump({e: {k: {z: round(x, 2) for z, x in zs.items() if x >= .2} for k, zs in ks.items()} for e, ks in C.items()},
          open(OUT, 'w'), ensure_ascii=False)
