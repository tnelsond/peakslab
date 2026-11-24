#!/usr/bin/env python3
"""km-english: every Khmer word the open sources have, with all they say of it in one
entry (its English words index words: searching English finds the Khmer too):

  - its English words, all that correspond to it, commonest first (km-align's, turned round
    by utils/flatalign.py: Bibles, OPUS, NLLB word-aligned, and people's translations)
  - English Wiktionary's entry for it (km-kaikki's, in km-synsets; CC BY-SA)
  - the English senses Wiktionary's translation tables give it (wiktionary/km-senses)
  - Wikidata's items it's the label of (km-wikidata, CC0)
  - the Greek and Hebrew words the Khmer Bibles translate by it (km-strongs: Strong's numbers)

  - for a word the Khmer dictionaries have (Chuon Nath's 2022 and 1967 editions, Headley's,
    Wiktionary's: its headword lists), not in that list: the English it was aligned with most
    (a fifth of its alignments at least; km-align leaves out grammar words and names)

Usage: kmenglish.py <Khmer-English.tsv (flatalign.py's)> <dict_src> <out.tsv> [pairs.json]
"""
import html, re, sys
from collections import defaultdict

SENSES, SRC, OUT = sys.argv[1:4]
PAIRS = sys.argv[4] if len(sys.argv) > 4 else None
K = f'{SRC}/khmer'
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()


def rows(path):
    for l in open(path, encoding='utf-8'):
        if not l.startswith('#') and '\t' in l:
            h, _, body = l.rstrip('\n').partition('\t')
            yield h, body


parts = defaultdict(dict)   # Khmer -> source -> its html
spell = {}                  # (its spelling: the first source's)
def add(k, src, body):
    n = norm(k)
    if not n or not re.search('[ក-ឳ]', n):
        return
    spell.setdefault(n, k.replace('​', '').strip())
    parts[n][src] = body


for k, b in rows(SENSES):
    add(k, 'senses', b)
for k, b in rows(f'{K}/thesaurus/km-synsets.tsv'):  # (km-kaikki's entries, there before the senses)
    b = re.sub(r'\t?<p-k>.*?</p-k>', '', b).strip('\t')
    if b:
        add(k, 'kaikki', b)

# A dictionary word's aligned English, when it has no senses
if PAIRS:
    import json
    from collections import Counter
    heads = set()
    for f in ('dict/km-nath2022', 'dict/km-h97', 'dict/km-nath1967', 'dict/km-wiktionary', 'thesaurus/km-synsets'):
        heads |= {norm(k) for k, _ in rows(f'{K}/{f}.tsv')}
    al = defaultdict(Counter)
    for r in json.load(open(PAIRS))['pairs']:
        al[norm(r[0])][r[1]] += r[2]
    for n, c in al.items():
        if n in heads and 'senses' not in parts.get(n, {}):  # ("senses": the list)
            t = sum(c.values())
            es = [e for e, x in c.most_common(4) if x >= .2 * t and x >= 5]
            if es:
                add(n, 'aligned', '\t'.join('@' + html.escape(e, quote=False) for e in es))

# Wiktionary's translation tables: "god (deity)"'s Khmer -> god (deity)
tr = defaultdict(list)
for key, b in rows(f'{K}/wiktionary/km-senses.tsv'):
    m = re.match(r'(.*?) \((.*)\)$', html.unescape(key))
    w, g = (m[1], m[2]) if m else (html.unescape(key), '')
    for k in re.findall(r'@([^\t<]+)', b):
        tr[norm(k)].append((w, g))
for n, ws in tr.items():
    add(n, 'trans', '<ul>' + ''.join(f'<li>@{html.escape(w, quote=False)}' + (f' <p-n>{html.escape(g, quote=False)}</p-n>' if g else '') + '</li>' for w, g in ws[:12]) + '</ul>')

for k, b in rows(f'{K}/dict/km-wikidata.tsv'):  # (an item a line)
    items = re.findall(r'(@[^\t]+)(?:\t(<p-n>.*?</p-n>))?(?=\t@|$)', b)
    add(k, 'wikidata', '<ul>' + ''.join(f'<li>{e}' + (f' {d}' if d else '') + '</li>' for e, d in items) + '</ul>' if len(items) > 1 else b)

# Strong's: a Khmer word's Greek and Hebrew (the ones it's a tenth of the translations of, at least)
st = defaultdict(list)
for key, b in rows(f'{K}/bible/dict/km-strongs.tsv'):
    g = re.match(r'<p-n>(.*?)</p-n>', b)
    if not g:
        continue
    for k, pct in re.findall(r'@([^\t<]+)\t<p-n>(\d+)%', b):
        if int(pct) >= 10:
            st[norm(k)].append((int(pct), key, g[1]))
for n, xs in st.items():
    xs.sort(reverse=True)
    add(n, 'strongs', '<ul>' + ''.join(f'<li>{g} <p-a>{key}</p-a> {p}%</li>' for p, key, g in xs[:4]) + '</ul>')

LABEL = {'senses': None, 'aligned': 'aligned', 'kaikki': 'Wiktionary', 'trans': 'Wiktionary: translates',
         'wikidata': 'Wikidata', 'strongs': 'Bible: Greek and Hebrew'}
with open(OUT, 'w', encoding='utf-8') as o:
    o.write('#desc\tKhmer–English, as complete as open sources make it: every Khmer word they give English for, with all they say of it. '
            'Its English words, all that correspond to it, commonest first: machine-made (Bibles, OPUS and NLLB '
            'word-aligned with eflomal), with people’s translations (Wiktionary’s, SBBIC’s); (muslim word): a word only '
            'the Khmer Muslim Bible has of the Khmer Bibles; '
            '<a href="https://en.wiktionary.org/">English Wiktionary</a>’s entry and translation tables '
            '(via <a href="https://kaikki.org/">Kaikki</a>); <a href="https://www.wikidata.org/">Wikidata</a> (CC0); the Greek '
            'and Hebrew words the Khmer Bibles translate by it (STEPBible’s tagged texts, CC BY 4.0); '
            'its parts under their sources’ licences: <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> (Wiktionary’s), '
            'CC0 (Wikidata’s). Machine-made parts unchecked: verify before relying on them.\n')
    o.write('#priority\t2\n#lang\tkm,en\n')
    for n in sorted(parts):
        p = parts[n]
        cells = []
        for src in ('senses', 'aligned', 'kaikki', 'trans', 'wikidata', 'strongs'):
            if src in p:
                lab = LABEL[src]
                cells.append((f'<p-n>{lab}:</p-n> ' if lab else '') + p[src])
        o.write(spell[n] + '\t' + '\t'.join(cells) + '\n')
cnt = defaultdict(int)
for p in parts.values():
    for s in p:
        cnt[s] += 1
print(OUT, len(parts), 'Khmer words', dict(cnt), file=sys.stderr)
