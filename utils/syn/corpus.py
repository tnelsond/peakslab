#!/usr/bin/env python3
"""The synsets and the word-aligned Khmer–English corpus, each teaching the other.

Usage: corpus.py <kmen2 dir> <dict_src dir> <out dir>

1. Tags: an English content word aligned to Khmer that shares senses with it (km-synsets and en-synsets: the same
   headwords) is tagged by those senses; one sense left, a sense-tagged word (translation as the judge, as in
   Diab & Resnik 2002). Each tagged sense's English context words (the sentence's other content lemmas) counted.
Links: the ones both alignments (fwd, rev) make. 
2. Proposals: an English word aligned to a Khmer word they share no sense with, often enough and strongly enough
   (Dice of their links): each of those sentences'
   contexts scored against the English word's senses (naive Bayes on the tags' contexts, the sense's share of the tags
   as its prior); the Khmer word proposed for the sense most of its sentences choose.
3. Narrowed: a word its Khmer shares two or more senses with, the senses scored by its context the same way (each
   sense's share of their tags its prior); tagged by the best if it beats the next by MARGIN (log odds).
Out: tags.tsv (sentence, token, English, Khmer, sense), tags-narrowed.tsv (the same, and its margin), stats.json,
     proposals.tsv (English, POS, Khmer, sense, its share of the sentences, sentences, Dice, example sentence ids).
"""
import sys, os, re, json, math, random, collections

K, SRC, OUT = sys.argv[1:4]
CONTENT = {'NOUN': 'noun', 'PROPN': 'noun', 'VERB': 'verb', 'ADJ': 'adj', 'ADV': 'adv'}
MINPAIR, MINDICE, MAXCTX, MAXTAG, MARGIN = 5, .05, 60, 3000, 2.0

def concepts(path):
	"""{word: {key}}, {key: part of speech}"""
	m, pos = collections.defaultdict(set), {}
	for l in open(path, encoding='utf-8'):
		if l.startswith('#'):
			continue
		k, *c = l.rstrip('\n').split('\t')
		row = '\t'.join(c)
		p = re.match(r'<p-n>([^<]*)</p-n>', row)
		pos[k] = p[1] if p else ''
		for w in re.findall(r'@([^\t<]+)', row):
			m[w.strip().lower().replace('​', '')].add(k)
	return m, pos

KM, _ = concepts(f'{SRC}/khmer/thesaurus/km-synsets.tsv')
EN, POS = concepts(f'{SRC}/english/thesaurus/en-synsets.tsv')

def senses(w, p):
	"""an English lemma's senses in its part of speech (a phrase's or particle's sense in any)"""
	want = CONTENT[p]
	return {k for k in EN.get(w, ()) if POS[k] in (want, '') or POS[k] not in ('noun', 'verb', 'adj', 'adv')}

def lines():
	with open(f'{K}/corpus.en') as fe, open(f'{K}/corpus.km') as fk, open(f'{K}/fwd.align') as fa, open(f'{K}/rev.align') as fr, \
			open(f'{K}/corpus.meta.jsonl') as fm:
		for n, (en, km, al, ar, me) in enumerate(zip(fe, fk, fa, fr, fm)):
			me = json.loads(me)
			E, Km, P = en.split(), km.split(), me[3]
			if len(P) != len(E):
				continue
			links = collections.defaultdict(list)
			for x in set(al.split()) & set(ar.split()):  # (links both directions make: Khmer-English)
				i, j = map(int, x.split('-'))
				if i < len(Km) and j < len(E):
					links[j].append(i)
			yield n, me[1], E, Km, P, links

def khmer(Km, ks):
	"""the Khmer an English word is aligned to: each word, and the run of them joined (ឆ្កែ ព្រៃ → ឆ្កែព្រៃ)"""
	ks = sorted(ks)
	out = [Km[i] for i in ks]
	if len(ks) > 1 and ks == list(range(ks[0], ks[-1] + 1)):
		out.append(''.join(out))
	return out

