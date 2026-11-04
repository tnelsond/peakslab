#!/usr/bin/env python3
"""Each language's words by WordNet sense (Open Multilingual Wordnet 1.4's
wordnets, Open English WordNet 2025's), and its names for each emoji (Unicode
CLDR's annotations), into peakslab .tsvs for each language (a wordnet one and
an emoji one): their headwords the senses or emoji, the same in every
language's (aligned, as kaikkisensestotsv.py's), so two of them on together are a dictionary of one to the other:

  dog (a member of the genus Canis ... domesticated by man since prehistoric times)	<p-n>noun</p-n>	@สุนัข	@หมา
  🐕 dog	@ឆ្កែ	@សត្វចិញ្ចឹម	@សុនខ

  - a sense's headword: OEWN's first word for it and its definition (up to a
    ";", at most 80 characters), the wordnets' synsets joined to OEWN's by their ILI
  - an emoji's: it and its English name (CLDR's tts), its words its name and
    keywords in the language; skin tones left out
  - a wordnet's own definitions and examples (Japanese's, ...) after its words;
    English's OEWN's whole definition (if cut) and examples

Usage: omwtotsv.py <english-wordnet-2025.xml[.gz]> <omw-1.4 dir> <cldr dir> <dict_src dir> [language ...]
  (cldr dir: annotations/<code>.json and annotations-derived/<code>.json, from
  cldr-json's cldr-annotations-full and cldr-annotations-derived-full; into
  <dict_src>/<language>/wordnet/<abbreviation>wn.tsv and
  <dict_src>/<language>/emoji/<abbreviation>emoji.tsv)
"""
import gzip, json, os, re, sys
import xml.etree.ElementTree as ET
from html import escape

OEWN, OMW, CLDR, SRC = sys.argv[1:5]
ONLY = set(sys.argv[5:])
# peakslab's language: (its abbreviation, name, OMW's wordnet, CLDR's locale)
LANGS = {
	'english': ('en', 'English', None, 'en'),
	'thai': ('th', 'Thai', 'th', 'th'), 'japanese': ('ja', 'Japanese', 'ja', 'ja'),
	'chinese': ('zh', 'Chinese (Mandarin)', 'cmn', 'zh'), 'french': ('fr', 'French', 'fr', 'fr'),
	'portuguese': ('pt', 'Portuguese', 'pt', 'pt'), 'indonesian': ('id', 'Indonesian', 'id', 'id'),
	'spanish': ('es', 'Spanish', 'es', 'es'), 'arabic': ('ar', 'Arabic', 'arb', 'ar'), 'hebrew': ('he', 'Hebrew', 'he', 'he'),
	'khmer': ('km', 'Khmer', None, 'km'), 'lao': ('lo', 'Lao', None, 'lo'), 'burmese': ('my', 'Burmese', None, 'my'),
	'nepali': ('ne', 'Nepali', None, 'ne'), 'cebuano': ('ceb', 'Cebuano', None, 'ceb'), 'hausa': ('ha', 'Hausa', None, 'ha'),
	'amharic': ('am', 'Amharic', None, 'am'), 'swahili': ('sw', 'Swahili', None, 'sw'), 'hindi': ('hi', 'Hindi', None, 'hi'),
	'bengali': ('bn', 'Bengali', None, 'bn'), 'gujarati': ('gu', 'Gujarati', None, 'gu'), 'kannada': ('kn', 'Kannada', None, 'kn'),
	'malayalam': ('ml', 'Malayalam', None, 'ml'), 'marathi': ('mr', 'Marathi', None, 'mr'), 'odia': ('or', 'Odia', None, 'or'),
	'punjabi': ('pa', 'Punjabi', None, 'pa'), 'tamil': ('ta', 'Tamil', None, 'ta'), 'telugu': ('te', 'Telugu', None, 'te'),
	'urdu': ('ur', 'Urdu', None, 'ur'), 'vietnamese': ('vi', 'Vietnamese', None, 'vi'), 'german': ('de', 'German', None, 'de'),
	'russian': ('ru', 'Russian', None, 'ru'), 'korean': ('ko', 'Korean', None, 'ko'), 'assamese': ('as', 'Assamese', None, 'as'),
	'tagalog': ('tl', 'Tagalog', None, 'fil'),
}
# A wordnet's credit (its license as OMW gives it)
CREDIT = {
	'th': 'Thai WordNet (NICT, <a href="https://wordnet.princeton.edu/license-and-commercial-use">WordNet license</a>)',
	'ja': 'Japanese WordNet (NICT, <a href="https://wordnet.princeton.edu/license-and-commercial-use">WordNet license</a>)',
	'cmn': 'Chinese Open Wordnet (Francis Bond, Shan Wang, <a href="https://wordnet.princeton.edu/license-and-commercial-use">WordNet license</a>)',
	'fr': 'WOLF, the French WordNet (<a href="http://www.cecill.info/licenses/Licence_CeCILL-C_V1-en.html">CeCILL-C</a>)',
	'pt': 'OpenWN-PT (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>)',
	'id': 'Wordnet Bahasa (Francis Bond et al., <a href="https://opensource.org/licenses/MIT">MIT</a>)',
	'es': 'the Multilingual Central Repository 3.0\'s Spanish WordNet (<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>)',
	'arb': 'Arabic WordNet (Abouenour, Bouzoubaa, Rosso, <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>)',
	'he': 'Hebrew WordNet (Noam Ordan, Shuly Wintner, <a href="https://wordnet.princeton.edu/license-and-commercial-use">WordNet license</a>)',
}
POS = {'n': 'noun', 'v': 'verb', 'a': 'adj', 's': 'adj', 'r': 'adv'}
TONE = re.compile('[\U0001F3FB-\U0001F3FF]')

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def wordnet(path):
	"""A WN-LMF file's synsets: {ili: (pos, [words], [definitions], [examples])}"""
	words, out = {}, {}
	for _, el in ET.iterparse(gzip.open(path) if path.endswith('.gz') else path):
		if el.tag == 'LexicalEntry':
			w = words[el.get('id')] = el.find('Lemma').get('writtenForm')  # (OEWN's members its entries', OMW's its senses')
			for s in el.iter('Sense'):
				words[s.get('id')] = w
			el.clear()
		elif el.tag == 'Synset':
			ili = el.get('ili')
			if ili and ili[1:].isdigit():  # (OEWN's new ones "in": none yet)
				ws = list(dict.fromkeys(words[m] for m in el.get('members', '').split() if m in words))
				if ws:
					out[ili] = (el.get('partOfSpeech'), ws, [d.text.strip() for d in el.iter('Definition') if d.text],
						[x.text.strip() for x in el.iter('Example') if x.text])
			el.clear()
	return out

