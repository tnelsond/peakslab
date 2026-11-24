#!/usr/bin/env python3
"""Checked words added to the built synsets (build.py's <lang>/thesaurus/<ab>-synsets.tsv), in place: only the
languages they're in, so nothing is rebuilt. Each word goes to its concept (a new row for one its language had no word
for, its part of speech English's), once: run again, it adds nothing; and the list is credited in the description.

Usage: add.py <dict_src dir> <checked words .tsv> ...
  checked words: "#credit<TAB>where they're from", then <abbreviation><TAB>concept key<TAB>word lines
  A list whose first line is "#remove" takes its words out of their concepts instead (words checked and found
  wrong: run after a rebuild, they're out again)
Out: the changed <ab>-synsets.tsv; on stderr, what each list added.
"""
import sys, os, re, collections
from html import escape, unescape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # (langs.py, beside this; -I leaves it off)
from langs import LANGS

SRC, LISTS = sys.argv[1], sys.argv[2:]
PATH = {ab: f'{SRC}/{l}/thesaurus/{ab}-synsets.tsv' for l, (ab, _, _) in LANGS.items()}
e = lambda s: escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (as build.py's: peakgen's marks as text)
u = lambda s: unescape(s.replace('@@', '@').replace('^^', '^'))


def read(path):
	head, rows = [], {}
	for l in open(path, encoding='utf-8'):
		if l.startswith('#'):
			head.append(l.rstrip('\n').split('\t', 1))
		elif '\t' in l:
			k, r = l.rstrip('\n').split('\t', 1)
			rows[u(k)] = r.split('\t')
	return head, rows


pos = None
want = collections.defaultdict(list)  # abbreviation: [(key, word, credit or None: out)]
for path in LISTS:
	credit = ''
	for l in open(path, encoding='utf-8'):
		a = l.rstrip('\n').split('\t')
		if a[0] == '#credit':
			credit = a[1]
		elif a[0] == '#remove':
			credit = None
		elif len(a) == 3 and a[0] in PATH:
			want[a[0]].append((u(a[1]), a[2], credit))
for ab, xs in want.items():
	head, rows = read(PATH[ab])
	if pos is None:  # (English's parts of speech, for a concept new to the language)
		pos = {k: r[0] for k, r in read(PATH['en'])[1].items()}
	n, miss, credits, out = 0, 0, [], 0
	for k, w, credit in xs:
		if credit is None:
			if k in rows:
				keep = [c for c in rows[k] if not (c.startswith('@') and u(c[1:]).lower() == w.lower())]
				# (and the romanization after it, if it had one)
				keep = [c for i, c in enumerate(keep) if not (c.startswith('<p-ipa>') and (i == 0 or not keep[i - 1].startswith('@')))]
				out += len(rows[k]) != len(keep)
				rows[k] = keep
				if not any(c.startswith('@') for c in keep):
					del rows[k]
			continue
		if k not in pos:
			miss += 1
			continue
		r = rows.setdefault(k, [pos[k]])
		if w.lower() not in {u(c[1:]).lower() for c in r if c.startswith('@')}:
			r.append('@' + e(w))
			n += 1
		if credit not in credits:
			credits.append(credit)
	desc = dict(head).get('#desc', '')
	new = [c for c in credits if c and c not in desc]
	if new:
		desc = desc.rstrip('. ') + '. Also ' + ' and '.join(new) + '.'
	with open(PATH[ab], 'w', encoding='utf-8') as o:
		for h in head:
			o.write('\t'.join(['#desc', desc] if h[0] == '#desc' else h) + '\n')
		for k in sorted(rows):
			o.write(e(k) + '\t' + '\t'.join(rows[k]) + '\n')
	print(f'{ab}: {n} words added ({sum(c is not None for _, _, c in xs) - n - miss} it had), {miss} with no such concept, {out} taken out; {len(rows)} senses', file=sys.stderr)
