#!/usr/bin/env python3
"""Turn eflomal word alignments into translation-pair counts.

Usage: extract.py WORK_DIR
Reads corpus.km/en, corpus.meta.jsonl, fwd.align, rev.align
Writes pairs.json : {"pairs": [[km, en, count, pos_counts, examples, khmer Bibles, English Bibles], ...], "Lk": {...}, "Le": {...}}
"""
import sys, json, re
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


BASE = re.compile(r'[\u1780-\u17b3](?:\u17d2[\u1780-\u17b3])*([\u17b6-\u17d1\u17dd]*)')


def km_syllables(w):
    """About how many syllables: a letter (its subscripts with it) with a vowel sign
    or mark is one; one without is the inherent vowel's at a word's start, else a final"""
    n = 0
    for i, m in enumerate(BASE.finditer(w)):
        n += bool(m[1]) or (i == 0 and m.end() < len(w))
    return max(n, 1)


def en_syllables(w):
    w = w.lower()
    n = len(re.findall(r'[aeiouy]+', w)) - (w.endswith('e') and not w.endswith(('le', 'ee')) and len(w) > 3)
    return max(n, 1)


def name_span(km, j, e, inter, k2e):
    """A name's Khmer: from a word aligned with it both ways, the run of next words
    (aligned with nothing else) whose syllables come nearest the English's: a
    Bible may write a name in pieces (អ័ប្រា​ហាំ)"""
    seeds = sorted(i for i in range(len(km)) if (i, j) in inter)
    if not seeds:
        return None
    a = b = seeds[0]
    want = en_syllables(e)
    free = lambda i: 0 <= i < len(km) and set(k2e.get(i, ())) <= {j}
    syl = lambda a, b: sum(km_syllables(km[i]) for i in range(a, b + 1))
    while b - a + 1 < MAX_SPAN:
        cur = abs(syl(a, b) - want)
        opts = [(abs(syl(x, y) - want), x, y) for x, y in ((a - 1, b), (a, b + 1)) if free(x if x < a else y)]
        if not opts or min(opts)[0] >= cur:
            break
        _, a, b = min(opts)
    return a, b


def events(km, en, fwd, rev, pos):
    """Yield (khmer_string, english_string, english_token_indices) for one verse pair."""
    inter = fwd & rev
    union = fwd | rev
    k2e, e2k = defaultdict(list), defaultdict(list)
    for i, j in union:
        k2e[i].append(j)
        e2k[j].append(i)
    used = set()
    # A name: the Khmer words that write it, by their syllables (អ័ប្រា + ហាំ -> Abraham)
    for j, p in enumerate(pos):
        if p == 'PROPN':
            sp = name_span(km, j, en[j], inter, k2e)
            if sp and sp[1] > sp[0]:
                yield '\u200b'.join(km[sp[0]:sp[1] + 1]), en[j], [j]
                used.update((i, j) for i in range(sp[0], sp[1] + 1))
    # One Khmer word -> English multi-word phrase (e.g. ពិធីបូជា -> burnt offering)
    for i, es in k2e.items():
        es.sort()
        if 2 <= len(es) <= 3 and contiguous(es) and any((i, j) in inter for j in es):
            if all(len(e2k[j]) == 1 for j in es) and not any((i, j) in used for j in es):
                yield km[i], ' '.join(en[j] for j in es), es
                used.update((i, j) for j in es)
    for i, j in inter:
        if (i, j) not in used and not any(i == x for x, _ in used):
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
        meta = json.loads(lm)
        for k, e, js in events(km, en, links(lf), links(lr), meta[3]):
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
