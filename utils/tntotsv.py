#!/usr/bin/env python3
"""Convert a WA-Catalog translationNotes (tN) resource into a peakslab Bible
commentary .tsv: one entry per verse chunk, keyed by its first verse (GEN 1.1)
so it groups with the Bible modules.

Usage: tntotsv.py <tn dir> <bible.tsv> <out.tsv> <desc> [tm repo]
  tn dir     the unzipped resource (<book>/<chapter>/<verse>.md)
  bible.tsv  a peakslab Bible in the same language: gives each book's name
             (from its @<p-n> label) and the last verse of each chapter
  tm repo    translationManual to link [[rc://*/ta/...]] to (default en_tm)
"""
import os, re, sys
from html import escape

TN, BIBLE, OUT, DESC = sys.argv[1:5]
TM = sys.argv[5] if len(sys.argv) > 5 else 'en_tm'

# tN uses USFM book ids; the peakslab Bibles use these
CODE = {'sng': 'SOL', 'ezk': 'EZE', 'jol': 'JOE', 'nam': 'NAH', 'mrk': 'MAR',
	'jhn': 'JOH', 'php': 'PHI', 'jas': 'JAM', '1jn': '1JO', '2jn': '2JO', '3jn': '3JO'}

books, names, lastverse = [], {}, {}
with open(BIBLE, encoding='utf-8') as f:
	for line in f:
		if line.startswith('#'):
			continue
		key, rest = line.split('\t', 1)
		m = re.match(r'(\S+) (\d+)\.(\d+)$', key)
		if not m:
			continue
		code, ch, v = m.group(1), int(m.group(2)), int(m.group(3))
		if code not in names:
			books.append(code)
			lab = re.search(r'<p-n>@?(.*?)\s*\d+:\d+</p-n>', rest)
			names[code] = lab.group(1) if lab else code
		lastverse[code, ch] = max(lastverse.get((code, ch), 0), v)

def link(m):
	path = m.group(1)
	topic = path.rstrip('/').split('/')[-1]
	if '/ta/' in path and topic and topic != 'ta':
		return (f'<a href="https://read.bibleineverylanguage.org/WA-Catalog/{TM}'
			f'?section=translate#{topic}">{topic}</a>')
	return topic

def inline(s):
	s = escape(s, quote=False)
	s = re.sub(r'\[\[rc://([^\]]*)\]\]', link, s)
	s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
	return s.replace('@', '@@').replace('^', '^^')

def md(text):
	"""The little markdown tN uses: # headings, paragraphs, * lists"""
	out, items = [], []
	def flush():
		if items:
			out.append('<ul>' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>')
			items.clear()
	for line in text.splitlines():
		line = line.strip()
		if not line:
			continue
		if line.startswith('#'):
			flush()
			out.append(f'<h4>{inline(line.lstrip("#").strip())}</h4>')
		elif re.match(r'[*-] ', line):
			items.append(inline(line[2:].strip()))
		else:
			flush()
			out.append(f'<p>{inline(line)}</p>')
	flush()
	return ''.join(out)

entries, missing = [], set()
dirs = {CODE.get(d, d.upper()): d for d in os.listdir(TN) if os.path.isdir(os.path.join(TN, d))}
for code in books:
	if code not in dirs:
		missing.add(code)
		continue
	bdir = os.path.join(TN, dirs[code])
	for chd in sorted((d for d in os.listdir(bdir) if d.isdigit()), key=int):
		ch = int(chd)
		files = {int(f[:-3]): f for f in os.listdir(os.path.join(bdir, chd)) if f[:-3].isdigit()}
		vs = sorted(files)
		for i, v in enumerate(vs):
			end = vs[i + 1] - 1 if i + 1 < len(vs) else lastverse.get((code, ch), v)
			with open(os.path.join(bdir, chd, files[v]), encoding='utf-8') as f:
				body = md(f.read())
			if not body:
				continue
			rng = f'{ch}:{v}' + (f'-{end}' if end > v else '')
			entries.append((f'{code} {ch}.{v}', f'<p-n>@{names[code]} {rng}</p-n>{body}'))

with open(OUT, 'w', encoding='utf-8') as out:
	out.write(f'#desc\t{DESC}\n#priority\t3\n#no sort\n')
	for k, b in entries:
		assert '\t' not in b and '\n' not in b, k
		out.write(f'{k}\t{b}\n')
print(f'{len(entries)} entries', file=sys.stderr)
if missing:
	print('no notes for', ' '.join(sorted(missing)), file=sys.stderr)
