#!/usr/bin/env python3
"""Score aligned pairs and write one PeakSlab dictionary: Khmer headwords with
their English glosses, English headwords with their Khmer ones.

A word in only one of the Bibles (Khmer or English), or English only in the
KJV and ASV (archaic: "thee", "begat"), has the Bible's name after it.

Usage: build_dict.py WORK_DIR OUT.tsv
"""
import sys, json, re, html
from collections import defaultdict, Counter

W, OUT = sys.argv[1:3]
d = json.load(open(f'{W}/pairs.json'))
Lk, Le = d['Lk'], d['Le']

POS = {'NOUN': 'n.', 'VERB': 'v.', 'ADJ': 'adj.', 'ADV': 'adv.', 'PROPN': 'name', 'ADP': 'prep.',
       'PRON': 'pron.', 'CCONJ': 'conj.', 'SCONJ': 'conj.', 'INTJ': 'interj.', 'PART': 'part.',
       'AUX': 'aux.', 'NUM': 'num.'}
FUNC = {'ADP', 'PRON', 'CCONJ', 'SCONJ', 'AUX', 'PART'}
ZW = '\u200b'
KH_CHAR = re.compile(r'[ក-៿]')

ARCHAIC = {'kjv', 'asv'}  # an English word only these have: old


def code(key):
    """"1sa 17.1" -> "1Sa 17.1", the form a verse link takes"""
    b, rest = key.split(' ', 1)
    return (b[:2].upper() + b[2:] if b[0].isdigit() else b.capitalize()) + ' ' + rest


def label(posc):
    p = Counter()
    for k, v in posc.items():
        tags = k.split('+')
        p[tags[-1] if len(tags) == 1 else ('phr' if tags[-1] != 'PROPN' else 'PROPN')] += v
    top = p.most_common(1)[0][0]
    return top, ('phr.' if top == 'phr' else POS.get(top, ''))


def refs(keys, n=2):
    return ', '.join(f'<p-a>{code(k)}</p-a>' for k in keys[:n])


def esc(s):
    return html.escape(s, quote=False)


# spaCy sometimes invents lemmas ("taxes" -> "taxis"); if a lemma never occurs as a real word
# in the English Bibles, show the most common surface form instead.
import glob, os
surf, lem2surf = set(), defaultdict(Counter)
in_en, in_km = defaultdict(set), defaultdict(set)  # word -> the Bibles that have it
for p in glob.glob(f'{W}/eng_*.json'):
    bible = os.path.basename(p)[4:-5]
    for toks in json.load(open(p)).values():
        for t in toks:
            l, _, s = t.split('|', 2)
            surf.add(s.lower())
            lem2surf[l][s.lower()] += 1
            in_en[l].add(bible)
for p in glob.glob(f'{W}/khm_*.json'):
    bible = os.path.basename(p)[4:-5]
    for toks in json.load(open(p)).values():
        for t in toks:
            in_km[t].add(bible)


def fix(e):
    out = []
    for w in e.split(' '):
        if w == 'i':
            w = 'I'
        elif w.lower() not in surf and lem2surf.get(w):
            w = lem2surf[w].most_common(1)[0][0]
        out.append(w)
    return ' '.join(out)


merged = defaultdict(lambda: [0, Counter(), [], set(), set(), set()])
for k, e, c, posc, ex, vs, es in d['pairs']:
    m = merged[(k, fix(e))]
    m[0] += c
    m[1].update(posc)
    m[2] += [x for x in ex if x not in m[2]]
    m[3].update(vs)
    m[4].update(es)
    m[5].add(e)
Le2 = Counter()
for e, v in Le.items():
    Le2[fix(e)] += v
Le = Le2

by_k, by_e = defaultdict(list), defaultdict(list)
# Khmer words that mostly translate English function words (and honorifics): a multi-word
# Khmer "phrase" that starts or ends with one is usually a fragment, not a dictionary entry.
dom = defaultdict(Counter)
for (k, e), (c, posc, ex, vs, es, lemmas) in merged.items():
    if ZW not in k:
        dom[k][label(posc)[0]] += c
FUNCK = {k for k, p in dom.items() if p.most_common(1)[0][0] in FUNC} | {'លោក', 'នាង', 'ឲ្យ', 'អោយ'}


def bad_phrase(k, c, vs):
    t = k.split(ZW)
    if len(t) == 1:
        return False
    return t[0] in FUNCK or t[-1] in FUNCK or len(vs) < 2 or c < 10


