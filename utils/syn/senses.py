#!/usr/bin/env python3
"""A language's synsets headed by its words (#lang <code>,senses): each word, its entries in the language's
dictionaries (as they are there), then its senses, each the key every language's synsets share:
	ស្រឡាញ់<TAB>(km-kaikki's entry)<TAB><p-k><p-n>verb</p-n> @love (have a great affection or liking for)</p-k>...
The key is a second index word, so a search for it finds the word, and the app (a gloss in another language) finds
the words for a key in either shape: an aligned one's headword, a senses one's <p-k>.

Usage: senses.py <ab>-synsets.tsv (built: build.py's, add.py's) <out .tsv> <dictionary .tsv>...
  The synsets' rows are "key<TAB><p-n>pos</p-n><TAB>@word<TAB>[<p-ipa>...]..."; the dictionaries' "word<TAB>...".
"""
import re, sys
from collections import defaultdict
from html import unescape

SYN, OUT, DICTS = sys.argv[1], sys.argv[2], sys.argv[3:]
u = lambda s: unescape(s.replace('@@', '@').replace('^^', '^'))  # (build.py's e(), back)

head, senses = {}, defaultdict(list)  # word: [(pos, key as written)]
for l in open(SYN, encoding='utf-8'):
	a = l.rstrip('\n').split('\t')
	if l.startswith('#'):
		head[a[0]] = a[1]
		continue
	if len(a) < 2:
		continue
	pos = re.sub(r'</?p-n>', '', a[1])
	for c in a[2:]:
		if c.startswith('@'):
			senses[u(c[1:])].append((pos, a[0]))
assert 'aligned' in head.get('#lang', ''), f'{SYN}: not a key-headed synsets ({head.get("#lang")})'

entries, credits = defaultdict(list), []
for p in DICTS:
	for l in open(p, encoding='utf-8'):
		a = l.rstrip('\n').split('\t', 1)
		if l.startswith('#desc'):
			credits.append(a[1])
		elif not l.startswith('#') and len(a) == 2:
			entries[a[0]].append(a[1])

code = head['#lang'].split(',')[0]
with open(OUT, 'w', encoding='utf-8') as o:
	o.write(f"#desc\t{head['#desc']} With each word, " + '; '.join(credits) + '.\n')
	o.write(f"#priority\t{head.get('#priority', '0')}\n#lang\t{code},senses\n")
	for w in sorted(set(senses) | set(entries)):
		ks = sorted(set(senses.get(w, [])))
		cells = entries.get(w, []) + [f'<p-k><p-n>{p}</p-n> @{k}</p-k>' for p, k in ks]
		o.write(w + '\t' + '\t'.join(cells) + '\n')
print(f'{OUT}: {len(set(senses) | set(entries))} words, {len(senses)} with senses, {sum(map(len, senses.values()))} senses',
      file=sys.stderr)
