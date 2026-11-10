#!/usr/bin/env python3
"""A Bible in OSIS with Strong's numbers (<w lemma="strong:H7225">word</w>, like
STEPBible's tagged Arabic SVD) as a PeakSlab Bible text: each tagged word is
<p-w s=H7225>word</p-w>, a link to its entry in the lexicons. A word with
several numbers ("strong:G3588 strong:G2316", the + God) takes the last, the
word's own. A Psalm's title starts its first verse, as the KJV has it.

Usage: osisstrongstotsv.py [--priority=N] BIBLE.osis.xml NAMES.tsv OUT.tsv "DESCRIPTION"
  NAMES.tsv  a PeakSlab Bible in the same language, for the books' names ("@التكوين 1:1")
"""
import re, sys
from html import escape

args = [a for a in sys.argv[1:] if not a.startswith('--priority=')]
priority = next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--priority=')), '-1')
SRC, NAMES, OUT, DESC = args

OSIS = ('Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job '
	'Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech '
	'Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus '
	'Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev').split()
CODES = ('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro '
	'ecc sol isa jer lam eze dan hos joe amo oba jon mic nah hab zep hag zec mal mat mar '
	'luk joh act rom 1co 2co gal eph phi col 1th 2th 1ti 2ti tit phm heb jam 1pe 2pe 1jo '
	'2jo 3jo jud rev').split()
BOOK = dict(zip(OSIS, CODES))

names = {}
for line in open(NAMES, encoding='utf-8'):
	m = re.match(r'(\S+) \d+\.\d+\t@(.*?) \d+:\d+\t', line)
	if m:
		names.setdefault(m[1], m[2])

def words(s):
	def w(m):
		n = re.findall(r'strong:([GH])0*(\d+)', m[1])
		t = m[2].strip()
		return f'<p-w s={n[-1][0]}{n[-1][1]}>{t}</p-w>' if n else t
	s = re.sub(r'<w lemma="([^"]*)"[^>]*>(.*?)</w>', w, s, flags=re.S)
	s = re.sub(r'<(?!/?p-w)[^>]+>', '', s)
	return re.sub(r'\s+', ' ', s).strip()

text = open(SRC, encoding='utf-8').read()
out = []
for ch in re.finditer(r"<chapter osisID='([^']+)'>(.*?)(?=<chapter |</div>\s*<div type='book'|</div>\s*</div>\s*</osisText>|$)", text, re.S):
	title = re.search(r'<title[^>]*type="psalm"[^>]*>(.*?)</title>', ch[2], re.S)
	title = words(title[1]) + ' ' if title else ''
	for v in re.finditer(r"<verse osisID='([^.]+)\.(\d+)\.(\d+)'>(.*?)</verse>", ch[2], re.S):
		b = BOOK[v[1]]
		t = words(v[4])
		if v[3] == '1':
			t, title = title + t, ''
		out.append(f'{b} {v[2]}.{v[3]}\t@{names[b]} {v[2]}:{v[3]}\t{t}')

with open(OUT, 'w', encoding='utf-8') as o:
	o.write(f'#desc\t{DESC}\n#priority\t{priority}\n#lang\tmono\n#no sort\n')
	o.writelines(l + '\n' for l in out)
print(len(out), 'verses', file=sys.stderr)