# A phrase like មនុស្ស+លោក and the single word មនុស្សលោក are the same headword once joined.
final = defaultdict(lambda: [0, Counter(), [], set(), set()])
for (k, e), (c, posc, ex, vs, es, lemmas) in merged.items():
    if not KH_CHAR.search(k) or bad_phrase(k, c, vs):
        continue
    m = final[(k.replace(ZW, ''), e)]
    m[0] += c
    m[1].update(posc)
    m[2] += [x for x in ex if x not in m[2]]
    # the Bibles that have the words: a word's own, a phrase's (several words) where it was aligned
    m[3].update(in_km[k] if ZW not in k and k in in_km else vs)
    for l in lemmas:
        m[4].update(in_en[l] if ' ' not in l and l in in_en else es)
Lk2 = Counter()
for k, v in Lk.items():
    Lk2[k.replace(ZW, '')] += v
Lk = Lk2

for (k, e), (c, posc, ex, kb, eb) in final.items():
    top, lab = label(posc)
    pf, pb = c / Lk[k], c / Le[e]
    row = dict(k=k, e=e, c=c, pf=pf, pb=pb, top=top, lab=lab, ex=ex, kb=kb, eb=eb)
    by_k[k].append(row)
    by_e[e].append(row)


def pick(rows, p_main, p_other, total):
    rows = sorted(rows, key=lambda r: -r['c'])
    out = []
    for r in rows:
        pm, po = r[p_main], r[p_other]
        need = 0.25 if r['top'] in FUNC else 0.07
        if pm < need or (po < 0.01 and pm < 0.3):
            continue
        if r['c'] < 5:
            continue
        out.append(r)
        if len(out) == 6:
            break
    return out


def which(bibles, english):
    """The Bibles to name after a word: its only one, or (English) only the KJV and ASV"""
    if len(bibles) == 1 or (english and bibles and bibles <= ARCHAIC):
        return f' <p-n>{", ".join(sorted(b.upper() for b in bibles))}</p-n>'
    return ''


def entries(groups, gloss_key, p_main, p_other, totals, minfreq):
    """Each headword's line: its glosses, each with its part of speech, how often, two verses"""
    head_en = gloss_key == 'k'
    lines = []
    for h, rows in groups.items():
        if totals.get(h, 0) < minfreq:
            continue
        sel = pick(rows, p_main, p_other, totals[h])
        if not sel:
            continue
        items = []
        for r in sel:
            g = r[gloss_key]
            gl = esc(g.replace('_', ' '))
            gl = f'<p-l><p-a>{gl}</p-a></p-l>' if gloss_key == 'k' else f'<p-a>{gl}</p-a>'
            gl += which(r['kb'] if gloss_key == 'k' else r['eb'], gloss_key == 'e')
            lab = f'<p-n>({r["lab"]})</p-n> ' if r['lab'] else ''
            items.append(f'<li>{lab}{gl} <p-n>{round(100 * r[p_main])}% · {refs(r["ex"])}</p-n></li>')
        own = which(set().union(*(r['eb' if head_en else 'kb'] for r in rows)), head_en).strip()
        hw = h.replace('_', ' ')
        lines.append((-totals[h], f'{esc(hw)}\t{own}<ul>{"".join(items)}</ul>'))
    return [l for _, l in sorted(lines)]


kms = sorted(os.path.basename(p)[4:-5].upper() for p in glob.glob(f'{W}/khm_*.json'))
ens = sorted(os.path.basename(p)[4:-5].upper() for p in glob.glob(f'{W}/eng_*.json'))
DESC = (f'Khmer–English Bible glosses, machine-made by word-aligning {len(kms)} Khmer Bibles ({", ".join(kms)}) '
        f'and {len(ens)} English ones ({", ".join(ens)}) with eflomal: a Khmer word\'s English glosses, an English '
        'word\'s Khmer ones. Percent = how often the word was aligned to that gloss. A word only one Bible has, or '
        '(English) only the KJV and ASV, has its name after it. Unchecked: verify before relying on it.')
km_lines = entries(by_k, 'e', 'pf', 'pb', Lk, 8)
en_lines = entries(by_e, 'k', 'pb', 'pf', Le, 8)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(f'#desc\t{DESC}\n#priority\t5\n#lang\tbi\n')
    f.writelines(l + '\n' for l in km_lines + en_lines)
print(len(km_lines), 'Khmer headwords;', len(en_lines), 'English headwords')
