#!/usr/bin/env python3
"""Convert the Lexicon KH app (kh.gov.rac.keadicd, NCKL) into a peakslab .tsv.

Usage: lexiconkhtotsv.py <db_keracdic8.sqlite> <out.tsv> <images.tsv>
  db_keracdic8.sqlite  from the apk's assets/
  images.tsv           url <tab> slab file name, for lexiconkhimg.sh

Entries are keyed by the Khmer term with the English and French terms indexed.
Pictures go in a separate slab named "<khmer>|@<english>.webp" so they group
with their entry.
"""
import html, re, sqlite3, sys

DB, OUT, IMGS = sys.argv[1:4]
IMGURL = 'https://rac-app.com/keadic/public/img/'

# The KaTeX the app renders, as plain HTML
SYMBOLS = {
	'pi': 'π', 'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε',
	'varepsilon': 'ε', 'theta': 'θ', 'lambda': 'λ', 'mu': 'μ', 'rho': 'ρ', 'varrho': 'ϱ',
	'sigma': 'σ', 'tau': 'τ', 'phi': 'φ', 'omega': 'ω', 'Delta': 'Δ', 'Sigma': 'Σ',
	'Omega': 'Ω', 'partial': '∂', 'angle': '∠', 'int': '∫', 'iint': '∬', 'infty': '∞',
	'ldots': '…', 'cdots': '⋯', 'cdot': '·', 'times': '×', 'div': '÷', 'pm': '±',
	'le': '≤', 'leq': '≤', 'ge': '≥', 'geq': '≥', 'ne': '≠', 'neq': '≠', 'approx': '≈',
	'equiv': '≡', 'in': '∈', 'notin': '∉', 'forall': '∀', 'exists': '∃', 'to': '→',
	'rightarrow': '→', 'longrightarrow': '⟶', 'leftarrow': '←', 'Rightarrow': '⇒',
	'Leftrightarrow': '⇔', 'mapsto': '↦', 'rightleftarrows': '⇄', 'rightleftharpoons': '⇌',
	'degree': '°', 'circ': '°', 'sqrt': '√', 'sin': 'sin', 'cos': 'cos', 'tan': 'tan',
	'log': 'log', 'ln': 'ln', 'lim': 'lim', 'displaystyle': '', 'quad': ' ', ',': ' ',
}

def group(s, i):
	"""The {...} group or single token at s[i:]; returns (text, next index)"""
	while i < len(s) and s[i] == ' ':
		i += 1
	if i >= len(s):
		return '', i
	if s[i] == '{':
		depth, j = 1, i + 1
		while j < len(s) and depth:
			depth += {'{': 1, '}': -1}.get(s[j], 0)
			j += 1
		return s[i + 1:j - 1], j
	if s[i] == '\\':
		m = re.match(r'\\([A-Za-z]+|.)', s[i:])
		return m.group(0), i + len(m.group(0))
	return s[i], i + 1

def latex(s):
	out, i = [], 0
	while i < len(s):
		c = s[i]
		if c in '^_':
			g, i = group(s, i + 1)
			tag = 'sup' if c == '^' else 'sub'
			out.append(f'<{tag}>{latex(g).strip()}</{tag}>')
		elif c == '\\':
			m = re.match(r'\\([A-Za-z]+|.)', s[i:])
			name, i = m.group(1), i + len(m.group(0))
			if name == 'frac':
				a, i = group(s, i)
				b, i = group(s, i)
				a, b = latex(a).strip(), latex(b).strip()
				wrap = lambda x: f'({x})' if re.search(r'[ +\-]', re.sub(r'<[^>]*>', '', x)) else x
				out.append(f'{wrap(a)}/{wrap(b)}')
			elif name == 'sqrt':
				n = re.match(r'\s*\[([^\]]*)\]', s[i:])  # \sqrt[3]{x}
				if n:
					i += len(n.group(0))
				a, i = group(s, i)
				root = {'': '√', '2': '√', '3': '∛', '4': '∜'}.get(n.group(1).strip() if n else '', None)
				root = root or f'<sup>{latex(n.group(1)).strip()}</sup>√'
				out.append(f'{root}({latex(a).strip()})')
			elif name in ('overrightarrow', 'vec'):
				a, i = group(s, i)
				out.append(f'{latex(a).strip()}⃗')
			elif name in ('mathbb', 'mathrm', 'text', 'mathbf', 'mathit'):
				a, i = group(s, i)
				bb = {'N': 'ℕ', 'Z': 'ℤ', 'Q': 'ℚ', 'R': 'ℝ', 'C': 'ℂ'}
				out.append(bb.get(a.strip(), a) if name == 'mathbb' else html.escape(a, quote=False))
			else:
				out.append(SYMBOLS.get(name, name))
		elif c in '{}':
			i += 1
		else:
			out.append(html.escape(c, quote=False))
			i += 1
	return re.sub(r' {2,}', ' ', ''.join(out))

