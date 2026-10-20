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
writes OUTDIR/greek/bible/{text/grc-tagnt,dict/tbesg}.tsv and
OUTDIR/hebrew/bible/{text/hbo-tahot,dict/tbesh}.tsv
"""
import glob, os, re, sys, unicodedata
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
		out.write(f'#desc\t{desc}\n#priority\t0\n#lang\tmono\n#no sort\n')
		for (b, ch, vs), words in sorted(verses.items()):
			out.write(f'{CODES[b]} {ch}.{vs}\t<p-il{" dir=rtl" if rtl else ""}>{" ¦ ".join(words)}</p-il>\n')

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

def lexicon(pattern, path, desc, forms):
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
		out.write(f'#desc\t{desc}\n#priority\t0\n#lang\tbi\n')
		for s, lemma, translit, morph, gloss, d, ds in entries:
			lemmas = [x.strip() for x in re.split(r'[,;]', lemma) if len(x.strip()) > 1]  # Not a letter alone (γ, λ, ...)
			syn = [x for x in dict.fromkeys(lemmas + [translit]) if x]
			# The text's forms go with the number's first entry (the others are its other senses)
			seen = {x.lower() for x in lemmas}
			fs = sorted(x for x in {x.lower(): x for x in forms.get(s, ())}.values() if x.lower() not in seen) if s not in done else []
			done.add(s)
			body = (f'<b>{"".join("@" + x + chr(9) for x in lemmas)}</b><p-ipa>@{translit}</p-ipa>\t' if lemmas else '') + \
				f'<p-n>{morph} {ds}</p-n> <b>{gloss}</b><br>{d}'
			if fs:
				body += '<br><p-n>Forms: ' + ' '.join(f'@{x}\t' for x in fs).rstrip() + '</p-n>'
			out.write(f'{s}\t{body}\n')

def main():
	src, out = sys.argv[1], sys.argv[2]
	cc = 'CC BY 4.0, from <a href="https://github.com/STEPBible/STEPBible-Data">STEPBible.org</a> (Tyndale House, Cambridge)'
	nt, ntforms = tagnt(src)
	write_bible(f'{out}/greek/bible/text/grc-tagnt.tsv', f'Greek New Testament, word by word: Translators Amalgamated Greek NT (TAGNT, Nestlé-Aland text with the KJV’s variants marked), English glosses based on the BSB, Strong’s numbers and grammar. {cc}', nt)
	ot, otforms = tahot(src)
	write_bible(f'{out}/hebrew/bible/text/hbo-tahot.tsv', f'Hebrew Old Testament, word by word: Translators Amalgamated Hebrew OT (TAHOT, Leningrad Codex, cantillation left out), English glosses, Strong’s numbers and grammar. {cc}', ot, rtl=True)
	lexicon(os.path.join(src, 'TBESG*.txt'), f'{out}/greek/bible/dict/tbesg.tsv', f'Translators Brief lexicon of Extended Strong’s for Greek (TBESG, from Abbott-Smith), with every form the New Testament has. {cc}', ntforms)
	lexicon(os.path.join(src, 'TBESH*.txt'), f'{out}/hebrew/bible/dict/tbesh.tsv', f'Translators Brief lexicon of Extended Strong’s for Hebrew (TBESH, from BDB), with every form the Old Testament has. {cc}', otforms)

if __name__ == '__main__':
	main()
