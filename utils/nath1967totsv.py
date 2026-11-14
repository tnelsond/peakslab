#!/usr/bin/env python3
"""Chuon Nath's Khmer dictionary, its 1967 (5th) edition (the Buddhist Institute), as the
Open Institute digitized it (SPICE program, LGPL 2.1:
https://github.com/ericvida/khmer-dictionary-spice, kh_dictionary.csv), into a peakslab .tsv:

  - a sense a line (its part of speech first: (ន.), (កិ.)), its examples after " : "
  - a compound it runs in (ភ្លើង's "ភ្លើងព្រៃ ភ្លើងដែលឆេះព្រៃ ។") a headword too, under
    its word (7,796 more)

Usage: nath1967totsv.py <kh_dictionary.csv> <out.tsv>
"""
import csv, html, re, sys
from collections import defaultdict

IN, OUT = sys.argv[1:3]
csv.field_size_limit(10 ** 8)
esc = lambda t: html.escape(t, quote=False)
POS = r'\((ន|កិ|គុ|កិ\.វិ|និ|សព្វ|ឈ|អា|គុ\.និ|បុ\. ស|សំ|បា)\.\)'


def text(d):  # (not its words' links: nearly every word has one; zero-width spaces between its words dropped)
    return esc(plain(d))


def plain(d):
    return re.sub(r'<"+\d+"+>([^/<]*)/a', r'\1', d).replace('​', '')


def sense(s):
    """<li>: its part of speech bold, its examples (after " : ") italic"""
    m = re.match(r'\s*((?:[^()]{0,12}?)?' + POS + r')\s*', plain(s))
    pos = ''
    if m:
        pos = re.search(POS, m[1])[1] + '.'
    body = text(s)
    body = re.sub(r'^\s*(?:[^()<]{0,12}?)?' + POS + r'\s*', '', body)
    d, sep, x = body.partition(' : ')
    return f"<li>{'<strong>' + pos + '</strong> ' if pos else ''}{d.strip()}{'<em> :' + x.strip() + '</em>' if sep else ''}</li>"


entries, subs = {}, defaultdict(list)
for r in csv.DictReader(open(IN, encoding='utf-8')):
    h = r['word'].strip().replace('​', '')
    lines = [x for x in r['definition'].replace('\\n', '\n').split('\n') if x.strip()]
    lis = []
    for line in lines:
        # a line's first sentences its sense; a sentence starting with a compound of the
        # headword and its definition, a sub-entry
        main, rest = [], False
        for sent in re.split(r'(?<=។)', line):
            m = re.match(r'\s*([ក-៿​]+)\s+(.{4,})', plain(sent))
            t = m[1].replace('​', '') if m else ''
            if main and t.startswith(h) and len(t) > len(h):
                rest = True
                subs[t].append((h, text(sent).strip().split(' ', 1)[-1].strip(' ។')))  # (after the compound: no space in it)
                continue
            if not rest:
                main.append(sent)
        if main:
            lis.append(sense(' '.join(main)))
    if lis:
        entries.setdefault(h, []).extend(lis)

with open(OUT, 'w', encoding='utf-8') as o:
    o.write('#desc\tChuon Nath’s Khmer dictionary (វចនានុក្រមខ្មែរ), its 1967 edition (the Buddhist Institute), as the '
            '<a href="https://www.open.org.kh/">Open Institute</a> digitized it (USAID’s SPICE program; '
            '<a href="https://github.com/ericvida/khmer-dictionary-spice">LGPL 2.1</a>); the compounds its entries run in, '
            'headwords too\n#priority\t1\n#lang\tmono\n')
    for h in sorted(entries):
        o.write(f'{h}\t<ul>{"".join(entries[h])}</ul>\n')
    for t in sorted(subs):
        if t in entries:
            continue
        h, d = subs[t][0]
        o.write(f'{t}\t<ul><li>{d}</li></ul><p-n>(<p-a>{h}</p-a>)</p-n>\n')
print(OUT, len(entries), 'entries', len(set(subs) - set(entries)), 'compounds', file=sys.stderr)
