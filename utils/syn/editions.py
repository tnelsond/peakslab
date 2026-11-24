#!/usr/bin/env python3
"""One Wiktionary edition's sets of words that mean the same thing, for build.py to place on the synsets.

Usage: editions.py <edition code> <its kaikki extract .jsonl.gz> <out.pkl>

A set is
  a translation table: the headword and its translations (one table per sense: its label, else its number; not one
    that says no sense, at the entry's level, in an entry of two or more: its words may be any of them, "after",
    "behind" and "buttock" in one);
  an entry's sense in another language: the word, and its gloss's words (the parts between commas, parentheses out)
    as its evidence only (a gloss is a definition, not the language's word), as the Thai edition's Lao words glossed
    in Thai, the English edition's glossed in English (not a sense that's a form of another word).
Only peakslab's languages' words (langs.py) are kept; a set needs two languages. A language the edition gives a
phrase of in pieces (each word linked: "в воздухе в пространстве", the Chinese edition's Russian) is left out of its
tables: one whose tables repeat a word over PIECES of the time.
Out: one pickle after another, each (part of speech, [(abbreviation, word)] its words, [(abbreviation, word)] its evidence)]
"""
import sys, os, gzip, json, re, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # (langs.py, beside this; -I leaves it off)
from langs import LANGS

ED, PATH, OUT = sys.argv[1:4]
PIECES = .05
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


def tables(e):
	"""{(sense, language): [words]}"""
	t, many = {}, sum(1 for s in e.get('senses', []) if not (s.get('form_of') or 'form-of' in s.get('tags', []))) > 1
	for i, s in [(None, None)] + list(enumerate(e.get('senses', []))):
		for x in (e.get('translations', []) if s is None else s.get('translations', [])):
			k = x.get('sense') or x.get('sense_index') or i
			if k is None and many:
				continue
			t.setdefault((k, x.get('lang_code')), []).append(x.get('word') or '')
	return t

n, rep = {}, {}
for line in gzip.open(PATH, 'rt'):
	for (_, c), ws in tables(json.loads(line)).items():
		n[c] = n.get(c, 0) + 1
		rep[c] = rep.get(c, 0) + (len(ws) != len(set(ws)))
pieces = {c for c in n if rep[c] > PIECES * n[c] and n[c] >= 100}
print(ED, 'in pieces:', sorted(pieces), file=sys.stderr)

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
	tabs = {}
	for (k, c), ws in tables(e).items():
		tab = AB.get(c) if c not in pieces else None
		for w in filter(None, map(clean, (p for x in ws for p in re.split(r'[,/]', x)))) if tab else ():  # (one, or a list)
			tabs.setdefault(k, set()).add((tab, w))
	for items in tabs.values():
		if ab:
			items.add((ab, word))
		if len({a for a, _ in items}) >= 2:
			put((pos, sorted(items), []))
	if ab and ab != ED and ED in AB.values():
		for s in e.get('senses', []):
			if s.get('form_of') or 'form-of' in s.get('tags', []):  # (a form of another word: its gloss is grammar)
				continue
			items = {(ED, p) for g in s.get('glosses', []) for p in gloss(g)}
			if items:
				put((pos, [(ab, word)], sorted(items)))
out.close()
print(ED, sets, 'sets', file=sys.stderr)
