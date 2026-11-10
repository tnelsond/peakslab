#!/usr/bin/env python3
"""CC-CEDICT (https://www.mdbg.net/chinese/dictionary?page=cc-cedict, cedict_1_0_ts_utf-8_mdbg.txt.gz) into a
peakslab .tsv: each entry's simplified characters, its pinyin (tone marks, a word to search), its traditional
characters if they differ (a word to search), and its meanings:

  传统	<p-ipa>@chuántǒng</p-ipa>	<p>@傳統</p>	<ol><li>tradition</li><li>traditional</li><li>convention</li></ol>

Usage: cedicttotsv.py <in.txt[.gz]> <out.tsv> [priority]
"""
import gzip, re, sys
from html import escape

IN, OUT = sys.argv[1:3]
PRIORITY = sys.argv[3] if len(sys.argv) > 3 else '1'
MARKS = {'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì', 'o': 'ōóǒò', 'u': 'ūúǔù', 'ü': 'ǖǘǚǜ'}

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')

def syllable(s):  # (zhong1 -> zhōng: the mark on a or e, the o of ou, else the last vowel)
	m = re.fullmatch(r'([a-zü:]+)([1-5])', s, re.I)
	if not m:
		return s
	t, tone = m[1].replace('u:', 'ü').replace('U:', 'Ü'), int(m[2])
	if tone == 5:
		return t
	low = t.lower()
	i = low.find('a') if 'a' in low else low.find('e') if 'e' in low else low.find('o') if 'ou' in low else max(low.rfind(v) for v in 'iouü')
	if i < 0:  # (m2, ng2, hm: no vowel to mark)
		return s
	mark = MARKS[low[i]][tone - 1]
	return t[:i] + (mark.upper() if t[i].isupper() else mark) + t[i + 1:]

def pinyin(p):
	return ''.join(syllable(s) if re.fullmatch(r'[a-zü:]+[1-5]', s, re.I) else ' ' + s + ' ' for s in p.split()).strip().replace('  ', ' ')

out, n = [f'#desc\tCC-CEDICT Chinese–English (simplified, its traditional and pinyin to search too; MDBG, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>), from <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict">MDBG</a>\n#priority\t{PRIORITY}\n#lang\tbi\n'], 0
for line in (gzip.open if IN.endswith('.gz') else open)(IN, 'rt', encoding='utf-8'):
	m = re.match(r'(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$', line)
	if not m:
		continue
	trad, simp, py, defs = m.groups()
	cells = [simp, f'<p-ipa>@{e(pinyin(py))}</p-ipa>']
	if trad != simp:
		cells.append(f'<p>@{e(trad)}</p>')
	cells.append('<ol>' + ''.join(f'<li>{e(d)}</li>' for d in defs.split('/') if d) + '</ol>')
	out.append('\t'.join(cells) + '\n')
	n += 1
open(OUT, 'w', encoding='utf-8').writelines(out)
print(f'{OUT}: {n} entries', file=sys.stderr)
