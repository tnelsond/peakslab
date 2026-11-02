#!/usr/bin/env python3
"""Khmer dictionaries taken from Android apps (dictworking/khmer/apk/extracted,
their Khmer already Unicode: the phrasal verbs' through utils/limon.py) into
peakslab .tsv files:

  python3 -I utils/khmerappstotsv.py phrasal phrasalverbs.tsv > dict_src/khmer/dict/phrasalverbs.tsv
  python3 -I utils/khmerappstotsv.py chinese chinese-khmer.tsv > dict_src/khmer/chinese/chinesekhmer.tsv
  python3 -I utils/khmerappstotsv.py thai thai-khmer.tsv > dict_src/khmer/thai/thaikhmer.tsv

  account for	<p-n>១</p-n> @ផ្តល់ពត៌មានល្អិតល្អន់ពី	<p-n>២</p-n> @ដឹងពីពត៌មានរបស់ ...
  爱	<p-ipa>ài</p-ipa>	@ស្រឡាញ់

Each Khmer gloss is its own field (@, to the tab), so searching it finds the
entry. The Chinese app's Khmer is machine translated from English: a gloss
still in English (the ones it didn't translate) is left out.
"""
import re, sys

HEAD = {
    'phrasal': ('English phrasal verbs to Khmer (from the KTD Mobile Khmer Phrasal Verbs Dictionary app)', 'rbi', 4),
    'chinese': ('Chinese to Khmer, with pinyin (from the Khmergroup Chinese Khmer Dictionary app; its Khmer machine translated)', 'zh,km', -2),
    'thai': ('Thai to Khmer, with romanization (from the Khmergroup Thai Khmer Dictionary app)', 'th,km', -1),
}
kind, src = sys.argv[1], sys.argv[2]

def glosses(s, sep):
    out = []
    for g in re.split(sep, s):
        g = g.strip(' ​;,&‧.!។')
        if g and g not in out and not (kind == 'chinese' and re.search('[A-Za-z]', g)):
            out.append(g)
    return out

desc, lang, priority = HEAD[kind]  # (negative: on the Chinese and Thai pages too)
print(f'#desc\t{desc}\n#priority\t{priority}' + (f'\n#lang\t{lang}' if lang else ''))
dropped = 0
for line in open(src, encoding='utf-8'):
    if line.startswith('#') or not line.strip():
        continue
    f = [x.strip() for x in line.rstrip('\n').split('\t')]
    if kind == 'phrasal':
        head, khmer = f[0], f[1]
        # numbered senses: ១-... ២-...
        parts = re.split(r'(?:^|\s)([០-៩]+)\s*-', khmer)
        senses = [('', parts[0])] + list(zip(parts[1::2], parts[2::2]))
        fields = []
        for n, s in senses:
            gs = glosses(s, r'/')
            if gs:
                fields.append((f'<p-n>{n}</p-n> ' if n else '') + '\t'.join('@' + g for g in gs))
    else:
        head, sound, khmer = f
        gs = glosses(khmer, r'[;|]' if kind == 'chinese' else r'[;/]')
        fields = ([f'<p-ipa>{sound}</p-ipa>'] if sound else []) + ['@' + g for g in gs]
        if not gs:
            dropped += 1
            continue
    if head and fields:
        print(head + '\t' + '\t'.join(fields))
if dropped:
    print(f'{dropped} entries without a Khmer gloss left out', file=sys.stderr)
