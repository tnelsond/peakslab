#!/usr/bin/env python3
"""Turn eflomal word alignments into translation-pair counts.

Usage: extract.py WORK_DIR
Reads corpus.km/en, corpus.meta.jsonl, fwd.align, rev.align
Writes pairs.json : {"pairs": [[km, en, count, pos_counts, examples, khmer Bibles, English Bibles], ...], "Lk": {...}, "Le": {...}}
"""
import sys, json
from collections import Counter, defaultdict

W = sys.argv[1]
MIN = 5
MAX_SPAN = 4


def links(line):
    out = set()
    for a in line.split():
        i, j = a.split('-')
        out.add((int(i), int(j)))
    return out


def contiguous(xs):
    return xs == list(range(xs[0], xs[0] + len(xs)))


def events(km, en, fwd, rev):
    """Yield (khmer_string, english_string, english_token_indices) for one verse pair."""
    inter = fwd & rev
    union = fwd | rev
    k2e, e2k = defaultdict(list), defaultdict(list)
    for i, j in union:
        k2e[i].append(j)
        e2k[j].append(i)
    used = set()
    # Khmer multi-token phrase -> one English word (e.g. ផ្ទៃ + មេឃ -> heaven)
    for j, ks in e2k.items():
        ks.sort()
        if 2 <= len(ks) <= MAX_SPAN and contiguous(ks) and any((i, j) in inter for i in ks):
            if all(len(k2e[i]) == 1 for i in ks):
                yield '\u200b'.join(km[i] for i in ks), en[j], [j]
                used.update((i, j) for i in ks)
    # One Khmer word -> English multi-word phrase (e.g. ពិធីបូជា -> burnt offering)
    for i, es in k2e.items():
        es.sort()
        if 2 <= len(es) <= 3 and contiguous(es) and any((i, j) in inter for j in es):
            if all(len(e2k[j]) == 1 for j in es) and not any((i, j) in used for j in es):
                yield km[i], ' '.join(en[j] for j in es), es
                used.update((i, j) for j in es)
    for i, j in inter:
        if (i, j) not in used:
            yield km[i], en[j], [j]


def run(pass_no, keep=None):
    counts = Counter()
    pos = defaultdict(Counter)
    ex = defaultdict(list)
    vers = defaultdict(set)
    engs = defaultdict(set)
    files = [open(f'{W}/{n}') for n in ('corpus.km', 'corpus.en', 'fwd.align', 'rev.align', 'corpus.meta.jsonl')]
    for n, (lk, le, lf, lr, lm) in enumerate(zip(*files)):
        km, en = lk.split(), le.split()
        meta = json.loads(lm) if pass_no == 2 else None
        for k, e, js in events(km, en, links(lf), links(lr)):
            if pass_no == 1:
                counts[(k, e)] += 1
            elif (k, e) in keep:
                p = '+'.join(meta[3][j] for j in js)
                pos[(k, e)][p] += 1
                vers[(k, e)].add(meta[1])
                engs[(k, e)].add(meta[2])
                lst = ex[(k, e)]
                if len(lst) < 4 and meta[0] not in lst:
                    lst.append(meta[0])
        if n % 100000 == 0:
            print(f'pass {pass_no}: {n}', file=sys.stderr, flush=True)
    return counts, pos, ex, vers, engs


counts, _, _, _, _ = run(1)
Lk, Le = Counter(), Counter()
for (k, e), c in counts.items():
    Lk[k] += c
    Le[e] += c
keep = {ke for ke, c in counts.items() if c >= MIN}
print(len(counts), 'pairs,', len(keep), 'with count >=', MIN, file=sys.stderr)
_, pos, ex, vers, engs = run(2, keep)
out = {
    'pairs': [[k, e, counts[(k, e)], dict(pos[(k, e)]), ex[(k, e)], sorted(vers[(k, e)]), sorted(engs[(k, e)])] for (k, e) in keep],
    'Lk': {k: v for k, v in Lk.items() if v >= MIN},
    'Le': {e: v for e, v in Le.items() if v >= MIN},
}
json.dump(out, open(f'{W}/pairs.json', 'w'), ensure_ascii=False)
