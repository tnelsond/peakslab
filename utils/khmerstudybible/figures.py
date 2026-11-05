#!/usr/bin/env python3
"""Find the study Bible's pictures: maps, charts and tables. A page without
Bible text that is mostly drawn (boxes, rules, a map) is one whole; on a page
of Bible text, a table or picture is the region its lines or image cover.

Usage: figures.py <pages.jsonl> <the PDF> <figures.json>
figures.json: {"pdf": path, "pages": {page: "text"|"prose"|"figure"|"skip"},
               "regions": [[page, x0, y0, x1, y1], ...]}"""
import json, re, sys
import os, pymupdf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse import page_book

SKIP = {  # covers, the publisher's pages, the foreword, the list of books
    'Old_Testament': {1, 2, 3, 4},
    'New_Testament': {1, 2, 3, 4, 5},
}

def textpage(p):
    n = sum(1 for s in p['segs'] if s['top'] >= 32 and 'Lmn' in s['font'] and re.fullmatch(r'\s*\d+\s*', s['t'])
            and (11.5 <= s['size'] <= 12.5 or s['size'] >= 26))
    notes = any(14 <= s['size'] <= 16.2 and 'Lmn' in s['font'] and s['top'] >= 32 for s in p['segs'])
    return n >= 1 or (notes and page_book(p) is not None)  # (a book's last page may have no verse number)

def clusters(rects, gap=6):
    """Rectangles that touch (within gap), merged"""
    out = []
    for r in rects:
        r = pymupdf.Rect(r)
        merged = True
        while merged:
            merged = False
            for o in out:
                if (o + (-gap, -gap, gap, gap)).intersects(r):
                    out.remove(o)
                    r |= o
                    merged = True
                    break
        out.append(r)
    return out

def main(jsonl, pdf, out):
    doc = pymupdf.open(pdf)
    skip = next((v for k, v in SKIP.items() if k in pdf), set())
    pages, regions = {}, []
    for line in open(jsonl):
        p = json.loads(line)
        n = p['page']
        pg = doc[n - 1]
        draws = [d['rect'] for d in pg.get_drawings() if d['rect'].width > 2 or d['rect'].height > 2]
        imgs = [pg.get_image_bbox(im) for im in pg.get_images(full=True)]
        imgs = [r for r in imgs if r.is_valid and r.width > 120 and r.height > 80]
        if n in skip:
            pages[n] = 'skip'
        elif textpage(p):
            pages[n] = 'text'
            for r in clusters(draws + imgs):
                if r.width > 150 and r.height > 45:  # a table (or a map) among the text
                    regions.append([n, *[round(x, 1) for x in r]])
        else:
            lmn = [s for s in p['segs'] if 'Lmn' in s['font'] and s['size'] > 1]
            pages[n] = 'figure' if len(draws) >= 8 or imgs or not lmn else 'prose'
    json.dump({'pdf': pdf, 'pages': pages, 'regions': regions}, open(out, 'w'))
    from collections import Counter
    print(Counter(pages.values()), len(regions), 'regions on text pages', file=sys.stderr)
    print('figures:', [k for k, v in pages.items() if v == 'figure'], file=sys.stderr)
    print('regions:', regions, file=sys.stderr)

if __name__ == '__main__':
    main(*sys.argv[1:4])
