#!/usr/bin/env python3
"""A Beblia Bible (https://github.com/Beblia/Holy-Bible-XML-Format) into a
peakslab Bible .tsv: "gen 1.1<TAB>@Génesis 1:1<TAB>text".

Usage: bebliatotsv.py <bible.xml> <names.tsv> <out.tsv> <desc> [priority]
  names.tsv  a peakslab Bible in the same language: its books, in order, give
             the codes (Beblia numbers them 1-66) and the names ("@Génesis 1:1")
  priority   files.json's (default 3)
"""
import re, sys
import xml.etree.ElementTree as ET

XML, NAMES, OUT, DESC = sys.argv[1:5]
PRIORITY = sys.argv[5] if len(sys.argv) > 5 else '3'

books = []  # [(code, name)], in order
for line in open(NAMES, encoding='utf-8'):
	m = re.match(r'(\S+) \d+\.\d+\t@(.*?) \d+:\d+\t', line)
	if m and (not books or books[-1][0] != m[1]):
		books.append((m[1], m[2]))
assert len(books) == 66, f'{NAMES}: {len(books)} books, not 66'

verses = []  # [(code, name, chapter, verse, text)]
for book in ET.parse(XML).getroot().iter('book'):
	code, name = books[int(book.get('number')) - 1]
	for ch in book.iter('chapter'):
		for v in ch.iter('verse'):
			text = re.sub(r'\s+', ' ', ''.join(v.itertext())).strip()
			if text:
				verses.append((code, name, ch.get('number'), v.get('number'), text))

# A chapter's or a section's first words in capitals, as printed ("EN el
# principio", "Y JEHOVÁ dijo"): each as the Bible writes it elsewhere
# ("fueron", "Jehová"), the first one with a capital
WORD = r'(?:[^\W\d_]+)'
lower = {w for *_, t in verses for w in re.findall(WORD, t) if w.islower()}
def caps(m):
	ws = re.findall(WORD, m[0])
	if not m[0].isupper() or max(map(len, ws)) < 2:
		return m[0]
	out = re.sub(WORD, lambda w: w[0].lower() if w[0].lower() in lower else w[0][0] + w[0][1:].lower(), m[0])
	return out[0].upper() + out[1:]

out = [f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\tmono\n#no sort\n']
for code, name, c, v, text in verses:
	text = re.sub(rf'^(?:{WORD} )*?{WORD}(?= {WORD}*[a-zà-ÿ])', caps, text)
	text = text.replace('@', '@@').replace('^', '^^')  # (peakgen's own marks)
	out.append(f'{code} {c}.{v}\t@{name} {c}:{v}\t{text}\n')
n = len(verses)
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} verses', file=sys.stderr)
