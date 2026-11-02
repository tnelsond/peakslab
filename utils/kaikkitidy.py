#!/usr/bin/env python3
"""A Kaikki (Wiktionary) dictionary .tsv, as exported to StarDict-style HTML,
into peakslab's own tags:

  थियो	<p-ipa>@[t̪ʰijo]	<p-r>@thiyo</p-r></p-ipa>	<p-n>verb</p-n> <p-tags>masculine, past</p-tags> was ...

  - its pronunciations (IPA, each a word to search) and its romanization
  - the part of speech <p-n>, the tags <p-tags>, examples <p-eg>, audio kept
  - "Form of" as the word to tap (<p-a>); the "Links:" lists dropped
  - the inflection table's forms (Devanagari) kept as words to search, in a
    closed <details>; its tags (@ne-conj, @ergative, ...) and bare IPA dropped

Usage: kaikkitidy.py <in.tsv> <out.tsv>
"""
import re, sys

IN, OUT = sys.argv[1:3]
IPA = re.compile(r'[ɐ-ʯ̀-ͯʰʱʲʷˀːˑ‿͜͡ᵈʳ]')  # (IPA's letters and marks: not a romanization's)
NATIVE = re.compile(r'[ऀ-ॿ]')

def tidy(body):
	ipas = re.findall(r'<span class="IPA">(.*?)</span>', body)
	body = re.sub(r'<div class="pronunciations">.*?</div>', '', body)
	body = re.sub(r'<div>Links:.*?</div>', '', body)
	# "Form of: हुनु": the gloss's हुनु, a word to tap
	m = re.search(r'<div class="form_of">Form of: (.*?)<br>.*?</div>', body)
	if m:
		body = body.replace(m[0], '')
		body = re.sub(rf'(?<![^\s(])({re.escape(m[1])})(?![^\s),:;])', r'<p-a>\1</p-a>', body, count=1)
	body = re.sub(r'<a href="bword://[^"]*">(.*?)</a>', r'<p-a>\1</p-a>', body)
	body = re.sub(r'<div>(\w[\w ]*:.*?)</div>', r'<p>\1</p>', body)  # (Synonyms:, Related:, Etymology:, ...)
	body = re.sub(r'<div class="pos"><font color="green">(.*?)</font></div>', r'<p-n>\1</p-n> ', body)
	body = re.sub(r'<div class="tags">(.*?)</div>', lambda m: '<p-tags>' + re.sub(r'</?font[^>]*>', '', m[1]) + '</p-tags> ', body)
	body = re.sub(r'<div class="examples">Examples:(?:<br>)?(.*?)</div></div>', lambda m: re.sub(r'<div class="example"[^>]*>(.*?)</div>', r'<p-eg>\1</p-eg>', m[1] + '</div>'), body)
	body = re.sub(r'<div class="antonym">(.*?)</div>', r'<p>\1</p>', body)
	body = re.sub(r'</?font[^>]*>', '', body)
	body = re.sub(r'(<br>\s*)+(?=<p|<ol|<p-eg|$)|(?<=</p>)(\s*<br>)+|(?<=</ol>)(\s*<br>)+', '', body)
	body = re.sub(r'<br>(?=</li>)', '', body).replace('\\n', '<br>')
	return ipas, body.strip().replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

out, n = [], 0
for line in open(IN, encoding='utf-8'):
	if line.startswith('#') or '\t' not in line:
		out.append(line)
		continue
	word, *cols = line.rstrip('\n').split('\t')
	i = next((i for i, c in enumerate(cols) if not c.startswith('@')), len(cols))  # (a body can have tabs)
	alts, body = [c[1:] for c in cols[:i]], ' '.join(cols[i:])
	ipas, body = tidy(body)
	# The romanization: an alternative in Latin letters, not IPA, not a table's
	# tag (they have '-', '.', digits or spaces: "ne-conj", "irregular.")
	romans = [a for a in alts if not NATIVE.search(a) and not IPA.search(a) and re.fullmatch(r'[^\W\d_]+', a)
		and a not in ('ergative', 'instrumental')]
	forms = [a for a in alts if NATIVE.search(a) and a != word]
	head = ''.join(f'@{i}\t' for i in ipas)
	head += ''.join(f'<p-r>@{r}</p-r>' for r in romans[:1])
	cells = [word]
	if head:
		cells.append(f'<p-ipa>{head.rstrip()}</p-ipa>')
	if forms:
		forms = list(dict.fromkeys(forms))  # (closed: a verb has hundreds; still words to search)
		cells.append(f'<details><summary>forms ({len(forms)})</summary>' + '\t'.join(f'@{f}' for f in forms) + '</details>')
	cells.append(body)
	out.append('\t'.join(cells) + '\n')
	n += 1
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} entries', file=sys.stderr)
