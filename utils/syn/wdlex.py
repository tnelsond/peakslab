#!/usr/bin/env python3
"""Wikidata lexeme senses: their WordNet 3.1 synset (P8814), item (P5137), translations (P5972), synonyms (P5973).

Usage: wdlex.py <latest-lexemes.json.gz> <ili-map-pwn31.tab> <out.pkl>
  sense[id] = (lang code, lemma, pos letter, gloss en, ili or None, item Q or None, [translation sense ids], [synonym sense ids])
"""
import sys, gzip, json, pickle

DUMP, MAP31, OUT = sys.argv[1:4]
ili31 = {}
for line in open(MAP31):
	i, s = line.split()
	ili31[s] = i
CAT = {'Q1084': 'n', 'Q24905': 'v', 'Q34698': 'a', 'Q380057': 'r', 'Q147276': 'n'}

def vals(claims, p):
	out = []
	for c in claims.get(p, []):
		v = c['mainsnak'].get('datavalue', {}).get('value')
		if isinstance(v, dict):
			v = v.get('id')
		if v:
			out.append(v)
	return out

sense = {}
for line in gzip.open(DUMP, 'rt'):
	line = line.strip().rstrip(',')
	if not line.startswith('{'):
		continue
	x = json.loads(line)
	lem = x.get('lemmas', {})
	if not lem:
		continue
	code, l = next(iter(lem.items()))
	pos = CAT.get(x.get('lexicalCategory'), 'x')
	for s in x.get('senses', []):
		c = s.get('claims', {})
		wn = vals(c, 'P8814')
		ili = None
		for v in wn:
			k = v.strip().lower()[-10:]
			ili = ili31.get(k) or ili31.get(k[:-1] + 's') or ili31.get(k[:-1] + 'a')
			if ili:
				break
		item = vals(c, 'P5137')
		tr, sy = vals(c, 'P5972'), vals(c, 'P5973')
		if ili or item or tr or sy:
			sense[s['id']] = (code.split('-')[0], l['value'], pos, s.get('glosses', {}).get('en', {}).get('value', ''),
				ili, item[0] if item else None, tr, sy)
print(len(sense), 'senses;', sum(1 for v in sense.values() if v[4]), 'with a synset;',
	sum(1 for v in sense.values() if v[5]), 'with an item', file=sys.stderr)
pickle.dump(sense, open(OUT, 'wb'), protocol=5)
