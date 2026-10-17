#!/usr/bin/env python3
"""Convert the Lao Bible Commentary and Lao Bible Dictionary from laobible.net
(crawled HTML) into peakslab .tsv sources.

Usage: laobible.py <rawdir> <imgdir> <outdir>
  rawdir/commentary/LBC###.html, rawdir/dictionary/<TERM>.html, rawdir/terms.json
  imgdir/<name>.webp  images already converted (see laobiblefetchimg.sh)
Writes outdir/laobiblecommentary.tsv and outdir/laobibledict.tsv
"""
import base64, json, os, re, sys
from bs4 import BeautifulSoup, NavigableString, Tag

RAW, IMG, OUT = sys.argv[1:4]

# Book codes used by the peakslab Bible modules (lao2012bible, eng-kjv, ...)
SITE2CODE = {
	'Ge': 'GEN', 'Ex': 'EXO', 'Lev': 'LEV', 'Nu': 'NUM', 'Dt': 'DEU', 'Jos': 'JOS',
	'Jdg': 'JDG', 'Ru': 'RUT', '1Sa': '1SA', '2Sa': '2SA', '1Ki': '1KI', '2Ki': '2KI',
	'1Ch': '1CH', '2Ch': '2CH', 'Ezr': 'EZR', 'Ne': 'NEH', 'Est': 'EST', 'Job': 'JOB',
	'Ps': 'PSA', 'Pr': 'PRO', 'Ecc': 'ECC', 'SS': 'SOL', 'Isa': 'ISA', 'Jer': 'JER',
	'La': 'LAM', 'Eze': 'EZE', 'Da': 'DAN', 'Hos': 'HOS', 'Joel': 'JOE', 'Am': 'AMO',
	'Ob': 'OBA', 'Jnh': 'JON', 'Mic': 'MIC', 'Na': 'NAH', 'Hab': 'HAB', 'Zep': 'ZEP',
	'Hag': 'HAG', 'Zec': 'ZEC', 'Zech': 'ZEC', 'Mal': 'MAL', 'Mt': 'MAT', 'Mk': 'MAR',
	'Lk': 'LUK', 'Jn': 'JOH', 'Acts': 'ACT', 'Rom': 'ROM', '1Cor': '1CO', '2Cor': '2CO',
	'Gal': 'GAL', 'Eph': 'EPH', 'Phi': 'PHI', 'Col': 'COL', '1Th': '1TH', '2Th': '2TH',
	'1Tim': '1TI', '2Tim': '2TI', 'Tit': 'TIT', 'Phm': 'PHM', 'Heb': 'HEB', 'Jas': 'JAM',
	'1Pet': '1PE', '2Pet': '2PE', '1Jn': '1JO', '2Jn': '2JO', '3Jn': '3JO', 'Jud': 'JUD',
	'Rev': 'REV',
}
ONECHAPTER = {'OBA', 'PHM', '2JO', '3JO', 'JUD'}
# Lao abbreviations used in the gospel harmony headings
LAOGOSPEL = {'ມທ': 'MAT', 'ມຣກ': 'MAR', 'ລກ': 'LUK', 'ຢຮ': 'JOH'}

# The commentary's <h1> titles in page order: a book code, or None for the
# topical sections (prophets, the NT world, the gospels, after Acts)
H1CODES = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI',
	'2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SOL', None,
	'ISA', 'JER', 'LAM', 'EZE', 'DAN', 'HOS', 'JOE', 'AMO', 'OBA', 'JON', 'MIC', 'NAH',
	'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', None, None, None, 'ACT', None, 'ROM', '1CO', '2CO',
	'GAL', 'EPH', 'PHI', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAM',
	'1PE', '2PE', '1JO', '2JO', '3JO', 'JUD', 'REV']

ZWS = '​'

