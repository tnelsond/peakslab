#!/usr/bin/env python3
"""Each language's words by WordNet sense (Open Multilingual Wordnet 1.4's
wordnets, Open English WordNet 2025's) into a peakslab .tsv for each language:
its headwords the senses, the same in every language's (aligned, as
kaikkisensestotsv.py's), so two of them on together are a dictionary of one to
the other:

  dog (a member of the genus Canis (probably descended from the common wolf) that has…)	<p-n>noun</p-n>	@สุนัข	@หมา	@หมาบ้าน

  - a sense's headword: OEWN's first word for it and its definition (up to a
    ";", at most 80 characters), the wordnets' synsets joined to OEWN's by their ILI
  - a wordnet's own definitions and examples (Japanese's, ...) after its words;
    English's OEWN's whole definition (if cut) and examples

Usage: omwtotsv.py <english-wordnet-2025.xml[.gz]> <omw-1.4 dir> <dict_src dir> [language ...]
  (into <dict_src>/<language>/wordnet/<abbreviation>wn.tsv)
"""
import gzip, os, sys
import xml.etree.ElementTree as ET
from html import escape

OEWN, OMW, SRC = sys.argv[1:4]
ONLY = set(sys.argv[4:])
# peakslab's language: (its abbreviation, name, OMW's wordnet)
LANGS = {
	'english': ('en', 'English', None),
	'thai': ('th', 'Thai', 'th'), 'japanese': ('ja', 'Japanese', 'ja'),
	'chinese': ('zh', 'Chinese (Mandarin)', 'cmn'), 'french': ('fr', 'French', 'fr'),
	'portuguese': ('pt', 'Portuguese', 'pt'), 'indonesian': ('id', 'Indonesian', 'id'),
	'spanish': ('es', 'Spanish', 'es'), 'arabic': ('ar', 'Arabic', 'arb'), 'hebrew': ('he', 'Hebrew', 'he'),
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

for l, (ab, name, wn) in LANGS.items():
	if ONLY and l not in ONLY:
		continue
	rows = {}
	for ili, (pos, ws, ds, xs) in (en if l == 'english' else wordnet(f'{OMW}/omw-{wn}/omw-{wn}.xml')).items():
		if ili not in key:
			continue
		cells = [f'<p-n>{POS.get(pos, pos)}</p-n>'] + ['@' + e(w.replace('_', ' ')) for w in ws]
		if l == 'english':
			ds = [d for d in ds if f'({d})' not in key[ili]]
		extra = ''.join(f'<p>{e(d)}</p>' for d in ds) + (f'<ul>{"".join(f"<li><i>{e(x)}</i></li>" for x in xs)}</ul>' if xs else '')
		rows[key[ili]] = '\t'.join(cells) + ('\t' + extra if extra else '')
	src = ('Open English WordNet 2025 (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, '
		'<a href="https://github.com/globalwordnet/english-wordnet">globalwordnet</a>)' if l == 'english' else
		f'{CREDIT[wn]}, from the <a href="https://github.com/omwn/omw-data">Open Multilingual Wordnet</a>')
	os.makedirs(f'{SRC}/{l}/wordnet', exist_ok=True)
	out = f'{SRC}/{l}/wordnet/{ab}wn.tsv'
	with open(out, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{name} words by WordNet sense, from {src}: its headwords the senses (Open English WordNet\'s '
			'word and definition), the same in every language\'s, so with another language\'s on, a dictionary between them\n'
			f'#priority\t{-1 if l == "english" else -2}\n#lang\t{ab},aligned\n')
		for k in sorted(rows):
			o.write(e(k) + '\t' + rows[k] + '\n')
	print(f'{out}: {len(rows)} senses', file=sys.stderr)
