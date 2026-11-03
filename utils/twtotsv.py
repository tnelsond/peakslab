#!/usr/bin/env python3
"""Bible translation words (translationWords: key terms, names and other
words), just each one's words, aligned (#lang xx,aligned): every language's
headwords the same keys (English's title for each article, "Holy Spirit"),
so any two on together are a dictionary of one to the other.

  Holy Spirit	@聖靈	@神的灵	@主的灵

From WA-Catalog's <code>_tw repos on WACS (what bibleineverylanguage.org
publishes), cloned into one folder:

  git clone --depth 1 https://content.bibletranslationtools.org/WA-Catalog/km_tw.git

Usage: twtotsv.py <folder of the clones> <dict_src dir>
  (into <dict_src>/<language>/bible-words/<abbreviation>tw.tsv)
"""
import glob, os, re, sys
from html import escape

REPOS, SRC = sys.argv[1:3]
# WA-Catalog's code: (peakslab's language, its abbreviation, its name)
LANGS = {
	'am': ('amharic', 'am', 'Amharic'), 'arb': ('arabic', 'ar', 'Arabic'), 'as': ('assamese', 'as', 'Assamese'),
	'bn': ('bengali', 'bn', 'Bengali'), 'ceb': ('cebuano', 'ceb', 'Cebuano'), 'en': ('english', 'en', 'English'),
	'es-419': ('spanish', 'es', 'Spanish (Latin America)'), 'fr': ('french', 'fr', 'French'), 'gu': ('gujarati', 'gu', 'Gujarati'),
	'ha': ('hausa', 'ha', 'Hausa'), 'hi': ('hindi', 'hi', 'Hindi'), 'id': ('indonesian', 'id', 'Indonesian'),
	'ilo': ('ilocano', 'ilo', 'Ilocano'), 'km': ('khmer', 'km', 'Khmer'), 'kn': ('kannada', 'kn', 'Kannada'),
	'lo': ('lao', 'lo', 'Lao'), 'ml': ('malayalam', 'ml', 'Malayalam'), 'mr': ('marathi', 'mr', 'Marathi'),
	'my': ('burmese', 'my', 'Burmese'), 'ne': ('nepali', 'ne', 'Nepali'), 'or': ('odia', 'or', 'Odia'),
	'pa': ('punjabi', 'pa', 'Punjabi'), 'plt': ('malagasy', 'mg', 'Malagasy'), 'pmy': ('papuan-malay', 'pmy', 'Papuan Malay'),
	'pt-br': ('portuguese', 'pt', 'Portuguese (Brazil)'), 'ru': ('russian', 'ru', 'Russian'), 'sw': ('swahili', 'sw', 'Swahili'),
	'ta': ('tamil', 'ta', 'Tamil'), 'te': ('telugu', 'te', 'Telugu'), 'th': ('thai', 'th', 'Thai'),
	'tl': ('tagalog', 'tl', 'Tagalog'), 'ur-deva': ('urdu', 'ur', 'Urdu (Devanagari)'), 'vi': ('vietnamese', 'vi', 'Vietnamese'),
	'zh': ('chinese', 'zh', 'Chinese'),
}

def e(s):
	return escape(s, quote=False).replace('@', '@@').replace('^', '^^')  # (peakgen's marks: just text here)

def articles(code):  # {kt/god: [its words]}
	out = {}
	for p in glob.glob(f'{REPOS}/{code}_tw/bible/*/*.md'):
		key = os.path.relpath(p, f'{REPOS}/{code}_tw/bible')[:-3]
		with open(p, encoding='utf-8') as f:
			title = next((l for l in f if l.strip()), '')
		title = title.strip().strip('#').strip().rstrip(':').strip()
		title = title.rsplit(':', 1)[-1]  # ("See also: Holy Spirit, ...")
		ws = []  # (Khmer's and Thai's between spaces too; Thai's and Lao's "or", brackets)
		for w in re.split(r'[,،、；;፣၊/()（）]|\s*(?:หรือ|ຫລື)\s*' + ('|\s+' if code in ('km', 'th') else ''), title):
			w = w.strip(' \t.。-\u200b')
			if w and w not in ws:
				ws.append(w)
		if ws:
			out[key] = ws
	return out

en = articles('en')
heads, n = {}, {}
for k, ws in en.items():  # (English's title; one two have, its key too)
	n[', '.join(ws)] = n.get(', '.join(ws), 0) + 1
for k, ws in en.items():
	t = ', '.join(ws)
	heads[k] = t if n[t] == 1 else f'{t} ({k})'
for code, (lang, ab, name) in LANGS.items():
	arts = articles(code)
	os.makedirs(f'{SRC}/{lang}/bible-words', exist_ok=True)
	out = f'{SRC}/{lang}/bible-words/{ab}tw.tsv'
	with open(out, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{name} Bible translation words (key terms, names and other words), just their words, from '
			'<a href="https://bibleineverylanguage.org/">bibleineverylanguage</a> (translationWords, '
			'<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>): with another language\'s on, '
			f'a dictionary between them\n#priority\t{-1 if lang == "english" else -2}\n#lang\t{ab},aligned\n')
		rows = sorted((heads.get(k, k.split('/')[-1]), ws) for k, ws in arts.items())
		for h, ws in rows:
			o.write(e(h) + '\t' + '\t'.join('@' + e(w) for w in ws) + '\n')
	print(f'{out}: {len(rows)} words', file=sys.stderr)