# The senses' headwords, from OEWN: its first word and definition (up to a ";",
# and its first 80 characters' words; the whole of it if that's taken, its
# synset's number if that is too)
def short(d, n=80):
	d = d.split('; ')[0]
	return d if len(d) <= n else d[:d.rfind(' ', 0, n)].rstrip(',:') + '…'
en = wordnet(OEWN)
key, taken = {}, set()
for ili, (pos, ws, ds, _) in sorted(en.items(), key=lambda x: int(x[0][1:])):
	d = ds[0] if ds else ''
	for k in (f'{ws[0]} ({short(d)})', f'{ws[0]} ({d})', f'{ws[0]} ({d}) {ili}'):
		if k not in taken:
			break
	taken.add(k)
	key[ili] = k

# The emoji's headwords: it and its English name
def cldr(code):
	out = {}
	for kind, top in (('annotations', 'annotations'), ('annotations-derived', 'annotationsDerived')):
		p = f'{CLDR}/{kind}/{code}.json'
		if os.path.exists(p):
			for em, a in json.load(open(p, encoding='utf-8'))[top]['annotations'].items():
				if not TONE.search(em):
					ws = [w for w in a.get('tts', []) + a.get('default', []) if w and w != '↑↑↑']
					ws += [w.split(': ', 1)[1] for w in ws if ': ' in w]  # ("flag: Cambodia": Cambodia too)
					if ws:
						out[em] = list(dict.fromkeys(ws))
	return out
en_emoji = cldr('en')

def write(l, folder, file, desc, priority, rows):
	os.makedirs(f'{SRC}/{l}/{folder}', exist_ok=True)
	out = f'{SRC}/{l}/{folder}/{file}.tsv'
	with open(out, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{desc}, the same in every language\'s, so with another language\'s on, a dictionary between them\n'
			f'#priority\t{priority}\n#lang\t{LANGS[l][0]},aligned\n')
		for k in sorted(rows):
			o.write(e(k) + '\t' + rows[k] + '\n')
	print(f'{out}: {len(rows)}', file=sys.stderr)

for l, (ab, name, wn, loc) in LANGS.items():
	if ONLY and l not in ONLY:
		continue
	pr = -1 if l == 'english' else -2
	rows = {}
	syn = en if l == 'english' else wordnet(f'{OMW}/omw-{wn}/omw-{wn}.xml') if wn else {}
	for ili, (pos, ws, ds, xs) in syn.items():
		if ili not in key:
			continue
		cells = [f'<p-n>{POS.get(pos, pos)}</p-n>'] + ['@' + e(w.replace('_', ' ')) for w in ws]
		if l == 'english':
			ds = [d for d in ds if f'({d})' not in key[ili]]
		extra = ''.join(f'<p>{e(d)}</p>' for d in ds) + (f'<ul>{"".join(f"<li><i>{e(x)}</i></li>" for x in xs)}</ul>' if xs else '')
		rows[key[ili]] = '\t'.join(cells) + ('\t' + extra if extra else '')
	if rows:
		src = ('Open English WordNet 2025 (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, '
			'<a href="https://github.com/globalwordnet/english-wordnet">globalwordnet</a>)' if l == 'english' else
			f'{CREDIT[wn]}, from the <a href="https://github.com/omwn/omw-data">Open Multilingual Wordnet</a>')
		write(l, 'wordnet', f'{ab}wn', f'{name} words by WordNet sense, from {src}: its headwords the senses '
			'(Open English WordNet\'s word and definition)', pr, rows)
	emoji = {f'{em} {en_emoji[em][0]}': '\t'.join('@' + e(w) for w in ws) for em, ws in cldr(loc).items() if em in en_emoji}
	if len(emoji) >= 500:  # (CLDR's Cebuano: 20)
		write(l, 'emoji', f'{ab}emoji', f'{name} names for the emoji, from <a href="https://cldr.unicode.org/">Unicode CLDR</a> '
			'(<a href="https://www.unicode.org/license.txt">Unicode license</a>): its headwords the emoji and their English names', pr, emoji)
