#!/usr/bin/env python3
"""A Kaikki (Wiktextract) dictionary, its JSONL (https://kaikki.org/dictionary/
<Language>/kaikki.org-dictionary-<Language>.jsonl.gz), into a peakslab .tsv:

  casa	<p-ipa>@[ˈka.sa]</p-ipa>	<details><summary>forms (1)</summary>@casas</details>	<p-n>noun</p-n> <ol><li>house ...</li></ol>

  - its pronunciation (IPA, a word to search), as kaikkitidy.py's
  - its forms (inflections) as words to search, in a closed <details>
  - each sense: its tags <p-tags>, gloss, examples (a list), synonyms to tap
  - its etymology (without Wiktionary's "Etymology tree")
  - a sense that is just a form of another word ("plural of casa") left out:
    that word has it as a form

Usage: kaikkijsontotsv.py <in.jsonl[.gz]> <out.tsv> <desc> [priority]
"""
import gzip, json, sys
from html import escape

IN, OUT, DESC = sys.argv[1:4]
PRIORITY = sys.argv[4] if len(sys.argv) > 4 else '1'
SKIP_FORM_TAGS = {'table-tags', 'inflection-template', 'class', 'romanization'}

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def sense(s):
	if s.get('form_of') or 'form-of' in s.get('tags', ()) or not s.get('glosses'):
		return ''
	tags = [t for t in s.get('tags', ()) if t not in ('form-of',)]
	out = (f'<p-tags>{e(", ".join(tags))}</p-tags> ' if tags else '') + e('; '.join(s['glosses']))
	egs = [f'<li><i>{e(x["text"])}</i>' + (f' — {e(tr)}' if (tr := x.get('english') or x.get('translation')) else '') + '</li>'
		for x in s.get('examples', ())[:2] if x.get('text')]
	if egs:
		out += '<ul>' + ''.join(egs) + '</ul>'
	syn = [x['word'] for x in s.get('synonyms', ()) if x.get('word')]
	if syn:
		out += '<p>Synonyms: ' + ', '.join(f'<p-a>{e(w)}</p-a>' for w in dict.fromkeys(syn)) + '</p>'
	return f'<li>{out}</li>'

out, n = [f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\tbi\n'], 0
for line in (gzip.open if IN.endswith('.gz') else open)(IN, 'rt', encoding='utf-8'):
	d = json.loads(line)
	word = d.get('word', '').strip()
	senses = ''.join(sense(s) for s in d.get('senses', ()))
	if not word or '\t' in word or not senses:
		continue
	ipas = list(dict.fromkeys(s['ipa'] for s in d.get('sounds', ()) if s.get('ipa')))
	ipas = [i for i in ipas if i.startswith('[')][:2] or ipas[:1]  # (the phonetic one, as Nepali's, else the phonemic)
	forms = [f['form'].strip() for f in d.get('forms', ())
		if f.get('form') and not SKIP_FORM_TAGS & set(f.get('tags', ())) and f['form'].strip() != word and '\t' not in f['form']]
	forms = list(dict.fromkeys(f for f in forms if f != '-'))
	ety = d.get('etymology_text', '')
	if ety.startswith('Etymology tree'):
		ety = ety.rsplit('\n', 1)[-1] if '\n' in ety else ''
	cells = [word]
	if ipas:
		cells.append('<p-ipa>' + '\t'.join('@' + e(i) for i in ipas) + '</p-ipa>')
	if forms:
		cells.append(f'<details><summary>forms ({len(forms)})</summary>' + '\t'.join('@' + e(f) for f in forms) + '</details>')
	body = f'<p-n>{e(d.get("pos", ""))}</p-n> <ol>{senses}</ol>'
	if ety:
		body += f'<p>Etymology: {e(ety.replace(chr(10), " "))}</p>'
	cells.append(body)
	out.append('\t'.join(cells) + '\n')
	n += 1
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} entries', file=sys.stderr)
