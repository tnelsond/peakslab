#!/usr/bin/env python3
"""One Wiktionary edition's sets of words that mean the same thing, for build.py to place on the synsets.

Usage: editions.py <edition code> <its kaikki extract .jsonl.gz> <out.pkl>

A set is
  a translation table: the headword and its translations (one table per sense label);
  an entry's sense in another language: the word, and its gloss's words (the parts between commas, parentheses out)
    as its evidence only (a gloss is a definition, not the language's word), as the Thai edition's Lao words glossed
    in Thai, the English edition's glossed in English.
Only peakslab's languages' words (langs.py) are kept; a set needs two languages.
Out: one pickle after another, each (part of speech, [(abbreviation, word)] its words, [(abbreviation, word)] its evidence)]
"""
import sys, os, gzip, json, re, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # (langs.py, beside this; -I leaves it off)
from langs import LANGS

ED, PATH, OUT = sys.argv[1:4]
AB = {c: ab for ab, _, cs in LANGS.values() for c in cs}
ED = AB.get(ED, ED)


def clean(w):
	"""a word as a dictionary would have it: no markup, notes or invisible joiners, nothing cut off (a Khmer word can't
	end in a coeng)"""
	w = re.sub(r'\([^)]*\)|[()\u200b\u2060\ufeff]', '', w)
	w = re.sub(r'\s+', ' ', w.strip().lstrip('^*').rstrip('.').strip())
	return '' if not w or w.endswith('្') or len(w) > 60 or any(c in w for c in '[]{}<>|=') else w


def gloss(g):
	g = re.sub(r'\([^)]*\)|\[[^]]*\]', '', g)
	for p in re.split(r'[,;/]', g):
		p = clean(re.sub(r'^to ', '', p.strip()) if ED == 'en' else p)
		if p and len(p.split()) <= 4:
			yield p


out, sets = open(OUT, 'wb'), 0
def put(s):
	global sets
	pickle.dump(s, out, protocol=5)
	sets += 1
for line in gzip.open(PATH, 'rt'):
	e = json.loads(line)
	word, ab, pos = clean(e.get('word', '')), AB.get(e.get('lang_code')), e.get('pos', '')
	if not word:
		continue
	tables = {}
	for i, s in [(None, None)] + list(enumerate(e.get('senses', []))):
		for t in (e.get('translations', []) if s is None else s.get('translations', [])):
			tab = AB.get(t.get('lang_code'))
			for w in filter(None, map(clean, re.split(r'[,/]', t.get('word') or ''))) if tab else ():  # (one, or a list)
				tables.setdefault(t.get('sense') or i, set()).add((tab, w))
	for items in tables.values():
		if ab:
			items.add((ab, word))
		if len({a for a, _ in items}) >= 2:
			put((pos, sorted(items), []))
	if ab and ab != ED and ED in AB.values():
		for s in e.get('senses', []):
			items = {(ED, p) for g in s.get('glosses', []) for p in gloss(g)}
			if items:
				put((pos, [(ab, word)], sorted(items)))
out.close()
print(ED, sets, 'sets', file=sys.stderr)
