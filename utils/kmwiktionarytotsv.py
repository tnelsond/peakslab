#!/usr/bin/env python3
"""Khmer Wiktionary's dump (https://dumps.wikimedia.org/kmwiktionary/latest/
kmwiktionary-latest-pages-articles.xml.bz2) into a peakslab .tsv, every
word's page (Khmer's, and the French, English, ... words it gives in Khmer):

  - its sections: a language's heading <p-n>, the others' in bold (a heading
    with nothing under it left out)
  - its senses a list, their examples under them
  - its bold words (Chuon Nath's ទឹក​កក, ទឹក​ខ្មៅ, ... in ទឹក) words to search
  - its links, and its translations' words, words to tap
  - its translations in a closed <details>; without its references, pictures,
    categories, tables or templates that only draw something

Usage: kmwiktionarytotsv.py <dump.xml[.bz2]> <out.tsv> <desc> [priority]
"""
import bz2, re, sys
from html import escape, unescape
from itertools import takewhile

IN, OUT, DESC = sys.argv[1:4]
PRIORITY = sys.argv[4] if len(sys.argv) > 4 else '2'

LANGS = {'km': 'ខ្មែរ', 'en': 'អង់គ្លេស', 'fr': 'បារាំង', 'ja': 'ជប៉ុន', 'ko': 'កូរ៉េ', 'vi': 'វៀតណាម',
	'th': 'ថៃ', 'zh': 'ចិន', 'cmn': 'ចិន', 'lo': 'ឡាវ', 'ar': 'អារ៉ាប់', 'de': 'អាល្លឺម៉ង់',
	'es': 'អេស្ប៉ាញ', 'ru': 'រុស្ស៊ី', 'pi': 'បាលី', 'sa': 'សំស្ក្រឹត'}
POS = {'noun': 'នាម', '-noun-': 'នាម', 'ន': 'នាម', 'verb': 'កិរិយាសព្ទ', '-verb-': 'កិរិយាសព្ទ',
	'adj': 'គុណនាម', '-adj-': 'គុណនាម', 'adv': 'គុណកិរិយា', '-adv-': 'គុណកិរិយា',
	'pronoun': 'សព្វនាម', 'prep': 'ធ្នាក់', 'conj': 'ឈ្នាប់', 'interj': 'ឧទានសព្ទ', '-etym-': 'និរុត្តិសាស្ត្រ'}
# Templates that are their text: which argument (1, the first after the name)
TEXT = {'l': 2, 'term': 1, 'th-l': 1, 'Khmr': 1, 'Latn': 1, 'Cyrl': 1, 'Hani': 1, 'IPAchar': 1,
	'lang': 2, 'm': 2, 'ja-def': 1, 'w': 1, 'inh': 3, 'der': 3, 'bor': 3, 'cog': 2}
LABELS = {'lb', 'context', 'qualifier', 'q', 'sense', 'i', 'gloss'}  # (their arguments, in brackets)
TRANS = {'t', 't+', 't-', 'tø', 't-check', 't+check'}
DROP_SECTIONS = re.compile(r'ឯកសារ​?យោង|References?$')
TRANS_SECTIONS = re.compile(r'បំណកប្រែ|បំនកប្រែ|បកប្រែ|Translations?$')

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def template(m, title):
	parts = m.group(1).split('|')
	name, pos = parts[0].strip(), [p.strip() for p in parts[1:] if '=' not in p]
	named = dict(p.split('=', 1) for p in parts[1:] if '=' in p)
	if name in TRANS and len(pos) >= 2:  # (in its translations' list: its word to tap)
		return f'[[{pos[1]}]]' + (f' ({named["tr"]})' if named.get('tr') else '')
	if name in LANGS and not pos:
		return LANGS[name]
	if name in POS and not pos:
		return POS[name]
	if name == 'PAGENAME':
		return title
	if name == 'IPA':
		return ' '.join(p for p in pos if p.startswith(('/', '[')))
	if name in LABELS and pos:
		return '(' + ', '.join(p for p in pos if p not in LANGS) + ')'
	if name == 'ux' and len(pos) >= 2:
		return pos[1] + (' — ' + pos[2] if len(pos) > 2 else '')
	if TEXT.get(name) and len(pos) >= TEXT[name]:
		return pos[TEXT[name] - 1]
	return ''

