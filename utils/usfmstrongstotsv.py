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
import itertools, re, sys

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

def strong(s):
	"""Door43's x-strong (b:H7225, G39720: Strong's with a sense digit) as Strong's (H7225, G3972)"""
	m = re.search(r'([GH])(\d+)', s.split(':')[-1])
	return m and m[1] + str(int(m[2][:-1] if m[1] == 'G' and len(m[2]) == 5 else m[2]))

LOW = {'G3588', 'H853'}  # the article, the object marker: not what a phrase aligned with them translates

def aligned(text):
	"""Aligned USFM (unfoldingWord's \\zaln-s |x-strong=...\\* \\w Paul|...\\w*\\zaln-e\\*) as \\w words|strong="G3972"\\w*:
	words aligned together (or next to each other with one number) one link, to their innermost original word that isn't an article"""
	text = re.sub(r'\\(?!zaln)[a-z]+\d?(-[se])?\\\*', '', text)  # milestones (\\ts\\*: a translator's chunk)
	items, stack, n, pos = [], [], 0, 0  # items: text, or [word, Strong's, its alignment]
	for m in re.finditer(r'\\zaln-s\s*\|([^\\]*)\\\*|\\zaln-e\\\*|\\w ([^|\\]*)\|[^\\]*\\w\*', text):
		items.append(text[pos:m.start()]); pos = m.end()
		if m[1] is not None:
			n += 1
			stack.append((n, strong(re.search(r'x-strong="([^"]*)"', m[1])[1]) if 'x-strong' in m[1] else None))
		elif m[2] is None:
			stack and stack.pop()
		else:
			ss = [s for _, s in stack if s]
			s = next((s for s in reversed(ss) if s not in LOW), ss[-1] if ss else None)
			items.append([m[2], s, stack[-1][0] if stack else 0])
	items.append(text[pos:])
	items = [x for k, g in itertools.groupby(items, lambda x: isinstance(x, str)) for x in ([''.join(g)] if k else g)]
	out, i = [], 0
	while i < len(items):
		it = items[i]
		if isinstance(it, str):
			out.append(it); i += 1
			continue
		words = it[0]; j = i + 1
		while it[1] and j + 1 < len(items) and isinstance(items[j], str) and not items[j].strip() \
				and isinstance(items[j + 1], list) and items[j + 1][1] == it[1]:
			words += ' ' + items[j + 1][0]; j += 2
		out.append(f'\\w {words}|strong="{it[1]}"\\w*' if it[1] else words)
		i = j
	return ''.join(out)

def book(path):
	text = open(path, encoding='utf-8').read().replace('\ufeff', '')  # (a BOM before \\id)
	text = re.sub(r'\\(?!zaln)[a-z]+\d?(-[se])?\\\*', '', text)  # milestones (\\ts\\*: a translator's chunk)
	if '\\zaln-s' in text:
		text = aligned(text)
	text = re.sub(r'\\w ([^|\\]*)\|(?![^\\]*strong=)[^\\]*\\w\*', r'\1', text)  # a word not aligned (x-occurrence only): just the word
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
