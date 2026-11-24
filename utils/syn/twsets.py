#!/usr/bin/env python3
"""The Bible translation words (translationWords: <lang>/bible/words/<ab>-tw.tsv, each keyed by the English term) as
sets for build.py to place on the synsets, as an edition's: each term, its English and every language's words.
Usage: twsets.py <dict_src dir> <out.pkl>
Out: the credit (a str), then one pickle a term: (None, [(abbreviation, word)], [])"""
import sys, os, glob, pickle, collections, re
from html import unescape
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from langs import LANGS
SRC, OUT = sys.argv[1:3]
ABS = {ab for ab, _, _ in LANGS.values()}
sets = collections.defaultdict(list)
for f in sorted(glob.glob(f'{SRC}/*/bible/words/*-tw.tsv')):
	ab = None
	for l in open(f, encoding='utf-8'):
		a = l.rstrip('\n').split('\t')
		if a[0] == '#lang':
			ab = a[1].split(',')[0]
		elif l[0] != '#' and len(a) > 1 and ab in ABS:
			for c in a[1:]:
				if c.startswith('@'):
					w = unescape(re.sub(r'<[^>]+>', '', c[1:])).replace('​', '').strip()
					if w and (ab, w) not in sets[a[0]]:
						sets[a[0]].append((ab, w))
with open(OUT, 'wb') as o:
	pickle.dump('the Bible translation words (<a href="https://bibleineverylanguage.org/">bibleineverylanguage</a>\'s '
		'translationWords, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)', o, protocol=5)
	n = 0
	for k, items in sets.items():
		if len({ab for ab, _ in items}) >= 2:
			pickle.dump((None, items, []), o, protocol=5); n += 1
print(n, 'terms,', sum(map(len, sets.values())), 'words', file=sys.stderr)
