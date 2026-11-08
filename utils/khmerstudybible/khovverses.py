#!/usr/bin/env python3
"""From the KHOV Bible module (khmer/bible/text/km-khov.peak.zst): its verses
(khov_verses.json, [[book, chapter, verse], ...]) and its book names
(khov_names.tsv), for the study notes to be keyed to.

Usage: khovverses.py <khov.peak.zst> <outdir>"""
import json, os, re, sys
import zstandard

src, out = sys.argv[1:3]
data = zstandard.ZstdDecompressor().stream_reader(open(src, 'rb')).read().decode('utf-8', 'replace')
verses, names = set(), {}
for m in re.finditer(r'(?:^|[\x00\n])([1-3]?[a-z]{2,3}) (\d+)\.(\d+)\t([^\t]*?) [០-៩]+\.[០-៩]+\t', data):
    verses.add((m.group(1), int(m.group(2)), int(m.group(3))))
    names.setdefault(m.group(1), m.group(4))
os.makedirs(out, exist_ok=True)
json.dump(sorted(verses), open(os.path.join(out, 'khov_verses.json'), 'w'))
with open(os.path.join(out, 'khov_names.tsv'), 'w', encoding='utf-8') as f:
    f.writelines(f'{k}\t{v}\n' for k, v in names.items())
print(len(verses), 'verses,', len(names), 'books', file=sys.stderr)