# Pass 1: tags, their contexts; untagged pairs counted
stats = collections.defaultdict(collections.Counter)
ctx = collections.defaultdict(collections.Counter)  # (English, sense): context lemma counts
ntag = collections.Counter()  # (English, sense): tags
untag = collections.Counter()  # (English, POS, Khmer)
nen, nkm = collections.Counter(), collections.Counter()  # (their links, for Dice)
os.makedirs(OUT, exist_ok=True)
with open(f'{OUT}/tags.tsv', 'w', encoding='utf-8') as tags:
	for n, src, E, Km, P, links in lines():
		c = stats[src]
		cw = [w for w, p in zip(E, P) if p in CONTENT]
		for j, (w, p) in enumerate(zip(E, P)):
			if p not in CONTENT:
				continue
			c['content'] += 1
			es = senses(w, p)
			if not es:
				c['English not in synsets'] += 1
				continue
			if j not in links:
				c['unaligned'] += 1
				continue
			ks = khmer(Km, links[j])
			shared = set().union(*(KM.get(k, set()) for k in ks)) & es
			if not shared:
				c['aligned, no shared sense'] += 1
				k = ks[-1]
				if not re.search('[a-z0-9]', k):
					untag[(w, p, k)] += 1
					nen[(w, p)] += 1
					nkm[k] += 1
				continue
			c['tagged'] += 1
			c['one sense' if len(shared) == 1 else 'narrowed'] += 1
			c['senses before'] += len(es)
			c['senses after'] += len(shared)
			if len(shared) == 1:
				s = next(iter(shared))
				tags.write(f'{n}\t{j}\t{w}\t{"/".join(ks)}\t{s}\n')
				if ntag[(w, s)] < MAXTAG:
					ntag[(w, s)] += 1
					ctx[(w, s)].update(x for x in cw if x != w)
		if n % 500000 == 0:
			print('pass 1', n, file=sys.stderr, flush=True)
json.dump({s: dict(c) for s, c in stats.items()}, open(f'{OUT}/stats.json', 'w'), indent=1)

# Pass 2: the sentences of each pair, often enough, scored against the English word's senses
dice = lambda x: 2 * untag[x] / (nen[x[:2]] + nkm[x[2]])
want = {x for x, c in untag.items() if c >= MINPAIR and dice(x) >= MINDICE}
print(len(want), 'pairs with', MINPAIR, 'or more sentences', file=sys.stderr)
bysense = collections.defaultdict(list)
for (w, s), c in ntag.items():
	bysense[w].append(s)
tot = {k: sum(c.values()) for k, c in ctx.items()}
votes = collections.defaultdict(collections.Counter)
seen, exs = collections.Counter(), collections.defaultdict(list)
def nb(w, s, cw, ss):
	c, t, V = ctx[(w, s)], tot[(w, s)], 50000
	return math.log(ntag[(w, s)] / sum(ntag[(w, x)] for x in ss)) + sum(math.log((c[x] + .1) / (t + .1 * V)) for x in cw if x != w)
random.seed(1)
narrowed = open(f'{OUT}/tags-narrowed.tsv', 'w', encoding='utf-8')
nar = collections.Counter()
for n, src, E, Km, P, links in lines():
	cw = [w for w, p in zip(E, P) if p in CONTENT]
	for j, (w, p) in enumerate(zip(E, P)):
		if p not in CONTENT or j not in links:
			continue
		ks = khmer(Km, links[j])
		shared = set().union(*(KM.get(k, set()) for k in ks)) & senses(w, p)
		if len(shared) > 1:
			ss = [s for s in shared if ntag[(w, s)]]
			nar['narrowed'] += 1
			if len(ss) == len(shared):  # (every one has tags to score it)
				sc = sorted(((nb(w, s, cw, ss), s) for s in ss), reverse=True)
				if sc[0][0] - sc[1][0] >= MARGIN:
					nar['tagged'] += 1
					narrowed.write(f'{n}\t{j}\t{w}\t{"/".join(ks)}\t{sc[0][1]}\t{sc[0][0] - sc[1][0]:.1f}\n')
			continue
		k = ks[-1]
		key = (w, p, k)
		if key not in want:
			continue
		seen[key] += 1
		if seen[key] > MAXCTX and random.random() > MAXCTX / seen[key]:
			continue
		ss = [s for s in bysense.get(w, ()) if s in senses(w, p)]
		if not ss:
			votes[key]['?'] += 1
			continue
		best = ss[0] if len(ss) == 1 else max(ss, key=lambda s: nb(w, s, cw, ss))
		votes[key][best] += 1
		if len(exs[key]) < 3:
			exs[key].append(str(n))
	if n % 500000 == 0:
		print('pass 2', n, file=sys.stderr, flush=True)
with open(f'{OUT}/proposals.tsv', 'w', encoding='utf-8') as o:
	for key, v in sorted(votes.items(), key=lambda x: -sum(x[1].values())):
		s, c = v.most_common(1)[0]
		o.write(f'{key[0]}\t{key[1]}\t{key[2]}\t{s}\t{c / sum(v.values()):.2f}\t{untag[key]}\t{dice(key):.3f}\t{",".join(exs[key])}\n')
narrowed.close()
print('narrowed', dict(nar), file=sys.stderr)
print('done', file=sys.stderr)
