#!/usr/bin/env python3
# Convert the StarDict "Webster's Revised Unabridged Dictionary (1913)" TSV
# (dict.org web1913 ASCII markup) into peakslab HTML.
#
#   python3 utils/webstertotsv.py webster.tsv.orig > dict_src/english/dict/webster.tsv
#
# Source markup handled:
#   ['e] [=a] ["o] [a^] ...   accented letters        -> Unicode
#   Word \\Syl"la*ble\\       headword + syllabified   -> <b>Syl´la·ble</b>
#   {Word}                    cross reference          -> <p-a>Word</p-a>
#   {Sub entry}, ...          sub-entry / inflection   -> <b>Sub entry</b>
#   [etym.] [Obs.]            brackets                 -> <p-n>[...]</p-n>
#   (Zool.)                   subject labels           -> <i>(Zoöl.)</i>
#   ``quote''  --Author       quotations               -> “quote” <i>—Author</i>
#   hard <br> wraps every ~60 chars are unwrapped; <br><br> is a paragraph.
import re
import sys
import unicodedata

MACRON = '̄'
BREVE = '̆'
SEMILONG = '̄̍'  # Webster's semi-long: macron with a tick above

CODES = {
	'ae': 'æ', 'AE': 'Æ', 'oe': 'œ', 'OE': 'Œ', '=ae': 'ǣ', '=AE': 'Ǣ',
	'eth': 'ð', 'thorn': 'þ', 'yogh': 'ȝ', 'th': 't͟h', 'ng': 'ṉ', '-n': 'ṉ', 'nsl': 'ṉ',
	'=oo': 'o͞o', 'oo^': 'o͝o', 'oomcr': 'o͝o',
	'imac': 'ī', 'aum': 'ä', 'add': 'a̤', 'udd': 'ṳ', 'usd': 'u̇', 'asl': 'a' + SEMILONG,
	'oasl': 'o' + SEMILONG, 'emc': 'ē', 'amc': 'ā', 'eucr': 'ĕ', 'acr"': 'ă', 'icrt': 'ĭ',
	'tcr': 't', 'til': 'ẽ', 'eum': 'ë', 'ocit': 'ô', 'edt': 'ð', 'dsdot': 'ḍ', 'dot': 'ȧ',
	'root': '√', 'deg': '°', 'min': '′', 'sec': '″', 'sect': '§', 'para': '¶',
	'dag': '‡', 'dagger': '†', 'hand': '☞', 'bar': '|', 'colret': ' | ', '+': '+',
	'times': '×', 'divby': '÷', 'pounds': '£', 'frac43': '4/3',
	'filig': 'ﬁ', 'fllig': 'ﬂ', 'ffllig': 'ﬄ',
	'sharp': '♯', 'flat': '♭', 'natural': '♮', 'upslur': '⁀', 'downslur': '‿',
	'breve': '˘', 'umlaut': '¨', 'spasp': '῾', 'asper': '῾',
	'lbrace2': '{', 'rbrace2': '}',
	'mercury': '☿', 'libra': '♎', 'taurus': '♉', 'scorpio': '♏', 'pisces': '♓',
	'Aries': '♈', 'Taurus': '♉', 'Gemini': '♊', 'Cancer': '♋', 'Leo': '♌', 'Virgo': '♍',
	'Libra': '♎', 'Scorpio': '♏', 'Sagittarius': '♐', 'Capricorn': '♑', 'Aquarius': '♒',
	'Pisces': '♓',
	'Obs2E': 'Obs.',
	'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε', 'zeta': 'ζ',
	'eta': 'η', 'theta': 'θ', 'iota': 'ι', 'kappa': 'κ', 'lambda': 'λ', 'mu': 'μ',
	'nu': 'ν', 'xi': 'ξ', 'omicron': 'ο', 'pi': 'π', 'rho': 'ρ', 'sigma': 'σ',
	'sigmat': 'ς', 'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ', 'chi': 'χ', 'psi': 'ψ',
	'omega': 'ω', 'digamma': 'ϝ', 'Pi': 'Π', 'Sigma': 'Σ', 'Delta': 'Δ', 'Omega': 'Ω',
}
# [<mark><letter>] or [<letter><mark>] -> letter + combining mark
PREFIX = {'"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃',
		'=': MACRON, ',': '̧', '*': '̊', '.': '̇', '-': SEMILONG}
