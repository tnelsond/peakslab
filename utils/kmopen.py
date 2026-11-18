#!/usr/bin/env python3
"""The Khmer words with an open English definition, in one dictionary (the workbench's: workbench/data/km-open.zst,
by peakgen): every entry of English Wiktionary (km-kaikki), of English Wiktionary's translation tables (km-senses:
a Khmer word there, its English sense), of Wikidata (km-wikidata) and every WordNet link of the workbench's
(km-wb's wn: uni/km-senses-all.json's), as it is, each marked with where it's from (p-tags), not merged: a word
has an entry from each. The workbench's words to define are the ones it hasn't.
Each input is a dictionary's entries, one a line (header<TAB>body: utils/peakdump.c's, of its .peak).
With the workbench's queue.json, its 4th field becomes 1 for a word this has (0: a word to define), so the workbench
knows without loading this (run it after kmenwb.py, which writes that field as English Wiktionary's alone).
Usage: kmopen.py <km-kaikki> <km-senses> <km-wikidata> <km-wb> <out .tsv> [queue.json]"""
import json, re, sys
KAIKKI, SENSES, WIKIDATA, WB, OUT = sys.argv[1:6]
QUEUE = sys.argv[6] if len(sys.argv) > 6 else None
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
# The WordNet links (machine-made: how, and how sure), not English Wiktionary's own senses ("word: gloss") or Wikidata's
for h, *b in lines(WB):
    try:
        d = json.loads('\t'.join(b))
    except ValueError:
        continue
    for s, pos, conf, how in d.get('wn', []):
        if pos != 'Wikidata' and not KH.search(s):
            out.append((h, tag(f'WordNet link ({how}, {conf})') + f'<p-n>{pos}</p-n> ' + s))

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('#desc\tKhmer words with an open English definition, all together: English Wiktionary (CC BY-SA, from '
            'kaikki.org), its translation tables, Wikidata (CC0) and the workbench\'s WordNet links (Open English '
            'WordNet, CC BY 4.0; machine-made)\n')
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