def clean(s):
	"""Normalise text: drop soft hyphens and ZWNJ (syllable breaks that would
	stop words matching a search), collapse whitespace, escape peakgen's index
	markers."""
	s = s.replace('­', '').replace('‌', '')
	s = re.sub(r'[ \t\r\n]+', ' ', s)
	return s.replace('@', '@@').replace('^', '^^')

def esc(s):
	return clean(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def text(el):
	return clean(el.get_text()).replace(ZWS, '').strip()

def vref(code, ch, v=None):
	return f'{code} {ch}.{v}' if v else f'{code} {ch}'

def parse_title1(t):
	"""'Ge 15:13-16' -> ('GEN 15.13', '-16'); None if unknown"""
	m = re.match(r'\s*([1-3]?[A-Za-z]+)\.?\s*(\d+)(?::\s*(\d+))?(.*)$', t)
	if not m or m.group(1) not in SITE2CODE:
		return None
	code, ch, v, rest = SITE2CODE[m.group(1)], m.group(2), m.group(3), m.group(4)
	if code in ONECHAPTER and not v:
		ch, v = '1', ch
	return vref(code, ch, v), rest.strip().replace(':', '.')

unknown_refs = {}

def inline(node, links):
	"""Render the children of node as peakslab HTML.
	links: whether non-faint dictionary terms become <p-a> popup links"""
	out = []
	for c in node.children:
		if isinstance(c, NavigableString):
			if c.__class__.__name__ in ('Comment', 'Doctype'):
				continue
			out.append(esc(str(c)))
			continue
		cls = c.get('class') or []
		name = c.name
		if name == 'span' and 'lbref' in cls:
			r = parse_title1(c.get('title1', ''))
			if r:
				code, cv = r[0].split(' ', 1)
				i = 2 if code[0].isdigit() else 1  # link text like the Bibles' "Rom 4.8"
				out.append(f'<p-a>{code[:i]}{code[i:].lower()} {cv}</p-a>{esc(r[1])}')
			else:
				unknown_refs[c.get('title1', '')] = unknown_refs.get(c.get('title1', ''), 0) + 1
				out.append(inline(c, links))
		elif name == 'span' and ('lbdref' in cls or 'mterm' in cls) and links and 'hf' not in cls:
			t = inline(c, links).strip()
			out.append(f'<p-a>{t}</p-a>' if t else '')
		elif name in ('span', 'a', 'font'):
			out.append(inline(c, links))
		elif name == 'br':
			out.append('<br>')
		elif name in ('b', 'i', 'em', 'strong', 'sup', 'sub', 'u'):
			out.append(f'<{name}>{inline(c, links)}</{name}>')
		elif name == 'img':
			out.append(img(c))
		else:
			out.append(block(c, links))
	return ''.join(out)

def img(el):
	name = os.path.splitext(os.path.basename(el.get('src', '')))[0]
	path = os.path.join(IMG, name + '.webp')
	if not os.path.exists(path):
		print('missing image', el.get('src'), file=sys.stderr)
		return ''
	with open(path, 'rb') as f:
		b64 = base64.b64encode(f.read()).decode()
	return f'<img src="data:image/webp;base64,{b64}" style="max-width:100%">'

def block(el, links):
	"""Render a block element, dropping the site's classes and ids"""
	name = el.name
	cls = el.get('class') or []
	body = inline(el, links).strip()
	if name == 'p' and 'head' in cls or 'subhead' in cls:
		return f'<h4>{body}</h4>' if body else ''
	if name == 'p' and 'ic' in cls:  # image caption
		return f'<p-n>{body}</p-n>' if body else ''
	if name == 'p' and 'prefix' in cls:
		return f'{body} ' if body else ''
	if name in ('h1', 'h2', 'h3'):
		return f'<h4>{body}</h4>' if body else ''
	if name in ('p', 'li', 'td', 'th', 'tr', 'table', 'ul', 'ol', 'thead', 'tbody', 'blockquote'):
		if name == 'table':
			return f'<table>{body}</table>'
		return f'<{name}>{body}</{name}>' if body or name in ('td', 'th') else ''
	if name == 'div':
		if 'links' in cls:
			return f'<p>{body}</p>'
		return body
	return body

def tsvline(key, body):
	assert '\t' not in key and '\n' not in body and '\t' not in body, key
	return f'{key}\t{body}\n'

# ---------------------------------------------------------------- commentary

def h3range(t, code):
	"""Verse refs in an <h3>/<h2> heading.
	Returns ([ref, ...], label) where label is the range as written"""
	if code is None:  # gospel harmony: (ມທ. 4:12-17, ມຣກ. 1:14-15, ລກ. 3:18-20, 4:14-15)
		m = re.search(r'\(((?:ມທ|ມຣກ|ລກ|ຢຮ)\..*)\)\s*$', t)
		if not m:
			return [], None
		refs, book = [], None
		for part in re.split(r'[,;]', m.group(1)):
			pm = re.match(r'\s*(?:(ມທ|ມຣກ|ລກ|ຢຮ)\.)?\s*(\d+):\s*(\d+)(.*)', part)
			if not pm:
				continue
			book = LAOGOSPEL.get(pm.group(1), book)
			refs.append((vref(book, pm.group(2), pm.group(3)), pm.group(4).strip().replace(':', '.')))
		return refs, m.group(1)
	m = re.search(r'ເພງສັນລະເສີນ\s+(\d+)(\s*-\s*\d+)?', t)
	if code == 'PSA' and m:
		return [(vref('PSA', m.group(1), '1'), '')], m.group(0)
	m = re.search(r'\((\d+)\s*:\s*(\d*)\s*(-[^)]*)?\)\s*$', t)
	if m:
		return [(vref(code, m.group(1), m.group(2) or '1'), '')], m.group(0)[1:-1]
	m = re.search(r'\((\d+)\s*-\s*(\d+)\)\s*$', t)
	if m:
		if code in ONECHAPTER:
			return [(vref(code, '1', m.group(1)), '')], m.group(0)[1:-1]
		return [(vref(code, m.group(1)), '')], m.group(0)[1:-1]
	return [], None

def commentary():
	pages = sorted(f for f in os.listdir(os.path.join(RAW, 'commentary')) if f.endswith('.html'))
	h1s = []
	entries = []  # (key, body)
	for f in pages:
		with open(os.path.join(RAW, 'commentary', f), encoding='utf-8') as fh:
			soup = BeautifulSoup(fh.read(), 'lxml')
		book = soup.find(id='book')
		h1 = text(book.find('h1'))
		if h1 not in h1s:
			h1s.append(h1)
		code = H1CODES[h1s.index(h1)]
		lao_book = h1
		cur = None  # [key, label, [extra refs], [html]]

		def flush():
			if cur and ''.join(cur[3]).strip():
				label = f'<p-n>@{esc(cur[1])}'
				for r, rest in cur[2]:
					label += f' · @{r}{rest}'
				entries.append((cur[0], label + '</p-n>' + ''.join(cur[3])))

		for el in book.children:
			if not isinstance(el, Tag) or el.name == 'h1':
				continue
			if el.name == 'h2':
				flush()
				span = el.find('span', class_='lbref')
				r = parse_title1(span['title1']) if span else None
				title = inline(el, False)
				lab = text(span) if span else None
				if span:  # drop the leading range link: the label shows it
					title = re.sub(r'^<p-a>[^<]*</p-a>[^ ]*\s*', '', title)
				elif code:  # or a plain "1:1-4:31 title"
					m = re.match(r'\s*(\d+):(\d+)(-[\d:]+)?\s+', text(el))
					if m:
						r, lab = (vref(code, m.group(1), m.group(2)), ''), m.group(0).strip()
						title = re.sub(r'^\s*\d+:\d+(-[\d:]+)?\s+', '', title)
				if not r:
					refs, lab = h3range(text(el), code)
					r = refs[0] if refs else None
				if r:
					key, label = r[0], f'{lao_book} {lab}'
				else:
					key, label = code or h1, lao_book
				cur = [key, label, [], [f'<h3>{title.strip()}</h3>']]
				continue
			if el.name == 'h3':
				t = text(el)
				refs, lab = h3range(t, code)
				if refs:
					# A section heading straight before a ranged subsection goes with it
					carry = cur[3] if cur and len(cur[3]) == 1 and cur[3][0].startswith('<h3>') else []
					if not carry:
						flush()
					cur = [refs[0][0], f'{lao_book} {lab}', refs[1:], carry]
				elif cur is None:
					cur = [code or h1, lao_book, [], []]
				cur[3].append(f'<h4>{inline(el, False).strip()}</h4>')
				continue
			if cur is None:
				cur = [code or h1, lao_book, [], []]
			if el.name == 'img':
				cur[3].append(img(el))
			else:
				cur[3].append(block(el, True))
		flush()
	assert len(h1s) == len(H1CODES), len(h1s)
	with open(os.path.join(OUT, 'laobiblecommentary.tsv'), 'w', encoding='utf-8') as out:
		out.write('#desc\tLao Bible Commentary (ຄູ່ມືອະທິບາຍພຣະຄຳພີ) by Don Fleming, '
			'Bridgeway Publications, translated by John Durdin. From '
			'<a href="https://laobible.net/commentary/index.html">laobible.net</a>\n')
		out.write('#priority\t3\n#no sort\n')
		for k, b in entries:
			out.write(tsvline(k, b))
	print(f'commentary: {len(entries)} entries', file=sys.stderr)

# ---------------------------------------------------------------- dictionary

def dictionary():
	with open(os.path.join(RAW, 'terms.json')) as f:
		terms = json.load(f)
	entries = []
	for t in terms:
		p = os.path.join(RAW, 'dictionary', t + '.html')
		if not os.path.exists(p):
			print('missing term', t, file=sys.stderr)
			continue
		with open(p, encoding='utf-8') as fh:
			soup = BeautifulSoup(fh.read(), 'lxml')
		term = soup.find('p', class_='term')
		if term is None:
			print('no term in', t, file=sys.stderr)
			continue
		eng = text(term.find('span', class_='engterm'))
		lao = text(term.find('span'))
		html = []
		for div in soup.find(id='book').find_all('div', recursive=False):
			cls = div.get('class') or []
			if 'r' in cls or 'l' in cls:
				continue
			html.append(inline(div, True))
		body = f'<p-l>@{esc(lao)}</p-l>' + ''.join(html)
		entries.append((eng, body))
	# The maps linked from the entries are their own pages
	for f in sorted(os.listdir(os.path.join(RAW, 'dictionary'))):
		if not f.startswith('map-'):
			continue
		with open(os.path.join(RAW, 'dictionary', f), encoding='utf-8') as fh:
			soup = BeautifulSoup(fh.read(), 'lxml')
		im = soup.find('img')
		entries.append((f'map: {im.get("alt", f[4:-5])}', f'<p-l>@{esc(text(soup.find("h1")))}</p-l>{img(im)}'))
	with open(os.path.join(OUT, 'laobibledict.tsv'), 'w', encoding='utf-8') as out:
		out.write('#desc\tLao Bible Dictionary (ຄຳສັບແລະຊື່ຕ່າງໆໃນພຣະຄຳພີ) by Don Fleming, '
			'translated by John Durdin. From '
			'<a href="https://laobible.net/dictionary/index.html">laobible.net</a>\n')
		out.write('#priority\t3\n')
		for k, b in entries:
			out.write(tsvline(k, b))
	print(f'dictionary: {len(entries)} entries', file=sys.stderr)

commentary()
dictionary()
for r, n in sorted(unknown_refs.items(), key=lambda x: -x[1]):
	print(f'unparsed ref {n}x: {r!r}', file=sys.stderr)