SUFFIX = {'^': BREVE}
# Sanskrit/Arabic transliteration puts the dot below these consonants
DOT_BELOW = set('rtndmhzcs')

def code_repl(m):
	c = m.group(1)
	if c in CODES:
		return CODES[c]
	if len(c) == 2 and c[0] in PREFIX and c[1].isalpha():
		mark = PREFIX[c[0]]
		if c[0] == '.' and c[1] in DOT_BELOW:
			mark = '̣'
		return unicodedata.normalize('NFC', c[1] + mark)
	if len(c) == 2 and c[1] in SUFFIX and c[0].isalpha():
		return unicodedata.normalize('NFC', c[0] + SUFFIX[c[1]])
	return m.group(0)

CODE_RE = re.compile(r'\[([^\[\]\s]{1,11})\]')

def chars(s):
	# Codes nest only as [[dag]] style ("the mark [[dag]]"), so one pass suffices.
	return CODE_RE.sub(code_repl, s)

def syllables(s):
	# Webster marks primary stress with ", secondary with `, syllables with *
	s = s.replace('"', '´').replace('`', 'ˋ').replace('*', '·')
	return s

def esc(s):
	return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def fold(s):
	return ''.join(ch for ch in unicodedata.normalize('NFD', s) if not unicodedata.combining(ch))

# ---------------------------------------------------------------- paragraphs

HEAD_RE = re.compile(r'^\S[^\\]{0,80}? \\\\[^\\]+\\\\')
SENSE_RE = re.compile(r'^(?:\d+\. ?[A-Z(\[{`]|\([a-z]\) |\(\d+\) |[a-z]\) )')

def unwrap(lines, head):
	"""Join hard-wrapped lines, keeping breaks before numbered senses etc."""
	out = lines[0]
	depth = out.count('[') - out.count(']')
	for ln in lines[1:]:
		brk = bool(SENSE_RE.match(ln))
		if head and depth == 0 and re.search(r'[\])]\.?$', out.rstrip()):
			brk = True
		out += '\n' + ln if brk else ' ' + ln
		depth += ln.count('[') - ln.count(']')
	return re.sub(r'[ \t]{2,}', ' ', out)

def brackets(s, outside):
	"""Wrap top-level [...] in <p-n> (etymology, inflections, [Obs.] labels).
	`outside` is applied to the text between brackets."""
	out, depth, start = [], 0, 0
	for i, ch in enumerate(s):
		if ch == '[':
			if depth == 0:
				out.append(outside(s[start:i]))
				start = i
			depth += 1
		elif ch == ']' and depth:
			depth -= 1
			if depth == 0:
				out.append('<p-n>' + s[start:i+1] + '</p-n>')
				start = i + 1
	out.append(outside(s[start:]) if depth == 0 else s[start:])
	return ''.join(out)

def braces(s, para_start):
	"""{X} -> bold sub-entry or <p-a> link."""
	def repl(m):
		inner = m.group(1)
		if '<' in inner:
			return '<b>' + syllables(re.sub(r'</?p-a>', '', inner)) + '</b>'
		at_start = para_start and m.start() == 0
		if at_start or re.search(r'[*"`´ˋ·]', inner) or inner.startswith('-'):
			return '<b>' + syllables(inner) + '</b>'
		return '<p-a>' + inner + '</p-a>'
	prev = None
	while prev != s:  # nested: {Endless, or perpetual, {screw}}
		prev = s
		s = re.sub(r'\{([^{}]+)\}', repl, s)
	return s

def quotes(s):
	s = s.replace("``", '“').replace("''", '”')
	return s

ATTR_END = re.compile(r'(?:^|(?<=\s)|(?<=[.;,!?”]))--(?=[A-Z\(])((?:(?! --)[^\n{<]){1,90})$')

def attribution(s):
	m = ATTR_END.search(s)
	if m:
		s = s[:m.start()].rstrip() + ' <i>—' + m.group(1).strip() + '</i>'
	s = re.sub(r'(?<=[.;,!?”)])\s*--(?=[A-Z])([A-Z][\w.\' ]{0,40}?\.)(?=\s|$)', r' <i>—\1</i>', s)
	s = s.replace(' -- ', ' — ').replace('--', '—')
	return s

