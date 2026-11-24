#!/usr/bin/env python3
"""A Bible's words tagged with Strong's numbers, from a table of each word's tag: <p-w s=G3670>ខ្ញុំនឹងប្រាប់គេថា</p-w>.

The table (one line a word, in the verse's order of prep.py's words):
  verse key<TAB>word number<TAB>Strong's or -<TAB>c (content) or g (grammar)<TAB>where from (h hand, j judge, v vote)
A run of words with one number is one tap. GRAMMAR says what grammar words get:
  phrase  the number of the phrase they're in (the default)
  none    nothing (only content words tapped)
so the rule can change without tagging anything again.

Usage: tagwrite.py BIBLE.tsv WORDS.json TAGS.tsv OUT.tsv [phrase|none] [DESC]
  WORDS.json  prep.py's khm_<name>.json: {verse key: [words]}
  DESC        added to the #desc (where the tags are from)
"""
import functools, json, re, sys
from collections import defaultdict

BIBLE, WORDS, TAGS, OUT = sys.argv[1:5]
GRAMMAR = sys.argv[5] if len(sys.argv) > 5 else 'phrase'
DESC = sys.argv[6] if len(sys.argv) > 6 else ''
ZW = '​'
# between a word's letters: what prep.py's words leave out (punctuation, digits, ៗ; a word may run across them)
GAP = '[\\s​0-9០-៩ៗ។៕.,!?;:«»“”"\'()\\-–—]*'
words = json.load(open(WORDS, encoding='utf-8'))
tags = defaultdict(dict)  # verse -> word number -> Strong's
for l in open(TAGS, encoding='utf-8'):
	a = l.rstrip('\n').split('\t')
	if len(a) >= 4 and not l.startswith('#') and a[2] != '-' and (a[3] == 'c' or GRAMMAR == 'phrase'):
		tags[a[0]][int(a[1])] = a[2]


def spans(t):
	"""(first, last, Strong's): runs of adjacent words with one number"""
	out = []
	for j in sorted(t):
		if out and out[-1][1] == j - 1 and out[-1][2] == t[j]:
			out[-1][1] = j
		else:
			out.append([j, j, t[j]])
	return out


@functools.cache
def pattern(w):
	return re.compile(GAP.join(map(re.escape, w)))


def tag_text(text, km, sp):
	"""The verse's text, its words wrapped: found in order (prep.py's words are its own, punctuation and digits
	out), outside markup and headings; None if a word can't be placed"""
	skip = [(m.start(), m.end()) for m in re.finditer(r'<(h\d|p-fn)[^>]*>.*?</\1>|<[^>]+>', text, re.S)]
	locs, pos = [], 0
	for w in km:
		p = text.find(w[0], pos)
		while p >= 0 and any(a <= p < b for a, b in skip):
			p = text.find(w[0], p + 1)
		m = pattern(w).match(text, p) if p >= 0 else None
		if not m:
			return None
		locs.append((m.start(), m.end()))
		pos = m.end()
	out, i = [], 0
	for a, b, s in sp:
		out += [text[i:locs[a][0]], f'<p-w s={s}>{text[locs[a][0]:locs[b][1]]}</p-w>']
		i = locs[b][1]
	return ''.join(out) + text[i:]


n = bad = 0
with open(BIBLE, encoding='utf-8') as f, open(OUT, 'w', encoding='utf-8') as o:
	for line in f:
		if line.startswith('#'):
			if line.startswith('#desc') and DESC:
				line = line.rstrip('\n. ') + '. ' + DESC + '\n'
			elif line.startswith('#priority'):
				line = '#priority\t4\n'
			o.write(line)
			continue
		parts = line.rstrip('\n').split('\t')
		k = parts[0]
		if tags.get(k) and len(parts) >= 3:
			t = tag_text('\t'.join(parts[2:]), [w.replace(ZW, '') for w in words.get(k, [])], spans(tags[k]))
			if t is None:
				bad += 1
			else:
				parts[2:] = t.split('\t')
				n += 1
		o.write('\t'.join(parts) + '\n')
print(n, 'verses tagged,', bad, 'left untagged (words not found)', file=sys.stderr)
