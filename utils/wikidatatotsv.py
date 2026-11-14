#!/usr/bin/env python3
"""A language's Wikidata labels (CC0) as a peakslab dictionary: each item with a label in it
and in English, its English label (an index word: searching it finds the item) and English
description:

  ជួរភ្នំក្រវាញ	@Cardamom Mountains	<p-n>mountain chain in Cambodia</p-n>

Items from QLever's Wikidata endpoint (https://qlever.dev/api/wikidata: the query service
times out on all of a language's); not the ones bots labeled by the hundred thousand
(Unicode and CJK characters, numbers, times of day, Wikimedia pages), nor a label not in
the language's script.

Usage: wikidatatotsv.py <code> <script regex> <out.tsv> [download.tsv]
  e.g. wikidatatotsv.py km '[ក-៿​ ]+' dict_src/khmer/dict/km-wikidata.tsv
"""
import html, os, re, sys, urllib.parse, urllib.request
from collections import defaultdict

CODE, SCRIPT, OUT = sys.argv[1:4]
DL = sys.argv[4] if len(sys.argv) > 4 else f'/tmp/wikidata-{CODE}.tsv'
# (classes bots label in every language: Unicode/CJK/Hangul characters, numbers, times of day,
# Wikimedia templates, modules, categories, disambiguation pages, asteroids, emoji...)
JUNK = set('Q29654788 Q17300291 Q1260524 Q53764732 Q55809450 Q109483621 Q16317911 Q50707 Q109615233 '
           'Q53764782 Q109483637 Q13366104 Q13366129 Q109483604 Q109483571 Q11266439 Q375355 Q49008 '
           'Q23017336 Q1049294 Q55712979 Q136440129 Q15100640 Q15184295 Q4167836 Q10885554 Q3863 '
           'Q13442814 Q4167410 Q21199 Q11563 Q12503 Q28920044 Q2995513'.split())
if not os.path.exists(DL):
    q = ('PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX wdt: <http://www.wikidata.org/prop/direct/> '
         'PREFIX schema: <http://schema.org/> SELECT ?i ?k ?e ?d (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); '
         f'separator=",") AS ?cs) WHERE {{ ?i rdfs:label ?k . FILTER(LANG(?k)="{CODE}") ?i rdfs:label ?e . '
         'FILTER(LANG(?e)="en") OPTIONAL { ?i schema:description ?d . FILTER(LANG(?d)="en") } '
         'OPTIONAL { ?i wdt:P31 ?c } } GROUP BY ?i ?k ?e ?d')
    req = urllib.request.Request('https://qlever.dev/api/wikidata?' + urllib.parse.urlencode({'query': q}),
                                 headers={'Accept': 'text/tab-separated-values', 'User-Agent': 'peakslab-dict/0.1'})
    open(DL, 'wb').write(urllib.request.urlopen(req, timeout=900).read())

un = lambda s: re.sub(r'^"|"(@[\w-]+)?$', '', s).replace('\\"', '"').replace('\\\\', '\\')
by = defaultdict(list)
for l in open(DL, encoding='utf-8'):
    a = l.rstrip('\n').split('\t')
    if a[0].startswith('?') or len(a) < 5:
        continue
    k, e, d = un(a[1]).strip(), un(a[2]).strip(), un(a[3]).split('; ')[0].strip() if a[3] else ''  # (a description's first part)
    cs = set(re.findall(r'Q\d+', a[4]))
    if cs & JUNK or not re.fullmatch(SCRIPT, k) or not e:
        continue
    by[k.replace('​', '')].append((e, d, a[0].rsplit('/', 1)[1].rstrip('>')))
esc = lambda t: html.escape(t, quote=False)
with open(OUT, 'w', encoding='utf-8') as o:
    o.write('#desc\t<a href="https://www.wikidata.org/">Wikidata</a> (<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>): '
            'its items with a label in this language and in English (people, places, films, organisations, '
            'some everyday words), each one\'s English label and description\n')
    o.write(f'#priority\t-1\n#lang\t{CODE},en\n')
    for k in sorted(by):
        items = sorted({(e, d) for e, d, _ in by[k]})
        o.write(k + '\t' + '\t'.join(f'@{esc(e)}' + (f'\t<p-n>{esc(d)}</p-n>' if d else '') for e, d in items) + '\n')
print(OUT, len(by), 'headwords', sum(map(len, by.values())), 'items', file=sys.stderr)
