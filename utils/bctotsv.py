#!/usr/bin/env python3
"""Wycliffe Associates' Bible Commentary (en_bc: <nn-book>/<chapter>.md, and
articles/*.md) into two peakslab .tsv files:
  - the commentary, a Bible note (#collapsed) for each section of a chapter
    ("## 1:1-17"): "mat 1.1<TAB>@Matthew 1:1-17<TAB>its questions"
  - its articles, a dictionary: each by its title ("Messiah (Christ)"), and by
    the names the links to it use. A link ("See: [Messiah (Christ)](../articles/
    messiahchrist.md)") is a word to tap (<p-a>): the popup has its article.

Usage: bctotsv.py <en_bc dir> <bible.tsv> <out.tsv> <articles out.tsv> <desc> <articles desc>
  bible.tsv  a peakslab Bible in the same language: each book's name ("@Matthew 1:1")
"""
import os, re, sys
from html import escape

BC, BIBLE, OUT, AOUT, DESC, ADESC = sys.argv[1:7]

# The book folders' USFM ids ("44-jhn"); the peakslab Bibles' codes
CODE = {'sng': 'sol', 'ezk': 'eze', 'jol': 'joe', 'nam': 'nah', 'mrk': 'mar',
	'jhn': 'joh', 'php': 'phi', 'jas': 'jam', '1jn': '1jo', '2jn': '2jo', '3jn': '3jo'}

names = {}
for line in open(BIBLE, encoding='utf-8'):
	m = re.match(r'(\S+) \d+\.\d+\t@(.*?) \d+:\d+\t', line)
	if m:
		names.setdefault(m[1], m[2])

LINK = re.compile(r'\[([^\]]+)\]\(([^)]*?)([\w-]+)\.md\)')
titles = {}  # article file name -> the names its links give it

def inline(s):
	"""**bold**, *italic*, and links: an article's, a word to tap; others, their text"""
	def link(m):
		text, path, f = m[1].strip(), m[2], m[3]
		if 'articles' not in path:
			return escape(text)
		titles.setdefault(f, set()).add(text)
		return f'<p-a>{escape(text)}</p-a>'
	out, last = [], 0
	for m in LINK.finditer(s):
		out.append(escape(s[last:m.start()]))
		out.append(link(m))
		last = m.end()
	out.append(escape(s[last:]))
	s = ''.join(out)
	s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
	s = re.sub(r'(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])', r'<i>\1</i>', s)
	return s.replace('@', '@@').replace('^', '^^')

def md(lines):
	"""Headings (any level below the section's), paragraphs, * lists, and
	"[1:1, 1:3]" (the verses a question is about) as a label"""
	out, items = [], []
	def flush():
		if items:
			out.append('<ul>' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>')
			items.clear()
	for line in lines:
		line = line.strip()
		if not line:
			continue
		if line.startswith('#'):
			flush()
			out.append(f'<h4>{inline(line.lstrip("#").strip())}</h4>')
		elif re.fullmatch(r'\[[\d:,\s-]+\]', line):
			flush()
			out.append(f'<p-n>{escape(line[1:-1])}</p-n>')
		elif re.match(r'[*-] ', line):
			items.append(inline(line[2:].strip()))
		else:
			flush()
			out.append(f'<p>{inline(line)}</p>')
	flush()
	return ''.join(out)

entries = []
for bdir in sorted(d for d in os.listdir(BC) if re.match(r'\d+-\w+$', d)):
	usfm = bdir.split('-', 1)[1]
	code = CODE.get(usfm, usfm)
	name = names[code]
	for f in sorted((f for f in os.listdir(os.path.join(BC, bdir)) if re.match(r'\d+\.md$', f)), key=lambda f: int(f[:-3])):
		sec, lines = None, []
		def done():
			if sec and (body := md(lines)):
				c, v = re.match(r'(\d+):(\d+)', sec).groups()
				entries.append(f'{code} {c}.{v}\t@{name} {sec}\t{body}\n')
		for line in open(os.path.join(BC, bdir, f), encoding='utf-8'):
			m = re.match(r'##\s+(\d+:\d+(?:\s*[-–]\s*[\d:]+)?)\s*$', line)
			if m:
				done()
				sec, lines = re.sub(r'\s+', '', m[1]), []
			elif sec:
				lines.append(line)
		done()

adir = os.path.join(BC, 'articles')
bodies = []  # (file, title, body): all of them first, for every link's name
for f in sorted(os.listdir(adir)):
	if not f.endswith('.md'):
		continue
	text = open(os.path.join(adir, f), encoding='utf-8').read().splitlines()
	head = next((l for l in text if l.startswith('# ')), None)
	if head:
		bodies.append((f[:-3], head[2:].strip(), md(text[text.index(head) + 1:])))
# A link to a file that isn't there ("ancestordescendant.md", "death.md"): the
# article whose name is in its, or has it ("ancestor.md", "diedeath.md")
for f in set(titles) - {f for f, _, _ in bodies}:
	to = next((g for g, _, _ in bodies if g in f or f in g), None)
	if to:
		titles.setdefault(to, set()).update(titles.pop(f))
articles = []
for f, title, body in bodies:
	# Found by its title, the names the links give it, and each of those
	# without what's in brackets ("Messiah (Christ)": Messiah, Christ)
	alts = {title, *titles.get(f, ())}
	for t in list(alts):
		m = re.match(r'(.*?)\s*\((.*)\)$', t)
		if m:
			alts |= {m[1], *(x.strip() for x in m[2].split(','))}
	alts = sorted(a for a in alts if a and a != title and '\t' not in a)
	articles.append(f'{title}\t' + ''.join(f'@{escape(a).replace("@", "@@")}\t' for a in alts) + f'{body}\n')

open(OUT, 'w', encoding='utf-8').writelines([f'#desc\t{DESC}\n#priority\t3\n#lang\tmono\n#no sort\n#collapsed\n', *entries])
open(AOUT, 'w', encoding='utf-8').writelines([f'#desc\t{ADESC}\n#priority\t3\n#lang\tmono\n', *articles])
missing = sorted(set(titles) - {f for f, _, _ in bodies})
print(f'{len(entries)} sections, {len(articles)} articles' + (f'; links to no article: {" ".join(missing)}' if missing else ''), file=sys.stderr)