def wikitext(text, title):
	"""Its text without its templates, references, ... (still wikitext's lines)"""
	text = re.sub(r'<!--.*?-->|<ref[^>/]*/>|<ref[^>]*>.*?</ref>|__\w+__', '', text, flags=re.S)
	text = re.sub(r'\{\|.*?\|\}', '', text, flags=re.S)  # (tables)
	for _ in range(5):  # (innermost first)
		text, n = re.subn(r'\{\{([^{}]*)\}\}', lambda m: template(m, title), text)
		if not n:
			break
	return re.sub(r'\[\[(?:[^\]|]*:)[^\]]*\]\]', '', text)  # categories, files, other wikis

def bold(m):
	w = re.sub(r'<[^>]*>|[][]', '', m.group(1)).strip()
	return f'<b>@{w}</b>\t' if w else ''  # (a tab: where its word to search ends)

def inline(s):
	"""A line's text into html: links to tap, its bold words to search"""
	s = re.sub(r'\[\[([^\]|]*)\|([^\]]*)\]\]', r'[[\2]]', s)
	s = re.sub(r'\[https?://\S+ ([^\]]*)\]|\[https?://\S+\]', r'\1', s)
	s = re.sub(r"'''(.*?)'''", bold, e(s))
	s = re.sub(r"''(.*?)''", r'<i>\1</i>', s)
	s = re.sub(r'\[\[([^\]]*)\]\]', lambda m: f'<p-a>{m.group(1)}</p-a>' if m.group(1).strip() else '', s)
	return s.replace("'''", '').strip()

def lines_html(lines):
	"""A section's lines: wikitext's lists (# a sense, #: its example, * ...) and paragraphs"""
	out, lists = [], []
	def close(depth):
		while len(lists) > depth:
			out.append(f'</li></{lists.pop()}>')
	for line in lines:
		m = re.match(r'^([#*:;]+)\s*(.*)', line)
		marks, body = (m.group(1), m.group(2)) if m else ('', line)
		body = inline(body)
		if not body:
			continue
		kinds = ['ol' if c == '#' else 'ul' for c in marks]
		if len(marks) > 1 and marks[-1] in ':*':
			body = f'<i>{body}</i>'  # (a sense's example)
		depth = 0
		while depth < min(len(lists), len(kinds)) and lists[depth] == kinds[depth]:
			depth += 1
		close(depth)
		if depth and depth == len(kinds):  # (the list's next item)
			out.append(f'</li><li>{body}')
		elif not kinds:
			out.append(f'<p>{body}</p>')
		else:
			for k in kinds[depth:]:
				lists.append(k)
				out.append(f'<{k}><li>')
			out.append(body)
	close(0)
	return ''.join(out)

def page(title, text):
	sections = [[1, '', []]]  # [level, heading, lines]: the text before its first heading, then each section
	for line in wikitext(text, title).split('\n'):
		h = re.match(r'^(=+)\s*(.*?)\s*=+\s*$', line)
		if h:
			sections.append([len(h.group(1)), inline(h.group(2)), []])
		elif line.strip():
			sections[-1][2].append(line.rstrip())
	html = [(level, head, lines_html(lines)) for level, head, lines in sections]
	out, skip = [], 0  # (skip: a dropped section's level, its sections under it too)
	for i, (level, head, body) in enumerate(html):
		if skip and level > skip:
			continue
		skip = 0
		if DROP_SECTIONS.search(head):
			skip = level
		elif TRANS_SECTIONS.search(head):
			if body:
				out.append(f'<details><summary>{head}</summary>{body}</details>')
		elif body or any(b for _, _, b in takewhile(lambda x: x[0] > level, html[i + 1:])):
			if head:
				out.append(f'<p-n>{head}</p-n>' if level == 2 else f'<p><b>{head}</b></p>')
			out.append(body)
	body = ''.join(out).replace('\n', ' ')
	return body if re.sub(r'<[^>]*>|\s', '', body) else ''

xml = (bz2.open if IN.endswith('.bz2') else open)(IN, 'rt', encoding='utf-8').read()
rows = []
for title, ns, text in re.findall(r'<page>.*?<title>(.*?)</title>.*?<ns>(\d+)</ns>.*?<text[^>]*>(.*?)</text>', xml, re.S):
	title, text = unescape(title).strip(), unescape(text)
	if ns != '0' or '\t' in title or re.match(r'\s*#(redirect|ប្តូរទីតាំង|បញ្ជូនបន្ត)', text, re.I):
		continue
	body = page(title, text)
	if body:
		rows.append(f'{e(title)}\t{body}\n')
with open(OUT, 'w', encoding='utf-8') as out:
	out.write(f'#desc\t{DESC}\n#priority\t{PRIORITY}\n#lang\tmono\n')
	out.writelines(sorted(rows))
print(f'{OUT}: {len(rows)} words', file=sys.stderr)
