#!/usr/bin/env python3
"""The Khmer–English workbench's data (workbench/): every Khmer headword of the aligned list (km-english), Headley 97,
Chuon Nath 2022 and 1967, English and Khmer Wiktionary, the WordNet links (uni/km-senses-all.json) and the Bible
words (km-bibleword, km-tw), commonest first (kmen2's corpus).
  queue.json: [[word, uses, sources, review]]: sources letters A aligned, H Headley, N Nath 2022, O Nath 1967,
    W English Wiktionary, K Khmer Wiktionary, D WordNet, B Bible words; review 1: English Wiktionary has it.
  km-wb.tsv (built by peakgen into km-wb.peak.zst, read with the engine): word<TAB>JSON
    {wn: [[WordNet sense (en-wn's headword), pos, confidence, how]], al: [[English, sentences]] (km-english's
    aligned words with their counts), mus: 1 (the Khmer Muslim Bible's own word), v: [km-ulb verses with it as a
    word, shortest first], vi: {a longer word it is in: [verses]}}.
Usage: kmenwb.py <dict_src> <kmen2 dir> <freq.json> <km-senses-all.json> <km-flat.tsv (flatalign's, for muslim
       words)> <out dir>"""
import html, json, os, re, sys
from collections import Counter, defaultdict
SRC, KMEN, FREQ, SENSES, FLAT, OUT = sys.argv[1:7]
os.makedirs(OUT, exist_ok=True)
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()
KH = re.compile(r'^[ក-៿᧠-᧿]+$')
freq = Counter(json.load(open(FREQ)))

def heads(path, col0=True):
    out = {}
    for l in open(path, encoding='utf-8'):
        if l.startswith('#') or '\t' not in l:
            continue
        a = l.rstrip('\n').split('\t')
        for k in a[0].split('|'):
            k = norm(k)
            if KH.match(k):
                out.setdefault(k, a)
    return out
D = f'{SRC}/khmer'
srcs = {'A': heads(f'{D}/dict/km-english.tsv'), 'H': heads(f'{D}/dict/km-h97.tsv'), 'N': heads(f'{D}/dict/km-nath2022.tsv'),
        'O': heads(f'{D}/dict/km-nath1967.tsv'), 'W': {k: [c for c in a if not c.startswith('<p-k>')] for k, a in heads(f'{D}/thesaurus/km-synsets.tsv').items() if any(not c.startswith('<p-k>') for c in a[1:])}, 'K': heads(f'{D}/dict/km-wiktionary.tsv')}
bw = {}
for f in ('km-bibleword', 'km-tw'):
    if os.path.exists(f'{D}/bible/words/{f}.tsv'):
        for l in open(f'{D}/bible/words/{f}.tsv', encoding='utf-8'):  # (English keys, the Khmer @ words)
            if not l.startswith('#'):
                for c in l.rstrip('\n').split('\t')[1:]:
                    k = norm(c.lstrip('@')) if c.startswith('@') and '@' not in c[1:] else ''
                    if KH.match(k):
                        bw.setdefault(k, None)
srcs['B'] = bw
wn = {norm(k): v for k, v in json.load(open(SENSES)).items() if KH.match(norm(k))}
srcs['D'] = wn
mus = set()
for l in open(FLAT, encoding='utf-8'):
    if '<p-n>(muslim word)</p-n>' in l:
        mus.add(norm(l.split('\t', 1)[0]))
pc = Counter()
for r in json.load(open(f'{KMEN}/pairs.json'))['pairs']:
    pc[norm(r[0]), r[1].lower()] += r[2]

words = set().union(*map(set, srcs.values()))
print(len(words), 'headwords;', {s: len(v) for s, v in srcs.items()}, file=sys.stderr)

# km-ulb verses: by kmen2's segmenting, a word on its own; a headword inside a longer token, "inside"
toks = json.load(open(f'{KMEN}/khm_ulb.json'))
vlen = {}
for l in open(f'{D}/bible/text/km-ulb.tsv', encoding='utf-8'):
    a = l.rstrip('\n').split('\t')
    if len(a) >= 3 and re.match(r'^[1-3]?[a-z]{2,3} \d+\.\d+$', a[0]):
        vlen[a[0]] = len(html.unescape(re.sub(r'<[^>]*>|¶', '', a[2])).replace('​', '').strip())
own, inside = defaultdict(set), defaultdict(lambda: defaultdict(set))
for ref, ts in toks.items():
    if ref not in vlen:
        continue
    for t in set(map(norm, ts)):
        if t in words:
            own[t].add(ref)
        n = len(t)
        for i in range(n):
            for j in range(i + 1, n + 1):
                s = t[i:j]
                if s != t and s in words and len(s) > 1:
                    inside[s][t].add(ref)
order = lambda refs: sorted(refs, key=lambda r: (vlen[r], r))
VMAX, IMAX = 400, 40

queue = []
with open(f'{OUT}/km-wb.tsv', 'w', encoding='utf-8') as o:
    o.write('#desc\tThe Khmer–English workbench’s data: each word’s WordNet links, aligned English and Khmer ULB verses\n')
    for k in sorted(words, key=lambda k: (-freq[k], k)):
        e = {}
        if k in wn:
            e['wn'] = [[s[0], s[1], round(max(s[2]), 2), s[3]] for s in wn[k]]
        if k in srcs['A']:
            al = [c.lstrip('@') for c in srcs['A'][k][1:] if c and not c.startswith('<') and len(c) < 60]
            if al:
                e['al'] = [[x, pc[k, x.lower()]] for x in al[:40]]
        if k in mus:
            e['mus'] = 1
        if own.get(k):
            e['v'] = order(own[k])[:VMAX]
            if len(own[k]) > VMAX:
                e['vn'] = len(own[k])
        if inside.get(k):
            e['vi'] = {t: order(rs)[:IMAX] for t, rs in sorted(inside[k].items(), key=lambda x: -len(x[1]))[:30]}
        body = json.dumps(e, ensure_ascii=False, separators=(',', ':')).replace('@', '@@').replace('^', '^^')
        o.write(f'{k}\t{body}\n')
        queue.append([k, freq[k], ''.join(s for s in 'AHNOWKDB' if k in srcs[s]), int(k in srcs['W'])])
json.dump(queue, open(f'{OUT}/queue.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(queue), 'words;', sum(x[3] for x in queue), 'to review (English Wiktionary has them);',
      sum(1 for k in words if own.get(k)), 'with a km-ulb verse', file=sys.stderr)
