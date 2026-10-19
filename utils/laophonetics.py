#!/usr/bin/env python3
# Lao pronunciation dictionaries from pat.tsv and kerr.tsv's pronunciations:
#   laoipa.tsv    Vientiane, in Patterson's notation (Kerr's words that
#                 Patterson doesn't have, rewritten in it)
#   laosouth.tsv  Southern Lao (Pakxé), its tones from the Vientiane ones
#
# Usage: utils/laophonetics.py pat.tsv kerr.tsv outdir
#
# Patterson's six tones: á high, ā mid, à low, â high falling, ǎ rising,
# ȁ low falling. Kerr has ȃ for â, ă for ǎ and no mark for à, writes the
# glides ao/ay/aw for au/ai, long diphthongs iaː for ia, and no ʔ before
# a vowel.
#
# Southern tones: Hartmann's Pakxé table (based on Hoonchamlong 1981), by
# tone box (consonant class x live, ◌່, ◌້, dead long, dead short):
#             live          ◌່          ◌້                dead long     dead short
#   high      high rising   lower mid   low, creaky       low           high rising
#   middle    mid           lower mid   low falling, cr.  low           high rising
#   low       mid falling   lower mid   low falling       low falling   lower mid
# Each Vientiane tone, with whether the syllable is dead (ends in p t k ʔ
# or a short vowel), is a box of its own or boxes with the same Southern
# tone, except that ◌້ is creaky with a middle class consonant (k c d t b
# p ʔ y) and not with a low one. Written in tone letters, creaky with ̰ .
import re, sys, unicodedata

V = 'aeiouɛɔəɨ'
M = '[\u0300-\u036f]*'
HIGH, MID, LOW, FALL, RISE, LOWFALL = '\u0301', '\u0304', '\u0300', '\u0302', '\u030c', '\u030f'
TONES = HIGH + MID + LOW + FALL + RISE + LOWFALL

def kerr2pat(s):
	"""Kerr's notation in Patterson's"""
	s = re.sub('o\u0302(?=\\s|$)', 'ʔ', unicodedata.normalize('NFD', s))  # ô: a final glottal stop
	s = s.replace('\u0311', FALL).replace('\u0306', RISE)
	out = []
	for syl in s.split():
		stray = re.search(f'(?<=[^{V}\u0300-\u036f])[{TONES}]', syl)    # A tone mark typed on a consonant:
		if stray:                                                      # on the vowel (unless it has one)
			syl = syl[:stray.start()] + syl[stray.end():]
			if not re.search(f'[{TONES}]', syl):
				i = next((k for k, c in enumerate(syl) if c in V), None)
				if i is not None: syl = syl[:i + 1] + stray.group(0) + syl[i + 1:]
		syl = re.sub(f'([iuɨ]{M})a({M})ː', r'\1a\2', syl)          # Diphthongs: iaː -> ia,
		syl = re.sub(f'([iuɨ])a([{TONES}])', r'\1\2a', syl)        # its tone on the first vowel
		syl = re.sub(f'(a{M}ː?{M})o$', r'\1u', syl)                 # Glides: ao -> au,
		syl = re.sub(f'([aeɛouɔəɨ]{M}ː?{M})y$', r'\1i', syl)       # ay -> ai,
		syl = re.sub(r'(?<=[^\Wkŋ])w$', 'u', syl)                    # a final w -> u
		if syl[0] in V: syl = 'ʔ' + syl                             # No consonant: ʔ
		if not re.search(f'[{TONES}]', syl):                         # No mark: low
			i = next((k for k, c in enumerate(syl) if c in V), None)
			if i is not None: syl = syl[:i + 1] + LOW + syl[i + 1:]
		out.append(syl)
	return unicodedata.normalize('NFC', ' '.join(out))

SYL = re.compile(f'([^{V}\\s]*)([{V}\u0300-\u036fː]+)([ptkʔmnŋyw]?)(?![{V}ʰ\u0300-\u036fː])')
def south(s):
	"""Vientiane (Patterson's notation) to Southern Lao"""
	def syl(m):
		on, nu, co = m.groups()
		tone = next((c for c in nu if c in TONES), None)
		if not tone: return m.group(0)
		dead = co in ('p', 't', 'k', 'ʔ') or (not co and 'ː' not in nu and sum(c in V for c in nu) == 1)
		letters, creaky = {
			RISE: ('˦˥', False), LOW: ('˧', False), MID: ('˨', False),
			HIGH: ('˦˥', False) if dead else ('˧˩', False),
			LOWFALL: ('˩', not dead),
			FALL: ('˨˩', not dead and on in ('k', 'c', 'd', 't', 'b', 'p', 'ʔ', 'y', 'kw')),
		}[tone]
		nu = nu.replace(tone, '')
		if creaky: nu = re.sub(f'([{V}])', '\\1\u0330', nu, count=1)
		return on + nu + co + letters
	return unicodedata.normalize('NFC', ' '.join(SYL.sub(syl, t) for t in unicodedata.normalize('NFD', s).split()))

def prons(path):
	"""word -> its pronunciations (the second column, [...]), in order"""
	d = {}
	for l in open(path, encoding='utf-8'):
		if l.startswith('#'): continue
		f = l.rstrip('\n').split('\t')
		if len(f) > 1 and re.fullmatch(r'\[[^\]/×\d-]*\]', f[1].strip()):
			p = ' '.join(f[1].strip()[1:-1].split())
			if p and p not in d.setdefault(f[0], []): d[f[0]].append(p)
	return d

def main(pat, kerr, out):
	words = prons(pat)
	for w, ps in prons(kerr).items():
		if w not in words: words[w] = list(dict.fromkeys(kerr2pat(p) for p in ps))
	src = '<a href="https://sealang.net/lao/dictionary.htm">sealang</a>\'s Patterson and Kerr'
	with open(f'{out}/laoipa.tsv', 'w', encoding='utf-8') as f:
		f.write(f'#desc\tLao pronunciation (Vientiane), from {src}: á high, ā mid, à low, â falling, ǎ rising, ȁ low falling\n#priority\t2\n#lang\tphon\n')
		for w, ps in words.items(): f.write(f"{w}\t{', '.join(f'[{p}]' for p in ps)}\n")
	with open(f'{out}/laosouth.tsv', 'w', encoding='utf-8') as f:
		f.write(f'#desc\tSouthern Lao pronunciation (Pakxé), {src} with Hartmann\'s Pakxé tones: ˦˥ high rising, ˧ mid, ˨ lower mid, ˩ low, ˨˩ low falling, ˧˩ mid falling, ̰ creaky\n#priority\t2\n#lang\tphon\n')
		for w, ps in words.items(): f.write(f"{w}\t{', '.join(dict.fromkeys(f'[{south(p)}]' for p in ps))}\n")
	print(f'{len(words)} words')

if __name__ == '__main__':
	main(*sys.argv[1:4])
