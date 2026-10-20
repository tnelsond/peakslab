#!/usr/bin/env python3
"""Tags a Bible text's words with Strong's numbers by aligning it, verse by
verse, with the Greek NT (grc-tagnt.tsv, from utils/stepbibletotsv.py): each
word the aligner is sure of becomes <p-w s=G3056>word</p-w>, like eng-kjvs.

Words: Khmer puts zero width spaces between a word's parts too (ដំណឹង​ល្អ,
"gospel", is "news" and "good"), so parts go together when the dictionaries
(DICT.tsv: their headwords and @ synonyms) have them as one word, the
longest one first, as translating does.

The aligner is eflomal (pip install eflomal), given the Greek as Strong's
numbers, so a word's forms count as one. A link is kept when eflomal finds
it both ways (Greek to the text and back) and that word and number go
together often enough over the whole NT; or when a word mostly translates a
number its verse's Greek has; and a part of a word next to a tagged part
gets its number when eflomal links it to that number either way. Other
translations in the same language help it learn the words: they're aligned
too, but only TEXT is written. The rest of the words stay untagged.

Usage: alignstrongs.py GREEK.tsv TEXT.tsv OUT.tsv "DESCRIPTION" PRIORITY [OTHER.tsv...] [--words DICT.tsv...]
"""
import os, re, sys, tempfile
from collections import Counter, defaultdict

NT = set('MAT MAR LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO 2JO 3JO JUD REV'.split())
ZWSP = chr(0x200b)
# Khmer letters, signs and digits (not punctuation: ។ ៕ ៖ ៘-៛)
KHMER = ''.join(f'{chr(a)}-{chr(b)}' for a, b in ((0x1780, 0x17d3), (0x17d7, 0x17d7), (0x17dc, 0x17dd), (0x17e0, 0x17e9), (0x19e0, 0x19ff)))
PART = re.compile(f'[{KHMER}A-Za-z]+')
KHMER_WORD = re.compile(f'[{KHMER}]{{2,}}')
SKIP = re.compile(r'<(p-n|h\d)\b', re.I)  # Not the reference or headings
UNTAGGED = {'G3588'}  # The article: most languages have no word for it, so it'd go with whatever's near
LONGEST = 5  # Parts in a word, at most

def bible(path):
	head, verses = [], {}
	for line in open(path, encoding='utf-8'):
		line = line.rstrip('\n')
		if line.startswith('#') and not verses:
			head.append(line)
		elif '\t' in line:
			ref, body = line.split('\t', 1)
			verses[ref] = body
	return head, verses

def lexicon(paths):
	"""The words the dictionaries have (headwords and @ synonyms), without zero width spaces"""
	words = set()
	for p in paths:
		for line in open(p, encoding='utf-8'):
			if line.startswith('#'):
				continue
			hw, _, rest = line.rstrip('\n').partition('\t')
			for w in [hw] + re.findall(r'@([^\t<@]+)', rest):
				w = w.replace(ZWSP, '').strip()
				if KHMER_WORD.fullmatch(w):
					words.add(w)
	return words

def glued(body, a, b):
	"""Parts that end at a and start at b are of one word (only zero width spaces between)"""
	return bool(body[a:b]) and not body[a:b].strip(ZWSP)

def join(body, parts, lex):
	"""Parts that make a word the dictionaries have, as one: the longest first"""
	out, i = [], 0
	while i < len(parts):
		j = i + 1
		for k in range(min(len(parts), i + LONGEST), i + 1, -1):
			if all(glued(body, parts[x][1], parts[x + 1][0]) for x in range(i, k - 1)) and \
					body[parts[i][0]:parts[k - 1][1]].replace(ZWSP, '') in lex:
				j = k
				break
		out.append((parts[i][0], parts[j - 1][1]))
		i = j
	return out

def spans(body, lex):
	"""The words of a verse's text (not in its tags, reference or headings), as (start, end)"""
	out, skip = [], None
	for m in re.finditer(r'<(/?)([\w-]+)[^>]*>|[^<]+', body):
		if m[2]:
			if skip is None and not m[1] and SKIP.match(m[0]):
				skip = m[2]
			elif skip and m[1] and m[2] == skip:
				skip = None
		elif skip is None:
			out += join(body, [(m.start() + w.start(), m.start() + w.end()) for w in PART.finditer(m[0])], lex)
	return out

def strongs(body):
	"""grc-tagnt's verse: its words' Strong's numbers"""
	m = re.search(r'<p-il[^>]*>(.*)</p-il>', body)
	return [w.split('|')[3] for w in m[1].split(' ¦ ')] if m else []

def links(path):
	return [{tuple(map(int, l.split('-'))) for l in line.split()} for line in open(path)]

def load(greek, text, others, lex):
	"""TEXT's NT verses (refs, their words' places ws) and, for every verse
	of it and the others, its Strong's numbers (src), words (trg, without
	zero width spaces) and which words are glued to the next (glue)"""
	_, gv = bible(greek)
	head, tv = bible(text)
	refs = [r for r in tv if r.split()[0] in NT and r in gv]
	ws = [spans(tv[r], lex) for r in refs]
	src, trg, glue = [], [], []
	def add(r, body, w):
		src.append([s for s in strongs(gv[r]) if s])
		trg.append([body[a:b].replace(ZWSP, '') for a, b in w])
		glue.append([glued(body, w[t][1], w[t + 1][0]) for t in range(len(w) - 1)] + [False])
	for r, w in zip(refs, ws):
		add(r, tv[r], w)
	for f in others:  # After TEXT's verses, which keep their places
		_, ov = bible(f)
		for r in ov:
			if r.split()[0] in NT and r in gv:
				add(r, ov[r], spans(ov[r], lex))
	return head, tv, refs, ws, src, trg, glue

