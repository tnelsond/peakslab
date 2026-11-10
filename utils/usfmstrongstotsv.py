#!/usr/bin/env python3
"""A Bible in USFM with Strong's numbers (\\w word|strong="H0430"\\w*, like
eBible.org's eng-kjv2006) as a PeakSlab Bible text: each tagged word is
<p-w s=H430>word</p-w>, which app.js makes a link to its entry in the
lexicons (and Strong's). Each verse's reference ("gen 1.1"), then its
reference in the book's name ("Genesis 1:1"), then its text, which reads as the plain one does: added words
in [brackets], a Psalm's title in its first verse, no footnotes or headings.

Usage: usfmstrongstotsv.py [--para] [--priority=N] OUT.tsv "DESCRIPTION" BOOK.usfm...
(--para: a verse starting a paragraph starts with ¶; priority: -1 if not given)
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
	t = re.sub(r'\\\+?w ([^|\\]*)\|strong="([GH]\d+)(?:,[GH]\d+)*"\\\+?w\*', word, t)  # (several numbers: the first's)
	t = re.sub(r'\\\+?add\*', ']', re.sub(r'\\\+?add\s+', '[', t))
	t = re.sub(r'\\\+?[a-z]+\d?\*', '', t)  # Every other marker (\nd, \wj, \p, \q1, \d, ...): just its text
	t = re.sub(r'\\\+?[a-z]+\d?', ' ', t)
	t = re.sub(r'\s+', ' ', t)
	return re.sub(r'\[\s+', '[', re.sub(r'\s+\]', ']', t)).strip()

def book(path):
	text = open(path, encoding='utf-8').read()
	code = re.search(r'^\\id (\w+)', text, re.M)[1]
	code = CODE.get(code, code).lower()
	name = (re.search(r'^\\toc2 (.+?)\s*$', text, re.M) or re.search(r'^\\h (.+?)\s*$', text, re.M))[1]  # The book's short name ("Genesis"; \\h can be capitals, "GENÈSE"), for its references
	text = re.sub(r'^\\(id|ide|h|toc\d|mt\d?|s\d?|rem|cl)\b.*$', '', text, flags=re.M)  # Headings
	parts = re.split(r'\\([cv]) (\d+)\S*', text)
	ch, title, para = 0, '', False
	for kind, n, chunk in zip(parts[1::3], parts[2::3], parts[3::3]):
		if kind == 'c':
			ch, title = int(n), chunk if '\\d' in chunk else ''
			para = para or bool(re.search(r'\\p\s*$', chunk))
		else:
			# (a paragraph starts at it, a \\p before it, with PARA: ¶, as the plain Bibles have it)
			yield f'{code} {ch}.{n}\t@{name} {ch}:{n}', ('¶ ' if para and PARA else '') + clean((title + ' ' if n == '1' else '') + chunk)
			para = bool(re.search(r'\\p\s*$', chunk))

PARA = False
def main():
	global PARA
	args = sys.argv[1:]
	PARA = '--para' in args  # (paragraphs marked ¶)
	pri = next((a.split('=', 1)[1] for a in args if a.startswith('--priority=')), '-1')
	args = [a for a in args if a != '--para' and not a.startswith('--priority=')]
	out, desc, files = args[0], args[1], args[2:]
	with open(out, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{desc}\n#priority\t{pri}\n#lang\tmono\n#no sort\n')
		for f in files:
			for ref, t in book(f):
				o.write(f'{ref}\t{t}\n')

if __name__ == '__main__':
	main()
