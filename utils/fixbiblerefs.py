#!/usr/bin/env python3
"""Bible references in peakslab .tsv files as links of the form <p-a>Rom 4.8</p-a>
(the Bible modules' book code, chapter.verse, or just the chapter) so a click
finds the verse. Ranges keep only the first verse inside the link:
<p-a>Mat 7.24</p-a>-25.
  - <p-a> links already there: normalised ("<p-a>Romans 4:8</p-a>")
  - English references in the text: "John 6:56; 15:4, 6", "Gen 1:3-5", and
    a verse alone ("see 1:5") in an entry keyed by its verse ("gen 2.4"): that book's
  - markdown links to a verse's file (translationNotes': "[Genesis 1:5](../01/05.md)")
Not inside a tag, a link, a label (<p-n>) or an entry's headword or reference ("@John 3:16").

Usage: fixbiblerefs.py file.tsv ...   (rewrites in place)
"""
import re, sys

CODES = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO '
	'ECC SOL ISA JER LAM EZE DAN HOS JOE AMO OBA JON MIC NAH HAB ZEP HAG ZEC MAL MAT MAR '
	'LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO '
	'2JO 3JO JUD REV').split()
NAMES = ('Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth 1Samuel 2Samuel '
	'1Kings 2Kings 1Chronicles 2Chronicles Ezra Nehemiah Esther Job Psalms Proverbs '
	'Ecclesiastes SongofSolomon Isaiah Jeremiah Lamentations Ezekiel Daniel Hosea Joel Amos '
	'Obadiah Jonah Micah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi Matthew Mark Luke '
	'John Acts Romans 1Corinthians 2Corinthians Galatians Ephesians Philippians Colossians '
	'1Thessalonians 2Thessalonians 1Timothy 2Timothy Titus Philemon Hebrews James 1Peter '
	'2Peter 1John 2John 3John Jude Revelation').split()
BOOK = {c: c for c in CODES}
BOOK.update({n.upper(): c for n, c in zip(NAMES, CODES)})
BOOK.update({'PSALM': 'PSA', 'SONGOFSONGS': 'SOL', 'SNG': 'SOL', 'EZK': 'EZE', 'JOL': 'JOE',
	'NAM': 'NAH', 'MRK': 'MAR', 'JHN': 'JOH', 'PHP': 'PHI', 'JAS': 'JAM', '1JN': '1JO',
	'2JN': '2JO', '3JN': '3JO'})

REF = re.compile(r'<p-a>\s*([1-3]?\s?[A-Za-z]+(?: of [A-Za-z]+)?)\.?\s+(\d+)(?:[:.](\d+))?([^<]*)</p-a>')

def fix(m):
	code = BOOK.get(re.sub(r'\s', '', m.group(1)).upper())
	if not code:
		return m.group(0)
	rest = m.group(4).strip().replace(':', '.')
	i = 2 if code[0].isdigit() else 1  # 1CH -> 1Ch, MAT -> Mat
	cv = f'{m.group(2)}.{m.group(3)}' if m.group(3) else m.group(2)
	return f'<p-a>{code[:i]}{code[i:].lower()} {cv}</p-a>{rest}'

def tag(code, c, v=None):
	i = 2 if code[0].isdigit() else 1
	return f'<p-a>{code[:i]}{code[i:].lower()} {c}' + (f'.{v}' if v else '') + '</p-a>'

