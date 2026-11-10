#!/usr/bin/env python3
"""STEPBible's tagged Greek NT and Hebrew OT, and their brief lexicons, as
PeakSlab dictionaries (https://github.com/STEPBible/STEPBible-Data, CC BY 4.0).

The texts (TAGNT, TAHOT) become interlinear Bibles: each verse is one
<p-il> element holding its words as "word|transliteration|gloss|Strong's|grammar"
(and a sixth field for a word only some manuscripts have), separated by " ¦ ".
app.js's p-il element draws them. In KJV versification with the KJV's book
codes, so they read in parallel with the other Bibles.

The lexicons (TBESG, TBESH) are keyed by plain Strong's numbers ("G976",
"H7225", like Strong's own dictionary) for the texts' links, with the lemma,
its transliteration and every form the text has as synonyms, so a Greek or
Hebrew word finds its entry and translating word by word glosses it.

Changes to STEPBible's data: Hebrew cantillation marks are left out (the
vowels stay), morpheme slashes are removed, words only in other editions
(Greek "O"/lower case, Hebrew "X" from the LXX) are left out, and the
lexicons' references become links.

Usage: stepbibletotsv.py SRCDIR OUTDIR
SRCDIR has the STEPBible files (TAGNT*.txt, TAHOT*.txt, TBESG*.txt, TBESH*.txt);
writes OUTDIR/ancient-greek/bible/{text/grc-tagnt,dict/tbesg}.tsv and
OUTDIR/biblical-hebrew/bible/{text/hbo-tahot,dict/tbesh}.tsv
"""
import glob, os, re, sys, unicodedata
from html import escape
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixbiblerefs
from collections import defaultdict

# STEPBible's book abbreviations, in order, and the KJV-style codes the other Bibles use
STEP = ('Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam '
	'Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col '
	'1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev').split()
CODES = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SOL ISA JER LAM '
	'EZE DAN HOS JOE AMO OBA JON MIC NAH HAB ZEP HAG ZEC MAL MAT MAR LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL '
	'1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO 2JO 3JO JUD REV').split()
BOOK = dict(zip(STEP, CODES))
BOOK.update({'Mar': 'MAR', 'Ezek': 'EZE', 'Joel': 'JOE', 'Nah': 'NAH', 'Jdgs': 'JDG', 'Song': 'SOL', 'Phil': 'PHI', 'Jam': 'JAM'})
ORDER = {c: i for i, c in enumerate(CODES)}
# The books' names, in their own language, for each verse's reference ("Ματθαῖος 1:1")
NAMES = dict(zip(CODES, ('בראשית|שמות|ויקרא|במדבר|דברים|יהושע|שופטים|רות|שמואל א|שמואל ב|מלכים א|מלכים ב|דברי הימים א|דברי הימים ב|עזרא|נחמיה|אסתר|איוב|תהלים|משלי|קהלת|שיר השירים|ישעיהו|ירמיהו|איכה|יחזקאל|דניאל|הושע|יואל|עמוס|עובדיה|יונה|מיכה|נחום|חבקוק|צפניה|חגי|זכריה|מלאכי|'
	'Ματθαῖος|Μᾶρκος|Λουκᾶς|Ἰωάννης|Πράξεις|Ῥωμαίους|Α΄ Κορινθίους|Β΄ Κορινθίους|Γαλάτας|Ἐφεσίους|Φιλιππησίους|Κολοσσαεῖς|Α΄ Θεσσαλονικεῖς|Β΄ Θεσσαλονικεῖς|Α΄ Τιμόθεον|Β΄ Τιμόθεον|Τίτον|Φιλήμονα|Ἑβραίους|Ἰακώβου|Α΄ Πέτρου|Β΄ Πέτρου|Α΄ Ἰωάννου|Β΄ Ἰωάννου|Γ΄ Ἰωάννου|Ἰούδα|Ἀποκάλυψις').split('|')))

CANTILLATION = re.compile('[\u0591-\u05AF\u05BD\u05C0\u05C4\u05C5]')  # accents, meteg, paseq, upper/lower dots

def lines(pattern):
	# NFC, as keyboards type it (STEPBible's ό, U+1F79, is ό, U+03CC)
	for f in sorted(glob.glob(pattern)):
		with open(f, encoding='utf-8-sig') as fh:
			for line in fh:
				yield unicodedata.normalize('NFC', line)

