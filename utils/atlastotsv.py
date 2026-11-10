#!/usr/bin/env python3
"""Map PDFs (like the Khmer Bible Atlas's, one map a page) as a PeakSlab
dictionary of maps: each map an SVG, its place names the words that find it
(a tap on "ក្រេត" in a verse: every map with Crete on it).

The SVG keeps the PDF's vectors (coastlines, routes, labels as glyph paths:
sharp at any zoom); its pictures (the shaded relief) are WEBP, at most MAXW
pixels wide. Its ids get the map's prefix (m1223_font_3), so maps on one page don't clash.

The labels' text in these PDFs is garbled (a custom glyph encoding), so they're
read by OCR: the page's glyphs alone, black on white, through tesseract (khm).
Every label is a name to search by (an @ alias), spelled as a Khmer Bible has
it when one has it with one mark (vowel sign, diacritic) added, dropped or
changed: tesseract's usual mistakes (រូម for រ៉ូម); else as read.

A map that's only a picture (its PDF missing) is a WEBP, read by OCR as is.

Usage: atlastotsv.py OUT.tsv "DESC" WORKDIR MAPS.txt BIBLE.tsv...
  MAPS.txt  a line per map: "<id> <file.pdf|.png|.jpg>" (paths from MAPS.txt's folder)
  WORKDIR   each map's SVG and labels, kept: a second run reuses them
  BIBLE.tsv Khmer Bibles (dict_src/khmer/bible/text/*.tsv), words split by ZWSP
Needs: pymupdf, pillow; rsvg-convert, tesseract with khm.traineddata (TESSDATA_PREFIX)
"""
import base64, io, json, os, re, subprocess, sys
from collections import Counter
from multiprocessing import Pool
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

MAXW, Q = 2400, 55
KHMER = re.compile('[\u1780-\u17dd]+')  # (no digits: a scale's)
MARKS = [chr(c) for c in range(0x17b6, 0x17d4)]  # vowel signs, diacritics

def webp(im, maxw=MAXW):
	if im.width > maxw:
		im = im.resize((maxw, max(1, round(im.height * maxw / im.width))), Image.LANCZOS)
	b = io.BytesIO()
	im.convert('RGB').save(b, 'WEBP', quality=Q, method=6)
	return base64.b64encode(b.getvalue()).decode()

def ocr(png, psm):
	r = subprocess.run(['tesseract', '-', '-', '-l', 'khm', '--psm', str(psm)], input=png,
		capture_output=True, env=dict(os.environ, OMP_THREAD_LIMIT='1'))
	return [l.strip() for l in r.stdout.decode().split('\n') if l.strip()]

def pdf_map(path):
	import pymupdf
	page = pymupdf.open(path)[0]
	svg = page.get_svg_image(text_as_path=True)
	# The labels: the glyphs alone, black on white
	t = re.sub(r'xlink:href="data:image[^"]*"', '', svg).replace('<defs>',
		'<style>image{display:none}g>path:not([id^=font_]),svg>path{display:none}use[data-text]{fill:#000!important}</style><defs>', 1)
	png = subprocess.run(['rsvg-convert', '-w', '5000', '-b', 'white'], input=t.encode(), capture_output=True).stdout
	labels = ocr(png, 11)
	# The map: pictures as WEBP, ids prefixed, no garbled text, 2 decimals
	svg = re.sub(r'<image([^>]*?)xlink:href="data:image/\w+;base64,([^"]+)"',
		lambda m: f'<image{m[1]}xlink:href="data:image/webp;base64,{webp(Image.open(io.BytesIO(base64.b64decode(m[2]))))}"', svg)
	svg = re.sub(r' data-text="[^"]*"', '', svg)
	svg = re.sub(r'(\d+\.\d{2})\d+', r'\1', svg)
	svg = re.sub(r'<svg ([^>]*?) width="[^"]*" height="[^"]*"', r'<svg \1 style="width:100%;height:auto"', svg, 1)
	svg = re.sub(r' xmlns:inkscape="[^"]*"', '', svg)
	return re.sub(r'\s*\n\s*', ' ', svg), labels

