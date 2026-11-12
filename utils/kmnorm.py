#!/usr/bin/env python3
"""Khmer text normalized, in place: each syllable's marks in Unicode's order, one of each.

  ZWNJ, ZWJ (ចេរូ<ZWNJ>ប៊ីម: a search for ចេរូប៊ីម missed it): gone
  a word break inside a syllable (ដូច<ZWSP>្នេះ, ទុរ្ភិក្<ZWSP>ស): gone
  marks after their consonant: coengs, shifter (៉ ៊), robat, vowel, signs (រា៉ម: រ៉ាម, រំុ: រុំ)
  a mark doubled (បញ្ចុុះ, ្្): one
  ុ with a top vowel: the shifter it looks like there (អុីស្រាអែល, អីុ: អ៊ីស្រាអែល; មុឺន: ម៉ឺន)
  two vowels that are one (េ+ី ើ, េ+ា ោ)
  a vowel or coeng typed before its consonant (េហតុ, ្រពះ: ហេតុ, ព្រះ)
  no space before ។ ៕; NBSP a space

Usage: kmnorm.py [--all] FILE.tsv...   (the text: fields after the second tab; --all: every field, a dictionary's Khmer headwords too)
"""
import re, sys
from collections import Counter

CONS = 'ក-ឳ'  # consonants and independent vowels
COENG, ROBAT, SHIFT = '្', '៌', '៉៊'
VOWEL = 'ា-ៅ'
SIGN = 'ំ-ៈ់៍-៑៓៝'
MARK = f'ា-៓៝'
JOIN = {'េី': 'ើ', 'ីេ': 'ើ', 'េា': 'ោ', 'េោ': 'ោ',
	'ោេ': 'ោ', 'េើ': 'ើ', 'ើេ': 'ើ'}
TOP = 'ិីឹឺើេ'  # ិ ី ឹ ឺ ើ (េ: half of ើ)
OSERIES = 'ងញមយរវ'  # their shifter is ៉; the others' ៊
stats = Counter()

def cluster(m):
	base, rest = m[1], m[2]
	coengs, shift, robat, vowels, signs = [], [], [], [], []
	for c in re.findall(f'{COENG}[{CONS}]|.', rest):
		(coengs if len(c) == 2 else shift if c in SHIFT else robat if c == ROBAT
			else vowels if 'ា' <= c <= 'ៅ' else signs).append(c)
	one = lambda l: ''.join(dict.fromkeys(l))
	v = one(vowels)
	if 'ុ' in v and len(v) > 1 and any(c in TOP for c in v):
		v = v.replace('ុ', ''); stats['ុ for a shifter'] += 1
		shift = shift or ['៉' if base in OSERIES else '៊']  # (with one already, a ុ too: អ៊ុី)
	v = JOIN.get(v, v)
	if len(v) > 1:
		stats['two vowels left: ' + v] += 1
	out = base + ''.join(coengs) + one(shift) + one(robat) + v + one(signs)
	if out != m[0]:
		stats['syllables fixed'] += 1
	return out

SYL = re.compile(f'([{CONS}])((?:{COENG}[{CONS}]|[{MARK}])+)')

def norm(t):
	t0 = t
	t = t.replace(' ', ' ').replace('‌', '').replace('‍', '')
	t = re.sub(f'(?<=[{CONS}{MARK}])​+(?=[{MARK}])', '', t)  # a break before a mark
	t = re.sub(f'{COENG}​+(?=[{CONS}])', COENG, t)  # coeng, break, consonant
	t = re.sub(f'{COENG}{{2,}}', COENG, t)
	t = re.sub(f'(^|[\\s«“(])([េ-ៃ])([{CONS}](?:{COENG}[{CONS}])*)', r'\1\3\2', t)  # េហតុ: ហេតុ
	t = re.sub(f'(^|[\\s«“(])({COENG}[{CONS}])([{CONS}])', r'\1\3\2', t)  # ្រពះ: ព្រះ
	t = SYL.sub(cluster, t)
	t = re.sub(r' +(?=[។៕])', '', t)
	if t != t0:
		stats['lines changed'] += 1
	return t

ALL = '--all' in sys.argv
for path in [a for a in sys.argv[1:] if a != '--all']:
	lines = open(path, encoding='utf-8').read().split('\n')
	for i, l in enumerate(lines):
		if l.startswith('#'):
			continue
		if ALL:
			lines[i] = norm(l)
		elif l.count('\t') >= 2:
			k, a, body = l.split('\t', 2)
			lines[i] = f'{k}\t{a}\t{norm(body)}'
	open(path, 'w', encoding='utf-8').write('\n'.join(lines))
for k, n in stats.most_common():
	print(f'{n:7} {k}', file=sys.stderr)