# Names and abbreviations a reference in English text uses ("1 Cor", "Ps.", "Mt");
# Jud is Judges, as the older commentaries have it (Jude is Jude)
ABBR = {c: c for c in CODES}
ABBR.update({n.upper(): c for n, c in zip(NAMES, CODES)})
for c, names in {'GEN': 'Ge Gn', 'EXO': 'Ex Exod', 'LEV': 'Le Lv', 'NUM': 'Nu Nm', 'DEU': 'De Dt Deut',
	'JOS': 'Josh', 'JDG': 'Judg Jud Jg', 'RUT': 'Ru Rth', '1SA': '1Sam', '2SA': '2Sam', '1KI': '1Kgs 1Kings',
	'2KI': '2Kgs 2Kings', '1CH': '1Chr 1Chron', '2CH': '2Chr 2Chron', 'EZR': 'Ezr', 'NEH': 'Ne', 'EST': 'Es Esth',
	'PSA': 'Ps Pss Psalm', 'PRO': 'Pr Prov Prv', 'ECC': 'Ec Eccl Eccles Qoh', 'SOL': 'So Song SongofSongs Cant Sng',
	'ISA': 'Is', 'JER': 'Je', 'LAM': 'La', 'EZE': 'Ezek Ezk', 'DAN': 'Da Dn', 'HOS': 'Ho', 'JOE': 'Joel Jl',
	'AMO': 'Am', 'OBA': 'Ob Obad', 'JON': 'Jonah Jnh', 'MIC': 'Mi', 'NAH': 'Na', 'HAB': 'Hb', 'ZEP': 'Zeph Zp',
	'HAG': 'Hg', 'ZEC': 'Zech Zc', 'MAL': 'Ml', 'MAT': 'Mt Matt', 'MAR': 'Mk Mr Mrk', 'LUK': 'Lk Lu',
	'JOH': 'Jn Jhn', 'ACT': 'Ac', 'ROM': 'Ro Rm', '1CO': '1Cor', '2CO': '2Cor', 'GAL': 'Ga', 'EPH': 'Ephes',
	'PHI': 'Php Phil Philip', 'COL': 'Col', '1TH': '1Thess 1Thes', '2TH': '2Thess 2Thes', '1TI': '1Tim',
	'2TI': '2Tim', 'TIT': 'Tt', 'PHM': 'Phlm Philem Phm', 'HEB': 'He', 'JAM': 'Jas Jm', '1PE': '1Pet 1Pt',
	'2PE': '2Pet 2Pt', '1JO': '1Jn 1John', '2JO': '2Jn 2John', '3JO': '3Jn 3John', 'JUD': 'Jude', 'REV': 'Re Rv'}.items():
	ABBR.update({n.upper(): c for n in names.split()})
ABBR['JUD'] = 'JDG'
ABBR['SONGOFSONGS'] = 'SOL'

def form(k):
	"""A key's spellings in text, as a pattern: "1 Cor", "1Cor", "I Cor", "First Cor",
	"Song of Solomon", in title case or capitals"""
	word = ' '.join(w if w == 'of' else w.capitalize() for w in re.sub(r'^SONGOF', 'song of ', k).lower().split())
	word = re.sub(r'^(\d)([a-z])', lambda m: m[1] + m[2].upper(), word)
	pats = {re.escape(word).replace(r'\ ', ' '), re.escape(word.upper()).replace(r'\ ', ' ')}
	out = set()
	for w in pats:
		if w[0] in '123':
			n = int(w[0])
			out.add(rf'(?:{n}|{"I" * n}|{("First", "Second", "Third")[n - 1]}|{("first", "second", "third")[n - 1]}) ?{w[1:].strip()}')
		else:
			out.add(w)
	return out

NAME = '|'.join(sorted({p for k in ABBR for p in form(k)}, key=len, reverse=True)).replace(' ', '[ ]?')
BOOKNAME = rf'(?:{NAME})\.?'
VERSE = r'(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(?:(\d{1,3}):)?(\d{1,3}))?'
START = re.compile(rf'(?<![\w:.])(?:({BOOKNAME})\s+)?{VERSE}(?![\d:])')
MORE = re.compile(rf'\s*([,;]|(?:and|or|with|cf\.)(?=\s))\s*(?:({BOOKNAME})\s+)?(?:(\d{{1,3}}):)?(\d{{1,3}})(?:\s*[-–]\s*(?:(\d{{1,3}}):)?(\d{{1,3}}))?(?![\d:])')

def book_of(name):
	n = re.sub(r'^(III|II|I|(?i:first|second|third))(?=\s|[A-Z][a-z])', lambda m: str({'I': 1, 'II': 2, 'III': 3, 'FIRST': 1, 'SECOND': 2, 'THIRD': 3}[m[1].upper()]), name.strip())
	return ABBR.get(re.sub(r'[\s.]', '', n).upper())

