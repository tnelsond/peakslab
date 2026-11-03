#!/usr/bin/env python3
"""Each language's words by English sense, from English Wiktionary's
translation tables (Kaikki's English JSONL:
https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz),
into a peakslab .tsv for each language: its headwords the senses, the same in
every language's, so two of them on together are a dictionary of one to the
other (the app shows the other dictionaries' entries for a headword found):

  love (strong affection)	<p-n>noun</p-n>	@사랑	<p-ipa>sarang</p-ipa>

  searching 사랑 finds "love (strong affection)", and the Khmer one's entry
  for it comes with it: សេចក្ដីស្រឡាញ់, ស្នេហា

  - a word's romanization (pinyin, ...) after it
  - English's its own words (love)

Usage: kaikkisensestotsv.py <English.jsonl[.gz]> <dict_src dir>
  (into <dict_src>/<language>/wiktionary/<abbreviation>senses.tsv, its languages
  LANGS below)
"""
import gzip, json, sys
from html import escape

IN, SRC = sys.argv[1:3]
# peakslab's language: (its abbreviation, Wiktionary's names for it)
LANGS = {
	'khmer': ('km', 'Khmer'), 'lao': ('lo', 'Lao'), 'thai': ('th', 'Thai'),
	'chinese': ('zh', 'Chinese Mandarin'), 'korean': ('ko', 'Korean'), 'japanese': ('ja', 'Japanese'),
	'indonesian': ('id', 'Indonesian'), 'nepali': ('ne', 'Nepali'), 'english': ('en', 'English'),
	'german': ('de', 'German'), 'portuguese': ('pt', 'Portuguese'), 'spanish': ('es', 'Spanish'),
	'greek': ('el', 'Ancient Greek'), 'hebrew': ('he', 'Hebrew'),
	'levantine': ('lb', 'Levantine Arabic', 'South Levantine Arabic', 'North Levantine Arabic'),
	'chitonga': ('toi', 'Tonga (Zambia)'), 'lozi': ('loz', 'Lozi'),
}
LANG_OF = {n: l for l, (_, *ns) in LANGS.items() for n in ns}

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

rows = {l: {} for l in LANGS}  # language: {headword: {pos: [(word, roman)]}}
with (gzip.open if IN.endswith('.gz') else open)(IN, 'rt', encoding='utf-8') as f:
	for line in f:
		if '"translations"' not in line:
			continue
		d = json.loads(line)
		tr = list(d.get('translations', ()))
		for s in d.get('senses', ()):
			tr += s.get('translations', ())
		pos, en = d.get('pos') or '', d['word']
		senses = set()
		for t in tr:
			l = LANG_OF.get(t.get('lang'))
			if not l:
				continue
			sense = t.get('sense') or ''
			senses.add(sense)
			hw = f'{en} ({sense})' if sense else en
			ws = rows[l].setdefault(hw, {}).setdefault(pos, [])
			for w in filter(None, (w.strip() for w in (t.get('word') or '').split('/'))):
				if not any(w == x for x, _ in ws):
					ws.append((w, t.get('roman') or ''))
		for sense in senses:  # (English's: the word itself)
			rows['english'].setdefault(f'{en} ({sense})' if sense else en, {}).setdefault(pos, [(en, '')])

for l, (ab, *_) in LANGS.items():
	out = f'{SRC}/{l}/wiktionary/{ab}senses.tsv'
	name = LANGS[l][1].replace('Chinese Mandarin', 'Chinese (Mandarin)')
	with open(out, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{name} words by English sense, from English Wiktionary\'s translation tables '
			'(<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>), from '
			'<a href="https://kaikki.org/dictionary/English/">kaikki.org</a>: with another language\'s on, '
			f'a dictionary between them\n#priority\t{-1 if l == "english" else -2}\n#lang\t{ab},aligned\n')
		n = 0
		for hw in sorted(rows[l]):
			lines = [(f'<p-n>{e(pos)}</p-n>\t' if pos else '') + '\t'.join('@' + e(w) + (f'\t<p-ipa>{e(r)}</p-ipa>' if r else '') for w, r in ws)
				for pos, ws in rows[l][hw].items() if ws]
			if lines:
				o.write(e(hw) + '\t' + '<br>'.join(lines) + '\n')
				n += 1
	print(f'{out}: {n} senses', file=sys.stderr)
