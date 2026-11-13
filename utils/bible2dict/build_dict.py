#!/usr/bin/env python3
"""Score aligned pairs and write one PeakSlab dictionary: Khmer headwords, each
with its English glosses as second index words ("@love\t; @charity\t"), so an
English word finds its Khmer ones and glosses English text with them too.

A gloss is a Khmer word's commonest English, or an English word's commonest
Khmer (either way round). A word in only one of the sources (Khmer or English),
or English only in the KJV and ASV (archaic: "thee", "begat"), comes last; after
it (Archaic) for those, a corpus's name for one only it has (OPUS's SUBS), not a Bible's.

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


LATIN = re.compile('[A-Za-z]')


def esc(s):
    """(a phrase in a language without spaces, Lao's, written whole)"""
    return html.escape(s if LATIN.search(s) else s.replace(' ', ''), quote=False)


import glob, os
# a source is a Bible if its lines are verses ("gen 1.1"), not a corpus's ("subs 12")
VERSE = re.compile(r'^\w+ \d+\.\d+')
is_bible = {(side == 'eng', os.path.basename(p)[4:-5]): bool(VERSE.match(next(iter(json.load(open(p))), '')))
            for side in ('khm', 'eng') for p in glob.glob(f'{W}/{side}_*.json')}
bibles = {b for (english, b), v in is_bible.items() if english and v}
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
# (A word the Bibles have passes: Abraham. Without them, names are lowercase too)
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
    if not bibles:
        fix = lambda e: ' '.join('I' if w == 'i' else w for w in e.split(' '))
else:
    english = lambda e: True

merged = defaultdict(lambda: [0, Counter(), set(), set(), set()])
for k, e, c, posc, ex, vs, es in d['pairs']:
    if not re.search(r'[^\W\d_]', k) or len(set(re.split('[_ ]', e))) < len(re.split('[_ ]', e)) or re.search(r"[^A-Za-z' _\u0e81-\u0ecd\u0edc-\u0edf-]|^-|-$", e):  # (no "4?tons", "-water": English, or Lao, is letters)
        continue
    if not (bibles & set(es)) and not english(e.replace('_', ' ')):
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
    share.update({(side == 'eng', b): c / sum(n.values()) for b, c in n.items()})


def rare(bibles, english):
    """A word only one source has (not most of the corpus), or (English) only the KJV and ASV: last"""
    return (len(bibles) == 1 and share.get((english, next(iter(bibles))), 0) < 0.6) or bool(english and bibles and bibles <= ARCHAIC)


def which(bibles, english):
    """What to put after a rare word: (Archaic) for English only the KJV and ASV have, a
    corpus's name for one only it has (OPUS's SUBS); not a Bible's"""
    if english and bibles and bibles <= ARCHAIC:
        return '(Archaic)'
    names = sorted(b.upper() for b in bibles if not is_bible.get((english, b)))
    return f'({", ".join(names)})' if rare(bibles, english) and len(names) == len(bibles) else ''


# Grammar words: Khmer ones mostly aligned with English function words (ជា, បាន, នៃ), English
# ones mostly function words; a gloss that's an earlier one of its entry and one of these
# (water: ទឹក, not ទឹកជា "water is"; intend, not "intend to") is left off
func_w = defaultdict(Counter)
for rows in by_k.values():
    for r in rows:
        func_w[r['k']][r['top'] in FUNC] += r['c']
        func_w[r['e']][r['top'] in FUNC] += r['c']
FUNCW = {w for w, c in func_w.items() if c[True] > c[False]}


# Khmer words that make another word of the one after them (សេចក្តីស្រឡាញ់ love n., ធ្វើបាប to sin): not grammar words there
MAKERS = {'សេចក្តី', 'សេចក្ដី', 'ការ', 'ភាព', 'អំពើ', 'ធ្វើ', 'ប្រព្រឹត្ត', 'ចិត្ត'}


def more(g, kept, sep):
    """g is a gloss already kept with a grammar word before or after it"""
    for k in kept:
        if len(g) <= len(k):
            continue
        if g.startswith(k) and g[len(k):].strip(sep) in FUNCW:
            return True
        if g.endswith(k) and g[:-len(k)].strip(sep) in FUNCW and not (not sep and g[:-len(k)] in MAKERS):
            return True
    return False


def entries(glosses, head, gloss, hb, gb, totals):
    """head<tab>(its source) @gloss<tab>(its source)<tab>@gloss<tab>... (the app shows them "a; b (SUBS); c")"""
    lines = []
    for h, rows in glosses.items():
        if not rows:
            continue
        # its commonest 8, those only one source (or only the KJV and ASV) has last
        sep = ' ' if gloss == 'e' else ''
        kept = []
        for r in sorted(rows, key=lambda r: -r['c']):
            if not more(r[gloss], [x[gloss] for x in kept], sep):
                kept.append(r)
        rows = sorted(kept[:8], key=lambda r: rare(r[gb], gb == 'eb'))
        hs = set().union(*(r[hb] for r in rows))
        own, last = which(hs, hb == 'eb'), rare(hs, hb == 'eb')
        gl = ''.join(f'@{esc(r[gloss].replace("_", " "))}\t' + (which(r[gb], gb == 'eb') + '\t' if which(r[gb], gb == 'eb') else '') for r in rows)
        lines.append((last, -totals[h], f'{esc(h.replace("_", " "))}\t{own + " " if own else ""}{gl}'))
    return [l for *_, l in sorted(lines)]  # (those only one Bible has last)


km_glosses = both(by_k, by_e, 'pf', 'pb', Lk, 6, 'k')
en_glosses = both(by_e, by_k, 'pb', 'pf', Le, 8, 'e')
lines = entries(km_glosses, 'k', 'e', 'kb', 'eb', Lk) + entries(en_glosses, 'e', 'k', 'eb', 'kb', Le)


def aligned():
    """An entry an English word (the key every language's dictionary shares: with two on, a
    dictionary between them), its words in the language: those it's the commonest English
    for and its own commonest, commonest first (those only one source has last)"""
    words = defaultdict(dict)
    for gl in (en_glosses, km_glosses):
        for rows in gl.values():
            for r in rows:
                words[r['e']].setdefault(r['k'], r)
    out = []
    for e, rows in words.items():
        kept = []
        for r in sorted(rows.values(), key=lambda r: -r['c']):
            if not more(r['k'], [x['k'] for x in kept], ''):
                kept.append(r)
        rows = sorted(kept[:8], key=lambda r: rare(r['kb'], False))
        eb = set().union(*(r['eb'] for r in rows))
        note = lambda t: f'<p-n>{t}</p-n>\t' if t else ''  # (not the words: the app's other languages' rows leave it out)
        gl = ''.join(f'@{esc(r["k"].replace("_", " "))}\t' + note(which(r['kb'], False)) for r in rows)
        out.append((rare(eb, True), -Le[e], f'{esc(e.replace("_", " "))}\t{note(which(eb, True))}{gl}'))
    return [l for *_, l in sorted(out)]


# ALIGNED=<code> (lo): that instead, "#lang lo,aligned"
ALIGNED = os.environ.get('ALIGNED')
if ALIGNED:
    lines = aligned()

kms = sorted(os.path.basename(p)[4:-5].upper() for p in glob.glob(f'{W}/khm_*.json'))
ens = sorted(os.path.basename(p)[4:-5].upper() for p in glob.glob(f'{W}/eng_*.json'))
DESC = (f'Khmer–English Bible glosses, machine-made by word-aligning {len(kms)} Khmer Bibles ({", ".join(kms)}) '
        f'and {len(ens)} English ones ({", ".join(ens)}) with eflomal: a Khmer word\'s English glosses and an English '
        'word\'s Khmer ones, commonest first. A word only one Bible has, or (English) only the KJV and '
        'ASV, has its name after it. Unchecked: verify before relying on it.')
DESC = os.environ.get('DESC', DESC).replace('{n}', ', '.join(kms))  # (another corpus's; {n}: its parts)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(f'#desc\t{DESC}\n#priority\t{os.environ.get("PRIORITY", 1)}\n#lang\t{ALIGNED + ",aligned" if ALIGNED else "bi"}\n')
    f.writelines(l + '\n' for l in lines)
print(sum(1 for r in km_glosses.values() if r), 'Khmer headwords,', sum(1 for r in en_glosses.values() if r), 'English headwords')