def align(src, trg):
	"""eflomal's links, Greek to the text and back: for each verse {(s, t)}
	(empty for a verse without either)"""
	import eflomal
	keep = [i for i in range(len(src)) if src[i] and trg[i]]
	fwd, rev = [set() for _ in src], [set() for _ in src]
	with tempfile.TemporaryDirectory() as tmp:
		f, r = os.path.join(tmp, 'fwd'), os.path.join(tmp, 'rev')
		eflomal.Aligner().align([' '.join(src[i]) for i in keep], [' '.join(trg[i]) for i in keep],
			links_filename_fwd=f, links_filename_rev=r)
		for i, a, b in zip(keep, links(f), links(r)):
			fwd[i], rev[i] = a, b
	return fwd, rev

def choose(src, trg, glue, n, fwd, rev, fill=.1, oneway=.05, grow=.1):
	"""The Strong's number of each word of the first n verses it's sure of: {(verse, word): number}"""
	both = [f & r for f, r in zip(fwd, rev)]
	# How often each word and number go together over the whole NT: linked
	# both ways (pair), either way (upair)
	pair, upair, word = Counter(), Counter(), Counter()
	for i, ls in enumerate(both):
		word.update(trg[i])
		pair.update((src[i][s], trg[i][t]) for s, t in ls)
		upair.update({(src[i][s], trg[i][t]) for s, t in fwd[i] | rev[i]})
	tags = {}
	for i in range(n):
		got = defaultdict(list)
		for s, t in both[i]:
			got[t].append(src[i][s])
		for t, ss in got.items():
			s = max(ss, key=lambda s: pair[s, trg[i][t]])  # A word for two Greek words: the one it goes with more
			c = pair[s, trg[i][t]]
			if s not in UNTAGGED and c >= 2 and c / word[trg[i][t]] >= .1:
				tags[i, t] = s
		# A word the aligner missed, when its verse's Greek has the number it
		# mostly translates (ព្រះបន្ទូល for λόγος)
		for t, k in enumerate(trg[i]):
			if (i, t) in tags:
				continue
			s = max((s for s in src[i] if s not in UNTAGGED), key=lambda s: pair[s, k], default=None)
			if s and pair[s, k] >= 5 and pair[s, k] / word[k] >= fill:
				tags[i, t] = s
		# Linked one way only, to a number the word goes with
		linked = defaultdict(set)
		for s, t in fwd[i] | rev[i]:
			linked[t].add(src[i][s])
		for t, k in enumerate(trg[i]):
			if (i, t) not in tags and linked[t] - UNTAGGED:
				s = max(linked[t] - UNTAGGED, key=lambda s: pair[s, k])
				if pair[s, k] >= 5 and pair[s, k] / word[k] >= oneway:
					tags[i, t] = s
		# The rest of a word: a part glued to a tagged one, linked to its
		# number either way, when that's what it often means (ល្អ in
		# ដំណឹងល្អ, not មាន, "has", in មានជីវិត)
		grew = True
		while grew:
			grew = False
			for t in range(len(trg[i])):
				if (i, t) in tags:
					continue
				for u in (t - 1, t + 1):
					s = tags.get((i, u))
					if 0 <= u < len(trg[i]) and glue[i][min(t, u)] and s in linked[t] and upair[s, trg[i][t]] / word[trg[i][t]] >= grow:
						tags[i, t] = tags[i, u]
						grew = True
						break
	return tags

def write(out, desc, priority, head, tv, refs, ws, tags):
	"""TEXT with its tags: a word's glued parts with one number in one <p-w>"""
	tagged = total = 0
	with open(out, 'w', encoding='utf-8') as o:
		desc_done = False
		for h in head:
			if h.startswith('#desc'):
				o.write(f'#desc\t{desc}\n')
				desc_done = True
			elif h.startswith('#priority'):
				o.write(f'#priority\t{priority}\n')
			else:
				o.write(h + '\n')
		if not desc_done:
			o.write(f'#desc\t{desc}\n')
		for i, r in enumerate(refs):
			body, w = tv[r], ws[i]
			total += len(w)
			runs, t = [], 0
			while t < len(w):
				s, u = tags.get((i, t)), t
				if s:
					tagged += 1
					while u + 1 < len(w) and tags.get((i, u + 1)) == s and glued(body, w[u][1], w[u + 1][0]):
						u += 1
						tagged += 1
					runs.append((w[t][0], w[u][1], s))
				t = u + 1
			for a, b, s in reversed(runs):  # From the end, so the places before stay
				body = f'{body[:a]}<p-w s={s}>{body[a:b]}</p-w>{body[b:]}'
			o.write(f'{r}\t{body}\n')
	return tagged, total

def main():
	args = sys.argv[1:]
	dicts = args[args.index('--words') + 1:] if '--words' in args else []
	greek, text, out, desc, priority, *others = args[:args.index('--words')] if dicts else args
	head, tv, refs, ws, src, trg, glue = load(greek, text, others, lexicon(dicts))
	fwd, rev = align(src, trg)
	tagged, total = write(out, desc, priority, head, tv, refs, ws, choose(src, trg, glue, len(refs), fwd, rev))
	print(f'{len(refs)} verses, {tagged} of {total} words tagged ({tagged / max(total, 1):.0%})', file=sys.stderr)

if __name__ == '__main__':
	main()
