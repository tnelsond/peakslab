#!/usr/bin/env python3
"""translationStudio / BTT Writer repos (WACS: <lang>_<book>_text_reg, a folder a
chapter, a file a chunk of USFM verses: 03/16.txt "\\v 16 ... \\v 17 ...") as a
Bible TSV: "jhn 3.16<TAB>@<book name> 3:16<TAB><text>", in Bible order.

A book in more than one repo (forks, a team's and its checker's) comes from the
one with the most verses, the newest of those (its last commit). A verse that
starts a paragraph (\\p) starts with ¶, as the other Bibles' TSVs do.

Usage: tstudiotsv.py "DESC" REPO_DIR... > out.tsv
"""
import json, os, re, subprocess, sys

BOOKS = ('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sng isa jer lam ezk dan '
	'hos jol amo oba jon mic nam hab zep hag zec mal mat mrk luk jhn act rom 1co 2co gal eph php col 1th 2th 1ti 2ti '
	'tit phm heb jas 1pe 2pe 1jn 2jn 3jn jud rev').split()
KEY = {'sng': 'sol', 'ezk': 'eze', 'jol': 'joe', 'nam': 'nah', 'mrk': 'mar', 'jhn': 'joh', 'php': 'phi', 'jas': 'jam', '1jn': '1jo', '2jn': '2jo', '3jn': '3jo'}

desc, repos = sys.argv[1], sys.argv[2:]


def read(repo):
	"""(book id, its name, {(chapter, verse): text})"""
	m = json.load(open(f'{repo}/manifest.json', encoding='utf-8'))
	book = m['project']['id']
	name = open(f'{repo}/front/title.txt', encoding='utf-8').read().strip() if os.path.exists(f'{repo}/front/title.txt') else m['project'].get('name', book)
	verses, cur = {}, None
	for ch in sorted(os.listdir(repo)):
		if not ch.isdigit():
			continue
		for f in sorted(os.listdir(f'{repo}/{ch}')):
			if not f[:-4].isdigit():
				continue
			usfm = open(f'{repo}/{ch}/{f}', encoding='utf-8').read()
			usfm = re.sub(r'\\c\s+\d+|[\x00-\x08\x0b-\x1f\x7f]', ' ', usfm)  # (a file's NULs: a crashed save)
			para = False
			for piece in re.split(r'(\\[vV]\s*\d+(?:-\d+)?\s*)', usfm):
				v = re.match(r"\\[vV]\s*(\d+)", piece)
				if v:
					cur = (int(ch), int(v[1]))
					verses[cur] = '¶ ' if para else ''
					para = False
					continue
				if re.search(r'\\p\b', piece) and not piece.split('\\p')[-1].strip():
					para = True
				text = re.sub(r'\\f\b.*?\\f\*', '', piece, flags=re.S)
				text = re.sub(r'\\[a-z]+\d*\*?', ' ', text).replace('\\', '')
				text = re.sub(r'\s+', ' ', text).strip()
				if v is None and text and cur in verses:
					verses[cur] += text + ' '
	verses = {k: t.strip() for k, t in verses.items() if t.strip() not in ('', '¶')}
	when = subprocess.run(['git', '-C', repo, 'log', '-1', '--format=%ct'], capture_output=True, text=True).stdout.strip() or '0'
	return book, name, verses, int(when)


best = {}
for r in repos:
	try:
		book, name, verses, when = read(r)
	except (OSError, KeyError, ValueError) as e:
		print(r, 'skipped:', e, file=sys.stderr)
		continue
	if book not in best or (len(verses), when) > (len(best[book][1]), best[book][2]):
		best[book] = (name, verses, when, r)

print(f'#desc\t{desc}\n#priority\t1\n#lang\tmono\n#no sort')
for book in BOOKS:
	if book not in best:
		continue
	name, verses, _, r = best[book]
	print(book, len(verses), 'verses from', os.path.basename(r), file=sys.stderr)
	for (c, v), t in sorted(verses.items()):
		print(f'{KEY.get(book, book)} {c}.{v}\t@{name} {c}:{v}\t{t}')
