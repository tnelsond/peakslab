#!/usr/bin/env python3
"""km-align without senses: each English word with every Khmer word or phrase that corresponds to it, commonest
first (by how often they were aligned; those people give but the aligner never paired after them), and the Greek
and Hebrew words the Bible translates by it (the BSB's Strong's numbers: those a tenth of its uses at least). And
the reverse, for km-english: each Khmer word with every English word it's in the list of, commonest first.

In: the sense-divided km-align (an English word's senses, <ol><li>gloss @km @km example</li>...</ol>, or one
list), kmen2's pairs.json (pair counts), the sense hub's ewords.json (an English word's verses and their Strong's)
and km-strongs (a Strong's number's Greek or Hebrew word, as <p-n>word <i>translit</i> gloss</p-n>).
A Khmer word of the Khmer Muslim Bible's (khmus) that none of the other Khmer Bibles has goes last, "(muslim word)"
after it (អុលឡោះ); a Khmer entry's too.
Usage: flatalign.py <km-align senses.tsv> <pairs.json> <ewords.json> <km-strongs.tsv> <out km-align.tsv>
       <out Khmer-English.tsv> <kmen2 dir (its khm_<Bible>.json)>"""
import html, json, re, sys
from collections import Counter, defaultdict

ALIGN, PAIRS, EWORDS, STRONGS, OUT, REV, KMEN = sys.argv[1:8]
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()
MUSNOTE = '<p-n>(muslim word)</p-n>'
mus, others = set(), set()
for b in ('khmus', 'gkb', 'kcb', 'khov', 'khov2016', 'khsv', 'ulb'):
    words = {norm(t) for toks in json.load(open(f'{KMEN}/khm_{b}.json')).values() for t in toks}
    (mus if b == 'khmus' else others).update(words)
MUS = mus - others
muslim = lambda k: norm(k) in MUS

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
byen = defaultdict(list)
mpair = defaultdict(Counter)  # (the Muslim Bible's own words, which only it has, so not in the list: អុលឡោះ god)
for r in pj['pairs']:
    cnt[norm(r[0]), r[1].lower()] += r[2]
    if r[2] >= 3:
        byen[r[1].lower()].append(norm(r[0]))
    if r[5] == ['khmus'] and norm(r[0]) in MUS:
        mpair[r[1].lower()][r[0]] += r[2]
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

def slip(k, e):
    """a piece or a phrase of a word that goes with e more: ណាព of ណាពី, អុលឡោះហើយ of អុលឡោះ"""
    k, c = norm(k), cnt[norm(k), e.lower()]
    return any(x != k and (x.startswith(k) or k.startswith(x)) and cnt[x, e.lower()] > c for x in byen[e.lower()])

def strongs(e):
    c = st.get(e.lower())
    if not c:
        return ''
    t = sum(c.values())
    xs = [(n, x) for n, x in c.most_common(5) if x >= .1 * t and n in gloss]
    return ('<p-n>Bible: Greek and Hebrew:</p-n> <ul>' + ''.join(
        f'<li>{gloss[n]} <p-a>{n}</p-a> {round(100 * x / t)}%</li>' for n, x in xs) + '</ul>') if xs else ''

rev = defaultdict(dict)
ns = nm = 0
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
                 'it has; (muslim word): a Khmer word only the Khmer Muslim Bible has of the Khmer Bibles, last. '
                 'Unchecked: verify before relying on it.')
        o.write(h + '\n')
    for e, note, words in rows:
        ws = sorted(words, key=lambda k: -cnt[norm(k), e.lower()])  # (stable: people's order for the unpaired)
        ws += [k for k, c in mpair[e.lower()].most_common()  # (its word: a share of its alignments, អុលឡោះ's god)
               if c >= 3 and c >= .25 * tot[norm(k)] and norm(k) not in map(norm, ws) and not slip(k, e)]
        ws = [k for k in ws if not muslim(k)] + [k for k in ws if muslim(k)]  # (the Muslim Bible's own words last)
        nm += sum(map(muslim, ws))
        s = strongs(e)
        ns += bool(s)
        cells = [x for k in ws for x in ([f'@{k}', MUSNOTE] if muslim(k) else [f'@{k}'])]
        o.write('\t'.join([e] + ([note] if note else []) + cells + ([s] if s else [])) + '\n')
        for i, k in enumerate(ws):
            c = cnt[norm(k), e.lower()]
            if c == 0 or c >= .01 * tot[norm(k)]:  # (people's, or a share of its alignments: not ចិត្ត's mid-april)
                rev[norm(k)].setdefault(e, (c, -i))
spell = {}
for _, _, words in rows:
    for k in words:
        spell.setdefault(norm(k), k)
for ks in mpair.values():
    for k in ks:
        spell.setdefault(norm(k), k)
with open(REV, 'w', encoding='utf-8') as o:
    for k in sorted(rev):
        es = sorted(rev[k], key=lambda e: (-rev[k][e][0], -rev[k][e][1]))
        o.write(spell[k] + '\t' + (MUSNOTE + '\t' if muslim(k) else '') + '\t'.join('@' + e for e in es) + '\n')
print(len(rows), 'English words,', ns, 'with Strong\'s,', nm, 'muslim words in them;', len(rev), 'Khmer words', file=sys.stderr)
