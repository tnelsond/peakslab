#!/usr/bin/env python3
"""A bible.com (YouVersion) Bible as a Bible TSV, "joh 3.16<TAB>@<book> 3:16<TAB><text>",
read a chapter page at a time (its verses' spans: data-usfm="JHN.3.16"). Its
chapters are the KJV's (a TSV with them, for the books and their chapters); a
chapter it hasn't (an NT's OT) is left out. Pages are kept in CACHE, so a run
again only fetches what's missing.

For aligning (utils/bible2dict), not for the site: these aren't free.

Usage: youversiontotsv.py VERSION_ID ABBR CACHE_DIR KJV.tsv "DESC" > out.tsv
  (e.g. 2956 TONGA96: bible.com/bible/2956/JHN.3.TONGA96)
"""
import html, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

VID, ABBR, CACHE, KJV, DESC = sys.argv[1:6]
BOOKS = ('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sng isa jer lam ezk dan '
	'hos jol amo oba jon mic nam hab zep hag zec mal mat mrk luk jhn act rom 1co 2co gal eph php col 1th 2th 1ti 2ti '
	'tit phm heb jas 1pe 2pe 1jn 2jn 3jn jud rev').split()
KEY = {'sng': 'sol', 'ezk': 'eze', 'jol': 'joe', 'nam': 'nah', 'mrk': 'mar', 'jhn': 'joh', 'php': 'phi', 'jas': 'jam', '1jn': '1jo', '2jn': '2jo', '3jn': '3jo'}
OURS = {KEY.get(b, b): b for b in BOOKS}

chapters = {}  # book -> its last chapter
for line in open(KJV, encoding='utf-8'):
	m = re.match(r'(\S+) (\d+)\.', line)
	if m and m[1] in OURS:
		chapters[m[1]] = max(chapters.get(m[1], 0), int(m[2]))
os.makedirs(CACHE, exist_ok=True)


def page(book, c):
	usfm = f'{OURS[book].upper()}.{c}'
	path = f'{CACHE}/{usfm}.html'
	if not os.path.exists(path):
		req = urllib.request.Request(f'https://www.bible.com/bible/{VID}/{usfm}.{ABBR}', headers={'User-Agent': 'Mozilla/5.0'})
		for tries in range(4):
			try:
				body = urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
				break
			except Exception as e:
				if getattr(e, 'code', None) == 404:
					body = ''
					break
				time.sleep(5 * (tries + 1))
		else:
			return book, c, None
		open(path, 'w', encoding='utf-8').write(body)
	return book, c, open(path, encoding='utf-8').read()


def verses(text, book, c):
	"""{verse: text} (a verse in pieces, a span each: joined; a range "JHN.3.16+JHN.3.17": its first)"""
	out = {}
	# (a verse's span is _verse; a cross-reference's note in it has data-usfm spans too)
	for m in re.finditer(r'class="[^"]*_verse"[^>]*data-usfm="([^"]+)"[^>]*>(.*?)(?=<span[^>]*_verse"[^>]*data-usfm=|<div|$)', text, re.S):
		v = re.match(rf'{OURS[book].upper()}\.{c}\.(\d+)', m[1])
		if not v:
			continue
		t = ''.join(re.findall(r'class="[^"]*_content"[^>]*>([^<]*)<', m[2]))
		t = re.sub(r'\s+', ' ', html.unescape(t)).strip()
		if t:
			out[int(v[1])] = (out.get(int(v[1]), '') + ' ' + t).strip()
	return out


name = {}
jobs = [(b, c) for b in chapters for c in range(1, chapters[b] + 1)]
got = {}
with ThreadPoolExecutor(4) as ex:
	for book, c, text in ex.map(lambda x: page(*x), jobs):
		if text is None:
			print('failed', book, c, file=sys.stderr)
			continue
		vs = verses(text, book, c)
		if vs:
			got[(book, c)] = vs
			t = re.search(r'<h1[^>]*>([^<]+)</h1>', text)
			if t and book not in name:
				name[book] = re.sub(r'\s*\d+\s*$', '', html.unescape(t[1])).strip()
print(f'#desc\t{DESC}\n#priority\t5\n#lang\tmono\n#no sort')
n = 0
for book, c in jobs:
	for v, t in sorted(got.get((book, c), {}).items()):
		print(f'{book} {c}.{v}\t@{name.get(book, book)} {c}:{v}\t{t}')
		n += 1
print(VID, ABBR, n, 'verses,', len(got), 'chapters', file=sys.stderr)
