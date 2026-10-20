#!/usr/bin/env python3
"""Tags a Bible text's words with Strong's numbers by aligning it, verse by
verse, with the Greek NT (grc-tagnt.tsv, from utils/stepbibletotsv.py): each
word the aligner is sure of becomes <p-w s=G3056>word</p-w>, like eng-kjvs.

The text's words must be separated (by zero width spaces or spaces, as
eBible's Khmer has them). The aligner is eflomal (pip install eflomal),
given the Greek as Strong's numbers, so a word's forms count as one. A link
is kept when eflomal finds it both ways (Greek to the text and back), and
that word and number go together often enough over the whole NT; the rest
of the words stay untagged. Other translations in the same language (also
with their words separated) help it learn the words: they're aligned too,
but only TEXT is written.

Usage: alignstrongs.py GREEK.tsv TEXT.tsv OUT.tsv "DESCRIPTION" PRIORITY [OTHER.tsv...]
"""
import os, re, sys, tempfile
from collections import Counter, defaultdict

NT = set('MAT MAR LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO 2JO 3JO JUD REV'.split())
# A word: Khmer letters, signs and digits, or Latin letters (not punctuation: ។ ៕ ៖ ៘-៛)
WORD = re.compile('[ក-៓ៗៜ៝០-៩᧠-᧿A-Za-z]+')
SKIP = re.compile(r'<(p-n|h\d)\b', re.I)  # Not the reference or headings
UNTAGGED = {'G3588'}  # The article: most languages have no word for it, so it'd go with whatever's near

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

def spans(body):
	"""The words of a verse's text (not in its tags, reference or headings), as (start, end)"""
	out, skip = [], None
	for m in re.finditer(r'<(/?)([\w-]+)[^>]*>|[^<]+', body):
		if m[2]:
			if skip is None and not m[1] and SKIP.match(m[0]):
				skip = m[2]
			elif skip and m[1] and m[2] == skip:
				skip = None
		elif skip is None:
			out += [(m.start() + w.start(), m.start() + w.end()) for w in WORD.finditer(m[0])]
	return out

def strongs(body):
	"""grc-tagnt's verse: its words' Strong's numbers"""
	m = re.search(r'<p-il[^>]*>(.*)</p-il>', body)
	return [w.split('|')[3] for w in m[1].split(' ¦ ')] if m else []

def links(path):
	return [{tuple(map(int, l.split('-'))) for l in line.split()} for line in open(path)]

def main():
	greek, text, out, desc, priority, *others = sys.argv[1:]
	import eflomal
	_, gv = bible(greek)
	head, tv = bible(text)
	refs = [r for r in tv if r.split()[0] in NT and r in gv]
	src = [[s for s in strongs(gv[r]) if s] for r in refs]
	ws = [spans(tv[r]) for r in refs]
	trg = [[tv[r][a:b] for a, b in w] for r, w in zip(refs, ws)]
	for f in others:  # After TEXT's verses, which keep their places
		_, ov = bible(f)
		for r in ov:
			if r.split()[0] in NT and r in gv:
				src.append([s for s in strongs(gv[r]) if s])
				trg.append([ov[r][a:b] for a, b in spans(ov[r])])
	keep = [i for i in range(len(src)) if src[i] and trg[i]]

	with tempfile.TemporaryDirectory() as tmp:
		fwd, rev = os.path.join(tmp, 'fwd'), os.path.join(tmp, 'rev')
		eflomal.Aligner().align([' '.join(src[i]) for i in keep], [' '.join(trg[i]) for i in keep],
			links_filename_fwd=fwd, links_filename_rev=rev)
		both = [f & r for f, r in zip(links(fwd), links(rev))]

	# How often each word and number go together, over the whole NT
	pair, word = Counter(), Counter()
	for i, ls in zip(keep, both):
		word.update(trg[i])
		pair.update((src[i][s], trg[i][t]) for s, t in ls)
	tags = {}
	for i, ls in zip(keep, both):
		if i >= len(refs):  # Another translation's
			break
		got = defaultdict(list)
		for s, t in ls:
			got[t].append(src[i][s])
		for t, ss in got.items():
			s = max(ss, key=lambda s: pair[s, trg[i][t]])  # A word for two Greek words: the one it goes with more
			n = pair[s, trg[i][t]]
			if s not in UNTAGGED and n >= 2 and n / word[trg[i][t]] >= .1:
				tags[i, t] = s
		# A word the aligner missed, when its verse's Greek has the number it
		# mostly translates (ព្រះបន្ទូល for λόγος)
		for t, k in enumerate(trg[i]):
			if (i, t) in tags:
				continue
			s = max((s for s in src[i] if s not in UNTAGGED), key=lambda s: pair[s, k], default=None)
			if s and pair[s, k] >= 5 and pair[s, k] / word[k] >= .3:
				tags[i, t] = s

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
		index = {r: i for i, r in enumerate(refs)}
		for r in refs:
			body, i = tv[r], index[r]
			total += len(ws[i])
			for t, (a, b) in reversed(list(enumerate(ws[i]))):  # From the end, so the places before stay
				if (i, t) in tags:
					body = f'{body[:a]}<p-w s={tags[i, t]}>{body[a:b]}</p-w>{body[b:]}'
					tagged += 1
			o.write(f'{r}\t{body}\n')
	print(f'{len(refs)} verses, {tagged} of {total} words tagged ({tagged / max(total, 1):.0%})', file=sys.stderr)

if __name__ == '__main__':
	main()
