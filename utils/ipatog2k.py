#!/usr/bin/env python3
"""Rewrite the Google Khmer Lexicon's phonemes (ipa.tsv) in G2K's phonetics
(the charts in khmer_consonants.tsv / khmer_vowels.tsv), except that long
vowels keep a length mark, ɯ is written ɨ, ọ is written o̟ and ដ stays ɗ.

Usage: ipatog2k.py ipa.tsv g2k.tsv

Only the transcription column changes. Google's notation is phonemic and its
vowels mostly say which consonant series they follow (ក kɑɑ, គ kɔɔ), so most
map straight across. A few stand for two G2K vowels, and those are decided
from the Khmer spelling: the vowel sign (ិ/ឹ, ឺ/ើ, ូ/ោ) or, for េ, the series
of the consonant it is written on.
"""
import re, sys

SRC, OUT = sys.argv[1:3]

S1 = set('កខចឆដឋណតថបផសហឡអឞ')
S2 = set('គឃងជឈញឌឍនទធពភមយរលវ')
SONORANT = set('ងញនមយរលវ')  # a subscript sonorant keeps the base's series
COENG, TO1, TO2 = '្', '៉', '៊'  # ្ ៉ ៊
SIGNS = set('ិីឹឺើូោេ័ឥឦឫឬឭឮ')  # with the independent vowels  # the vowels that decide an ambiguous Google vowel

# Google vowel -> G2K, where it only means one thing
VOWEL = {
	'aa': 'a', 'a': 'a', 'ie': 'iᵊ', 'ea': 'eᵃ', 'oa': 'oᵃ',
	'ɑɑ': 'ɔ', 'ɑ': 'ɔ', 'ɔɔ': 'o', 'ɔ': 'o',
	'ii': 'i', 'i': 'i', 'ɨɨ': 'ɯ', 'uu': 'u', 'u': 'u', 'o': 'o',
	'uə': 'uᵊ', 'iə': 'iᵊ', 'ɨə': 'ɯᵊ', 'aə': 'aᵊ',
	'ae': 'aᵋ', 'ɛɛ': 'ɛ', 'ɛ': 'ɛ', 'ɛə': 'ɛᵊ', 'ao': 'aᵒ',
}
# Open diphthongs Google writes with a glide
GLIDE = {'əj': 'eʲ', 'aj': 'aʲ', 'ej': 'ɛʲ', 'aw': 'aᶭ', 'ɨw': 'əⁱ', 'əw': 'əⁱ'}
# Google vowel -> (Khmer signs it can come from, how to choose, default)
AMBIGUOUS = {
	'əə': ({'ឺ', 'ើ', '័'}, lambda sign, ser: 'ə' if sign == 'ឺ' or (sign == '័' and ser == 1) else 'ɨ', 'ɨ'),
	'oo': ({'ូ', 'ោ'}, lambda sign, ser: 'oᵘ' if sign == 'ូ' else 'ọ', 'oᵘ'),
	'ee': ({'េ', 'ិ', 'ី'}, lambda sign, ser: 'ɛᵉ' if sign == 'េ' and ser == 2 else 'e', 'e'),
	'e': ({'េ', 'ិ'}, lambda sign, ser: 'ɛᵉ' if sign == 'េ' and ser == 2 else 'e', 'e'),
	# ិ/ី give e and i; ឹ gives ə and ɯ; េ before ញ, ច (Google ə, ɨ) stays as is
	'ə': ({'ិ', 'ី', 'ឹ', 'េ', 'ឥ', 'ឦ'}, lambda sign, ser: 'e' if sign in 'ិីឥឦ' else 'ə', 'ə'),
	'ɨ': ({'ិ', 'ឹ', 'េ', 'ឥ', 'ឫ', 'ឬ', 'ឭ', 'ឮ'},
		lambda sign, ser: 'i' if sign in 'ិឥ' else 'ɯ' if sign in 'ឹឫឬឭឮ' else 'ɨ', 'ɨ'),
}
# Unambiguous Google vowels that still use up one of the deciding signs
SOURCE = {'aə': {'ើ'}, 'ɨɨ': {'ឺ'}, 'uu': {'ូ'}, 'ao': {'ោ'}, 'ii': {'ី'}, 'i': {'ិ', 'ី'},
	'əj': {'ី'}}
ONSET = {'kh': 'kʰ', 'ch': 'cʰ', 'th': 'tʰ', 'ph': 'pʰ'}
SPELL = {'ɯ': 'ɨ', 'ọ': 'o̟'}
VOWELCHARS = 'aeiouəɑɔɛɨ'

def series(k, i):
	"""Series of the consonant cluster the vowel sign at k[i] is written on"""
	j = i - 1
	shift = None
	while j >= 0 and k[j] not in S1 | S2:
		if k[j] in (TO1, TO2):
			shift = 1 if k[j] == TO1 else 2
		j -= 1
	if shift:
		return shift
	if j < 0:
		return 1
	ser = 1 if k[j] in S1 else 2
	if j >= 2 and k[j - 1] == COENG and k[j] not in SONORANT:
		return ser  # a non-sonorant subscript sets the series
	if j >= 2 and k[j - 1] == COENG:
		b = k[j - 2]  # a sonorant subscript: the base consonant's series
		return 1 if b in S1 else 2 if b in S2 else ser
	return ser

def events(k):
	"""(sign, series) for each deciding vowel sign, in writing order"""
	return [(c, series(k, i)) for i, c in enumerate(k) if c in SIGNS]

def onset(o):
	for g, r in ONSET.items():
		o = o.replace(g, r)
	return o

def convert(key, ipa):
	ev = events(key)

	def take(signs):
		"""The earliest unused sign from signs, used up"""
		for n, e in enumerate(ev):
			if e[0] in signs:
				return ev.pop(n)
		return None

	out = []
	for syl in ipa.split('.'):
		m = re.match(rf'([^{VOWELCHARS}]*)([{VOWELCHARS}]+)(.*)$', syl)
		if not m:
			out.append(onset(syl))
			continue
		o, v, coda = m.groups()
		if coda[:1] in ('j', 'w') and v + coda[0] in GLIDE:
			take(SOURCE.get(v + coda[0], ()))
			nuc, coda = GLIDE[v + coda[0]], coda[1:]
		elif v in AMBIGUOUS:
			signs, choose, default = AMBIGUOUS[v]
			e = take(signs)
			nuc = choose(*e) if e else default
		else:
			take(SOURCE.get(v, ()))
			nuc = VOWEL.get(v, v)
		for a, b in SPELL.items():
			nuc = nuc.replace(a, b)
		if len(v) == 2 and v[0] == v[1]:  # a long vowel: ː after the vowel and its diacritics
			m = re.match(r'(.[\u0300-\u036f]*)(.*)$', nuc)
			nuc = m.group(1) + 'ː' + m.group(2)
		out.append(onset(o) + nuc + coda)
	return '.'.join(out)

with open(SRC, encoding='utf-8') as f, open(OUT, 'w', encoding='utf-8') as out:
	for line in f:
		line = line.rstrip('\n')
		if line.startswith('#desc'):
			line += " Rewritten in G2K's phonetics."
		if line.startswith('#') or '\t' not in line:
			out.write(line + '\n')
			continue
		key, ipa = line.split('\t', 1)
		out.write(f'{key}\t{convert(key, ipa) if ipa else ""}\n')
