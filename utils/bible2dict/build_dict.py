#!/usr/bin/env python3
"""Score aligned pairs and write one PeakSlab dictionary: Khmer headwords, each
with its English glosses as second index words ("@love\t; @charity\t"), so an
English word finds its Khmer ones and glosses English text with them too.

A gloss is a Khmer word's commonest English, or an English word's commonest
Khmer (either way round). A word in only one of the Bibles (Khmer or English),
or English only in the KJV and ASV (archaic: "thee", "begat"), has the Bible's
name after it.

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


def esc(s):
    return html.escape(s, quote=False)


import glob, os
# spaCy sometimes invents lemmas ("taxes" -> "taxis"); if a lemma never occurs as a real word
# in the English Bibles, show the most common surface form instead. A name (mostly tagged one)
# is capitalized: God, Lord (LORD too), Israel; "i" is I, "o" O.
surf, lem2surf, propn, usual, caps = set(), defaultdict(Counter), defaultdict(Counter), defaultdict(Counter), defaultdict(Counter)
in_en, in_km = defaultdict(set), defaultdict(set)  # word -> the Bibles that have it
for p in glob.glob(f'{W}/eng_*.json'):
    bible = os.path.basename(p)[4:-5]
    for toks in json.load(open(p)).values():
        for t in toks:
            l, pos, s = t.split('|', 2)
            surf.add(s.lower())
            lem2surf[l][s.lower()] += 1
            propn[s.lower()][pos == 'PROPN'] += 1
            usual[l][pos] += 1
            caps[l][s[:1].isupper()] += 1  # (by the word as written: "lovest" a name only sometimes)
            in_en[l].add(bible)
for p in glob.glob(f'{W}/khm_*.json'):
    bible = os.path.basename(p)[4:-5]
    for toks in json.load(open(p)).values():
        for t in toks:
            in_km[t].add(bible)


def fix(e):
    out = []
    for w in e.split(' '):
        if w.lower() not in surf and lem2surf.get(w):
            w = lem2surf[w].most_common(1)[0][0]
        c = propn.get(w.lower())
        if w in ('i', 'o') or (c and c[True] >= c[False]):
            w = w[:1].upper() + w[1:]
        out.append(w)
    return ' '.join(out)


# EN_WORDS (a word list: Open English WordNet's headwords): English only its lowercase words,
# not names nearly always (tagged one 90% of the time, or capitalized 85%: Skype, Android, China;
# "university" 69%, apple 84%, a word starting a sentence 10-20%), or
# grammar words (spaCy's English stop words: of, your); so no brand or program names, "wanna",
# "Hd", "ve" or "files" (and all lowercase). Without it (the Bibles), names too: Abraham
EN_WORDS = os.environ.get('EN_WORDS')
if EN_WORDS:
    lower = {l.split('\t', 1)[0].strip() for l in open(EN_WORDS, encoding='utf-8') if l[:1].islower()}
    from spacy.lang.en.stop_words import STOP_WORDS
    def english(e):
        for w in e.split(' '):
            c, u = usual.get(w, Counter()), caps.get(w, Counter())
            if not (w in STOP_WORDS or (w in lower and c['PROPN'] < 0.9 * sum(c.values()) and u[True] < 0.85 * sum(u.values()))):
                return False
        return True
    fix = lambda e: ' '.join('I' if w == 'i' else w for w in e.split(' '))
else:
    english = lambda e: True

merged = defaultdict(lambda: [0, Counter(), set(), set(), set()])
for k, e, c, posc, ex, vs, es in d['pairs']:
    if not re.search(r'[^\W\d_]', k) or len(set(re.split('[_ ]', e))) < len(re.split('[_ ]', e)) or re.search(r"[^A-Za-z' _-]|^-|-$", e) or not english(e.replace('_', ' ')):  # (no "4?tons", "-water": English is letters)
        continue
    if ZW in k and (len(vs) < 2 or c < 10):  # a name's pieces: in two Bibles at least
        continue
    m = merged[(k.replace(ZW, ''), fix(e))]
    m[0] += c
    m[1].update(posc)
    # the Bibles that have the words: a word's own, a name's (several pieces) where it was aligned
    m[2].update(in_km[k] if ZW not in k and k in in_km else vs)
    for l in [e]:
        m[3].update(in_en[l] if ' ' not in l and l in in_en else es)
Lk2, Le2 = Counter(), Counter()
for k, v in Lk.items():
    Lk2[k.replace(ZW, '')] += v
for e, v in Le.items():
    Le2[fix(e)] += v
Lk, Le = Lk2, Le2

# A number gloss only for a number word: a classifier (នាក់, "three hundred men") isn't
# "hundred", nor "thousand" នាក់. A pair is a number's if most of it is aligned with English numbers;
# a Khmer word is a number word if its commonest English is one (ពាន់: thousand; នាក់: man)
is_num = lambda posc: sum(v for t, v in posc.items() if 'NUM' in t.split('+')) * 2 > sum(posc.values())
top_k = {}
for (k, e), (c, posc, kb, eb, _) in merged.items():
    if c > top_k.get(k, (0, None))[0]:
        top_k[k] = (c, is_num(posc))
num_k = {k: 1 if n else 0 for k, (_, n) in top_k.items()}
by_k, by_e = defaultdict(list), defaultdict(list)
for (k, e), (c, posc, kb, eb, _) in merged.items():
    if is_num(posc) and num_k[k] <= 0:
        continue
    row = dict(k=k, e=e, c=c, pf=c / Lk[k], pb=c / Le[e], top=label(posc)[0], kb=kb, eb=eb)
    by_k[k].append(row)
    by_e[e].append(row)


def pick(rows, p_main, p_other, n):
    out = []
    for r in sorted(rows, key=lambda r: -r['c']):
        pm, po = r[p_main], r[p_other]
        need = 0.25 if r['top'] in FUNC else 0.07
        if pm < need or (po < 0.01 and pm < 0.3) or r['c'] < 5:
            continue
        out.append(r)
        if len(out) == n:
            break
    return out


# Each headword's glosses, both ways: a Khmer word's commonest English (and the English words
# it's the commonest Khmer for), an English word's commonest Khmer (and the Khmer words it's
# the commonest English for): many Khmer words for an English one, for its gloss
def both(groups, others, main, other, totals, n, key):
    out = defaultdict(list)
    for h, rows in groups.items():
        if totals[h] >= 8:
            out[h] += pick(rows, main, other, n)
    for h, rows in others.items():
        for r in pick(rows, other, main, 3):
            if r not in out[r[key]] and totals[r[key]] >= 8:
                out[r[key]].append(r)
    return out


# A source's share of its side (its lines): one with most of it (the ChiTonga Bible beside nine
# stories) isn't named after a word only it has, as nearly every word is
share = {}
for side in ('khm', 'eng'):
    n = {os.path.basename(p)[4:-5]: len(json.load(open(p))) for p in glob.glob(f'{W}/{side}_*.json')}
    share.update({b: c / sum(n.values()) for b, c in n.items()})


def which(bibles, english):
    """The Bibles to name after a word: its only one (not most of the corpus), or (English) only the KJV and ASV"""
    if (len(bibles) == 1 and share.get(next(iter(bibles)), 0) < 0.6) or (english and bibles and bibles <= ARCHAIC):
        return f'({", ".join(sorted(b.upper() for b in bibles))})'
    return ''


# Grammar words: Khmer ones mostly aligned with English function words (ជា, បាន, នៃ), English
# ones mostly function words; a gloss that's an earlier one of its entry and one of these
# (water: ទឹក, not ទឹកជា "water is"; intend, not "intend to") is left off
func_w = defaultdict(Counter)
for rows in by_k.values():
    for r in rows:
        func_w[r['k']][r['top'] in FUNC] += r['c']
        func_w[r['e']][r['top'] in FUNC] += r['c']
FUNCW = {w for w, c in func_w.items() if c[True] > c[False]}


def more(g, kept, sep):
    """g is a gloss already kept with a grammar word before or after it"""
    for k in kept:
        for rest in (g[len(k):], g[:-len(k)]) if len(g) > len(k) else ():
            if (g.startswith(k) if rest == g[len(k):] else g.endswith(k)) and rest.strip(sep) in FUNCW:
                return True
    return False


def entries(glosses, head, gloss, hb, gb, totals):
    """head<tab>(its Bible) @gloss<tab>(its Bibles)<tab>@gloss<tab>... (the app shows them "a; b (KJV); c")"""
    lines = []
    for h, rows in glosses.items():
        if not rows:
            continue
        # its commonest 8, those only one Bible (or only the KJV and ASV) has last
        sep = ' ' if gloss == 'e' else ''
        kept = []
        for r in sorted(rows, key=lambda r: -r['c']):
            if not more(r[gloss], [x[gloss] for x in kept], sep):
                kept.append(r)
        rows = sorted(kept[:8], key=lambda r: bool(which(r[gb], gb == 'eb')))
        own = which(set().union(*(r[hb] for r in rows)), hb == 'eb')
        gl = ''.join(f'@{esc(r[gloss].replace("_", " "))}\t' + (which(r[gb], gb == 'eb') + '\t' if which(r[gb], gb == 'eb') else '') for r in rows)
        lines.append((bool(own), -totals[h], f'{esc(h.replace("_", " "))}\t{own + " " if own else ""}{gl}'))
    return [l for *_, l in sorted(lines)]  # (those only one Bible has last)


km_glosses = both(by_k, by_e, 'pf', 'pb', Lk, 6, 'k')
en_glosses = both(by_e, by_k, 'pb', 'pf', Le, 8, 'e')
lines = entries(km_glosses, 'k', 'e', 'kb', 'eb', Lk) + entries(en_glosses, 'e', 'k', 'eb', 'kb', Le)

kms = sorted(os.path.basename(p)[4:-5].upper() for p in glob.glob(f'{W}/khm_*.json'))
ens = sorted(os.path.basename(p)[4:-5].upper() for p in glob.glob(f'{W}/eng_*.json'))
DESC = (f'Khmer–English Bible glosses, machine-made by word-aligning {len(kms)} Khmer Bibles ({", ".join(kms)}) '
        f'and {len(ens)} English ones ({", ".join(ens)}) with eflomal: a Khmer word\'s English glosses and an English '
        'word\'s Khmer ones, commonest first. A word only one Bible has, or (English) only the KJV and '
        'ASV, has its name after it. Unchecked: verify before relying on it.')
DESC = os.environ.get('DESC', DESC).replace('{n}', ', '.join(kms))  # (another corpus's; {n}: its parts)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(f'#desc\t{DESC}\n#priority\t{os.environ.get("PRIORITY", 1)}\n#lang\tbi\n')
    f.writelines(l + '\n' for l in lines)
print(sum(1 for r in km_glosses.values() if r), 'Khmer headwords,', sum(1 for r in en_glosses.values() if r), 'English headwords')
