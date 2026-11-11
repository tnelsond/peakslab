#!/usr/bin/env python3
"""Compare generated Khmer glosses with Headley's Cambodian-English Dictionary (h97.tsv).

Usage: evaluate.py GENERATED_TSV H97_TSV
"""
import sys, re, random
from collections import defaultdict

TAG = re.compile(r'<[^>]+>')


def load_gen(p):
    out = {}
    for line in open(p, encoding='utf-8'):
        if line[0] == '#':
            continue
        k, v = line.rstrip('\n').split('\t', 1)
        glosses = re.findall(r'</p-n> <p-a>([^<]+)</p-a> <p-n>(\d+)%', v)
        out[k] = [(g, int(pct)) for g, pct in glosses]
    return out


def stems(text):
    words = re.findall(r'[a-z]+', text.lower())
    s = set()
    for w in words:
        s.add(w)
        for suf in ('ing', 'ed', 'es', 's', 'ly', 'er'):
            if w.endswith(suf) and len(w) - len(suf) >= 3:
                s.add(w[:-len(suf)])
    return s


h97 = defaultdict(str)
for line in open(sys.argv[2], encoding='utf-8'):
    if line[0] == '#':
        continue
    p = line.rstrip('\n').split('\t')
    h97[p[0].replace('​', '').strip()] += ' ' + TAG.sub(' ', ' '.join(p[1:]))

gen = load_gen(sys.argv[1])


def match(g, ref):
    ws = stems(g)
    gw = [w for w in re.findall(r'[a-z]+', g.lower()) if w not in {'of', 'the', 'a', 'to'}]
    return bool(gw) and all(any(x in ref for x in stems(w)) for w in gw)


buckets = defaultdict(lambda: [0, 0, 0])  # n, top1 hit, any hit
misses = []
for k, gl in gen.items():
    if k not in h97 or not gl:
        continue
    ref = stems(h97[k])
    top = gl[0][1]
    b = '>=70%' if top >= 70 else '40-69%' if top >= 40 else '<40%'
    for key in (b, 'all'):
        buckets[key][0] += 1
        buckets[key][1] += match(gl[0][0], ref)
        buckets[key][2] += any(match(g, ref) for g, _ in gl)
    if not match(gl[0][0], ref):
        misses.append((k, gl[:3], h97[k][:120].strip()))

print(f'{len(gen)} generated headwords, {sum(1 for k in gen if k in h97)} also in h97')
for key in ('all', '>=70%', '40-69%', '<40%'):
    n, t1, an = buckets[key]
    if n:
        print(f'{key:7} n={n:5}  top gloss in h97: {100*t1/n:.0f}%   any gloss in h97: {100*an/n:.0f}%')
random.seed(1)
print('\nsample top-gloss misses:')
for m in random.sample(misses, 15):
    print(' ', m[0], m[1], '| h97:', m[2])
