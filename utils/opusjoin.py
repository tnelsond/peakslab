#!/usr/bin/env python3
"""Khmer, English and another language through the same English sentence: kmen2's English–Khmer sentences (a
source's) joined with an OPUS English–Chinese or English–Thai corpus (moses zip) where the English is the same
(lowercase, letters and digits, without a/an/the: kmen2's English drops punctuation and some articles); sentences of
3 words at least. Out: key<TAB>English<TAB>the other language, for pivot.py's extra sentences.
Usage: opusjoin.py <kmen2 dir> <source> <OPUS zip> <out.tsv> (appended)"""
import io, json, re, sys, zipfile
W, SRC, ZIP, OUT = sys.argv[1:5]
DROP = {'a', 'an', 'the'}
def key(words):
    ws = [re.sub(r'[^a-z0-9]', '', w.lower()) for w in words]
    ws = [w for w in ws if w and w not in DROP]
    return ' '.join(ws) if len(ws) >= 3 else None
want = {}
for k, toks in json.load(open(f'{W}/eng_{SRC}.json')).items():
    s = key(t.split('|', 2)[2] for t in toks)
    if s:
        want.setdefault(s, []).append(k)
z = zipfile.ZipFile(ZIP)
names = z.namelist()
en = next(n for n in names if n.endswith('.en'))
ot = next(n for n in names if not n.endswith(('.en', '.xml', '.ids')) and not n.startswith(('README', 'LICENSE')))
n = hit = 0
seen = set()
with open(OUT, 'a', encoding='utf-8') as o:
    for le, lo in zip(io.TextIOWrapper(z.open(en), encoding='utf-8', errors='replace'),
                      io.TextIOWrapper(z.open(ot), encoding='utf-8', errors='replace')):
        n += 1
        s = key(le.split())
        if s and s in want and s not in seen:  # (the first translation of a sentence)
            seen.add(s)
            for k in want[s]:
                o.write(f'{k}\t{le.strip()}\t{lo.strip()}\n')
                hit += 1
print(SRC, ZIP, n, 'lines;', len(seen), 'of', len(want), 'sentences matched;', hit, 'rows', file=sys.stderr)
