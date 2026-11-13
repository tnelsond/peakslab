#!/usr/bin/env python3
"""Lao text normalized, in place: each syllable's marks in order, one of each.

  ເເ (two ເ) is ແ
  a zero-width space inside a syllable (ກ<ZWSP>ັບ, ເ<ZWSP>ພາ): gone; ZWNJ, ZWJ: gone
  ໍ + າ is ຳ, its tone before it (ນໍ້າ, ນ້ໍາ, ນຳ້: ນ້ຳ)
  a tone before its vowel sign (ຮຸ້: ຮຸ້)
  a mark doubled (ເພິິ່ນ, ສິ່່ງ): one; two tones: the first
  a Latin letter between Lao ones: the Lao on its key (j ່, s ຫ, t ະ: a keyboard slip)
  no space before . , ; : ! ?; NBSP a space

Usage: lonorm.py FILE.tsv...   (the text: fields after the second tab)
"""
import re, sys
from collections import Counter

LAO = '\u0e81-\u0edf'
CONS = '\u0e81-\u0eae\u0ebd\u0edc-\u0edf'  # consonants (ຽ, ໜ ໝ too)
VOW = '\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ecd'  # above and below: ັ ິ ີ ຶ ື ຸ ູ ົ ຼ ໍ
TONE = '\u0ec8-\u0ecb'
MARK = '\u0eb0-\u0ebc\u0ec8-\u0ecd'
# the Lao keyboard's letters on Latin keys (those typed by mistake)
KEYS = {'j': '\u0ec8', 's': '\u0eab', 't': '\u0eb0', 'h': '\u0ec9', 'k': '\u0eb2', 'y': '\u0eb4', 'u': '\u0eb5', 'a': '\u0eb1', 'q': '\u0ebb'}
stats = Counter()


def sub(pat, rep, s, name):
	s, n = re.subn(pat, rep, s)
	stats[name] += n
	return s


def norm(s):
	"""(again till nothing changes: a tone moved can make a mark doubled)"""
	while (t := norm1(s)) != s:
		s = t
	return s


def norm1(s):
	s = sub('\u00a0', ' ', s, 'NBSP')
	s = sub('[\u200c\u200d\ufeff]', '', s, 'ZWNJ, ZWJ')
	s = sub(f'\u200b+(?=[{MARK}])', '', s, 'ZWSP before a mark')
	s = sub('(?<=[\u0ec0-\u0ec4])\u200b+', '', s, 'ZWSP after a leading vowel')
	s = sub('\u0ec0\u0ec0', '\u0ec1', s, 'ເເ: ແ')
	s = sub(f'([{MARK}])\\1+', r'\1', s, 'a mark doubled')
	s = sub(f'([{TONE}])[{TONE}]+', r'\1', s, 'two tones')
	s = sub(f'([{TONE}])([{VOW}]+)', r'\2\1', s, 'a tone before its vowel')
	s = sub(f'\u0ecd([{TONE}]?)\u0eb2', '\\1\u0eb3', s, 'ໍ + າ: ຳ')
	s = sub(f'([{TONE}])\u0ecd\u0eb2', '\\1\u0eb3', s, 'ໍ + າ: ຳ')
	s = sub(f'\u0eb3([{TONE}])', '\\1\u0eb3', s, 'ຳ before its tone')
	s = sub(f'(?<=[{LAO}])[{"".join(KEYS)}](?=[{LAO}])', lambda m: KEYS[m[0]], s, 'a Latin key for Lao')
	s = sub(r' +(?=[.,;:!?])', '', s, 'a space before punctuation')
	return s


for path in sys.argv[1:]:
	out = []
	for line in open(path, encoding='utf-8'):
		if line.startswith('#'):
			out.append(line)
			continue
		parts = line.rstrip('\n').split('\t')
		parts[2:] = [norm(p) for p in parts[2:]]
		out.append('\t'.join(parts) + '\n')
	open(path, 'w', encoding='utf-8').writelines(out)
for k, n in stats.items():
	print(f'{k}: {n}')
