#!/usr/bin/env python3
"""Pair every Khmer translation with every English translation, verse by verse.

Usage: build_corpus.py WORK_DIR
Writes WORK_DIR/corpus.km, corpus.en (one verse per line, space-separated tokens)
and corpus.meta.jsonl (verse key, khm name, eng name, english surface/pos per token).
"""
import sys, json, glob, os, re
from collections import Counter, defaultdict

W = sys.argv[1]
DROP_POS = {'DET', 'PUNCT', 'SYM', 'X', 'SPACE'}  # (numbers stay: "four faces" is បួនមុខ)

khm = {os.path.basename(p)[4:-5]: json.load(open(p)) for p in sorted(glob.glob(f'{W}/khm_*.json'))}
eng = {os.path.basename(p)[4:-5]: json.load(open(p)) for p in sorted(glob.glob(f'{W}/eng_*.json'))}
# a word's part of speech: its usual one ("the" a determiner, though tagged a name 3 times in 183,000)
tags = defaultdict(Counter)
for ev in eng.values():
    for toks in ev.values():
        for t in toks:
            l, p, _ = t.split('|', 2)
            tags[l][p] += 1
usual = {l: c.most_common(1)[0][0] for l, c in tags.items()}

n = 0
with open(f'{W}/corpus.km', 'w') as fk, open(f'{W}/corpus.en', 'w') as fe, open(f'{W}/corpus.meta.jsonl', 'w') as fm:
    for kn, kv in khm.items():
        for en, ev in eng.items():
            for key, ktoks in kv.items():
                etoks = ev.get(key)
                if not etoks or not ktoks:
                    continue
                kept = [t.split('|') for t in etoks]
                kept = [t for t in kept if usual[t[0]] not in DROP_POS]
                if not kept or len(ktoks) > 250 or len(kept) > 250:
                    continue
                fk.write(' '.join(ktoks) + '\n')
                fe.write(' '.join(re.sub(r'\s', '_', t[0]) for t in kept) + '\n')  # (any space in a word: one token)
                fm.write(json.dumps([key, kn, en, [t[1] for t in kept]], ensure_ascii=False) + '\n')
                n += 1
print(n, 'sentence pairs')
