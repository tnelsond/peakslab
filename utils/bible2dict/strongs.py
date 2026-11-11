#!/usr/bin/env python3
"""Khmer Bibles aligned with the Greek and Hebrew: each Khmer word (or phrase)
to the Strong's number of the word it translates.

The corpus: every Khmer Bible's words for a verse (prep.py's khm_*.json),
against the Strong's numbers of that verse in STEPBible's TAGNT and TAHOT
(grc-tagnt.tsv, hbo-tahot.tsv: English versification, like the Khmer Bibles),
aligned with eflomal. All the Khmer Bibles are in it, for its statistics; one
of them (BIBLE) comes out tagged.

Writes:
  BIBLE_OUT.tsv   that Khmer Bible with each aligned word <p-w s=H8064>ផ្ទៃមេឃ</p-w>
                  (a tap: the lexicons' entry), its headings and markup as they were
  LEX_OUT.tsv     each Strong's number (G26, its Greek or Hebrew word another
                  name for it): the Khmer words it's translated by, how often,
                  and verses of BIBLE

Usage: strongs.py WORK_DIR grc-tagnt.tsv hbo-tahot.tsv BIBLE BIBLE.tsv BIBLE_OUT.tsv LEX_OUT.tsv LEXICON.tsv...
  WORK_DIR  prep.py's (khm_<name>.json); BIBLE a name there (khsv)
  LEXICON   grc-tbesg.tsv, hbo-tbesh.tsv: each number's dictionary form and transliteration
Needs: eflomal-align on PATH
"""
import html, json, glob, os, re, subprocess, sys
from collections import Counter, defaultdict

W, TAGNT, TAHOT, BIBLE, BIBLE_TSV, BIBLE_OUT, LEX_OUT = sys.argv[1:8]
LEXICONS = sys.argv[8:]
MAXLEN = 250
ZW = '​'
# Khmer grammar words at a rendering's edges (បានបង្កើត, នៅលើមេឃ, ព្រះនៃ): not the word's meaning
LEAD = {'បាន', 'ដែល', 'នៅ', 'លើ', 'ជា', 'ត្រូវ', 'នឹង', 'កំពុង', 'ក៏', 'ហើយ', 'គឺ', 'ឲ្យ', 'អោយ', 'ពី', 'ក្នុង', 'ដល់', 'ទៅ', 'មក'}
TRAIL = {'នៃ', 'របស់', 'ដែរ', 'ហើយ', 'នោះ', 'នេះ', 'ទាំង', 'ទៅ', 'មក', 'ឡើយ', 'ផង'}

# ------------------------------------------------------------------ the originals
orig = {}   # verse -> [Strong's]
word = {}   # Strong's -> (word, transliteration, English gloss): its commonest
forms = defaultdict(Counter)
for path in (TAGNT, TAHOT):
	for line in open(path, encoding='utf-8'):
		if line.startswith('#'):
			continue
		key, _, body = line.rstrip('\n').split('\t', 2)
		body = re.sub(r'<[^>]+>', '', body)
		ss = []
		for w in body.split(' ¦ '):
			f = w.split('|')
			if len(f) < 4 or not re.match(r'[GH]\d+', f[3]):
				continue
			s = re.match(r'[GH]\d+', f[3])[0]
			ss.append(s)
			forms[s][(re.sub(r'[^\w֐-׿Ͱ-Ͽἀ-῿]', '', f[0]), f[1], f[2].strip('[]‹›.,;:'))] += 1
		orig[key] = ss
for s, c in forms.items():
	word[s] = c.most_common(1)[0][0]
for path in LEXICONS:  # the dictionary form, where a lexicon has it
	for line in open(path, encoding='utf-8'):
		m = re.match(r'([GH]\d+)\t<b>@([^\t<]+)\t</b>(?:<p-ipa>@([^<]*)</p-ipa>)?', line)
		if m and m[1] in word:
			word[m[1]] = (m[2].strip(), (m[3] or word[m[1]][1]).strip(), word[m[1]][2])

# ------------------------------------------------------------------ the corpus
khm = {os.path.basename(p)[4:-5]: json.load(open(p)) for p in sorted(glob.glob(f'{W}/khm_*.json'))}
meta = []
with open(f'{W}/s.km', 'w') as fk, open(f'{W}/s.src', 'w') as fs:
	for name, verses in khm.items():
		for key, toks in verses.items():
			ss = orig.get(key)
			if not ss or not toks or len(toks) > MAXLEN or len(ss) > MAXLEN:
				continue
			fk.write(' '.join(toks) + '\n')
			fs.write(' '.join(ss) + '\n')
			meta.append((name, key))
print(len(meta), 'verse pairs', file=sys.stderr)
subprocess.run(['eflomal-align', '-s', f'{W}/s.km', '-t', f'{W}/s.src', '-f', f'{W}/s.fwd', '-r', f'{W}/s.rev',
	'-m', '3', '--overwrite'], check=True)

# ------------------------------------------------------------------ the links
def links(line):
	return {tuple(map(int, a.split('-'))) for a in line.split()}

def spans(km, ss, fwd, rev):
	"""(first Khmer word, last, Strong's): a word or a run of them for one original word"""
	inter, union = fwd & rev, fwd | rev
	k2s, s2k = defaultdict(set), defaultdict(set)
	for i, j in union:
		k2s[i].add(j); s2k[j].add(i)
	out, used = [], set()
	for j, ks in s2k.items():  # a run of Khmer words for one original word (ផ្ទៃ មេឃ: H8064)
		ks = sorted(ks)
		if 2 <= len(ks) <= 4 and ks == list(range(ks[0], ks[-1] + 1)) and any((i, j) in inter for i in ks) \
				and all(k2s[i] == {j} for i in ks):
			out.append((ks[0], ks[-1], ss[j])); used.update(ks)
	for i, j in sorted(inter):
		if i not in used:
			out.append((i, i, ss[j])); used.add(i)
	return sorted(out)