def picture_map(path):
	im = Image.open(path)
	g = im.convert('L')
	if g.width < 4000:
		g = g.resize((4000, round(g.height * 4000 / g.width)), Image.LANCZOS)
	b = io.BytesIO(); g.save(b, 'PNG')
	return f'<img src="data:image/webp;base64,{webp(im)}" style="max-width:100%">', ocr(b.getvalue(), 11)

def one(job):
	mid, path, work = job
	out = os.path.join(work, mid + '.json')
	if not os.path.exists(out):
		html, labels = pdf_map(path) if path.lower().endswith('.pdf') else picture_map(path)
		json.dump({'html': html, 'labels': labels}, open(out, 'w'), ensure_ascii=False)
	print(mid, file=sys.stderr, flush=True)
	return mid

def vocabulary(bibles, wanted):
	"""How often the Bibles have each wanted string, as a run of 1 to 3 words"""
	n = Counter()
	for f in bibles:
		for line in open(f, encoding='utf-8'):
			text = line.split('\t', 2)[-1]
			for run in re.split(r'[^\u1780-\u17dd\u200b]+', text):
				ws = [w for w in run.split('\u200b') if w]
				for i in range(len(ws)):
					s = ''
					for w in ws[i:i + 3]:
						s += w
						if len(s) > 24:
							break
						if s in wanted:
							n[s] += 1
	return n

def variants(label):
	"""The label, and (5 letters or more) it with one mark added, dropped or changed"""
	yield label
	if len(label) < 5:
		return
	for i in range(len(label) + 1):
		for m in MARKS:
			yield label[:i] + m + label[i:]
		if i < len(label):
			yield label[:i] + label[i + 1:]
			if label[i] in MARKS:
				for m in MARKS:
					yield label[:i] + m + label[i + 1:]

def place(label, vocab):
	"""The label as a Bible has it: itself, or its commonest variant there"""
	if vocab.get(label, 0) > 0:
		return label
	best = max(variants(label), key=lambda c: vocab.get(c, 0))
	return best if vocab.get(best, 0) > 0 else None

def main():
	OUT, DESC, WORK, LIST = sys.argv[1:5]
	os.makedirs(WORK, exist_ok=True)
	base = os.path.dirname(os.path.abspath(LIST))
	maps = [l.split(None, 1) for l in open(LIST, encoding='utf-8') if l.strip()]
	jobs = [(mid, os.path.join(base, f.strip()), WORK) for mid, f in maps]
	with Pool(int(os.environ.get('JOBS', '2'))) as p:
		list(p.imap_unordered(one, jobs))
	labels = {mid: json.load(open(os.path.join(WORK, mid + '.json'))) for mid, _, _ in jobs}
	runs = {''.join(KHMER.findall(l)) for d in labels.values() for l in d['labels']}  # each label's words, joined
	vocab = vocabulary(sys.argv[5:], {v for r in runs for v in variants(r)})
	rows, found, kept = [], 0, 0
	for mid, _, _ in jobs:
		d = labels[mid]
		names = []
		for l in d['labels']:  # each label a name, as a Bible spells it if one has it
			w = ''.join(KHMER.findall(l))
			if len(w) < 3:  # (two letters: a scrap)
				continue
			found += 1
			p = place(w, vocab) or w
			if p not in names:
				names.append(p)
		kept += len(names)
		head = '<p-n>' + ' · '.join(f'@{n}\t' for n in names) + '</p-n>' if names else ''
		# its ids its own, so maps on one page don't clash
		html = re.sub(r'(id="|#)(?:m[A-Za-z0-9]+_)?(clip|font|image|mask|pattern)_', lambda m: f'{m[1]}m{re.sub(r"[^A-Za-z0-9]", "", mid)}_{m[2]}_', d['html'])
		rows.append(f'{mid}\t{head}{html.replace("@", "@@").replace("^", "^^")}')
	with open(OUT, 'w', encoding='utf-8') as o:
		o.write(f'#desc\t{DESC}\n#priority\t2\n#lang\tmono\n')
		o.writelines(r + '\n' for r in rows)
	print(f'{len(rows)} maps, {kept} place names (of {found} labels read)', file=sys.stderr)

if __name__ == '__main__':
	main()
