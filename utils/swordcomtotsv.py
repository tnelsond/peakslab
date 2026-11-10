#!/usr/bin/env python3
"""A SWORD commentary (CrossWire's zCom / zCom4 modules: OSIS, or ThML like the
Treasury of Scripture Knowledge) into a peakslab Bible note .tsv (#collapsed):
each entry at its first verse, "gen 1.1<TAB>@Genesis 1:1–5<TAB>the note"
(verses linked to one entry are one note), a book's introduction under its code.
A reference is a verse to tap: <p-a>Isa 34.11</p-a>.

Usage: swordcomtotsv.py <module dir (modules/comments/zcom/jfb)> <kjv.tsv> <bible.tsv> <out.tsv> <priority> <desc>
  kjv.tsv    a peakslab KJV, for the module's versification
  bible.tsv  a peakslab Bible in English: each book's name ("@Matthew 1:1")
"""
import os, re, sys
from html import escape, unescape
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swordcom

MOD, KJV, BIBLE, OUT, PRIORITY, DESC = sys.argv[1:7]

CODES = ('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro '
	'ecc sol isa jer lam eze dan hos joe amo oba jon mic nah hab zep hag zec mal mat mar '
	'luk joh act rom 1co 2co gal eph phi col 1th 2th 1ti 2ti tit phm heb jam 1pe 2pe 1jo '
	'2jo 3jo jud rev').split()
# OSIS names, then the TSK's and other short forms
OSIS = ('Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job '
	'Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech '
	'Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus '
	'Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev').split()
TSK = ('Ge Ex Le Nu De Jos Jud Ru 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Ne Es Job Ps Pr Ec So Isa Jer '
	'La Eze Da Ho Joe Am Ob Jon Mic Na Hab Zep Hag Zec Mal Mt Mr Lu Joh Ac Ro 1Co 2Co Ga Eph '
	'Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jo 2Jo 3Jo Jude Re').split()
BOOK = {}
for names in (TSK, OSIS, [c.capitalize() for c in CODES]):
	BOOK.update({n.lower(): c for n, c in zip(names, CODES)})
BOOK.update({'psa': 'psa', 'is': 'isa', 'jdg': 'jdg', 'jude': 'jud', 'ezk': 'eze', 'mk': 'mar', 'lk': 'luk', 'jn': 'joh'})
ORDER = {c: i for i, c in enumerate(CODES)}

names = {}
for line in open(BIBLE, encoding='utf-8'):
	m = re.match(r'(\S+) \d+\.\d+\t@(.*?) \d+:\d+\t', line)
	if m:
		names.setdefault(m[1], m[2])

def code(b):
	return b[:2].upper() + b[2:] if b[0].isdigit() else b.capitalize()

def tap(b, c, v=None, rest=''):
	return f'<p-a>{code(b)} {c}' + (f'.{v}' if v else '') + '</p-a>' + (f'–{rest}' if rest else '')

def osisref(r):
	"""'Gen.1.1-Gen.2.3' -> <p-a>Gen 1.1</p-a>–2:3; None if not a Bible book"""
	r = r.split()[0] if r.split() else r
	a, _, z = r.partition('-')
	m = re.match(r'([1-3]?[A-Za-z]+)\.?(\d+)(?:[.:](\d+))?', a.strip())
	if not m or m[1].lower() not in BOOK:
		return None
	b, c, v = BOOK[m[1].lower()], m[2], m[3]
	rest = ''
	n = re.match(r'(?:[1-3]?[A-Za-z]+\.?)?(\d+)(?:[.:](\d+))?$', z.strip())
	if n:
		rest = (n[2] if n[1] == c else f'{n[1]}:{n[2]}') if n[2] else n[1]
	return tap(b, c, v, rest)

def reflist(s, b, c):
	"""The TSK's lists: 'Ps 33:6,9; 148:5; Mt 8:3' or '10,12,18' (this chapter)"""
	out = []
	for part in re.split(r'\s*;\s*', s.strip()):
		m = re.match(r'([1-3]?[A-Za-z]+)\s+(.*)$', part)
		if m and m[1].lower() in BOOK:
			b, part = BOOK[m[1].lower()], m[2]
		if ':' in part:
			c, part = part.split(':', 1)
		vs = []
		for v in part.split(','):
			n = re.match(r'(\d+)(?:-(\d+))?$', v.strip())
			if not n or not c.strip().isdigit():
				vs.append(escape(v, quote=False))
				continue
			vs.append(tap(b, c.strip(), n[1], n[2] or ''))
		out.append(', '.join(vs))
	return '; '.join(out), b, c

