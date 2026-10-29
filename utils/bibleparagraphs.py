#!/usr/bin/env python3
"""Paragraph marks for Bible texts: "¶ " where a paragraph starts.

Most of our Bible sources have no paragraphs (verse-per-line and XML exports),
so they take the English ULB's (from its USFM: the verses it starts with ¶),
by reference. The ¶ goes before the verse's first word, after any heading and
opening tags. A verse that has one already is left as it is, so running this
again changes nothing.

    utils/bibleparagraphs.py dict_src/english/bible/text/engULB.tsv x.tsv ...
"""
import re, sys

LEAD = re.compile(r'^(\s*(?:<h\d[^>]*>.*?</h\d>\s*|<(?:div|p|span)\b[^>]*>\s*)*)')

def ref(line):
    book, _, cv = line.split('\t', 1)[0].partition(' ')
    return book.upper() + ' ' + cv

ulb = sys.argv[1]
starts = {ref(l) for l in open(ulb, encoding='utf-8')
          if not l.startswith('#') and '\t' in l and l.rstrip('\n').rsplit('\t', 1)[1].lstrip().startswith('¶')}
print(f'{ulb}: {len(starts)} paragraphs')
for path in sys.argv[2:]:
    lines = open(path, encoding='utf-8').read().split('\n')
    n = 0
    for i, l in enumerate(lines):
        if l.startswith('#') or '\t' not in l or ref(l) not in starts:
            continue
        head, text = l.rsplit('\t', 1)
        lead = LEAD.match(text).group(1)
        if text[len(lead):].startswith('¶'):
            continue
        lines[i] = f'{head}\t{lead}¶ {text[len(lead):]}'
        n += 1
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'{path}: {n} marked')
