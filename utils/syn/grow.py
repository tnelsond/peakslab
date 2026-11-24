#!/usr/bin/env python3
"""The corpus's proposals (corpus.py) checked by the Khmer–English dictionaries, and what they'd add to km-synsets.

Usage: grow.py <corpus out dir> <dict_src dir> <kmen2 dir> <out.tsv>

A proposal (an English word, its sense, the Khmer word aligned to it) is confirmed when a dictionary gives the
Khmer word an English gloss that's one of the sense's English words: the open ones (kaikki, ANT, SBBIC, phrasal
verbs), else as a check only (Headley, never quoted). Each is a new word or a known word (in km-synsets, in other
senses), and a synonym (the sense has Khmer words already) or a new sense (it has none yet).
An English word with no tagged sense (corpus.py's "?": no Khmer word in any of its senses yet) gets the sense whose
English words the dictionaries give the Khmer word, the most of them (the only one, or the English word's only
sense): so the new senses, the ones the corpus alone can't tell apart.
Vocabulary: the share of the corpus's Khmer words (tokens, then distinct words seen 5+ times) km-synsets has, now and
with the confirmed ones.
Out: <out.tsv> (Khmer, English, POS, sense, kind, confirmed by, share, sentences, Dice), and a summary on stderr.
"""
import sys, os, re, collections, html

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # (langs.py, beside this; -I leaves it off)
from langs import keyed

CORPUS, SRC, K, OUT = sys.argv[1:5]
D = f'{SRC}/khmer/dict'


def rows(path):
	for l in open(path, encoding='utf-8'):
		if l[0] != '#' and '\t' in l:
			yield l.rstrip('\n').split('\t', 1)


def text(h):
	return html.unescape(re.sub(r'<[^>]+>', ' ', h))


def eng(t):
	"""the English words and phrases in a gloss: the parts between , ; / ( ), "to" off a verb"""
	for p in re.split(r'[,;/()\[\]:.]|\bor\b', t.lower()):
		p = re.sub(r'^\s*(to|a|an|the)\s+', '', p).strip()
		if p and re.fullmatch(r"[a-z][a-z' -]*", p) and len(p.split()) <= 4:
			yield p


# The dictionaries' English for each Khmer word
ev = collections.defaultdict(lambda: collections.defaultdict(set))  # Khmer: {English: {dictionary}}
for k, b in rows(f'{D}/km-kaikki.tsv'):
	for li in re.findall(r'<li>(.*?)</li>', b):
		for x in eng(text(li)):
			ev[k][x].add('kaikki')
for k, b in rows(f'{D}/km-ant.tsv'):
	for x in eng(' , '.join(re.findall(r'[A-Za-z][A-Za-z\' ,;-]*', text(b)))):
		ev[k][x].add('ANT')
for e, b in rows(f'{D}/km-sbbic.tsv'):
	for k in re.split(r'[/,;]', text(b)):
		for x in eng(e):
			ev[k.strip()][x].add('SBBIC')
for e, b in rows(f'{D}/km-phrasalverbs.tsv'):
	for k in re.findall(r'@([^\t<]+)', b):
		for x in eng(e):
			ev[k.strip()][x].add('phrasal verbs')
for k, b in rows(f'{D}/km-h97.tsv'):
	for li in re.findall(r'<li>(.*?)(?=<li>|</ul>|$)', b):
		for x in eng(text(li)):
			ev[k][x].add('Headley (check)')
print(len(ev), 'Khmer words with English glosses', file=sys.stderr)


POS = {'NOUN': 'noun', 'PROPN': 'noun', 'VERB': 'verb', 'ADJ': 'adj', 'ADV': 'adv'}
pos_of = {}
def synsets(path):
	words, of = collections.defaultdict(list), collections.defaultdict(set)
	for k, r in keyed(path):
		p = re.match(r'<p-n>([^<]*)</p-n>', r)
		pos_of[k] = p[1] if p else ''
		for w in re.findall(r'@([^\t<]+)', r):
			w = html.unescape(w.strip())
			words[k].append(w)
			of[w.lower()].add(k)
	return words, of


KMW, KMOF = synsets(f'{SRC}/khmer/thesaurus/km-synsets.tsv')
ENW, ENOF = synsets(f'{SRC}/english/thesaurus/en-synsets.tsv')

out, kinds = [], collections.Counter()
for l in open(f'{CORPUS}/proposals.tsv', encoding='utf-8'):
	en, pos, km, s, share, n, dice, _ = l.rstrip('\n').split('\t')
	gl = ev.get(km, {})
	if s == '?':  # (the dictionaries choose: the sense with the most of their English for it)
		cands = [k for k in ENOF.get(en, ()) if pos_of[k] in (POS[pos], '') or pos_of[k] not in POS.values()]
		sc = sorted(((sum(1 for w in ENW[k] if w.lower() in gl), k) for k in cands), reverse=True) + [(0, None)]
		if not sc[0][0] or sc[0][0] == sc[1][0]:
			continue
		s = sc[0][1]
	if s not in ENW:
		continue
	lem = {w.lower() for w in ENW[s]}
	by = sorted({d for x, ds in gl.items() if x in lem for d in ds})
	kind = ('known word, ' if km.lower() in KMOF else 'new word, ') + ('synonym' if KMW.get(s) else 'new sense')
	if s in KMOF.get(km.lower(), ()):
		continue  # (has it now: the synsets grew since)
	open_ = [d for d in by if 'check' not in d]
	conf = 'open' if open_ else ('check' if by else 'none')
	kinds[(kind, conf)] += 1
	out.append((km, en, pos, s, kind, ', '.join(by), share, n, dice, conf))
for (kind, conf), c in sorted(kinds.items()):
	print(f'{kind:22} confirmed by {conf:6} {c:7}', file=sys.stderr)

# Vocabulary
freq = collections.Counter()
for line in open(f'{K}/corpus.km', encoding='utf-8'):
	freq.update(w for w in line.split() if re.search('[ក-៿]', w))
tot = sum(freq.values())
have = set(KMOF)
add = {o[0].lower() for o in out if o[9] != 'none'}
for name, H in (('km-synsets now', have), ('with confirmed', have | add)):
	tok = sum(c for w, c in freq.items() if w.lower() in H)
	common = [w for w, c in freq.items() if c >= 5]
	print(f'{name:16} Khmer tokens {tok / tot:.1%}; words seen 5+ times {sum(1 for w in common if w.lower() in H) / len(common):.1%} '
		f'of {len(common)}', file=sys.stderr)
with open(OUT, 'w', encoding='utf-8') as o:
	for x in sorted(out, key=lambda x: (x[9] == 'none', x[9] == 'check', -int(x[7]))):
		o.write('\t'.join(x[:9]) + '\n')
