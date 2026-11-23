#!/usr/bin/env python3
"""Load the sources of the universal synsets into one pickle.

Usage: load.py <english-wordnet-2025-plus.xml.gz> <omw-1.4 dir> <kaikki english .jsonl.gz> <wdlex.pkl> <out.pkl>

  syn[id]   = (ili, pos, [english lemmas], definition, [examples], [hypernym ids], lexfile)
  idx[(lemma lower, pos)] = [synset ids, commonest sense first]
  omw[ili]  = {lang: [lemmas]}                      30 OMW 1.4 wordnets
  wk        = [(word, pos, gloss, [synonyms], wikidata Q, {lang: [words]}, label, {(lang, word): roman}, 'wikt'|'wd')]
              one per English Wiktionary sense with translations (label: its table's), and per English word
              of a Wikidata item lexemes name (wdlex.py)
"""
import sys, gzip, json, pickle, glob, os, collections
import xml.etree.ElementTree as ET

OEWN, OMW, KAIKKI, WDLEX, OUT = sys.argv[1:6]
POS = {'noun': 'n', 'verb': 'v', 'adj': 'a', 'adv': 'r', 'name': 'n'}


def oewn(path):
	syn, idx, lemma = {}, collections.defaultdict(list), {}
	for _, el in ET.iterparse(gzip.open(path) if path.endswith('.gz') else path):
		if el.tag == 'LexicalEntry':
			lem = el.find('Lemma')
			w, p = lem.get('writtenForm'), lem.get('partOfSpeech')
			p = 'a' if p == 's' else p
			lemma[el.get('id')] = w
			for s in el.findall('Sense'):
				idx[(w.lower(), p)].append(s.get('synset'))
			el.clear()
		elif el.tag == 'Synset':
			d = el.find('Definition')
			hyp = [r.get('target') for r in el.findall('SynsetRelation') if r.get('relType') in ('hypernym', 'instance_hypernym', 'similar')]
			p = el.get('partOfSpeech')
			syn[el.get('id')] = [el.get('ili'), 'a' if p == 's' else p, el.get('members', '').split(), d.text if d is not None else '',
				[x.text for x in el.findall('Example')], hyp, el.get('lexfile')]
			el.clear()
	for k, v in syn.items():
		v[2] = list(dict.fromkeys(lemma[m] for m in v[2] if m in lemma))  # (in its members' order)
	return {k: tuple(v) for k, v in syn.items()}, dict(idx)


def omw(d):
	out = collections.defaultdict(dict)
	for f in sorted(glob.glob(f'{d}/omw-*/omw-*.xml')):
		lang = os.path.basename(f)[4:-4]
		if lang == 'en':
			continue
		lang = {'arb': 'ar', 'cmn': 'zh', 'zsm': 'ms', 'iwn': 'it'}.get(lang, lang)
		ili, lem = {}, {}
		for _, el in ET.iterparse(f):
			if el.tag == 'LexicalEntry':
				w = el.find('Lemma').get('writtenForm')
				for s in el.findall('Sense'):
					lem.setdefault(s.get('synset'), []).append(w)
				el.clear()
			elif el.tag == 'Synset':
				ili[el.get('id')] = el.get('ili')
				el.clear()
		for s, ws in lem.items():
			i = ili.get(s)
			if i:
				l = out[i].setdefault(lang, [])
				l += [w for w in ws if w not in l]
		print(lang, len(lem), file=sys.stderr)
	return dict(out)


def wiktionary(path):
	"""Each sense with translations; an entry's translations no sense took, one per table (its label the gloss)"""
	wk = []
	for line in gzip.open(path, 'rt'):
		e = json.loads(line)
		p = POS.get(e['pos'], e['pos'])  # (n v a r, else Wiktionary's: phrase, suffix, ...)
		groups = [(s, s.get('translations', [])) for s in e.get('senses', [])]
		tables = collections.defaultdict(list)
		for t in e.get('translations', []):
			tables[t.get('sense') or ''].append(t)
		groups += [({'glosses': [k]}, ts) for k, ts in tables.items()]
		for s, ts in groups:
			tr, rom = collections.defaultdict(list), {}
			for t in ts:
				c = t.get('lang_code')
				for w in filter(None, (w.strip() for w in (t.get('word') or '').split('/'))):
					if c and w not in tr[c]:
						tr[c].append(w)
						if t.get('roman'):
							rom[(c, w)] = t['roman']
			if not tr:
				continue
			label = next((t['sense'] for t in ts if t.get('sense')), '')
			wk.append((e['word'], p, '; '.join(s.get('glosses', [])) or label,
				[x['word'] for x in s.get('synonyms', []) if 'word' in x],
				(s.get('wikidata') or [None])[0], dict(tr), label, rom, 'wikt'))
	return wk


def wikidata(path):
	"""A Wikidata item its lexemes' senses name (P5137) with an English one: one per English word of it,
	its other languages' lemmas the translations"""
	words, en = collections.defaultdict(lambda: collections.defaultdict(list)), collections.defaultdict(dict)
	for code, lem, pos, gl, ili, q, tr, sy in pickle.load(open(path, 'rb')).values():
		if q:
			if lem not in words[q][code]:
				words[q][code].append(lem)
			if code == 'en':
				en[q].setdefault((lem, pos), gl)
	return [(w, p, g, [], q, {c: ws for c, ws in words[q].items() if c != 'en'}, g, {}, 'wd')
		for q, ws in en.items() for (w, p), g in ws.items()]


syn, idx = oewn(OEWN)
print('oewn', len(syn), file=sys.stderr)
om = omw(OMW)
wk = wiktionary(KAIKKI)
print('wiktionary senses', len(wk), file=sys.stderr)
wk += wikidata(WDLEX)
print('+ wikidata items', len(wk), file=sys.stderr)
pickle.dump({'syn': syn, 'idx': idx, 'omw': om, 'wk': wk}, open(OUT, 'wb'), protocol=5)