def plain(strong):
	"""G0976, G2424G, H1254A -> G976, G2424, H1254"""
	m = re.match(r'([GH])0*(\d+)', strong)
	return m and m[1] + m[2]

def field(s):
	# (<the>: a word English doesn't translate)
	return s.replace('|', '/').replace('¦', ' ').replace('\t', ' ').replace('<', '‹').replace('>', '›').strip()

def verse_key(code, ch, vs):
	return (ORDER[code], int(ch), max(int(vs), 1))  # A Psalm's title (verse 0) is in verse 1, as the KJV has it

def write_bible(path, desc, verses, rtl=False):
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, 'w', encoding='utf-8') as out:
		out.write(f'#desc\t{desc}\n#priority\t-1\n#lang\tmono\n#no sort\n')
		for (b, ch, vs), words in sorted(verses.items()):
			out.write(f'{CODES[b].lower()} {ch}.{vs}\t@{NAMES[CODES[b]]} {ch}:{vs}\t<p-il{" dir=rtl" if rtl else ""}>{" ¦ ".join(words)}</p-il>\n')

# ---------------------------------------------------------------- Greek NT
def tagnt(src):
	verses, forms = defaultdict(list), defaultdict(set)
	for line in lines(os.path.join(src, 'TAGNT*.txt')):
		m = re.match(r'(\w{3})\.(\d+)\.(\d+)(?:\[(\d+)\.(\d+)\])?\S*#\d+=(\S+)\t', line)
		if not m or m[1] not in BOOK:
			continue
		t = m[6]
		# N: Nestlé-Aland's text (n: a minor difference), K: the KJV's Greek only
		if 'N' in t or 'n' in t:
			note = ''
		elif t.startswith('K'):
			note = 'Textus Receptus only'
		else:
			continue
		f = line.rstrip('\n').split('\t')
		gm = re.match(r'(.*?)\s*\((.*)\)\s*$', f[1])
		word, translit = (gm[1], gm[2]) if gm else (f[1].strip(), '')
		strong, _, grammar = f[3].split('«')[-1].partition('=')
		ch, vs = (m[4], m[5]) if m[4] else (m[2], m[3])  # KJV's versification
		s = plain(strong) or ''
		verses[verse_key(BOOK[m[1]], ch, vs)].append('|'.join(map(field, [word, translit, f[2], s, grammar] + ([note] if note else []))))
		bare = re.sub(r'[^\w\u0300-\u036f\u2019]', '', word).strip('\u2019')  # Without punctuation
		if s and len(bare) > 1:
			forms[s].add(bare)
	return verses, forms

# ---------------------------------------------------------------- Hebrew OT
def tahot(src):
	verses, forms = defaultdict(list), defaultdict(set)
	for line in lines(os.path.join(src, 'TAHOT*.txt')):
		m = re.match(r'(\w{3})\.(\d+)\.(\d+)\S*#\d+=(\S+)\t', line)
		if not m or m[1] not in BOOK or m[4].startswith('X'):  # X: words the LXX has
			continue
		f = line.rstrip('\n').split('\t')
		word = CANTILLATION.sub('', f[1]).replace('/', '').replace('\\', '')
		translit = f[2].replace('/', '')
		gloss = re.sub(r'\s*/\s*', ' ', f[3]).strip()
		root = re.search(r'\{([^}]*)\}', f[4])
		s = plain(root[1] if root else next((x for x in re.split(r'[/\\]', f[4]) if not x.startswith('H9')), f[4])) or ''
		verses[verse_key(BOOK[m[1]], m[2], m[3])].append('|'.join(map(field, [word, translit, gloss, s, f[5]])))
		bare = re.sub(r'[\u05C3\u05BE\s]+$', '', word)  # Without the verse end, maqaf
		if s and len(bare) > 1:
			forms[s].add(bare)
	return verses, forms