LABELS = r'\((?:[A-Z][A-Za-zäëöü]*\.?(?: [A-Za-z]+\.?)?(?: & [A-Z][a-z]*\.?)?)\)'

def loose(s):
	return fold(s).lower().replace("'", '').replace('`', '').replace('"', '').replace('*', '')

def heads(t):
	"""`Word \\Syl"la*ble\\ (pron), pos.` -> <b>Syl´la·ble</b> (pron), <p-n>pos.</p-n>
	The plain headword before the syllabified one is dropped."""
	out, pos = [], 0
	for m in re.finditer(r'\\\\([^\\]+)\\\\', t):
		pre = t[pos:m.start()]
		n = len(m.group(1).split())
		off = max(0, len(pre) - 200)
		pm = re.search(r'(?:^|(?<=\s))' + r'\s+'.join([r'\S+'] * n) + r' ?$', pre[off:])
		if pm and loose(pm.group(0).strip()) == loose(m.group(1)):
			pre = pre[:off + pm.start()]
			if re.search(r'[.:”)\]]\s*$', pre):
				pre = pre.rstrip() + '\n'
		out.append(pre + '<b>' + syllables(m.group(1)) + '</b>\x01')
		pos = m.end()
	out.append(t[pos:])
	t = ''.join(out)
	# part of speech after the head or pronunciation
	t = re.sub(r'(</b>\x01(?: \([^()]*\))?,? )((?:[a-z]{1,6}\.)(?:(?: &amp; | |, )[a-z]{1,6}\.)*)',
			r'\1<p-n>\2</p-n>', t)
	return t.replace('\x01', '')

def paragraph(p):
	lines = [l for l in p.split('<br>')]
	while lines and not lines[0].strip():
		lines.pop(0)
	if not lines:
		return None, None
	is_head = bool(HEAD_RE.match(lines[0]))
	t = unwrap([l.strip() for l in lines], is_head)
	t = esc(t)
	t = chars(t)
	starts_brace = t.startswith('{')
	kind = 'text'
	if is_head:
		kind = 'head'
	elif re.match(r'(Note|Usage|Syn|Ex|Example)s?:', t):
		kind = 'note'
	elif not starts_brace and not SENSE_RE.match(t) and re.search(r'\s--\S[^\n]{0,90}$', t):
		kind = 'quote'

	if kind == 'quote':
		# Derived words after the citation: ... --Peacham. -- {Re*fin"ed*ly}, adv.
		rest = ''
		m = re.search(r'\s--[A-Z][^{]*? -- (?=\{)', t)
		if m:
			t, rest = t[:m.end() - 4], t[m.end() - 3:]
		# Editorial [insertions] inside quotes stay as-is
		t = quotes(t)
		t = braces(t, False)
		t = attribution(t)
		t = '<p-q>' + t.replace('\n', '<br>') + '</p-q>'
		if rest:
			t += text(rest, 'text')
		return t, kind
	if starts_brace:
		kind = 'sub'
	elif re.match(r'(Usage|Syn):', t):
		kind = 'syn'
	return text(t, kind), kind

def text(t, kind):
	t = heads(t)
	# pronunciations: (k[a^]b"b[asl]j)
	t = re.sub(r'\(([^()“”]*["`*][^()“”]*)\)', lambda m: '(' + syllables(m.group(1)) + ')', t)
	# unbalanced in the source: {Endless, or perpetual, {screw}, a screw ...
	t = re.sub(r'^\{([^{}]*)\{([^{}]+)\}(?![^{]*\})', r'{\1\2}', t)
	t = braces(t, True)
	# derived words the source left unbraced: -- Ground"less*ness, n.
	t = re.sub(r'(?<![\w"`*])([A-Za-z][a-z]*(?:[*`][a-z]+)*"[a-z]*(?:[*`"][a-z]+)*)(?=[,.;: ])',
			lambda m: '<b>' + syllables(m.group(1)) + '</b>' if '*' in m.group(1) else m.group(0), t)
	t = brackets(t, lambda x: re.sub(LABELS, lambda m: '<i>' + m.group(0) + '</i>' if len(m.group(0)) < 28 else m.group(0), x))
	t = quotes(t)
	t = attribution(t)
	if kind in ('note', 'syn'):
		t = re.sub(r'^(\w+:)\s*(?:— )?', r'<b>\1</b> ', t)
	# sense numbers become list items in listify()
	t = re.sub(r'(^|\n)(\d+)\. ', '\\1\x02\\2\x02', t)
	t = re.sub(r'(^|\n)\(([a-z])\) ', '\\1\x03\\2\x03', t)
	t = re.sub(r'(^|\n)(\(\d+\))(?= )', r'\1<b>\2</b>', t)
	return t.replace('\n', '<br>')

