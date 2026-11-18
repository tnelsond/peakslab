#!/usr/bin/env python3
"""The Khmer words with an open English definition, in one dictionary (the workbench's: workbench/data/km-open.zst,
by peakgen): every entry of English Wiktionary (km-kaikki), of English Wiktionary's translation tables (km-senses:
a Khmer word there, its English sense) and of Wikidata (km-wikidata), as it is, each marked with where it's from
(p-tags), not merged: a word has an entry from each. Not WordNet links: there's no official Khmer WordNet (the
workbench's, uni/km-senses-all.json's, are machine-made). The workbench's words to define are the ones it hasn't.
Each input is a dictionary's entries, one a line (header<TAB>body: utils/peakdump.c's, of its .peak).
With the workbench's queue.json, its 4th field becomes 1 for a word this has (0: a word to define), so the workbench
knows without loading this (run it after kmenwb.py, which writes that field as English Wiktionary's alone).
Usage: kmopen.py <km-kaikki> <km-senses> <km-wikidata> <out .tsv> [queue.json]"""
import json, re, sys
KAIKKI, SENSES, WIKIDATA, OUT = sys.argv[1:5]
QUEUE = sys.argv[5] if len(sys.argv) > 5 else None
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()
KH = re.compile(r'[ក-៿᧠-᧿]')
text = lambda h: re.sub(r'<[^>]+>', '', h).replace('​', '').strip()
tag = lambda t: f'<p-tags>{t}</p-tags> '
out = []
def lines(path):
    for l in open(path, encoding='utf-8'):
        l = l.rstrip('\n').rstrip()
        if '\t' in l and not l.startswith('#'):
            yield l.split('\t')

# English Wiktionary's Khmer entries
for h, *b in lines(KAIKKI):
    out.append((h, tag('English Wiktionary') + '\t'.join(b)))
# A translation table's English sense, for each Khmer word in it (a cell of Khmer, no Latin)
for h, *b in lines(SENSES):
    pos = next((c for c in b if c.startswith('<p-n>')), '')
    for c in b:
        t = text(c)
        if KH.search(t) and not re.search(r'[A-Za-z]', t):
            out.append((t, tag('Wiktionary translation table') + pos + ' ' + h))
# Wikidata's Khmer labels: the English label, the description
for h, *b in lines(WIKIDATA):
    out.append((h, tag('Wikidata') + '\t'.join(b)))
# (No WordNet links: Khmer has no official WordNet, and km-wb's are machine-made)

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('#desc\tKhmer words with an open English definition, all together: English Wiktionary (CC BY-SA, from '
            'kaikki.org), its translation tables and Wikidata (CC0)\n')
    for h, b in out:
        f.write(f'{h}\t{b}\n')
src = {}
for h, b in out:
    src.setdefault(re.match(r'<p-tags>([^<(]+)', b).group(1).strip(), set()).add(h)
print(len(out), 'entries;', len({h for h, _ in out}), 'headwords;', {k: len(v) for k, v in src.items()}, file=sys.stderr)
if QUEUE:
    has = {norm(h) for h, _ in out}
    q = json.load(open(QUEUE))
    for x in q:
        x[3] = int(norm(x[0]) in has)
    json.dump(q, open(QUEUE, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(sum(1 for x in q if not x[3]), 'of', len(q), 'words to define', file=sys.stderr)
