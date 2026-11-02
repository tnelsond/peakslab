#!/usr/bin/env python3
"""A WordNet in plain-text StarDict form (as Open English WordNet's, through
`pyglossary x.ifo out.txt --write-format=Tabfile`):

  happy|happier|happiest	[adj]\\n1. enjoying ... (synonyms: glad)\\n   "a happy smile"

into a peakslab .tsv:

  happy	<details><summary>forms (2)</summary>@happier	@happiest</details>	<p-n>adj</p-n> <ol><li>enjoying ...<ul><li><i>a happy smile</i></li></ul><p>Synonyms: <p-a>glad</p-a></p></li></ol>

  - each part of speech <p-n>, its senses numbered, their examples a list
  - each sense's synonyms as words to tap (as kaikkijsontotsv.py's)
  - its forms as words to search, in a closed <details> (as tabtotsv.py's)

Usage: wordnettotsv.py <in.txt> <out.tsv> <desc> [priority]
"""
import re, sys
from html import escape

IN, OUT, DESC = sys.argv[1:4]
PRIORITY = sys.argv[4] if len(sys.argv) > 4 else '2'

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def body(text):
	out, senses = [], None
	def close():  # (a part of speech's senses: their definitions, examples and synonyms)
		if senses:
			out.append('<ol>' + ''.join(f'<li>{d}' + (f'<ul>{"".join(x)}</ul>' if x else '') + f'{syn}</li>' for d, x, syn in senses) + '</ol>')
	for line in text.split('\n'):
		if m := re.fullmatch(r'\[(.+)\]', line.strip()):  # a part of speech
			close()
			out.append(f'<p-n>{e(m[1])}</p-n> ')
			senses = []
		elif m := re.match(r'\d+\. (.*)', line):  # a sense
			d, syn = m[1], ''
			if s := re.search(r'\s*\(synonyms: ([^()]*)\)$', d):
				d = d[:s.start()]
				syn = '<p>Synonyms: ' + ', '.join(f'<p-a>{e(w.strip())}</p-a>' for w in s[1].split(',') if w.strip()) + '</p>'
			if senses is None:
				senses = []
			senses.append([e(d), [], syn])
		elif (m := re.fullmatch(r'\s+"(.*)"', line)) and senses:  # an example
			senses[-1][1].append(f'<li><i>{e(m[1])}</i></li>')
	close()
	return ''.join(out)

out, n = [f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\tmono\n'], 0
for line in open(IN, encoding='utf-8'):
	if line.startswith('##') or '\t' not in line:
		continue
	words, text = line.rstrip('\n').split('\t', 1)
	word, *forms = [w.strip() for w in words.split('|')]
	forms = [f for f in dict.fromkeys(forms) if f and f != word]
	b = body(text.replace('\\n', '\n'))
	if not word or not b:
		continue
	cells = [word]
	if forms:
		cells.append(f'<details><summary>forms ({len(forms)})</summary>' + '\t'.join('@' + e(f) for f in forms) + '</details>')
	cells.append(b)
	out.append('\t'.join(cells) + '\n')
	n += 1
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} entries', file=sys.stderr)
