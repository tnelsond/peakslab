#!/usr/bin/env python3
"""A Bible in USFM with Strong's numbers (\\w word|strong="H0430"\\w*, like
eBible.org's eng-kjv2006) as a PeakSlab Bible text: each tagged word is
<p-w s=H430>word</p-w>, which app.js makes a link to its entry in the
lexicons (and Strong's). The text reads as the plain one does: added words
in [brackets], a Psalm's title in its first verse, no footnotes or headings.

Usage: usfmstrongstotsv.py OUT.tsv "DESCRIPTION" BOOK.usfm...
"""
import re, sys

# USFM's book codes that the other Bibles here have differently
CODE = {'SNG': 'SOL', 'EZK': 'EZE', 'JOL': 'JOE', 'NAM': 'NAH', 'MRK': 'MAR', 'JHN': 'JOH',
	'PHP': 'PHI', 'JAS': 'JAM', '1JN': '1JO', '2JN': '2JO', '3JN': '3JO'}

def word(m):
	n = re.match(r'([GH])0*(\d+)', m[2])
	return f'<p-w s={n[1]}{n[2]}>{m[1].strip()}</p-w>'

def clean(t):
	t = re.sub(r'\\f .*?\\f\*|\\x .*?\\x\*', '', t)  # Footnotes, cross references
	t = re.sub(r'\\\+?w ([^|\\]*)\|strong="([GH]\d+)"\\\+?w\*', word, t)
	t = re.sub(r'\\\+?add\*', ']', re.sub(r'\\\+?add\s+', '[', t))
	t = re.sub(r'\\\+?[a-z]+\d?\*', '', t)  # Every other marker (\nd, \wj, \p, \q1, \d, ...): just its text
	t = re.sub(r'\\\+?[a-z]+\d?', ' ', t)
	t = re.sub(r'\s+', ' ', t)
	return re.sub(r'\[\s+', '[', re.sub(r'\s+\]', ']', t)).strip()

def book(path):
	text = open(path, encoding='utf-8').read()
	code = re.search(r'^\\id (\w+)', text, re.M)[1]
	code = CODE.get(code, code)
	text = re.sub(r'^\\(id|ide|h|toc\d|mt\d?|s\d?|rem|cl)\b.*$', '', text, flags=re.M)  # Headings
	parts = re.split(r'\\([cv]) (\d+)\S*', text)
	ch, title = 0, ''
	for kind, n, chunk in zip(parts[1::3], parts[2::3], parts[3::3]):
		if kind == 'c':
			ch, title = int(n), chunk if '\\d' in chunk else ''
		else:
			yield f'{code} {ch}.{n}', clean((title + ' ' if n == '1' else '') + chunk)

def main():
	out, desc, files = sys.argv[1], sys.argv[2], sys.argv[3:]
	with open(out, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{desc}\n#priority\t0\n#lang\tmono\n#no sort\n')
		for f in files:
			for ref, t in book(f):
				o.write(f'{ref}\t{t}\n')

if __name__ == '__main__':
	main()