def esc(s):
	return html.escape(s, quote=False).replace('@', '@@').replace('^', '^^')

def desc(d):
	# Fix the source's few typos: [pp2} and a formula missing its {kk2},
	# which then ends at the Khmer text after it
	d = d.replace('[pp2}', '{pp2}')
	if d.count('{kk1}') > d.count('{kk2}'):
		i = d.rindex('{kk1}') + 5
		m = re.search(r'[ក-៿]', d[i:])
		j = i + m.start() if m else len(d)
		d = d[:j].rstrip() + ' {kk2} ' + d[j:]
	parts, last = [], 0
	for m in re.finditer(r'\{(vv1|kk1|pp1)\}(.*?)\{(vv2|kk2|pp2)\}|<br\s*/?>|\r?\n', d, re.S):
		parts.append(esc(d[last:m.start()]))
		last = m.end()
		kind = m.group(1)
		if kind == 'vv1':  # see also
			parts.append(f'<p-a>{esc(m.group(2).strip())}</p-a>')
		elif kind == 'kk1':
			parts.append(f'<i>{latex(m.group(2).strip()).replace("@", "@@").replace("^", "^^")}</i>')
		elif kind == 'pp1':  # pictures are in the slab
			pass
		else:
			parts.append('<br>')
	parts.append(esc(d[last:]))
	return re.sub(r'(<br>\s*)+$', '', re.sub(r'\s+', ' ', ''.join(parts))).strip()

def terms(s, tag):
	"""freeze/frozen -> <b>@freeze</b> / <b>@frozen</b> so each is searchable"""
	return ' / '.join(f'<{tag}>@{esc(t.strip())}</{tag}>' for t in s.split('/') if t.strip())

def senses(text, subject):
	"""1) ... 2) ... as list items, the subject first like a part of speech,
	examples (ឧ. ...) in italics"""
	parts = [p.strip() for p in re.split(r'(?:^|\s)[១-៩][០-៩]*\)\s+', text) if p.strip()]
	items = []
	for i, p in enumerate(parts or ['']):
		m = re.search(r'(?:^|\s)ឧ\.\s*', p)
		if m:
			p = f'{p[:m.start()].strip()} <em>ឧ. {p[m.end():].strip()}</em>'
		lead = f'<strong>{subject}</strong> ' if i == 0 and subject else ''
		items.append(f'<li>{lead}{p.strip()}</li>')
	return '<ul>' + ''.join(items) + '</ul>'

c = sqlite3.connect(DB)
cats = {i: (name, short) for i, name, short in c.execute('select t_id, t_cat, t_short from tb_acat')}
rows = c.execute('select t_id, t_cat_id, t_main_kh, t_main_en, t_main_fr, t_desc from tb_amain '
	'where t_active = 1 order by t_main_kh, t_cat_id').fetchall()

images, seen = [], {}
with open(OUT, 'w', encoding='utf-8') as out:
	out.write('#desc\tLexicon KH (សទ្ទានុក្រមបច្ចេកសព្ទ) Khmer–English–French technical terms '
		'from the National Council of Khmer Language, Royal Academy of Cambodia '
		'(<a href="https://nckl.rac.gov.kh">nckl.rac.gov.kh</a>)\n#priority\t3\n')
	for tid, cat, kh, en, fr, d in rows:
		kh, en, fr, d = (kh or '').strip(), (en or '').strip(), (fr or '').strip(), d or ''
		name, short = cats.get(cat, ('', ''))
		langs = ' · '.join(x for x in (terms(en, 'b'), terms(fr, 'i')) if x)
		body = (f'<p>{langs}</p>' if langs else '') + senses(desc(d), esc(short.strip('[]')))
		assert '\t' not in kh + body, tid
		out.write(f'{kh}\t{body}\n')
		for f in re.findall(r'\{pp1\}\s*(.*?)\s*\{pp2\}', d):
			label = re.sub(r'[/|\\:*?"<>]', ' ', en.split('/')[0]).strip() or str(tid)
			base = f'{kh}|@{label}'
			seen[base] = seen.get(base, 0) + 1
			n = seen[base]
			images.append((IMGURL + f, f'{base}{" " + str(n) if n > 1 else ""}.webp'))

with open(IMGS, 'w', encoding='utf-8') as f:
	for url, name in images:
		f.write(f'{url}\t{name}\n')
print(f'{len(rows)} entries, {len(images)} images', file=sys.stderr)
