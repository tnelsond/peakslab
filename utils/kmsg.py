#!/usr/bin/env python3
"""The workbench's suggested senses (workbench/data/km-sg.zst, by peakgen): for each Khmer word, the senses the
Khmer–English corpus proposed for it (utils/syn/grow.py, each confirmed by an open dictionary) as Claude judged them
(utils/syn judging: judged.tsv): accepted (the sense fits; km-synsets has it), another sense of the same English word
(the one that fits, judged so), or rejected (none fits), with how sure and why. For review: the accepted ones are in
km-synsets already, the others in no dictionary.
Usage: kmsg.py <judged.tsv> <en-synsets.tsv> <out .tsv>
  judged.tsv: id, Khmer, English, sense (an en-synsets key), verdict (accept|other|reject), sure|unsure, kind,
  confirming dictionaries, reason
  out: word<TAB>JSON [[sense, its part of speech, verdict, sure (1|0), English word, dictionaries, reason]]"""
import json, re, sys
from collections import defaultdict
from html import unescape
JUDGED, EN, OUT = sys.argv[1:4]
pos = {}
for l in open(EN, encoding='utf-8'):
    if not l.startswith('#') and '\t' in l:
        k, r = l.split('\t', 1)
        m = re.match(r'<p-n>([^<]*)</p-n>', r)
        pos[unescape(k)] = m[1] if m else ''
by = defaultdict(list)
for l in open(JUDGED, encoding='utf-8'):
    i, km, en, s, v, sure, kind, dicts, why = l.rstrip('\n').split('\t')
    x = [unescape(s), pos.get(unescape(s), ''), v, int(sure == 'sure'), en, dicts, why]
    if x not in by[km]:
        by[km].append(x)
with open(OUT, 'w', encoding='utf-8') as o:
    o.write('#desc\tThe workbench’s suggested senses: the Khmer–English corpus’s, confirmed by an open dictionary, '
            'as Claude judged them\n')
    for k in sorted(by):
        xs = sorted(by[k], key=lambda x: (['accept', 'other', 'reject'].index(x[2]), -x[3]))
        body = json.dumps(xs, ensure_ascii=False, separators=(',', ':')).replace('@', '@@').replace('^', '^^')
        o.write(f'{k}\t{body}\n')
print(len(by), 'words,', sum(map(len, by.values())), 'senses', file=sys.stderr)
