#!/usr/bin/env python3
"""Tyndale Open Study Notes (tyndaleopenresources.com, CC BY-SA 4.0) into two
peakslab .tsv files:
  - the notes, a Bible note (#collapsed) at each note's first verse:
    "gen 1.1<TAB>@Genesis 1:1–2:3<TAB>the note"; each book's summary and
    introduction under its code ("gen<TAB>@Genesis"), and at the first verse of
    a profile's or theme's passage, a word to tap for it
  - the profiles and theme articles, a dictionary by title
A reference ("?bref=Gen.1.22-25") is a verse to tap: <p-a>Gen 1.22</p-a>-25,
a link to a profile or theme its title (<p-a>Adam and Eve</p-a>), to a note its verse.

Usage: tyndaletotsv.py <Tyndale Open Study Notes dir> <bible.tsv> <out.tsv> <articles out.tsv> <desc> <articles desc>
  bible.tsv  a peakslab Bible in English: each book's name ("@Matthew 1:1")
"""
import os, re, sys
import xml.etree.ElementTree as ET
from html import escape

SRC, BIBLE, OUT, AOUT, DESC, ADESC = sys.argv[1:7]

CODES = ('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro '
	'ecc sol isa jer lam eze dan hos joe amo oba jon mic nah hab zep hag zec mal mat mar '
	'luk joh act rom 1co 2co gal eph phi col 1th 2th 1ti 2ti tit phm heb jam 1pe 2pe 1jo '
	'2jo 3jo jud rev').split()
# Tyndale's book abbreviations, in the same order
TYN = ('Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job '
	'Ps Pr Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jon Mic Nah Hab Zeph Hagg Zech '
	'Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thes 2Thes 1Tim 2Tim Titus '
	'Phlm Heb Jas 1Pet 2Pet 1Jn 2Jn 3Jn Jude Rev').split()
BOOK = dict(zip(TYN, CODES))
# Item names spell 1, 2, 3 in Roman numerals ("ITim_BookIntro"), and intros' names vary
for t, c in list(BOOK.items()):
	if t[0] in '123':
		BOOK['I' * int(t[0]) + t[1:]] = c
BOOK.update({'Prov': 'pro', 'Psa': 'psa', 'Song': 'sol', 'Phlm': 'phm', 'IIIJn': '3jo', 'IIJn': '2jo', 'IJn': '1jo'})
ORDER = {c: i for i, c in enumerate(CODES)}

names = {}
for line in open(BIBLE, encoding='utf-8'):
	m = re.match(r'(\S+) \d+\.\d+\t@(.*?) \d+:\d+\t', line)
	if m:
		names.setdefault(m[1], m[2])

def book(t):
	b = BOOK.get(t)
	if not b:
		# "GenesisIntro", "1Timothy..." : the start of its name
		for c, n in names.items():
			if t.lower().startswith(n.replace(' ', '').lower()):
				return c
	return b

def parse_ref(r):
	"""'Gen.1.1-2.3' -> ('gen', 1, 1, '1:1–2:3'); a book alone, chapter 0"""
	m = re.match(r'([1-3I]*[A-Za-z]+)\.(\d+)(?:\.(\d+))?(?:-(?:(\d+)\.)?(\d+))?$', r.strip())
	if not m or not book(m[1]):
		return None
	b, c, v = book(m[1]), int(m[2]), int(m[3] or 1)
	show = f'{c}:{v}' if m[3] else f'{c}'
	if m[5]:
		show += '–' + (f'{m[4]}:{m[5]}' if m[4] else m[5])
	return b, c, v, show

def verse(r, text=''):
	"""A verse to tap: 'Rom.5.12-21' -> '<p-a>Rom 5.12</p-a>–21', the end of the
	range as the link's text has it ("1:3–2:3"; some refs lose it: "Gen.1.3-2")"""
	p = parse_ref(r)
	if not p:
		return None
	b, c, v, show = p
	m = re.search(r'[–-]\s*([\d:]+)\s*$', text)
	rest = m[1] if m else show.split('–', 1)[1] if '–' in show else ''
	code = b[:2].upper() + b[2:] if b[0].isdigit() else b.capitalize()
	return f'<p-a>{code} {c}.{v}</p-a>' + (f'–{rest}' if rest else '')

titles = {}  # profile / theme item name -> its title
for f in ('Profiles.xml', 'ThemeNotes.xml'):
	for item in ET.parse(os.path.join(SRC, f)).getroot():
		titles[item.get('name')] = item.findtext('title').strip()