# ---------------------------------------------------------------- Lexicons
def refs(m):
	"""<ref='Luk.3.4; 20.42'>...</ref> -> links to each verse"""
	out, book = [], None
	for r in m[1].split(';'):
		r = r.strip().rstrip('.')
		x = re.match(r'(?:(\w{3})\.)?(\d+)\.(\d+)(.*)', r)
		if not x:
			continue
		book = BOOK.get(x[1], book) if x[1] else book
		if not book:
			continue
		out.append(f'<p-a>{book} {x[2]}.{x[3]}</p-a>{x[4]}')
	return ' '.join(out) or m[2]

def lexicon(pattern, path, desc, forms, priority=0):
	entries = []
	for line in lines(pattern):
		f = line.rstrip('\n').split('\t')
		if len(f) < 8 or not re.match(r'[GH]\d', f[0]):
			continue
		s = plain(f[0])
		lemma, translit, morph, gloss = (x.strip() for x in f[3:7])
		d = re.sub(r"<ref='([^']*)'>(.*?)</ref>", refs, f[7].strip())
		d = re.sub(r'<br\s*/?>', '<br>', d, flags=re.I).replace('__', '').strip()
		d = re.sub(r'^(<br>\s*)+', '', d)
		entries.append((s, lemma, translit, morph, gloss, d, f[1].strip(' =')))
	os.makedirs(os.path.dirname(path), exist_ok=True)
	done = set()
	with open(path, 'w', encoding='utf-8') as out:
		out.write(f'#desc\t{desc}\n#priority\t{priority}\n#lang\tbi\n')
		for s, lemma, translit, morph, gloss, d, ds in entries:
			lemmas = [x.strip() for x in re.split(r'[,;]', lemma) if len(x.strip()) > 1]  # Not a letter alone (γ, λ, ...)
			syn = [x for x in dict.fromkeys(lemmas + [translit]) if x]
			# The text's forms go with the number's first entry (the others are its other senses)
			seen = {x.lower() for x in lemmas}
			fs = sorted(x for x in {x.lower(): x for x in sorted(forms.get(s, ()), reverse=True)}.values() if x.lower() not in seen) if s not in done else []
			done.add(s)
			body = (f'<b>{"".join("@" + x + chr(9) for x in lemmas)}</b><p-ipa>@{translit}</p-ipa>\t' if lemmas else '') + \
				f'<p-n>{morph} {ds}</p-n> <b>{gloss}</b><br>{d}'
			if fs:
				body += '<br><p-n>Forms: ' + ' '.join(f'@{x}\t' for x in fs).rstrip() + '</p-n>'
			out.write(f'{s}\t{body}\n')

# ---------------------------------------------------------------- Grammar codes
def morph_codes(pattern):
	"""TEGMC / TEHMC: the brief codes' table (Code, Example, Meaning) and the
	full codes' records ("$", CODE<TAB>Function=..., then a phrase, what it
	does, an example with the word in _underscores_) -> {code: html}"""
	codes, rec = {}, None
	def row(code, lines):
		phrase, *rest = [x.strip().strip('"').replace('": "', ': ').strip() for x in lines if x.strip()] or ['']
		ex = [re.sub(r'_\s*([^_]+?)\s*_', r'<b>\1</b>', escape(x, quote=False)) for x in rest]
		codes[code] = f'<b>{escape(phrase, quote=False)}</b>' + ''.join(f'<br>{x}' for x in ex)
	for line in lines(pattern):
		line = line.rstrip('\n').rstrip('\t')
		if line.startswith('$'):
			if rec:
				row(rec[0], rec[1])
			rec = None if line.startswith('$=') else []
			continue
		if rec == []:
			f = line.split('\t')
			rec = (f[0].strip(), [])
			continue
		if rec:
			rec[1].append(line)
			continue
		f = line.split('\t')
		if len(f) >= 3 and re.match(r'[GHAN]:\S', f[0]) and f[2].strip():
			codes.setdefault(f[0].strip(), f'<b>{escape(f[2].strip(), quote=False)}</b><br>{escape(f[1].strip(), quote=False)}')
	if rec:
		row(rec[0], rec[1])
	return codes

def write_morph(path, codes, used=()):
	"""Each code, and each combination the text uses (Hebrew "HC/Td/Ncfsa": its
	language letter, then parts: HC, HTd, HNcfsa), what its parts mean: added
	to the end of a lexicon's .tsv (path), the grammar codes' home"""
	entries = dict(codes)
	for c in used:
		if c in entries or '/' not in c:
			continue
		parts = [c[0] + x for x in c[1:].split('/')]
		if all(p in codes for p in parts):
			entries[c] = '<br>'.join(f'<p-n>{p}</p-n> {codes[p]}' for p in parts)
	with open(path, 'a', encoding='utf-8') as out:
		for c in sorted(entries):
			out.write(f'{c}\t{entries[c]}\n')

