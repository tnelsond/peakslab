#!/usr/bin/env python3
"""The universal synsets: one aligned dictionary per language, the same keys in all, so any two on are a
dictionary between them (<lang>/thesaurus/<ab>-synsets.tsv, #lang <ab>,aligned).

Usage: build.py <src.pkl> <links.pkl> <wdlabels.json> <dict_src dir>

A concept is
  an Open English WordNet synset: its words in each language from the Open Multilingual Wordnet, the
    Wiktionary senses and Wikidata items linked to it (link.py), and those items' labels;
    key "first lemma (definition up to a ";", 80 characters)", as en-wn's was
  else a Wikidata item (the senses naming it, none linked): key "English word (its gloss)"
  else a Wiktionary translation table: key "English word (the table's sense)", as the -senses' were
"""
import sys, json, pickle, os, collections
from html import escape

SRC, LINKS, LABELS, OUT = sys.argv[1:5]
d = pickle.load(open(SRC, 'rb'))
syn, omw, wk = d['syn'], d['omw'], d['wk']
links = pickle.load(open(LINKS, 'rb'))
labels = json.load(open(LABELS))

# peakslab's language: (abbreviation, name, its codes in Wiktionary / Wikidata / OMW)
LANGS = {
	'english': ('en', 'English', ['en']), 'khmer': ('km', 'Khmer', ['km']), 'lao': ('lo', 'Lao', ['lo']),
	'thai': ('th', 'Thai', ['th']), 'chinese': ('zh', 'Chinese (Mandarin)', ['zh', 'cmn']),
	'korean': ('ko', 'Korean', ['ko']), 'japanese': ('ja', 'Japanese', ['ja']), 'indonesian': ('id', 'Indonesian', ['id']),
	'nepali': ('ne', 'Nepali', ['ne']), 'german': ('de', 'German', ['de']), 'portuguese': ('pt', 'Portuguese', ['pt']),
	'spanish': ('es', 'Spanish', ['es']), 'ancient-greek': ('grc', 'Ancient Greek', ['grc']),
	'biblical-hebrew': ('hbo', 'Biblical Hebrew', ['hbo']), 'hebrew': ('he', 'Hebrew', ['he']),
	'levantine': ('lb', 'Levantine Arabic', ['apc', 'ajp']), 'chitonga': ('toi', 'Chitonga', ['toi']),
	'lozi': ('loz', 'Lozi', ['loz']), 'amharic': ('am', 'Amharic', ['am']), 'arabic': ('ar', 'Arabic', ['ar']),
	'assamese': ('as', 'Assamese', ['as']), 'bengali': ('bn', 'Bengali', ['bn']), 'burmese': ('my', 'Burmese', ['my']),
	'cebuano': ('ceb', 'Cebuano', ['ceb']), 'french': ('fr', 'French', ['fr']), 'gujarati': ('gu', 'Gujarati', ['gu']),
	'hausa': ('ha', 'Hausa', ['ha']), 'hindi': ('hi', 'Hindi', ['hi']), 'ilocano': ('ilo', 'Ilocano', ['ilo']),
	'kannada': ('kn', 'Kannada', ['kn']), 'malagasy': ('mg', 'Malagasy', ['mg']), 'malayalam': ('ml', 'Malayalam', ['ml']),
	'marathi': ('mr', 'Marathi', ['mr']), 'odia': ('or', 'Odia', ['or']), 'punjabi': ('pa', 'Punjabi', ['pa']),
	'russian': ('ru', 'Russian', ['ru']), 'swahili': ('sw', 'Swahili', ['sw']), 'tagalog': ('tl', 'Tagalog', ['tl']),
	'tamil': ('ta', 'Tamil', ['ta']), 'telugu': ('te', 'Telugu', ['te']), 'urdu': ('ur', 'Urdu', ['ur']),
	'vietnamese': ('vi', 'Vietnamese', ['vi']), 'mentawai': ('mwv', 'Mentawai', ['mwv']),
	'papuan-malay': ('pmy', 'Papuan Malay', ['pmy']),
}
WL = 'https://wordnet.princeton.edu/license-and-commercial-use'
OMWCREDIT = {
	'th': f'Thai WordNet (NICT, <a href="{WL}">WordNet license</a>)',
	'ja': f'Japanese WordNet (NICT, <a href="{WL}">WordNet license</a>)',
	'zh': f'Chinese Open Wordnet (Francis Bond, Shan Wang, <a href="{WL}">WordNet license</a>)',
	'fr': 'WOLF, the French WordNet (<a href="http://www.cecill.info/licenses/Licence_CeCILL-C_V1-en.html">CeCILL-C</a>)',
	'pt': 'OpenWN-PT (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>)',
	'id': 'Wordnet Bahasa (Francis Bond et al., <a href="https://opensource.org/licenses/MIT">MIT</a>)',
	'es': 'the Multilingual Central Repository 3.0\'s Spanish WordNet (<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>)',
	'ar': 'Arabic WordNet (Abouenour, Bouzoubaa, Rosso, <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>)',
	'he': f'Hebrew WordNet (Noam Ordan, Shuly Wintner, <a href="{WL}">WordNet license</a>)',
}
POSNAME = {'n': 'noun', 'v': 'verb', 'a': 'adj', 'r': 'adv'}

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def short(t, n=80):
	t = t.split('; ')[0]
	return t if len(t) <= n else t[:t.rfind(' ', 0, n)].rstrip(',:') + '…'

