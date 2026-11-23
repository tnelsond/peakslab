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
