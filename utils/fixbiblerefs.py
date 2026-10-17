#!/usr/bin/env python3
"""Normalise <p-a> verse links in peakslab .tsv files to the form "Rom 4.8"
(the Bible modules' book code, chapter.verse, or just the chapter) so a click finds the verse.
Ranges keep only the first verse inside the link: <p-a>Mat 7.24</p-a>-25

Usage: fixbiblerefs.py file.tsv ...   (rewrites in place)
"""
import re, sys

CODES = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO '
	'ECC SOL ISA JER LAM EZE DAN HOS JOE AMO OBA JON MIC NAH HAB ZEP HAG ZEC MAL MAT MAR '
	'LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO '
	'2JO 3JO JUD REV').split()
NAMES = ('Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth 1Samuel 2Samuel '
	'1Kings 2Kings 1Chronicles 2Chronicles Ezra Nehemiah Esther Job Psalms Proverbs '
	'Ecclesiastes SongofSolomon Isaiah Jeremiah Lamentations Ezekiel Daniel Hosea Joel Amos '
	'Obadiah Jonah Micah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi Matthew Mark Luke '
	'John Acts Romans 1Corinthians 2Corinthians Galatians Ephesians Philippians Colossians '
	'1Thessalonians 2Thessalonians 1Timothy 2Timothy Titus Philemon Hebrews James 1Peter '
	'2Peter 1John 2John 3John Jude Revelation').split()
BOOK = {c: c for c in CODES}
BOOK.update({n.upper(): c for n, c in zip(NAMES, CODES)})
BOOK.update({'PSALM': 'PSA', 'SONGOFSONGS': 'SOL', 'SNG': 'SOL', 'EZK': 'EZE', 'JOL': 'JOE',
	'NAM': 'NAH', 'MRK': 'MAR', 'JHN': 'JOH', 'PHP': 'PHI', 'JAS': 'JAM', '1JN': '1JO',
	'2JN': '2JO', '3JN': '3JO'})

REF = re.compile(r'<p-a>\s*([1-3]?\s?[A-Za-z]+(?: of [A-Za-z]+)?)\.?\s+(\d+)(?:[:.](\d+))?([^<]*)</p-a>')

def fix(m):
	code = BOOK.get(re.sub(r'\s', '', m.group(1)).upper())
	if not code:
		return m.group(0)
	rest = m.group(4).strip().replace(':', '.')
	i = 2 if code[0].isdigit() else 1  # 1CH -> 1Ch, MAT -> Mat
	cv = f'{m.group(2)}.{m.group(3)}' if m.group(3) else m.group(2)
	return f'<p-a>{code[:i]}{code[i:].lower()} {cv}</p-a>{rest}'

for path in sys.argv[1:]:
	with open(path, encoding='utf-8') as f:
		s = f.read()
	n = len(REF.findall(s))
	s2 = REF.sub(fix, s)
	with open(path, 'w', encoding='utf-8') as f:
		f.write(s2)
	print(f'{path}: {n} links', file=sys.stderr)
