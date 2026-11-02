#!/usr/bin/env python3
"""Two languages' words from English Wiktionary's translation tables (Kaikki's
English JSONL: https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz)
into a peakslab .tsv of one to the other. A table is one sense of an English
word, so its Thai and Khmer words are each other's translations, by sense:

  ถุงอัณฑะ	<p-ipa>thǔng-an-tha</p-ipa>	<p-n>noun</p-n>	@ក្រសោមស្វាស	@ប្លោក	<i>scrotum</i> (sac of skin that protects the testicles)

  - a row for each of the first language's words (its headword), each sense a
    line: its part of speech, the second language's words (words to search),
    the English word and its sense
  - its romanizations (pinyin, ...), the most common first
  - a word in its scripts (Chinese's "詞典 /词典") a headword in each

Usage: kaikkitranslationstotsv.py <English.jsonl[.gz]> <from language> <to language> <out.tsv> <desc> [priority] [lang]
  languages: Kaikki's names (Thai, Lao, Khmer, "Chinese Mandarin": its "Chinese"
  is Cantonese, Hokkien, ... too)
"""
import gzip, json, sys
from collections import Counter
from html import escape

IN, FROM, TO, OUT, DESC = sys.argv[1:6]
PRIORITY = sys.argv[6] if len(sys.argv) > 6 else '1'
LANG = sys.argv[7] if len(sys.argv) > 7 else ''  # (#lang: its languages, "ko,km")

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def uniq(xs):
	return list(dict.fromkeys(xs))

rows = {}  # headword: {'roman': [...], 'senses': [...]}
with (gzip.open if IN.endswith('.gz') else open)(IN, 'rt', encoding='utf-8') as f:
	for line in f:
		if '"translations"' not in line:
			continue
		d = json.loads(line)
		tr = list(d.get('translations', ()))
		for s in d.get('senses', ()):
			tr += s.get('translations', ())
		tables = {}  # sense: (from translations, to words)
		for t in tr:
			l = t.get('lang')
			if l not in (FROM, TO):
				continue
			fr, to = tables.setdefault(t.get('sense') or '', ([], []))
			for w in filter(None, (w.strip() for w in (t.get('word') or '').split('/'))):
				(fr if l == FROM else to).append((w, t.get('roman')) if l == FROM else w)
		for sense, (fr, to) in tables.items():
			if not fr or not to:
				continue
			to = uniq(to)
			for w, roman in fr:
				r = rows.setdefault(w, {'roman': [], 'senses': []})
				if roman:
					r['roman'].append(roman)
				r['senses'].append((d.get('pos') or '', to, d['word'], sense))

with open(OUT, 'w', encoding='utf-8') as out:
	out.write(f'#desc\t{DESC}\n#priority\t{PRIORITY}\n' + (f'#lang\t{LANG}\n' if LANG else ''))
	for hw in sorted(rows):
		r = rows[hw]
		cells = [e(hw)]
		if r['roman']:
			cells.append('<p-ipa>' + e(', '.join(w for w, _ in Counter(r['roman']).most_common())) + '</p-ipa>')  # (its most common first)
		lines = []
		for pos, to, en, sense in uniq((p, tuple(t), en, s) for p, t, en, s in r['senses']):
			lines.append((f'<p-n>{e(pos)}</p-n>\t' if pos else '') + '\t'.join('@' + e(w) for w in to)
				+ f'\t<i>{e(en)}</i>' + (f' ({e(sense)})' if sense else ''))
		cells.append('<br>'.join(lines))
		out.write('\t'.join(cells) + '\n')
print(f'{OUT}: {len(rows)} words', file=sys.stderr)