def inline(e):
	"""An element's contents: spans and links as peakslab markup, text escaped"""
	out = [escape(e.text or '', quote=False)]
	for c in e:
		cls = c.get('class', '')
		inner = inline(c)
		if c.tag == 'a':
			href = c.get('href', '').strip()
			if href.startswith('?bref='):
				inner = verse(href[6:], c.text or '') or inner
			elif href.startswith('?item='):
				name, _, kind = href[6:].rpartition('_Filament')[0].rpartition('_')
				if name in titles:
					inner = f'<p-a>{escape(titles[name], quote=False)}</p-a>'
				elif kind == 'StudyNote' and verse(name):
					inner = re.sub(r'(\d+:[\d:–-]+)$', '', inner).rstrip()
					inner = f'{inner} {verse(name)}'
		elif cls == 'sn-ref':
			inner = ''  # the note's verses, already its heading
		elif cls.startswith('sn-excerpt') or cls in ('bold', 'intro-h2'):
			inner = f'<b>{inner}</b>'
		elif cls in ('ital', 'hebrew', 'greek', 'aramaic', 'latin', 'divine-name-ital'):
			inner = f'<i>{inner}</i>'
		elif cls == 'ital-bold':
			inner = f'<b><i>{inner}</i></b>'
		elif cls in ('sup', 'sub'):
			inner = f'<{cls}>{inner}</{cls}>'
		if 'divine-name' in cls:
			inner = inner.upper().replace('<P-A>', '<p-a>').replace('</P-A>', '</p-a>').replace('<I>', '<i>').replace('</I>', '</i>')
		out.append(inner)
		out.append(escape(c.tail or '', quote=False))
	return ''.join(out)

def paras(body, skip_title=True):
	out = []
	for p in body:
		cls = p.get('class', '')
		s = re.sub(r'\s+', ' ', inline(p)).strip()
		if not s:
			continue
		if cls.endswith('-title'):
			if not skip_title:
				out.append(f'<h3>{s}</h3>')
		elif cls.endswith('-h1') or cls.endswith('refs-title'):
			out.append(f'<h4>{s}</h4>')
		elif cls.endswith('-h2'):
			out.append(f'<h5>{s}</h5>')
		else:
			out.append(f'<p>{s}</p>')
	return ''.join(out).replace('@', '@@').replace('^', '^^')

rows = []  # (book order, chapter, verse, n, line)
n = 0
def add(b, c, v, line):
	global n
	n += 1
	rows.append((ORDER[b], c, v, n, line))

# Each book: its summary, then its introduction, under its code
intros = {}
for f in ('BookIntroSummaries.xml', 'BookIntros.xml'):
	for item in ET.parse(os.path.join(SRC, f)).getroot():
		p = parse_ref(item.findtext('refs').split(',')[0])
		intros.setdefault(p[0], []).append(paras(item.find('body'), skip_title=f == 'BookIntros.xml'))
for b, parts in intros.items():
	add(b, 0, 0, f'{b}\t@{names[b]}\t' + ''.join(parts))

for item in ET.parse(os.path.join(SRC, 'StudyNotes.xml')).getroot():
	p = parse_ref(item.findtext('refs').split(',')[0])
	if not p:
		print('no verse:', item.get('name'), file=sys.stderr)
		continue
	b, c, v, show = p
	add(b, c, v, f'{b} {c}.{v}\t@{names[b]} {show}\t' + paras(item.find('body')))

arts = []
for f, kind in (('Profiles.xml', 'Profile'), ('ThemeNotes.xml', 'Theme')):
	for item in ET.parse(os.path.join(SRC, f)).getroot():
		t = titles[item.get('name')]
		arts.append(f'{t}\t' + paras(item.find('body')))
		p = parse_ref(item.findtext('refs').split(',')[0])
		if p:
			b, c, v, show = p
			add(b, c, v, f'{b} {c}.{v}\t@{names[b]} {show}\t<p>{kind}: <p-a>{escape(t, quote=False)}</p-a></p>')

rows.sort()
head = '#desc\t{}\n#priority\t3\n#lang\tmono\n'
with open(OUT, 'w', encoding='utf-8') as o:
	o.write(head.format(DESC) + '#no sort\n#collapsed\n')
	o.writelines(r[4] + '\n' for r in rows)
with open(AOUT, 'w', encoding='utf-8') as o:
	o.write(head.format(ADESC))
	o.writelines(a + '\n' for a in sorted(arts))
print(len(rows), 'notes,', len(arts), 'articles', file=sys.stderr)

# Its Bible references as links (utils/fixbiblerefs.py)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixbiblerefs
fixbiblerefs.fix_file(OUT)
fixbiblerefs.fix_file(AOUT)