# ---------------------------------------------------------------- Proper names
def ref_list(s, book=None):
	"""'Exo.4.27ff; 5.1ff; 9.8,27' -> links (a book carries on, as does a chapter)"""
	out, ch = [], None
	for part in re.split(r';\s*', s.strip().rstrip(';')):
		pieces = []
		for i, r in enumerate(part.split(',')):
			r = r.strip()
			x = re.match(r'(?:(\w{3})\.)?(?:(\d+)\.)?(\d+)([a-z]*\W*\w*)$', r)
			if not x or (x[1] and x[1] not in BOOK) or not (x[2] or ch):
				if r:
					pieces.append(escape(r, quote=False))
				continue
			book = BOOK[x[1]] if x[1] else book
			if not book:
				continue
			if x[2]:
				ch = x[2]
			pieces.append(f'<p-a>{book} {ch}.{x[3]}</p-a>{escape(x[4], quote=False)}')
		out.append(', '.join(pieces))
	return '; '.join(p for p in out if p)

def names_in(s):
	"""'Moses@Exo.2.10-Rev, Miriam@Exo.15.20-Mic' -> words to tap"""
	return ', '.join(f'<p-a>{escape(n.split("@")[0].strip(), quote=False)}</p-a>' if '@' in n else escape(n.strip(), quote=False)
		for n in re.split(r',\s*|\s+\+\s*', s) if n.strip(' +'))

def tipnr(pattern, path, desc):
	"""TIPNR: every person, place and other name, by its English name; its
	Hebrew and Greek forms and Strong's numbers find it too"""
	recs, rec = [], None
	for line in lines(pattern):
		line = line.rstrip('\n').rstrip('\t')
		m = re.match(r'\$=+\s*(PERSON|PLACE|OTHER)', line)
		if m:
			rec = {'kind': m[1], 'head': None, 'names': [], 'total': None}
			recs.append(rec)
			continue
		if not rec:
			continue
		f = line.split('\t')
		if rec['head'] is None:
			rec['head'] = f
		elif f[0].startswith('– Total'):
			rec['total'] = f
		elif f[0].startswith('– '):
			rec['names'].append(f)
		elif m := re.match(r'@(\w+)=\s*(.*)', line):
			rec[m[1]] = m[2].replace('\t', ' ').strip()
	os.makedirs(os.path.dirname(path), exist_ok=True)
	n = 0
	with open(path, 'w', encoding='utf-8') as out:
		out.write(f'#desc\t{desc}\n#priority\t2\n#lang\tmono\n')
		for r in recs:
			h = r['head']
			if not h or '@' not in h[0]:
				continue
			name = h[0].split('@')[0].strip()
			h += [''] * 9
			body = []
			brief = r.get('Brief') or r.get('Briefest') or (h[1] if r['kind'] != 'PLACE' else '')
			if brief:
				body.append(f'<b>{escape(brief, quote=False)}</b>')
			art = r.get('Article') or r.get('Short') or ''
			art = re.sub(r'<ref="[^"]*">(.*?)</ref>', r'\1', art)  # (its references: fixbiblerefs.py links them)
			if art:
				art = re.sub(r'<br\s*/?>', '<br>', escape(art, quote=False).replace('&lt;BR&gt;', '<br>').replace('&lt;br&gt;', '<br>'), flags=re.I)
				body.append(art)
			if r['kind'] == 'PERSON':
				for label, v in (('Parents', h[2]), ('Siblings', h[3]), ('Partners', h[4]), ('Children', h[5]), ('Tribe or nation', h[6])):
					v = v.strip(' +')
					if v and v != '>':
						body.append(f'{label}: {names_in(v) if "@" in v else escape(v, quote=False)}')
			elif r['kind'] == 'PLACE':
				links = [f'<a href="{u.strip()}">{t}</a>' for u, t in ((h[4], 'Google Maps'), (h[5], 'PalOpenMaps')) if u.strip().startswith('http')]
				area = h[6].strip(' >')
				if area:
					body.append(f'Area: {escape(area, quote=False)}')
				if links:
					body.append(' · '.join(links))
			forms = []
			for f in r['names']:
				f += [''] * 6
				x = re.match(r'([GH]\d+\w*)«([GH]\d+)\w*=(.*)', f[2].strip())
				if not x:
					continue
				word, s = x[3].strip(), plain(x[2])
				shown = re.sub(r'\s*=\S+$', '', f[3]).strip()
				forms.append(f'@{escape(word, quote=False)}\t <p-a>@{s}\t</p-a>' + (f' ({escape(shown, quote=False)})' if shown and shown != name else ''))
			if forms:
				body.append('Names: ' + '; '.join(dict.fromkeys(forms)))
			t = r['total']
			if t and len(t) > 4:
				count = t[5].strip() if len(t) > 5 else ''
				label = '1 reference' if count == '1' else f'{count} references' if count.isdigit() else 'References'
				body.append(f'{label}: ' + ref_list(t[4], None))
			out.write(f'{name}\t' + '<br>'.join(body) + '\n')
			n += 1
	fixbiblerefs.fix_file(path)
	return n