def more(t, end, code, c):
	"""The references after one ("; 15:4, 6; Rom 1:3"): their links, where they end"""
	s = ''
	while (n := MORE.match(t, end)):
		b2 = book_of(n[2]) if n[2] else None
		if n[2] and not b2:
			break
		sep = n[0][:n.start(2) - n.start() if n[2] else n.start(3) - n.start() if n[3] else n.start(4) - n.start()]
		if n[1] in (',', 'and', 'or') and not n[3] and b2 is None:  # ", 6": a verse of this chapter
			s += f'{sep}{tag(code, c, n[4])}' + (f'–{n[6]}' if n[6] else '')
		elif n[3]:  # "; 15:4", "; Rom 1:3", "and 2:4"
			code, c = b2 or code, n[3]
			s += f'{sep}{tag(code, c, n[4])}' + (f'–{n[5] + ":" if n[5] else ""}{n[6]}' if n[6] else '')
		else:
			break
		end = n.end()
	return s, end, code, c

def link_text(t, here, prev=None):
	"""Plain references in text t (no tags) as links; here: the entry's book, or
	None; prev: (book, chapter) of the link just before t, which "; 8:34" goes on from"""
	out, pos = [], 0
	if prev:
		s, pos, _, _ = more(t, 0, *prev)
		out.append(s)
	for m in START.finditer(t):
		if m.start() < pos:
			continue
		code = book_of(m[1]) if m[1] else here
		if not code:
			continue
		c, v = m[2], m[3]
		s = tag(code, c, v) + (f'–{m[4] + ":" if m[4] else ""}{m[5]}' if m[5] else '')
		rest, end, _, _ = more(t, m.end(), code, c)
		out.append(t[pos:m.start()])
		out.append(s + rest)
		pos = end
	out.append(t[pos:])
	return ''.join(out)

MDLINK = re.compile(r'\[([^\]]*)\]\(((?:\.\./)*)(?:(\d*-?[1-3a-z]{3})/)?(\d+)/(\d+)\.md\)')
# A tag, a link, a label: left as they are; the text between them, linked
SKIP = re.compile(r'<p-a>.*?</p-a>|<p-n>.*?</p-n>|<a [^>]*>.*?</a>|<[^>]*>', re.S)

def link_body(body, here):
	def md(m):
		b = here
		if m[3]:
			b = BOOK.get(re.sub(r'^\d+-', '', m[3]).upper(), here)
		if not b:
			return m[1]
		r = re.search(r'[-–]\s*([\d:]+)\s*$', m[1])
		return tag(b, int(m[4]), int(m[5])) + (f'–{r[1]}' if r else '')
	body = MDLINK.sub(md, body)
	out, pos, prev, prev_end = [], 0, None, -1
	for m in SKIP.finditer(body):
		out.append(link_text(body[pos:m.start()], here, prev if pos == prev_end else None) if pos < m.start() else '')
		out.append(m[0])
		a = re.fullmatch(r'<p-a>(\S+) (\d+)(?:\.\d+)?</p-a>', m[0])
		# A verse link: what follows it can go on from it ("<p-a>Jos 1.8</p-a>; 8:34")
		prev, prev_end = ((a[1].upper(), a[2]), m.end()) if a and a[1].upper() in BOOK else (None, -1)
		pos = m.end()
	out.append(link_text(body[pos:], here, prev if pos == prev_end else None))
	return ''.join(out)

def fix_file(path):
	with open(path, encoding='utf-8') as f:
		lines = f.read().split('\n')
	n = 0
	for i, line in enumerate(lines):
		if not line or line.startswith('#') or '\t' not in line:
			continue
		key, rest = line.split('\t', 1)
		k = re.match(r'(\S+)(?: \d+\.\d+)?$', key)
		here = BOOK.get(k[1].upper()) if k else None
		head = ''
		if rest.startswith('@') and '\t' in rest:
			head, rest = rest.split('\t', 1)
			head += '\t'
		rest = REF.sub(fix, rest)
		rest = link_body(rest, here)
		n += rest.count('<p-a>')
		lines[i] = f'{key}\t{head}{rest}'
	with open(path, 'w', encoding='utf-8') as f:
		f.write('\n'.join(lines))
	print(f'{path}: {n} links', file=sys.stderr)

if __name__ == '__main__':
	for path in sys.argv[1:]:
		fix_file(path)
