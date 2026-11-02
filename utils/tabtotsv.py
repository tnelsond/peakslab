#!/usr/bin/env python3
"""A dictionary in pyglossary's Tabfile (from an MDX, a StarDict, a DSL, ...:
`pyglossary dict.mdx out.txt --write-format=Tabfile`) into a peakslab .tsv:

  - its alternatives ("casa|casas|...": forms) as words to search, in a
    closed <details> (a verb has dozens)
  - its HTML without its looks: no styles, colors, fonts, classes, spans,
    stylesheets or Kindle index tags; its structure (div, p, b, i, ul, li) kept
  - a link to another entry (entry://, bword://, <a href="word">) a word to tap

Usage: tabtotsv.py <in.txt> <out.tsv> <desc> [priority] [lang]
  priority, lang  the .tsv's #priority (default 1) and #lang (default mono)
"""
import re, sys

IN, OUT, DESC = sys.argv[1:4]
PRIORITY = sys.argv[4] if len(sys.argv) > 4 else '1'
LANG = sys.argv[5] if len(sys.argv) > 5 else 'mono'

def tidy(body):
	body = body.replace('\\n', '\n').replace('\\t', ' ').replace('\\\\', '\\')
	if not re.search(r'<\w', body):  # (plain text: its lines its lines)
		body = body.strip().replace('\n', '<br>')
	body = re.sub(r'\\([^\w\s])', r'\1', body)  # (then a source's own escapes, DSL's: "\/", "\(", "\>")
	body = re.sub(r'<link[^>]*>|</?idx:[^>]*>|<a id="[^"]*"\s*>\s*</a>|<img[^>]*>', '', body)
	# A link to another entry: a word to tap; any other link, its text
	body = re.sub(r'<a [^>]*href="(?:entry|bword)://[^"]*"[^>]*>(.*?)</a>', r'<p-a>\1</p-a>', body, flags=re.S)
	body = re.sub(r'<a [^>]*href="(?!https?:)[^"]*"[^>]*>(.*?)</a>', r'<p-a>\1</p-a>', body, flags=re.S)
	body = re.sub(r'</?(?:span|font)\b[^>]*>', '', body, flags=re.I)
	body = re.sub(r'<(\w+)\s[^>]*?>', lambda m: m[0] if m[1] in ('a', 'audio', 'source') else f'<{m[1]}>', body)
	body = re.sub(r'<p>', '<div>', body).replace('</p>', '</div>')
	body = re.sub(r'<div>\s*</div>|<(b|i)>\s*</\1>', '', body)
	body = re.sub(r'\s*\n\s*', '', body)
	body = re.sub(r'[ \t]{2,}', ' ', body)
	body = re.sub(r'^(<br>\s*)+|\s*(<br>\s*)+$', '', body.strip())
	return body.replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

out, n = [f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\t{LANG}\n'], 0
# A body made of records, each with its own headword (Lingoes' `1`word`2`text,
# or `1`word<P>text`2`): the entries are those records, a word's together
# (a source with one line per sense, or its keys not its records'), a
# homograph's number left off (亶1, 亶2: 亶)
records = {}
def lines():
	for line in open(IN, encoding='utf-8'):
		if line.startswith('##') or '\t' not in line:
			continue
		words, body = line.rstrip('\n').split('\t', 1)
		if '`1`' not in body:
			yield words, body
			continue
		for head, text in re.findall(r'`1`(.*?)(?:<P>|`2`)(.*?)(?:`2`)?(?=(?:\\n)?\s*`1`|$)', body):
			head = re.sub(r'(?<=\D)\d+$', '', head.strip())
			if head and text.strip() and text not in records.setdefault(head, []):
				records[head].append(text)
	for head, texts in records.items():
		yield head, '<br>'.join(texts)
# Keys with the same text one entry: its word the one the text names first
# (기세【氣勢】: 기세), the others its forms (氣勢 finds it)
entries = {}  # tidied body: [[words of a key], ...]
for words, body in lines():
	body = tidy(body)
	if body:
		# (a homograph's number left off: Naver's "사랑 1"; and an accent's, Daijirin's "げちょう ◎")
		entries.setdefault(body, []).append([re.sub(r'\s+(?:\d{1,2}|[◎①-⑳])+$', '', w.replace('\\|', '|').strip()) for w in re.split(r'(?<!\\)\|', words)])
for body, keys in entries.items():
	words = [w for w in dict.fromkeys(w for k in keys for w in k) if w and '\t' not in w]
	if not words:
		continue
	text = re.sub(r'<[^>]*>', '', body)
	word = keys[0][0] if len(keys) == 1 and keys[0][0] in words else min(words, key=lambda w: (text.find(w) < 0, text.find(w)))
	alts = [a for a in words if a != word]
	body = re.sub(rf'^(?:{re.escape(word)}(?:\s*\d{{1,2}})?\s*(?:<br>\s*)+)+', '', body)  # (its word again first, as a heading: Naver's)
	if not body:
		continue
	cells = [word]
	if alts:
		cells.append(f'<details><summary>forms ({len(alts)})</summary>' + '\t'.join('@' + a.replace('@', '@@') for a in alts) + '</details>')
	cells.append(body)
	out.append('\t'.join(cells) + '\n')
	n += 1
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} entries', file=sys.stderr)
