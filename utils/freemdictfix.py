#!/usr/bin/env python3
"""After tabtotsv.py, what a FreeMdict dictionary needs of its own:

  lexitron <in.tsv> <thai.tsv> <english.tsv> <desc-thai> <desc-english>
      NECTEC's Lexitron, both ways in one: its Thai words (Thai to English)
      and its English words (English to Thai), each its own .tsv; a sense's
      [VT] a note, its S. (synonyms) and A. (antonyms) words to tap
  strongs <in.tsv> <out.tsv>
      a Chinese Strong's lexicon: just its Chinese (its English is the
      English Strong's), out of its table
"""
import re, sys

kind = sys.argv[1]
lines = open(sys.argv[2], encoding='utf-8').read().split('\n')
head = [l for l in lines if l.startswith('#')]
body = [l for l in lines if l and not l.startswith('#')]

def taps(words):
	return ', '.join(f'<p-a>{w.strip()}</p-a>' for w in re.split(r'[;,]', words) if w.strip())

def sense(s):
	s = re.sub(r'^\[([A-Z]+)\]\s*', lambda m: f'<p-n>{m[1].lower()}</p-n> ', s.strip())
	s = re.sub(r' A\.(.*)$', lambda m: f'<br><p-n>opposite</p-n> {taps(m[1])}', s)
	s = re.sub(r' S\.(.*?)(?=<br>|$)', lambda m: f'<br><p-n>same</p-n> {taps(m[1])}', s)
	return f'<li>{s}</li>'

if kind == 'lexitron':
	thai, eng = [], []
	for l in body:
		w, b = l.split('\t', 1)
		ss = [sense(s) for s in b.split('<br>')]
		b = '<ol>' + ''.join(ss) + '</ol>' if len(ss) > 1 else ss[0][4:-5]
		(thai if re.match(r'[฀-๿]', w) else eng).append(f'{w}\t{b}')
	for out, rows, desc, lang in ((sys.argv[3], thai, sys.argv[5], 'bi'), (sys.argv[4], eng, sys.argv[6], 'rbi')):
		with open(out, 'w', encoding='utf-8') as f:
			f.write(f'#desc\t{desc}\n#priority\t{sys.argv[7] if len(sys.argv) > 7 else 1}\n#lang\t{lang}\n')
			f.write('\n'.join(rows) + '\n')
		print(f'{out}: {len(rows)} entries', file=sys.stderr)
elif kind == 'strongs':
	with open(sys.argv[3], 'w', encoding='utf-8') as f:
		f.write('\n'.join(head) + '\n')
		for l in body:
			w, b = l.split('\t', 1)
			cells = re.findall(r'<tr><td>(.*?)(?:</pre>)?</td></tr>', b)
			zh = cells[1] if len(cells) > 1 else b
			zh = re.sub(r'^(<br>)+|</a>', '', zh)
			zh = re.sub(r'<b><b>(.*?)</b>\)</b>', r'<b>\1)</b>', zh)
			f.write(f'{w}\t{zh}\n')
