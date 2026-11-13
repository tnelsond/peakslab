#!/usr/bin/env python3
"""A language's Strong's dictionary from its Bibles' own tags (<p-w s=H430>God</p-w>:
Door43's, from their translators' alignment; the BSB's, the KJV's): each Strong's
number (G26: the key every language's shares, so with two on, a dictionary between
them; "#lang hi,aligned"), its Greek or Hebrew word, the words the Bibles translate
it by, how often, and verses. The same as strongs.py's, without aligning anything.

Usage: taggedstrongs.py CODE LANGUAGE OUT.tsv grc-tagnt.tsv hbo-tahot.tsv LEXICON.tsv... -- BIBLE.tsv...
  e.g. taggedstrongs.py hi Hindi hi-strongs.tsv grc-tagnt.tsv hbo-tahot.tsv grc-tbesg.tsv hbo-tbesh.tsv -- hi-irvs.tsv hi-glt.tsv
"""
import html, os, re, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from origwords import originals, code

CODE, LANG, OUT, TAGNT, TAHOT = sys.argv[1:6]
rest = sys.argv[6:]
LEXICONS, BIBLES = rest[:rest.index('--')], rest[rest.index('--') + 1:]
_, word = originals(TAGNT, TAHOT, LEXICONS)

TAG = re.compile(r'<p-w s=([GH]\d+)[a-zA-Z]?>(.*?)</p-w>', re.S)
# a word's edges: not its punctuation, brackets or quotes (Door43's {implied} words too)
EDGE = re.compile(r'^[\W\d_]+|[\W\d_]+$')
MARK = re.compile(r'[ऀ-෿฀-໿ក-៿؀-ۿ]')  # (Indic, Thai, Lao, Khmer, Arabic marks: \W, but part of a word)

pairs, caps, seen = Counter(), defaultdict(Counter), defaultdict(list)
for path in BIBLES:
    for line in open(path, encoding='utf-8'):
        if line.startswith('#'):
            continue
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 3:
            continue
        key = parts[0]
        for s, w in TAG.findall('\t'.join(parts[2:])):
            w = re.sub(r'<[^>]+>', '', html.unescape(w)).replace('{', '').replace('}', '')
            w = ' '.join(w.replace('\u200b', '').replace('\u200d', '').split())  # (zero-width spaces and joiners: the same word)
            while w and not MARK.match(w[-1]) and EDGE.search(w[-1]):
                w = w[:-1]
            while w and not MARK.match(w[0]) and EDGE.search(w[0]):
                w = w[1:]
            if not w or not re.search(r'[^\W\d_]', w):
                continue
            caps[w.lower()][w[:1].isupper()] += 1
            pairs[(w.lower(), s)] += 1
            if len(seen[(w.lower(), s)]) < 2 and key not in seen[(w.lower(), s)]:
                seen[(w.lower(), s)].append(key)
# lowercase, unless written with a capital 85% of the time at least (God, Israel; not a sentence's first word)
shown = {w: w[:1].upper() + w[1:] if c[True] >= 0.85 * sum(c.values()) else w for w, c in caps.items()}

by_s, tot = defaultdict(list), Counter()
for (w, s), c in pairs.items():
    tot[s] += c
    by_s[s].append((c, w))
rows = []
for s, lst in by_s.items():
    lst.sort(reverse=True)
    keep = [(c, w) for c, w in lst if c >= 3 and c / tot[s] >= 0.05][:8]
    if not keep:
        continue
    g, tr, gl = word.get(s, ('', '', ''))
    head = f'<p-n>{html.escape(g, quote=False)} <i>{html.escape(tr, quote=False)}</i> {html.escape(gl, quote=False)}</p-n>\t' if g else ''
    # (the words its second index words; the rest in <p-n>, which another language's row leaves out)
    items = ''.join(f'@{html.escape(shown[w], quote=False)}\t<p-n>{round(100 * c / tot[s])}%'
                    + (' · ' + ', '.join(f'<p-a>{code(v)}</p-a>' for v in seen[(w, s)]) if seen[(w, s)] else '') + '</p-n>\t'
                    for c, w in keep)
    rows.append((s[0], int(s[1:]), f'{s}\t{head}{items}'))
rows.sort()
n = len(BIBLES)
with open(OUT, 'w', encoding='utf-8') as o:
    o.write(f'#desc\tGreek and Hebrew words in {LANG}: each Strong’s number, the {LANG} words {n} {LANG} Bible{"s" if n > 1 else ""} '
            f'translate it by (from {"their" if n > 1 else "its"} own word tags), how often, and verses. With another language’s on, '
            'a dictionary between them.\n#priority\t2\n'
            f'#lang\t{CODE},aligned\n')
    o.writelines(r[2] + '\n' for r in rows)
print(OUT, len(rows), 'Strong’s numbers', file=sys.stderr)