SENSE_SPLIT = re.compile(r'(?:<br>)*\x02(\d+)\x02|(?:<br>)*\x03([a-z])\x03')

def trim_br(s):
	return re.sub(r'^(?:<br>)+|(?:<br>)+$', '', s)

def listify(s):
	"""Turn the \x02N\x02 / \x03a\x03 sense markers into <ol><li> (nested for (a))."""
	parts = SENSE_SPLIT.split(s)
	out = [trim_br(parts[0])]
	stack = []  # 'n' for 1. 2. lists, 'a' for (a) (b) lists
	want = {'n': 1, 'a': 1}
	for i in range(1, len(parts), 3):
		num, let, txt = parts[i], parts[i + 1], parts[i + 2]
		kind, v = ('n', int(num)) if num else ('a', ord(let) - 96)
		if kind == 'n':
			while stack and stack[-1] == 'a':
				out.append('</li></ol>')
				stack.pop()
		if stack and stack[-1] == kind:
			out.append('</li>')
		else:
			out.append('<ol>' if kind == 'n' else '<ol type="a">')
			stack.append(kind)
			want[kind] = 1
		out.append('<li>' if v == want[kind] else f'<li value="{v}">')
		want[kind] = v + 1
		out.append(trim_br(txt))
	out.extend('</li></ol>' for _ in stack)
	return ''.join(out)

def body(b):
	# typo in the source: \\Gur"net\<br>. (single closing backslash)
	b = re.sub(r'(\\\\[^\\<]{1,80})\\(?!\\)(?:<br>)?', r'\1\\\\', b)
	entries = []
	for p in b.split('<br><br>'):
		html, kind = paragraph(p)
		if html is None:
			continue
		if kind == 'head' or not entries:
			entries.append([[html]])
		elif kind in ('sub', 'syn'):
			# sub-entries and synonyms belong to the whole entry: end the sense list
			entries[-1].append([html])
		else:
			entries[-1][-1].append(html)
	seen, out = set(), []
	for e in entries:
		s = '<br>'.join(listify('<br>'.join(block)) for block in e)
		s = re.sub(r'(</p-q>|</ol>)<br>', r'\1', s)
		s = re.sub(r'<br>(<p-q>|<ol)', r'\1', s)
		# one <p-n> instead of <p-n>n.</p-n> <p-n>[F.]</p-n>
		s = re.sub(r'</p-n>(\s*)<p-n>', r'\1', s)
		if s not in seen:
			seen.add(s)
			out.append(s)
	return '<hr>'.join(out)

def headword(k, html):
	# The source writes é as 'e in headwords ('Ecart'e). Fold those to plain
	# ASCII so the entry is found by typing "ecarte"; real apostrophes stay.
	if "'" not in k:
		return k
	acc = re.sub(r"'([AEIOUaeiou])", lambda m: unicodedata.normalize('NFC', m.group(1) + '́'), k)
	if acc != k and acc.lower() in fold_keep(html).lower():
		return fold(acc)
	return k

def fold_keep(html):
	return re.sub(r'[´ˋ·]', '', re.sub(r'<[^>]+>', '', html))

def main():
	src = open(sys.argv[1], encoding='utf-8') if len(sys.argv) > 1 else sys.stdin
	w = sys.stdout
	cache = {}  # many headwords share one body
	for line in src:
		line = line.rstrip('\n')
		if line.startswith('#'):
			w.write(line + '\n')
			continue
		k, b = line.split('\t', 1)
		html = cache.get(b)
		if html is None:
			html = cache[b] = body(b)
		w.write(headword(k, html) + '\t' + html + '\n')

if __name__ == '__main__':
	main()
