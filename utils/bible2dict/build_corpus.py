#!/usr/bin/env python3
"""Pair every Khmer translation with every English translation, verse by verse.

Usage: build_corpus.py WORK_DIR
Writes WORK_DIR/corpus.km, corpus.en (one verse per line, space-separated tokens)
and corpus.meta.jsonl (verse key, khm name, eng name, english surface/pos per token).

A Bible (its lines verses, "gen 1.1") pairs with every Bible; a corpus's lines ("subs 12")
only with its own (the same file name). A corpus in pieces (nllb.1, nllb.2: big ones,
for prep.py a piece at a time) is one source. A file is loaded when it's needed (the
Bibles kept): a corpus of millions of lines doesn't have to fit in memory with the rest
"""
import sys, json, glob, os, re
from collections import Counter, defaultdict

W = sys.argv[1]
DROP_POS = {'DET', 'PUNCT', 'SYM', 'X', 'SPACE'}  # (numbers stay: "four faces" is បួនមុខ)
VERSE = re.compile(r'^\w+ \d+\.\d+')
name = lambda p: os.path.basename(p)[4:-5]
group = lambda n: n.split('.')[0]  # (nllb.3: nllb)
khms, engs = sorted(glob.glob(f'{W}/khm_*.json')), sorted(glob.glob(f'{W}/eng_*.json'))

# a word's part of speech: its usual one ("the" a determiner, though tagged a name 3 times in 183,000)
tags = defaultdict(Counter)
bible, cache = {}, {}
for p in engs:
    ev = json.load(open(p))
    bible[p] = bool(VERSE.match(next(iter(ev), '')))
    if bible[p]:
        cache[p] = ev
    for toks in ev.values():
        for t in toks:
            l, pos, _ = t.split('|', 2)
            tags[l][pos] += 1
    del ev
usual = {l: c.most_common(1)[0][0] for l, c in tags.items()}
del tags

n = 0
with open(f'{W}/corpus.km', 'w') as fk, open(f'{W}/corpus.en', 'w') as fe, open(f'{W}/corpus.meta.jsonl', 'w') as fm:
    for kp in khms:
        kv, kn = json.load(open(kp)), name(kp)
        kb = bool(VERSE.match(next(iter(kv), '')))
        for ep in engs:
            en = name(ep)
            if bible[ep] != kb or (not kb and en != kn):
                continue
            ev = cache.get(ep) or json.load(open(ep))
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
                fm.write(json.dumps([key, group(kn), group(en), [t[1] for t in kept]], ensure_ascii=False) + '\n')
                n += 1
            del ev
        del kv
print(n, 'sentence pairs')
