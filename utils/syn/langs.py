"""peakslab's languages in the synsets"""

# peakslab's language: (abbreviation, name, its codes in Wiktionary / Wikidata / OMW)
LANGS = {
	'english': ('en', 'English', ['en']), 'khmer': ('km', 'Khmer', ['km']), 'lao': ('lo', 'Lao', ['lo']),
	'thai': ('th', 'Thai', ['th']), 'chinese': ('zh', 'Chinese (Mandarin)', ['zh', 'cmn']),
	'korean': ('ko', 'Korean', ['ko']), 'japanese': ('ja', 'Japanese', ['ja']), 'indonesian': ('id', 'Indonesian', ['id']),
	'nepali': ('ne', 'Nepali', ['ne']), 'german': ('de', 'German', ['de']), 'portuguese': ('pt', 'Portuguese', ['pt']),
	'spanish': ('es', 'Spanish', ['es']), 'ancient-greek': ('grc', 'Ancient Greek', ['grc']),
	'biblical-hebrew': ('hbo', 'Biblical Hebrew', ['hbo']), 'hebrew': ('he', 'Hebrew', ['he']),
	'levantine': ('lb', 'Levantine Arabic', ['apc', 'ajp']), 'chitonga': ('toi', 'Chitonga', ['toi']),
	'lozi': ('loz', 'Lozi', ['loz']), 'amharic': ('am', 'Amharic', ['am']), 'arabic': ('ar', 'Arabic', ['ar']),
	'assamese': ('as', 'Assamese', ['as']), 'bengali': ('bn', 'Bengali', ['bn']), 'burmese': ('my', 'Burmese', ['my']),
	'cebuano': ('ceb', 'Cebuano', ['ceb']), 'french': ('fr', 'French', ['fr']), 'gujarati': ('gu', 'Gujarati', ['gu']),
	'hausa': ('ha', 'Hausa', ['ha']), 'hindi': ('hi', 'Hindi', ['hi']), 'ilocano': ('ilo', 'Ilocano', ['ilo']),
	'kannada': ('kn', 'Kannada', ['kn']), 'malagasy': ('mg', 'Malagasy', ['mg']), 'malayalam': ('ml', 'Malayalam', ['ml']),
	'marathi': ('mr', 'Marathi', ['mr']), 'odia': ('or', 'Odia', ['or']), 'punjabi': ('pa', 'Punjabi', ['pa']),
	'russian': ('ru', 'Russian', ['ru']), 'swahili': ('sw', 'Swahili', ['sw']), 'tagalog': ('tl', 'Tagalog', ['tl']),
	'tamil': ('ta', 'Tamil', ['ta']), 'telugu': ('te', 'Telugu', ['te']), 'urdu': ('ur', 'Urdu', ['ur']),
	'vietnamese': ('vi', 'Vietnamese', ['vi']), 'mentawai': ('mwv', 'Mentawai', ['mwv']),
	'papuan-malay': ('pmy', 'Papuan Malay', ['pmy']),
}

# Wiktionary editions, by their language's code (kaikki.org's extracts)
WIKTIONARIES = {ab: name for ab, name, _ in LANGS.values()} | {'en': 'English', 'ms': 'Malay', 'it': 'Italian',
	'nl': 'Dutch', 'pl': 'Polish', 'cs': 'Czech', 'el': 'Greek', 'tr': 'Turkish', 'ku': 'Kurdish'}


def keyed(path):
	"""A synsets .tsv's rows as (key, its row: "<p-n>pos</p-n><TAB>@word..."), in either shape: an aligned one's
	(headed by keys) as it is, a senses one's (headed by words, senses.py's) turned back"""
	import re
	from collections import defaultdict
	lines = [l.rstrip('\n') for l in open(path, encoding='utf-8')]
	if not any(l.startswith('#lang') and ',senses' in l for l in lines):
		yield from (l.split('\t', 1) for l in lines if l[:1] != '#' and '\t' in l)
		return
	pos, words = {}, defaultdict(list)
	for l in lines:
		if l[:1] != '#' and '\t' in l:
			w, r = l.split('\t', 1)
			for p, k in re.findall(r'<p-k><p-n>(.*?)</p-n> @(.*?)</p-k>', r):
				pos[k] = p
				words[k].append(w)
	for k in pos:
		yield k, f'<p-n>{pos[k]}</p-n>\t' + '\t'.join('@' + w for w in words[k])
