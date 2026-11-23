#!/usr/bin/env python3
"""Wikidata labels, in the given languages, of every item the senses name (from QLever's SPARQL endpoint).

Usage: wdlabels.py <src.pkl> <out.json> <lang> [lang ...]
out: {Q: {lang: label}}; resumable (items already in out are skipped)
"""
import sys, json, os, pickle, time, urllib.request, urllib.parse

SRC, OUT, LANGS = sys.argv[1], sys.argv[2], sys.argv[3:]
qs = sorted({x[4] for x in pickle.load(open(SRC, 'rb'))['wk'] if x[4]})
got = json.load(open(OUT)) if os.path.exists(OUT) else {}
todo = [q for q in qs if q not in got]
print(len(qs), 'items,', len(todo), 'to fetch', file=sys.stderr)
URL = 'https://qlever.dev/api/wikidata'
for i in range(0, len(todo), 1500):
	b = todo[i:i + 1500]
	q = ('PREFIX wd: <http://www.wikidata.org/entity/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> '
		'SELECT ?q ?l WHERE { VALUES ?q { ' + ' '.join('wd:' + x for x in b) + ' } ?q rdfs:label ?l . '
		'FILTER(LANG(?l) IN (' + ','.join(f'"{l}"' for l in LANGS) + ')) }')
	req = urllib.request.Request(URL, urllib.parse.urlencode({'query': q}).encode(),
		{'Accept': 'application/sparql-results+json', 'User-Agent': 'peakslab-synsets/1.0'})
	for t in range(5):
		try:
			r = json.load(urllib.request.urlopen(req, timeout=300))
			break
		except Exception as ex:
			print('retry', ex, file=sys.stderr)
			time.sleep(10 * (t + 1))
	else:
		sys.exit('QLever failed')
	for x in b:
		got[x] = {}
	for row in r['results']['bindings']:
		got[row['q']['value'].rsplit('/', 1)[1]][row['l']['xml:lang']] = row['l']['value']
	json.dump(got, open(OUT, 'w'), ensure_ascii=False)
	print(i + len(b), file=sys.stderr, flush=True)