def main():
	src, out = sys.argv[1], sys.argv[2]
	cc = 'CC BY 4.0, from <a href="https://github.com/STEPBible/STEPBible-Data">STEPBible.org</a> (Tyndale House, Cambridge)'
	nt, ntforms = tagnt(src)
	write_bible(f'{out}/ancient-greek/bible/text/grc-tagnt.tsv', f'Greek New Testament, word by word: Translators Amalgamated Greek NT (TAGNT, Nestlé-Aland text with the KJV’s variants marked), English glosses based on the BSB, Strong’s numbers and grammar. {cc}', nt)
	ot, otforms = tahot(src)
	write_bible(f'{out}/biblical-hebrew/bible/text/hbo-tahot.tsv', f'Hebrew Old Testament, word by word: Translators Amalgamated Hebrew OT (TAHOT, Leningrad Codex, cantillation left out), English glosses, Strong’s numbers and grammar. {cc}', ot, rtl=True)
	lexicon(os.path.join(src, 'TBESG*.txt'), f'{out}/ancient-greek/bible/dict/grc-tbesg.tsv', f'Translators Brief lexicon of Extended Strong’s for Greek (TBESG, from Abbott-Smith), with every form the New Testament has, and its grammar codes explained (TEGMC: what N-NSF, V-AAI-3S ... mean, with an example). {cc}', ntforms)
	write_morph(f'{out}/ancient-greek/bible/dict/grc-tbesg.tsv', morph_codes(os.path.join(src, 'TEGMC*.txt')))
	lexicon(os.path.join(src, 'TBESH*.txt'), f'{out}/biblical-hebrew/bible/dict/hbo-tbesh.tsv', f'Translators Brief lexicon of Extended Strong’s for Hebrew (TBESH, from BDB), with every form the Old Testament has, and the Hebrew and Aramaic grammar codes explained (TEHMC: what HVqp3ms, HC/Ncmsa ... mean, part by part, with an example). {cc}', otforms)
	used = {w.split('|')[4] for ws in ot.values() for w in ws if w.count('|') >= 4}
	write_morph(f'{out}/biblical-hebrew/bible/dict/hbo-tbesh.tsv', morph_codes(os.path.join(src, 'TEHMC*.txt')), used)
	lexicon(os.path.join(src, 'TFLSJ*.txt'), f'{out}/ancient-greek/bible/dict/grc-tflsj.tsv', f'Translators Formatted full LSJ Bible lexicon (TFLSJ): Liddell–Scott–Jones from Perseus, abbreviations expanded and authors dated by Tyndale House, for every word of the Greek Bible, by Strong’s number, with every form the New Testament has. {cc}', ntforms, priority=2)
	tipnr(os.path.join(src, 'TIPNR*.txt'), f'{out}/english/bible/dict/en-tipnr.tsv', f'Translators Individualised Proper Names with all References (TIPNR): every person, place and other name of the Bible, who or what each is, their family, their Hebrew and Greek names and every verse. {cc}')

if __name__ == '__main__':
	main()
