#!/usr/bin/env python3
"""The Berean Standard Bible with its Hebrew and Greek words' Strong's numbers,
from Berean's interlinear tables (https://bereanbible.com/bsb_tables.tsv,
public domain), as a PeakSlab Bible text: each of the BSB's words or phrases
that translates a Hebrew or Greek word is <p-w s=H7225>In the beginning</p-w>,
which app.js makes a link to its entry in the lexicons (and Strong's).

The tables are a row for each Hebrew or Greek word, in the BSB's English order,
with the English it's translated by ("-": none; ". . .": said with another
word's; "vvv": the verse's words go on). The text is those, with their punctuation and quotation marks, so it
reads as the BSB does: the interlinear's [brackets] (words the translation
adds) without the brackets, a Psalm's title in its first verse, no headings
or footnotes, a verse that starts a paragraph starting with ¶.

Usage: bsbtablestotsv.py bsb_tables.tsv OUT.tsv [priority]
"""
import csv, re, sys

CODES = ('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sol isa jer lam '
	'eze dan hos joe amo oba jon mic nah hab zep hag zec mal mat mar luk joh act rom 1co 2co gal eph phi col '
	'1th 2th 1ti 2ti tit phm heb jam 1pe 2pe 1jo 2jo 3jo jud rev').split()
IN, OUT = sys.argv[1:3]
PRIORITY = sys.argv[3] if len(sys.argv) > 3 else '0'
DESC = ('Berean Standard Bible (public domain), with Strong’s numbers: tap a word for its Hebrew or Greek. From '
	'Berean’s interlinear tables (<a href="https://bereanbible.com">bereanbible.com</a>)')
H_STR, G_STR, VERSE, PAR, BEGQ, TEXT, PNC, ENDQ, END = 10, 11, 12, 15, 17, 18, 19, 20, 22

plain = lambda s: re.sub(r'<span class=\|reftext\|>.*?</span>|<[^>]*>|[\[\]]', '', s).strip()  # (no html, no verse numbers (a Psalm's), no brackets)

csv.field_size_limit(10 ** 8)
rows = csv.reader(open(IN, encoding='utf-8', errors='replace'), delimiter='\t', quoting=csv.QUOTE_NONE)
next(rows)
out, books = [f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\tmono\n#no sort\n'], []
ref, text = None, ''

def flush():
	if ref:
		out.append(f'{ref}\t{re.sub(r"\s+", " ", text).strip()}\n')

for row in rows:
	if len(row) < 23:
		continue
	if row[VERSE]:  # A verse's first row: "Genesis 1:1"
		flush()
		name, cv = row[VERSE].rsplit(' ', 1)
		if not books or books[-1] != name:
			books.append(name)
		c, v = cv.split(':')
		ref = f'{CODES[len(books) - 1]} {c}.{v}\t@{name} {cv}'
		text = '¶ ' if 'class=|reg|' in row[PAR] else ''
	words = re.sub(r'\s*\{\}|(^|\s)-$|\s*\bvvv\b', '', plain(row[TEXT])).strip()  # ("12,000 {}", "( -", "( vvv")
	if words in ('-', '. . .', 'vvv'):  # (none; said with another word's; a verse's words carried on)
		words = ''
	n = row[H_STR].strip() and 'H' + row[H_STR].strip() or row[G_STR].strip() and 'G' + row[G_STR].strip()
	if words:
		text += ' ' + plain(row[BEGQ]) + (f'<p-w s={n}>{words}</p-w>' if n and n[1:].isdigit() else words)
	text += plain(row[PNC]) + plain(row[ENDQ]) + plain(row[END])
flush()
assert len(books) == 66, len(books)
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {len(out) - 1} verses', file=sys.stderr)