# Each sense's concept: its synset; else the synset its item's other senses link to most; else its item; else its table
qsyn = collections.defaultdict(collections.Counter)
for i, x in enumerate(wk):
	if links[i][0] and x[4]:
		qsyn[x[4]][links[i][0]] += 1
def concept(i):
	w, p, g, sy, q, tr, label, rom, src = wk[i]
	if links[i][0]:
		return links[i][0]
	if q and q in qsyn:
		return qsyn[q].most_common(1)[0][0]
	if q:
		return 'Q:' + q
	return ('T', w, p, label or short(g))

members = collections.defaultdict(list)
for i in sorted(range(len(wk)), key=lambda i: -(links[i][2][0][1] if links[i][2] else 0)):  # (best-linked first)
	members[concept(i)].append(i)
for s in syn:
	members.setdefault(s, [])

# Keys: a synset's as en-wn's (its synsets in ILI order first, so the same synsets get the same keys), then the rest
taken, key = set(), {}
def order(c):
	if isinstance(c, str) and c in syn:
		i = syn[c][0]
		return (0, int(i[1:]) if i and i[1:].isdigit() else 10 ** 9, c)
	return (1, str(c))
for c in sorted(members, key=order):
	if isinstance(c, str) and c in syn:
		ws, dfn = syn[c][2], syn[c][3] or ''
		tries = [f'{ws[0]} ({short(dfn)})', f'{ws[0]} ({dfn})', f'{ws[0]} ({dfn}) {syn[c][0] or c}']
	else:
		x = wk[members[c][0]]
		t = x[6] or short(x[2])
		tries = [f'{x[0]} ({t})' if t else x[0], f'{x[0]} ({t}) {x[1]}', f'{x[0]} ({t}) {c if isinstance(c, str) else members[c][0]}']
	k = next((k for k in tries if k not in taken), tries[-1] + f' {len(taken)}')
	taken.add(k)
	key[c] = k

def pos(c):
	if isinstance(c, str) and c in syn:
		return POSNAME[syn[c][1]]
	p = collections.Counter(wk[i][1] for i in members[c]).most_common(1)[0][0]
	return POSNAME.get(p, p)

def words(c, codes):
	"""[(word, roman)] in a language, the most sources' first: OMW's, the senses', the items' labels"""
	n, rom = collections.Counter(), {}
	if isinstance(c, str) and c in syn:
		for code in codes:
			for w in omw.get(syn[c][0], {}).get(code, []):
				n[w.replace('_', ' ')] += 1
	qs = []
	for i in members[c]:
		x = wk[i]
		for code in codes:
			for w in x[5].get(code, []):
				n[w] += 1
				rom.setdefault(w, x[7].get((code, w), ''))
		if x[4] and x[4] not in qs:
			qs.append(x[4])
	for q in qs:
		for code in codes:
			l = labels.get(q, {}).get(code)
			if l and len(l) <= 40 and not any(ch in l for ch in '(),:;'):
				n[l] += 1
	return [(w, rom.get(w, '')) for w, _ in n.most_common()]  # (ties: first seen first)


def english(c):
	"""English's words and its text: a synset's lemmas, definition and examples; else the senses' words and glosses"""
	if isinstance(c, str) and c in syn:
		ws = list(syn[c][2])
		ds = [syn[c][3]] if syn[c][3] and f'({syn[c][3]})' not in key[c] else []
		xs = syn[c][4]
	else:
		ws, ds, xs = [], [], []
	for i in members[c]:
		x = wk[i]
		if x[0] not in ws:
			ws.append(x[0])
		if x[2] and x[2] not in ds and f'({x[2]})' not in key[c] and not (isinstance(c, str) and c in syn):
			ds.append(x[2])
	text = ''.join(f'<p>{e(t)}</p>' for t in ds) + (f'<ul>{"".join(f"<li><i>{e(t)}</i></li>" for t in xs if t)}</ul>' if any(xs) else '')
	return ws, text

for l, (ab, name, codes) in LANGS.items():
	rows = []
	for c in members:
		if l == 'english':
			ws, text = english(c)
			cells = ['@' + e(w) for w in ws] + ([text] if text else [])
		else:
			cells = [x for w, r in words(c, codes) for x in ['@' + e(w)] + ([f'<p-ipa>{e(r)}</p-ipa>'] if r else [])]
		if cells:
			rows.append((key[c], f'<p-n>{e(pos(c))}</p-n>\t' + '\t'.join(cells)))
	if not rows:
		continue
	src = ['Open English WordNet 2025 (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)']
	if ab in OMWCREDIT:
		src.append(OMWCREDIT[ab] + ', from the <a href="https://github.com/omwn/omw-data">Open Multilingual Wordnet</a>')
	src += ['English Wiktionary\'s translation tables (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, '
		'from <a href="https://kaikki.org/dictionary/English/">kaikki.org</a>)',
		'Wikidata\'s lexemes and labels (<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>)']
	os.makedirs(f'{OUT}/{l}/thesaurus', exist_ok=True)
	path = f'{OUT}/{l}/thesaurus/{ab}-synsets.tsv'
	with open(path, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{name} words by sense, the same senses in every language\'s, so with another language\'s on, '
			f'a dictionary between them: from {", ".join(src[:-1])} and {src[-1]}. Its headwords: Open English WordNet\'s '
			'word and definition, else Wiktionary\'s English word and sense\n'
			f'#priority\t{-1 if l == "english" else -2}\n#lang\t{ab},aligned\n')
		for k, r in sorted(rows):
			o.write(e(k) + '\t' + r + '\n')
	print(f'{path}: {len(rows)} senses', file=sys.stderr)