def thml(t, b, c):
	"""The TSK: a word of the verse, then its references, a line each"""
	segs = [s.strip() for s in re.split(r'<br\s*/?>|\n', t)]
	out, word, c = [], None, str(c)
	for s in segs:
		s = re.sub(r'<sync[^>]*/>|<See[^>]*>', '', s).strip()
		if not s:
			continue
		m = re.fullmatch(r'<scripRef>(.*?)</scripRef>', s)
		if m:
			refs, _, _ = reflist(unescape(m[1]), b, c)
			if word is not None:
				out.append(f'<p><b>{word}</b> {refs}</p>')
				word = None
			elif out and out[-1].endswith('</p>'):
				out[-1] = out[-1][:-4] + f'; {refs}</p>'
			else:
				out.append(f'<p>{refs}</p>')
			continue
		if word is not None:
			out.append(f'<p>{word}</p>')
		def ref(m):
			p = re.match(r'\s*([1-3]?[A-Za-z]+)\s+(\d+):(\d+)', m[1])
			if p and p[1].lower() in BOOK:
				return tap(BOOK[p[1].lower()], p[2], p[3])
			return escape(unescape(m[2]), quote=False)
		s = re.sub(r'<scripRef passage="([^"]*)">(.*?)</scripRef>', ref, s)
		parts = re.split(r'(<p-a>.*?</p-a>)', s)
		word = ''.join(p if p.startswith('<p-a>') else escape(unescape(re.sub(r"<[^>]+>", "", p)), quote=False) for p in parts).strip()
	if word:
		out.append(f'<p>{word}</p>')
	return ''.join(out)

HI = {'italic': 'i', 'bold': 'b', 'super': 'sup', 'underline': 'u'}

def osis(t):
	"""OSIS to paragraphs: div milestones and titles break them, \x01 between"""
	out = []
	pos = 0
	stack = []
	for m in re.finditer(r'<(/?)(\w+)([^>]*?)(/?)>|([^<]+)', t):
		if m[5] is not None:
			out.append(escape(unescape(m[5]), quote=False))
			continue
		close, tag, attrs, empty = m[1], m[2], m[3], m[4]
		typ = re.search(r'type="([^"]*)"', attrs)
		typ = typ[1] if typ else ''
		if tag in ('div', 'lg', 'row', 'table'):
			out.append('\x01')
		elif tag == 'l':
			out.append('\x01' if close or empty else '')
		elif tag == 'title':
			if close:
				out.append(stack.pop() if stack else '')
			elif not empty:
				# x-ms: the running header; the others a heading
				stack.append('</h4>\x01' if typ != 'x-ms' else '\x02')
				out.append('\x01<h4>' if typ != 'x-ms' else '\x03')
		elif tag == 'hi':
			if close:
				out.append(stack.pop() if stack else '')
			else:
				h = HI.get(typ)
				stack.append(f'</{h}>' if h else '')
				out.append(f'<{h}>' if h else '')
		elif tag == 'reference':
			if close:
				out.append(stack.pop() if stack else '')
			else:
				r = re.search(r'osisRef="([^"]*)"', attrs)
				link = osisref(r[1]) if r else None
				if link:
					out.append(link + '\x04')  # its own text dropped, to \x05
					stack.append('\x05')
				else:
					stack.append('')
		elif tag == 'note':
			if close:
				out.append(stack.pop() if stack else '')
			elif not empty:
				out.append(' [')
				stack.append(']')
		elif tag == 'cell':
			out.append(' ' if not close else '')
	s = ''.join(out)
	s = re.sub(r'\x03.*?\x02', '', s, flags=re.S)
	s = re.sub(r'\x04.*?\x05', '', s, flags=re.S)
	paras = []
	for p in s.split('\x01'):
		p = re.sub(r'\s+', ' ', p).strip()
		p = re.sub(r'<(\w+)>\s*</\1>', '', p).strip()
		if not p:
			continue
		paras.append(p if p.startswith('<h4>') else f'<p>{p}</p>')
	return ''.join(paras)

thml_mod = 'tsk' in MOD.rstrip('/').split('/')[-1]
rows = []
prev, group = None, []
def flush():
	if not group:
		return
	b, c, v, t = group[0]
	lc, lv = group[-1][1], group[-1][2]
	html = thml(t, b, c) if thml_mod else osis(t)
	if html:
		html = html.replace('@', '@@').replace('^', '^^')
		if c == 0:
			rows.append(f'{b}\t@{names[b]}\t{html}')
		elif v == 0:
			rows.append(f'{b} {c}.1\t@{names[b]} {c}\t{html}')
		else:
			show = f'{c}:{v}' + ('' if (lc, lv) == (c, v) else f'–{lv}' if lc == c else f'–{lc}:{lv}')
			rows.append(f'{b} {c}.{v}\t@{names[b]} {show}\t{html}')
	group.clear()
for b, c, v, t, loc in swordcom.entries(MOD, KJV):
	if not t.strip():
		flush(); prev = None
		continue
	if loc != prev or v == 0 or group and group[0][2] == 0:
		flush()
	group.append((b, c, v, t))
	prev = loc
flush()

with open(OUT, 'w', encoding='utf-8') as o:
	o.write(f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\tmono\n#no sort\n#collapsed\n')
	o.writelines(r + '\n' for r in rows)
print(len(rows), 'notes', file=sys.stderr)
