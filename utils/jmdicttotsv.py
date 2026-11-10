#!/usr/bin/env python3
"""JMdict (EDRDG, CC BY-SA 4.0), as jmdict-simplified's JSON (https://github.com/scriptin/jmdict-simplified,
jmdict-eng-*.json.zip), into a peakslab .tsv: each entry's first written form (else its first reading), its readings
(words to search), its other written forms (words to search), and its senses, each with its parts of speech:

  学校	<p-ipa>@がっこう</p-ipa>	<ol><li><p-n>noun</p-n> school</li></ol>

Usage: jmdicttotsv.py <in.json[.zip]> <out.tsv> [priority]
"""
import json, re, sys, zipfile
from html import escape

IN, OUT = sys.argv[1:3]
PRIORITY = sys.argv[3] if len(sys.argv) > 3 else '1'

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')

if IN.endswith('.zip'):
	z = zipfile.ZipFile(IN); data = json.loads(z.read(z.namelist()[0]))
else:
	data = json.load(open(IN, encoding='utf-8'))
tags = data.get('tags', {})
tag = lambda t: re.sub(r' \([a-z]+\)', '', tags.get(t, t))  # ("noun (common) (futsuumeishi)": noun)
out, n = [f'#desc\tJMdict Japanese–English (the <a href="https://www.edrdg.org/">EDRDG</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>): its words by their kanji and kana, from <a href="https://github.com/scriptin/jmdict-simplified">jmdict-simplified</a> {data.get("version", "")} ({data.get("dictDate", "")})\n#priority\t{PRIORITY}\n#lang\tbi\n'], 0
for w in data['words']:
	kanji, kana = [k['text'] for k in w.get('kanji', ())], [k['text'] for k in w.get('kana', ())]
	if not kanji and not kana:
		continue
	head = (kanji or kana)[0]
	senses = []
	for s in w.get('sense', ()):
		gl = '; '.join(g['text'] for g in s.get('gloss', ()) if g.get('lang', 'eng') == 'eng')
		if not gl:
			continue
		pos = ', '.join(tag(p) for p in s.get('partOfSpeech', ()))
		extra = ', '.join(tag(x) for x in s.get('misc', ()) + s.get('field', ()) + s.get('dialect', ()))
		info = ' '.join(e(x) for x in s.get('info', ()))
		senses.append('<li>' + (f'<p-n>{e(pos)}</p-n> ' if pos else '') + (f'<p-tags>{e(extra)}</p-tags> ' if extra else '') + e(gl) + (f' ({info})' if info else '') + '</li>')
	if not senses:
		continue
	cells = [head]
	reads = [r for r in kana if r != head]
	if reads:
		cells.append('<p-ipa>' + '\t'.join('@' + e(r) for r in reads) + '</p-ipa>')
	if kanji[1:]:
		cells.append('<p>' + '\t'.join('@' + e(k) for k in kanji[1:]) + '</p>')
	cells.append('<ol>' + ''.join(senses) + '</ol>')
	out.append('\t'.join(cells) + '\n')
	n += 1
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} entries', file=sys.stderr)
