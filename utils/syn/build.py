#!/usr/bin/env python3
"""The universal synsets: one aligned dictionary per language, the same keys in all, so any two on are a
dictionary between them (<lang>/thesaurus/<ab>-synsets.tsv, #lang <ab>,aligned).

Usage: build.py <src.pkl> <links.pkl> <wdlabels.json> <dict_src dir> [<edition sets .pkl> ...]

A concept is
  an Open English WordNet synset: its words in each language from the Open Multilingual Wordnet, the
    Wiktionary senses and Wikidata items linked to it (link.py), and those items' labels;
    key "first lemma (definition up to a ";", 80 characters)", as en-wn's was
  else a Wikidata item (the senses naming it, none linked): key "English word (its gloss)"
  else a Wiktionary translation table: key "English word (the table's sense)", as the -senses' were
Then the other Wiktionary editions' sets of words (editions.py; in the order given, each placed with the words the
ones before placed): each of a set's languages votes for the concepts holding the most of its words there; the top
concept, needing MINV votes and to beat the next by GAP (in a set of fewer languages: all but one language's, and all
its votes), takes the set's words it lacks (not English's: WordNet's and English Wiktionary's words are English's,
and another edition's English is a translation, often of a word's other meanings; not its evidence: a gloss's words; nor a word in a script its language's
words are under 5% of, as a romanization). A gloss is evidence only if every part of it is its language's word. A sense of a Lao word glossed by one Thai word is placed by that word, if
it has one concept.
"""
import sys, json, pickle, os, collections, unicodedata
from html import escape

SRC, LINKS, LABELS, OUT = sys.argv[1:5]
EDS = sys.argv[5:]
MINV, GAP = 3, 2
d = pickle.load(open(SRC, 'rb'))
syn, omw, wk = d['syn'], d['omw'], d['wk']
links = pickle.load(open(LINKS, 'rb'))
labels = json.load(open(LABELS))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # (langs.py, beside this; -I leaves it off)
from langs import LANGS, WIKTIONARIES

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

# The concepts of each word in each language (by number: a word's tuple of them), then the editions' sets placed
cs = list(members)
cix = {c: i for i, c in enumerate(cs)}
mem, scripts = {}, {}
def script(w):
	ch = next((ch for ch in w if ch.isalpha()), '')
	return unicodedata.name(ch, '?').split()[0] if ch else '?'
for l, (ab, name, codes) in LANGS.items():
	m, n = collections.defaultdict(list), collections.Counter()
	for i, c in enumerate(cs):
		for w in (english(c)[0] if l == 'english' else (w for w, _ in words(c, codes))):
			m[w.lower()].append(i)
			n[script(w)] += 1
	mem[ab] = {w: tuple(dict.fromkeys(v)) for w, v in m.items()}
	scripts[ab] = {s for s, k in n.items() if k >= .05 * sum(n.values())}
del m
print('concepts\' words in', len(mem), 'languages', file=sys.stderr)
POSN = {'noun': 'noun', 'name': 'noun', 'verb': 'verb', 'adj': 'adj', 'adv': 'adv'}
cpos = [pos(c) for c in cs]

def place(items, p):
	by = collections.defaultdict(set)
	for ab, w in items:
		by[ab].add(w.lower())
	fits = lambda i: not p or cpos[i] not in POSN.values() or cpos[i] == p
	v = collections.Counter()
	for ab, ws in by.items():
		n = collections.Counter(i for w in ws for i in mem[ab].get(w, ()) if fits(i))
		if n:
			top = max(n.values())
			v.update(i for i, k in n.items() if k == top)
	need = min(MINV, len(by) - 1)
	t = v.most_common(2) + [(None, 0)]
	if need < 1 or t[0][1] < need or t[0][1] - t[1][1] < min(GAP, t[0][1]):
		return None
	return t[0][0]

def stream(path):
	"""editions.py's sets, one at a time"""
	with open(path, 'rb') as f:
		while True:
			try:
				yield pickle.load(f)
			except EOFError:
				return

added = {ab: collections.defaultdict(collections.Counter) for ab in mem}
used = []
for path in EDS:
	ed = os.path.basename(path).split('.')[0].split('-')[0]  # (en-Lao.pkl: the English edition's Lao entries)
	new, sets, placed, loo = [], 0, 0, [0, 0]
	for p, items, evidence in stream(path):
		sets += 1
		if not all(w.lower() in mem[ab] for ab, w in evidence):  # (a gloss all words, not a definition or a form's note)
			continue
		p = POSN.get(p)
		k = place(items + evidence, p)
		if k is None:
			continue
		placed += 1
		for ab, w in items:
			if ab == 'en':  # (votes, adds nothing)
				continue
			if k not in mem[ab].get(w.lower(), ()):
				if script(w) in scripts[ab]:
					new.append((ab, w, k))
			elif len(mem[ab][w.lower()]) > 1 and len(items + evidence) > 2:  # (leave one out: still chosen without it?)
				loo[1] += 1
				loo[0] += place([x for x in items + evidence if x != (ab, w)], p) == k
	for ab, w, k in new:
		added[ab][k][w] += 1
		mem[ab][w.lower()] = mem[ab].get(w.lower(), ()) + (k,)
	n = collections.Counter(ab for ab, _, _ in new)
	print(f'{ed}: {sets} sets, {placed} placed, leave-one-out {loo[0]}/{loo[1]} = {loo[0] / max(loo[1], 1):.2f}; '
		f'{len(new)} words added: ' + ' '.join(f'{a}:{c}' for a, c in n.most_common(12)), file=sys.stderr, flush=True)
	if ed not in used:
		used.append(ed)
del mem

for l, (ab, name, codes) in LANGS.items():
	rows = []
	for i, c in enumerate(cs):
		ws = [(w, '') for w in english(c)[0]] if l == 'english' else words(c, codes)
		have = {w.lower() for w, _ in ws}
		ws += [(w, '') for w, _ in added[ab].get(i, collections.Counter()).most_common() if w.lower() not in have and not have.add(w.lower())]
		if l == 'english':
			text = english(c)[1]
			cells = ['@' + e(w) for w, _ in ws] + ([text] if text else [])
		else:
			cells = [x for w, r in ws for x in ['@' + e(w)] + ([f'<p-ipa>{e(r)}</p-ipa>'] if r else [])]
		if cells:
			rows.append((key[c], f'<p-n>{e(pos(c))}</p-n>\t' + '\t'.join(cells)))
	if not rows:
		continue
	src = ['Open English WordNet 2025 (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)']
	if ab in OMWCREDIT:
		src.append(OMWCREDIT[ab] + ', from the <a href="https://github.com/omwn/omw-data">Open Multilingual Wordnet</a>')
	src += ['English Wiktionary\'s translation tables (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, '
		'from <a href="https://kaikki.org/dictionary/English/">kaikki.org</a>)']
	if used:
		names = [WIKTIONARIES.get(x, x) for x in used]
		src.append(f'the {", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]} Wiktionaries\' '
			'translation tables and entries (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, '
			'from <a href="https://kaikki.org/dictionary/rawdata.html">kaikki.org</a>)')
	src += [
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
