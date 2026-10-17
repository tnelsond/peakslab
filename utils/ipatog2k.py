#!/usr/bin/env python3
"""Rewrite the Google Khmer Lexicon's phonemes (ipa.tsv) the way G2K's word
lists do (L1-Week 1 New Word List: khɲom, ɓɔːŋ, phʔoʊn, lo̞kkru, ruəhnəɨ).

Usage: ipatog2k.py ipa.tsv g2k.tsv

Only the transcription column changes. Google's notation is phonemic and its
vowels mostly say which consonant series they follow (ក kɑɑ, គ kɔɔ), so most
map straight across. A few stand for two G2K vowels, and those are decided
from the Khmer spelling: the vowel sign (ិ/ឹ, ឺ/ើ, ូ/ោ) or, for េ, the series
of the consonant it is written on. Google also leaves the aspiration out of
clusters (ខ្ញុំ kɲom), which the spelling puts back (khɲom).
"""
import re, sys

SRC, OUT = sys.argv[1:3]

S1 = set('កខចឆដឋណតថបផសហឡអឞ')
S2 = set('គឃងជឈញឌឍនទធពភមយរលវ')
SONORANT = set('ងញនមយរលវ')  # a subscript sonorant keeps the base's series
ASPIRATED = set('ខឃឆឈឋឍថធផភ')
STOP = {'k': 'កខគឃ', 'c': 'ចឆជឈ', 't': 'ឋឍតថទធ', 'p': 'បផពភ'}
COENG, TO1, TO2 = '្', '៉', '៊'  # ្ ៉ ៊
SIGNS = set('ិីឹឺើូោេ័ឥឦឫឬឭឮ')  # the vowels that decide an ambiguous Google vowel

# Google vowel -> G2K, where it only means one thing
VOWEL = {
	'aa': 'aː', 'a': 'a', 'ie': 'iə', 'iə': 'iə', 'ea': 'ea', 'oa': 'oa',
	'ɑɑ': 'ɔː', 'ɑ': 'ɔ', 'ɔɔ': 'o', 'ɔ': 'o',
	'ii': 'i', 'i': 'i', 'ɨɨ': 'ɨ', 'uu': 'u', 'u': 'o̞', 'o': 'o',
	'uə': 'uə', 'ɨə': 'ɨə', 'aə': 'aə',
	'ae': 'aɛ', 'ɛɛ': 'ɛ', 'ɛ': 'ɛ', 'ɛə': 'ɛə', 'ao': 'ao',
}
# Diphthongs Google writes with a glide
GLIDE = {'əj': 'ej', 'aj': 'aj', 'ej': 'ɛj', 'aw': 'aw', 'ɨw': 'əɨ', 'əw': 'əɨ', 'aəj': 'aoj'}
# Google vowel -> (Khmer signs it can come from, how to choose, default)
AMBIGUOUS = {
	'əə': ({'ឺ', 'ើ', '័'}, lambda sign, ser: 'ə' if sign == 'ឺ' or (sign == '័' and ser == 1) else 'ɨ', 'ɨ'),
	'oo': ({'ូ', 'ោ'}, lambda sign, ser: 'oʊ' if sign == 'ូ' else 'o̞', 'oʊ'),
	'ee': ({'េ', 'ិ', 'ី'}, lambda sign, ser: 'ɛe' if sign == 'េ' and ser == 2 else 'e', 'e'),
	'e': ({'េ', 'ិ'}, lambda sign, ser: 'ɛe' if sign == 'េ' and ser == 2 else 'e', 'e'),
	'ə': ({'ិ', 'ី', 'ឹ', 'េ', 'ឥ', 'ឦ'}, lambda sign, ser: 'e' if sign == 'េ' else 'ə', 'ə'),
	'ɨ': ({'ិ', 'ឹ', 'េ', 'ឥ', 'ឫ', 'ឬ', 'ឭ', 'ឮ'},
		lambda sign, ser: 'ə' if sign in 'ិឥ' else 'ɛ' if sign == 'េ' else 'ɨ', 'ɨ'),
}
# Unambiguous Google vowels that still use up one of the deciding signs
SOURCE = {'aə': {'ើ'}, 'ɨɨ': {'ឺ'}, 'uu': {'ូ'}, 'ao': {'ោ'}, 'ii': {'ី'}, 'i': {'ិ', 'ី'},
	'əj': {'ី'}, 'aəj': {'ើ'}}
GLOTTAL_K = ('a', 'ɑ', 'ea', 'oa', 'ie', 'iə', 'uə')  # final ក is ʔ after these (neaʔ)
PALATAL_K = ('ae', 'ee')  # and c after these (sʔaɛc)
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

def clusters(k):
	"""The base of each consonant + subscript, in writing order"""
	return [k[i] for i in range(len(k) - 2) if k[i + 1] == COENG and k[i] in S1 | S2]

def convert(key, ipa):
	ev = events(key)
	cl = clusters(key)

	def take(signs):
		"""The earliest unused sign from signs, used up"""
		for n, e in enumerate(ev):
			if e[0] in signs:
				return ev.pop(n)
		return None

	out = []
	for i, syl in enumerate(ipa.split('.')):
		m = re.match(rf'([^{VOWELCHARS}]*)([{VOWELCHARS}]+)(.*)$', syl)
		if not m:
			out.append(syl)
			continue
		o, v, coda = m.groups()
		# put back the aspiration of a cluster's first consonant (ខ្ញុំ khɲom)
		if len(o) >= 2 and o[0] in STOP and o[1] != 'h':
			for n, b in enumerate(cl):
				if b in STOP[o[0]]:
					if cl.pop(n) in ASPIRATED:
						o = o[0] + 'h' + o[1:]
					break
		if o[:1] == 'p' and o[1:2] in ('ʔ', 'ɗ'):
			o = 'ph' + o[1:]  # ប្អូន phʔoʊn, ប្ដី phɗej
		if i == 0 and o[:1] == 'ʔ':
			o = o[1:] if o == 'ʔ' else 'ə' + o[1:]  # ɔt, ajuʔ, but អ្វី əwej
		if coda == 'k' and v in GLOTTAL_K:
			coda = 'ʔ'
		elif coda == 'k' and v in PALATAL_K:
			coda = 'c'
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
		if nuc == 'o̞' and coda == 'm':
			nuc = 'ʊ'  # ុំ cʊm, phnʊm
		elif nuc == 'o̞' and coda in ('', 'ʔ'):
			nuc = 'u'  # an open ុ: ajuʔ
		if nuc == 'i' and coda == 'ŋ':
			coda = 'ɲ'  # មីង miɲ
		out.append(o + nuc + coda)
	return ''.join(out)

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