tagged = {}  # BIBLE's verse -> [(first, last, Strong's)]
pairs = Counter()  # (Khmer, Strong's) over all the Bibles
seen = defaultdict(list)  # (Khmer, Strong's) -> BIBLE's verses
with open(f'{W}/s.km') as fk, open(f'{W}/s.src') as fs, open(f'{W}/s.fwd') as ff, open(f'{W}/s.rev') as fr:
	for (name, key), lk, ls, lf, lr in zip(meta, fk, fs, ff, fr):
		km, ss = lk.split(), ls.split()
		sp = spans(km, ss, links(lf), links(lr))
		for a, b, s in sp:
			ws = km[a:b + 1]
			while len(ws) > 1 and ws[0] in LEAD:
				ws = ws[1:]
			while len(ws) > 1 and ws[-1] in TRAIL:
				ws = ws[:-1]
			k = ''.join(ws)
			pairs[(k, s)] += 1
			if name == BIBLE and len(seen[(k, s)]) < 3 and key not in seen[(k, s)]:
				seen[(k, s)].append(key)
		if name == BIBLE:
			tagged[key] = (km, sp)

# ------------------------------------------------------------------ the tagged Bible
def code(key):
	b, rest = key.split(' ', 1)
	return (b[:2].upper() + b[2:] if b[0].isdigit() else b.capitalize()) + ' ' + rest

def tag_text(text, km, sp):
	"""The verse's text, its words wrapped: found in order in the text (prep.py's
	words are its own, punctuation and digits out), outside tags and headings"""
	want = {}
	for a, b, s in sp:
		want[a] = (b, s)
	out, pos, i = [], 0, 0
	# where each word is: its first letters after the last word's end, outside markup
	locs = []
	skip = [(m.start(), m.end()) for m in re.finditer(r'<(h\d|p-fn)[^>]*>.*?</\1>|<[^>]+>', text, re.S)]
	def free(p):
		return not any(a <= p < b for a, b in skip)
	for w in km:
		p = text.find(w[0], pos)
		while p >= 0 and not free(p):
			p = text.find(w[0], p + 1)
		# the whole word, its letters with zero-width spaces or nothing between
		m = re.compile(f'[{ZW}]?'.join(map(re.escape, w))).match(text, p) if p >= 0 else None
		if not m:
			return None  # (can't place it: the verse untagged)
		locs.append((m.start(), m.end()))
		pos = m.end()
	for a, (b, s) in sorted(want.items()):
		out.append(text[i:locs[a][0]])
		out.append(f'<p-w s={s}>{text[locs[a][0]:locs[b][1]]}</p-w>')
		i = locs[b][1]
	out.append(text[i:])
	return ''.join(out)

n = bad = 0
with open(BIBLE_TSV, encoding='utf-8') as f, open(BIBLE_OUT, 'w', encoding='utf-8') as o:
	for line in f:
		if line.startswith('#'):
			if line.startswith('#desc'):
				line = line.rstrip('\n') + ' Each word tapped: the Greek or Hebrew it translates (machine-aligned with STEPBible’s TAGNT and TAHOT, eflomal).\n'
			o.write(line)
			continue
		parts = line.rstrip('\n').split('\t')
		key = parts[0]
		if key in tagged and len(parts) >= 3:
			km, sp = tagged[key]
			body = '\t'.join(parts[2:])
			t = tag_text(body, km, sp)
			if t is None:
				bad += 1
			else:
				parts[2:] = t.split('\t')
				n += 1
		o.write('\t'.join(parts) + '\n')
print(n, 'verses tagged,', bad, 'left untagged (words not found)', file=sys.stderr)

# ------------------------------------------------------------------ the Khmer lexicon
by_s, tot = defaultdict(list), Counter()
for (k, s), c in pairs.items():
	tot[s] += c
	by_s[s].append((c, k))
rows = []
for s, lst in by_s.items():
	lst.sort(reverse=True)
	keep = [(c, k) for c, k in lst if c >= 3 and c / tot[s] >= 0.05][:8]
	if not keep:
		continue
	w, tr, gl = word.get(s, ('', '', ''))
	items = ''.join(f'<li><p-l><p-a>{html.escape(k, quote=False)}</p-a></p-l> <p-n>{round(100 * c / tot[s])}%'
		+ (' · ' + ', '.join(f'<p-a>{code(v)}</p-a>' for v in seen[(k, s)][:2]) if seen[(k, s)] else '') + '</p-n></li>'
		for c, k in keep)
	head = f'<b>@{w}\t</b> <p-ipa>{html.escape(tr, quote=False)}</p-ipa> <p-n>{html.escape(gl, quote=False)}</p-n>' if w else ''
	rows.append((s[0], int(s[1:]), f'{s}\t{head}<ul>{items}</ul>'))
rows.sort()
with open(LEX_OUT, 'w', encoding='utf-8') as o:
	o.write('#desc\tGreek and Hebrew words in Khmer: each Strong’s number, the Khmer words the Khmer Bibles translate it by '
		f'(machine-aligned with STEPBible’s TAGNT and TAHOT, eflomal: {", ".join(n.upper() for n in khm)}), how often, and verses of the {BIBLE.upper()}. '
		'Unchecked: verify before relying on it.\n#priority\t2\n#lang\tbi\n')
	o.writelines(r[2] + '\n' for r in rows)
print(len(rows), 'Strong’s numbers in Khmer', file=sys.stderr)
