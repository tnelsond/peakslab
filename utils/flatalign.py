#!/usr/bin/env python3
"""km-align without senses: each English word with every Khmer word or phrase that corresponds to it, commonest
first (by how often they were aligned; those people give but the aligner never paired after them), and the Greek
and Hebrew words the Bible translates by it (the BSB's Strong's numbers: those a tenth of its uses at least). And
the reverse, for km-english: each Khmer word with every English word it's in the list of, commonest first.

In: the sense-divided km-align (an English word's senses, <ol><li>gloss @km @km example</li>...</ol>, or one
list), kmen2's pairs.json (pair counts), the sense hub's ewords.json (an English word's verses and their Strong's)
and km-strongs (a Strong's number's Greek or Hebrew word, as <p-n>word <i>translit</i> gloss</p-n>).
Usage: flatalign.py <km-align senses.tsv> <pairs.json> <ewords.json> <km-strongs.tsv> <out km-align.tsv>
       <out Khmer-English.tsv>"""
import html, json, re, sys
from collections import Counter, defaultdict

ALIGN, PAIRS, EWORDS, STRONGS, OUT, REV = sys.argv[1:7]
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()

head, rows = [], []
for l in open(ALIGN, encoding='utf-8'):
    if l.startswith('#'):
        head.append(l.rstrip('\n'))
    elif '\t' in l:
        e, body = l.rstrip('\n').split('\t', 1)
        body = re.sub(r'<p-x>.*?</p-x>', '', body)  # (the examples)
        words = list(dict.fromkeys(w.strip() for w in re.findall(r'@([^\t<]+)', body)))
        note = re.match(r'(<p-n>\([^<]*\)</p-n>)\t', body)  # ((Archaic), a corpus's name)
        rows.append((e, note[1] if note else '', words))

cnt = Counter()
pj = json.load(open(PAIRS))
for r in pj['pairs']:
    cnt[norm(r[0]), r[1].lower()] += r[2]
tot = Counter()  # (a Khmer word's alignments)
for k, n in pj['Lk'].items():
    tot[norm(k)] += n
del pj

gloss = {}
for l in open(STRONGS, encoding='utf-8'):
    m = re.match(r'([GH]\d+[a-z]?)\t<p-n>(.*?)</p-n>', l)
    if m:
        gloss[m[1]] = m[2].split('</i>')[0] + '</i>' if '</i>' in m[2] else m[2]  # (the word, not the BSB's phrase)
st = defaultdict(Counter)
for w, ss in json.load(open(EWORDS)).items():
    for s in ss:
        for _, n in s['occ']:
            st[w.lower()][n] += 1

def strongs(e):
    c = st.get(e.lower())
    if not c:
        return ''
    t = sum(c.values())
    xs = [(n, x) for n, x in c.most_common(5) if x >= .1 * t and n in gloss]
    return ('<p-n>Bible: Greek and Hebrew:</p-n> <ul>' + ''.join(
        f'<li>{gloss[n]} <p-a>{n}</p-a> {round(100 * x / t)}%</li>' for n, x in xs) + '</ul>') if xs else ''

rev = defaultdict(dict)
ns = 0
with open(OUT, 'w', encoding='utf-8') as o:
    for h in head:
        if h.startswith('#desc\t'):
            h = ('#desc\tKhmer words by English word: every Khmer word or phrase that corresponds to it, commonest first, '
                 'and the Greek and Hebrew words the Bible translates by it (Strong’s numbers: STEPBible’s tagging of the '
                 'BSB, CC BY 4.0). ' + h[6:].split(': an English word’s commonest Khmer', 1)[0].split(
                     'Khmer words by English word, ', 1)[-1].replace('machine-made', 'Machine-made', 1)
                 + '. People’s translations too: English Wiktionary’s translation tables, the English glosses of '
                 'Wiktionary’s Khmer entries (via Kaikki) and the SBBIC English–Khmer dictionary’s (GPL 2); a '
                 'machine-aligned Khmer word only where one of these gives it, a Khmer dictionary has it (Headley’s and '
                 'Chuon Nath’s, only to check by), or a good share of the sentences do. With another language’s on, a '
                 'dictionary between them. (Archaic): English only the KJV and ASV have; a corpus’s name after a word only '
                 'it has. Unchecked: verify before relying on it.')
        o.write(h + '\n')
    for e, note, words in rows:
        ws = sorted(words, key=lambda k: -cnt[norm(k), e.lower()])  # (stable: people's order for the unpaired)
        s = strongs(e)
        ns += bool(s)
        o.write('\t'.join([e] + ([note] if note else []) + [f'@{k}' for k in ws] + ([s] if s else [])) + '\n')
        for i, k in enumerate(ws):
            c = cnt[norm(k), e.lower()]
            if c == 0 or c >= .01 * tot[norm(k)]:  # (people's, or a share of its alignments: not ចិត្ត's mid-april)
                rev[norm(k)].setdefault(e, (c, -i))
spell = {}
for _, _, words in rows:
    for k in words:
        spell.setdefault(norm(k), k)
with open(REV, 'w', encoding='utf-8') as o:
    for k in sorted(rev):
        es = sorted(rev[k], key=lambda e: (-rev[k][e][0], -rev[k][e][1]))
        o.write(spell[k] + '\t' + '\t'.join('@' + e for e in es) + '\n')
print(len(rows), 'English words,', ns, 'with Strong\'s;', len(rev), 'Khmer words', file=sys.stderr)
