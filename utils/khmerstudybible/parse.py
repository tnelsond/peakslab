#!/usr/bin/env python3
"""Parse the extracted segments of the Khmer Holy Study Bible (Limon-encoded
PDFs) into study notes, cross references and parallel passages, keyed by
book/chapter/verse.  Writes parsed.json (still Limon-encoded text)."""
import json, os, re, sys
from collections import defaultdict
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from books import HEADS, ORDER, ABBR, ABBR2CODE, ONECHAPTER

KHOV = defaultdict(set)
LASTV = defaultdict(int)
for _b, _c, _v in json.load(open(os.environ.get('KHOV_VERSES', 'khov_verses.json'))):
    KHOV[_b].add((_c, _v)); LASTV[_b, _c] = max(LASTV[_b, _c], _v)

def fix_label(book, label, prev):
    """A heading's reference, its digits maybe run into the bold words after
    it ('1³1714' for 1:17 '14...'): (label, the digits that weren't, (c, v))"""
    m = re.match(r'(\d+)(?:³(\d+))?', label)
    if m.group(2):
        c, vd = int(m.group(1)), m.group(2)
    elif book in ONECHAPTER:
        c, vd = 1, m.group(1)
    else:
        return None
    if book in ONECHAPTER and m.group(2) and (c, int(vd)) not in KHOV[book] and (1, c) in KHOV[book]:
        pass
    if m.group(2) and prev[2] == book and prev[0] and c != prev[0] and (c, int(vd)) not in KHOV[book] \
            and (prev[0], int(vd)) in KHOV[book] and (prev[0], int(vd)) >= prev[:2]:
        label = f'{prev[0]}³' + label[m.start(2):]  # a misprinted chapter ("4³46" in 1 Kings 8)
        return fix_label(book, label, prev)
    for k in range(len(vd), 0, -1):
        v = int(vd[:k])
        if k == len(vd) and (c, v) not in KHOV[book] and LASTV[book, c] < v <= LASTV[book, c] + 3 and (prev[2] != book or (c, v) >= prev[:2]):
            pass  # a verse KHOV numbers differently (its last, Deuteronomy 29:29): keep it
        elif not ((c, v) in KHOV[book] and (k == len(vd) or (c, v) >= prev[:2] or prev[2] != book)):
            continue
        if True:
            if k < len(vd):
                return label[:m.start(2 if m.group(2) else 1) + k], label[m.start(2 if m.group(2) else 1) + k:], (c, v)
            rest = label[m.end():]
            out = label[:m.end()]
            for p in re.finditer(r'([-/])(\d+)(?:³(\d+))?', rest):
                if p.group(3):
                    out += p.group(0)
                    continue
                n = p.group(2)
                ok = next((j for j in range(len(n), 0, -1) if v < int(n[:j]) <= LASTV[book, c]), None)
                if ok is None:
                    return out, rest[p.start():], (c, v)
                out += p.group(1) + n[:ok]
                if ok < len(n):
                    return out, rest[p.start() + 1 + ok:], (c, v)
            return out, '', (c, v)
    return None

BOLD = ('MNMBHH', 'KFZQUU', 'RUSYYI')
MARKERS = 'kxKXgcqCQjdzDZNtfTFnbpBPmyrlvshLG'

def is_note(s): return 14.0 <= s['size'] <= 16.2 and 'Lmn' in s['font']
def is_xref(s): return 12.4 <= s['size'] <= 13.6 and 'Lmn' in s['font']
def is_text(s): return 16.4 <= s['size'] <= 17.6 and 'Lmn' in s['font']
def is_vnum(s): return 11.5 <= s['size'] <= 12.5 and 'Lmn' in s['font'] and re.fullmatch(r'\s*\d+\s*', s['t'])
def is_chnum(s): return s['size'] >= 26 and 'Lmn' in s['font'] and re.fullmatch(r'\s*\d+\s*', s['t'])
def is_marker(s): return 9.5 <= s['size'] <= 10.5 and 'Lmn' in s['font']

def runs_of(seg, inv):
    """[(text, bold, limon)] for a segment"""
    limon = 'Lmn' in seg['font'] or 'CHHAY' in seg['font']  # (Chhay Round: the titles, Limon's encoding too)
    out = []
    for ch, f in zip(seg['t'].replace('\t', ' '), seg['b']):
        b = limon and inv[f].split('+')[0] in BOLD
        if out and out[-1][1] == b:
            out[-1][0] += ch
        else:
            out.append([ch, b, limon])
    return out

def runs_of_spaced(seg, inv):
    """runs_of, and a space before a segment that starts apart from the last"""
    return runs_of(seg, inv)

KINDS, REGIONS, FIGPDF = {}, {}, {}
def load_figures(jsonl, fig):
    d = json.load(open(fig))
    KINDS[jsonl], REGIONS[jsonl], FIGPDF[jsonl] = d['pages'], d['regions'], d['pdf']

def page_book(p):
    hs = [s['t'] for s in p['segs'] if s['top'] < 32 and s['size'] >= 16 and not re.fullmatch(r'\s*\d+\s*', s['t'])]
    name = re.sub(r'\s*\d+³.*', '', ' '.join(hs)).strip()
    name = re.sub(r'\s+\d+$', '', name).replace(' ', '')
    return HEADS.get(name)

def lines_of(segs, W, pred, extra=None, extra_alone=False, onecol=False):
    """Visual lines of the segments pred picks: [(col, top, x0, [runs])],
    left column then right column, top to bottom"""
    picked = [s for s in segs if pred(s)]
    lines = []
    for s in sorted(picked, key=lambda s: (s['x0'] >= W / 2 - 8, s['top'], s['x0'])):
        col = 0 if onecol else int(s['x0'] >= W / 2 - 8)
        for L in lines:
            if L['col'] == col and abs(L['top'] - s['top']) < 3:
                L['segs'].append(s)
                break
        else:
            lines.append({'col': col, 'top': s['top'], 'segs': [s]})
    if extra:  # e.g. English words (Times) set inside a note's line
        for s in segs:
            if extra(s):
                col = 0 if onecol else int(s['x0'] >= W / 2 - 8)
                for L in lines:
                    if L['col'] == col and -3 < s['top'] - L['top'] < 9:
                        L['segs'].append(s)
                        break
                else:
                    if extra_alone:
                        lines.append({'col': col, 'top': s['top'], 'segs': [s]})
    lines.sort(key=lambda L: (L['col'], L['top']))
    for L in lines:
        L['segs'].sort(key=lambda s: s['x0'])
    return lines

def main(files, out):
    notes = []    # {book, label, start:(c,v), page, runs}
    xstream = []  # (book, page, text)  Limon
    parallels = []  # (book, page, text)
    textmarks = {}  # (book, c, v, marker) -> context (Limon)
    vnums = defaultdict(set)
    prose, pagepos = [], []
    for path in files:
        book = None
        tc, tv = 0, 0  # text's chapter, verse
        for line in open(path):
            p = json.loads(line)
            W, H = p['wh']
            inv = {v: k for k, v in p['fonts'].items()}
            segs = [s for s in p['segs'] if s['top'] >= 32 or s['size'] < 16]
            hb = page_book(p)
            if hb and hb != book:
                book, tc, tv = hb, 0, 0
            kind = KINDS.get(path, {}).get(str(p['page']), 'text')
            if kind != 'text':  # an introduction, an outline, a map, a table: kept for build.py
                if kind != 'skip':
                    big = any(('Lmn' in s['font'] and s['size'] >= 17.9) or 'CHHAY' in s['font'] for s in p['segs'])
                    lines = []
                    if kind == 'prose':
                        body = [s for s in p['segs'] if 'Lmn' in s['font'] and 16 <= s['size'] <= 17.6]
                        spans = sum(1 for s in body if s['x0'] < W / 2 - 20 and s['x1'] > W / 2 + 20)
                        onecol = spans >= len(body) * 0.3 or spans >= 8  # (most such pages are one column)
                        for L in lines_of([s for s in p['segs'] if s['size'] > 1 and not re.fullmatch(r'\s*\d+\s*', s['t'])], W,
                                          lambda s: s['size'] > 1 and ('Lmn' in s['font'] or 'CHHAY' in s['font']),
                                          lambda s: ('Times' in s['font'] or 'Arial' in s['font']) and s['size'] > 1, True, onecol):
                            lines.append({'chhay': any('CHHAY' in x['font'] for x in L['segs']), 'col': L['col'], 'top': L['top'], 'x0': L['segs'][0]['x0'], 'x1': L['segs'][-1]['x1'],
                                          'size': max((x for x in L['segs'] if 'Times' not in x['font']), key=lambda x: len(x['t'].strip()))['size'] if any('Times' not in x['font'] for x in L['segs']) else 17,
                                          'runs': [r for x in L['segs'] for r in runs_of_spaced(x, inv)]})
                    prose.append({'page': p['page'], 'kind': kind, 'title': big, 'W': W, 'lines': lines,
                                  'pdf': FIGPDF.get(path)})
                continue
            if not book:
                continue
            p_book = book
            regions = [r[1:] for r in REGIONS.get(path, []) if r[0] == p['page']]
            if regions:  # a table among the text: a picture of it, not notes
                inside = lambda s: any(r[0] - 2 <= (s['x0'] + s['x1']) / 2 <= r[2] + 2 and r[1] - 2 <= s['top'] + s['size'] / 2 <= r[3] + 2 for r in regions)
                segs = [s for s in segs if not inside(s)]
                for r in regions:
                    prose.append({'page': p['page'], 'kind': 'region', 'bbox': r, 'pdf': FIGPDF.get(path), 'title': False, 'lines': []})
            # --- the Bible text: chapter and verse numbers, and the markers
            ctx = since = ''
            for s in segs:
                if is_chnum(s):
                    n = int(s['t'])
                    if tc < n <= tc + 3 or n == 1:
                        tc, tv, ctx, since = n, 1, '', ''
                elif 8.0 <= s['size'] <= 12.5 and 'Lmn' in s['font'] and re.fullmatch(r'[\s\dA-Za-z]+', s['t']):
                    # verse numbers and markers (both small; sometimes one segment: "v 17")
                    for tok in re.findall(r'\d+|[A-Za-z]', s['t']):
                        if tok.isdigit():
                            n = int(tok)
                            if tc == 0:
                                tc = 1
                            tv, ctx, since = n, '', ''
                            vnums[book].add((tc, n))
                        elif tok in MARKERS and tc:
                            textmarks.setdefault((book, tc, tv, tok, p['page']), since if len(since.strip()) >= 4 else ctx)
                            since = ''
                elif is_text(s):
                    ctx = (ctx + s['t'])[-200:]
                    since = (since + s['t'])[-200:]
            pagepos.append({'page': p['page'], 'pdf': FIGPDF.get(path), 'book': book, 'c': tc, 'v': tv})
            # --- notes
            nl = lines_of(segs, W, is_note, lambda s: 'Times' in s['font'] and 7 <= s['size'] <= 12.5)
            for L in nl:  # above some of the Bible's text: not a note
                L['intext'] = any(is_text(s) and s['top'] > L['top'] + 3 and (s['x0'] >= W / 2 - 8) == bool(L['col']) for s in segs)
            for L in nl:
                runs = []
                for s in L['segs']:
                    r = runs_of(s, inv)
                    if runs and runs[-1][2] and r and r[0][2] and s['x0'] - prev_x1 > 2 and not runs[-1][0].endswith(' '):
                        runs[-1][0] += ' '
                    runs += r
                    prev_x1 = s['x1']
                if not runs:
                    continue
                if runs[0][1] and runs[0][2]:  # a heading's digits may be in another font
                    while len(runs) > 1 and runs[1][2] and re.match(r'[\d³/-]', runs[1][0]) and re.search(r'[\d³]$', runs[0][0]):
                        dm = re.match(r'[\d³/-]+', runs[1][0])
                        runs[0][0] += dm.group(0)
                        runs[1][0] = runs[1][0][dm.end():]
                        if not runs[1][0]:
                            runs.pop(1)
                            if len(runs) > 1 and runs[1][1] == runs[0][1]:
                                runs[0][0] += runs.pop(1)[0]
                        else:
                            break
                first = runs[0]
                m = re.match(r'\s*(?:x>\s?)?(\d+(?:³\d+)?(?:\s*[-/]\s*\d+(?:³\d+)?)*)', first[0]) if first[1] and first[2] else None
                if m and not L['intext']:
                    label = re.sub(r'\s+', '', m.group(1))
                    prev = (notes[-1]['book'], *notes[-1]['start']) if notes else ('', 0, 0)
                    prev = (prev[1], prev[2], prev[0]) if prev[0] == book else (0, 0, '')
                    fx = fix_label(book, label, prev)
                    if fx:
                        label, back, (c, v) = fx
                        first[0] = back + first[0][m.end():]
                        notes.append({'book': book, 'label': label, 'start': [c, v], 'page': p['page'], 'runs': runs})
                        continue
                if L['intext']:  # a gospel harmony's line ("3³2-10-mf 3³1-10") in the text
                    t = ''.join(r[0] for r in runs)
                    if re.search(r'\d³\d', t):
                        parallels.append((book, p['page'], re.sub(r'^([\d³/,-]*\d)\s*-\s*', r'\1 = ', t.strip())))
                    continue
                if notes and notes[-1]['book'] == book:
                    nr = notes[-1]['runs']
                    nr.append(['\n', False, False])
                    nr += runs
                elif notes:  # a note continued from the last book's last page
                    notes[-1]['runs'] += [['\n', False, False]] + runs
            # --- cross references: the middle column, then what's under the text
            xs = [s for s in segs if is_xref(s)]
            mid = [s for s in xs if W * 0.40 < s['x0'] < W * 0.56 and s['x1'] - s['x0'] < 90]
            rest = [s for s in xs if s not in mid]
            par = [s for s in rest if '=' in s['t']]
            rest = [s for s in rest if s not in par]
            for s in sorted(par, key=lambda s: (s['x0'] >= W / 2 - 8, s['top'], s['x0'])):
                parallels.append((book, p['page'], s['t']))
            txt = ' '.join(s['t'] for s in sorted(mid, key=lambda s: (s['top'], s['x0'])))
            txt += ' ' + ' '.join(s['t'] for s in sorted(rest, key=lambda s: (s['x0'] >= W / 2 - 8, round(s['top']), s['x0'])))
            xstream.append((book, p['page'], txt))
    # A heading with a misprinted chapter ("5³10" among John 6's): the chapter
    # of the notes around it
    fixed = 0
    for i in range(1, len(notes) - 1):
        a, n, z = notes[i - 1], notes[i], notes[i + 1]
        if a['book'] == n['book'] == z['book'] and n['start'][0] != a['start'][0] == z['start'][0]:
            c, v = a['start'][0], n['start'][1]
            if a['start'][1] <= v <= z['start'][1] and (c, v) in KHOV[n['book']]:
                n['label'] = re.sub(r'^\d+³', f'{c}³', n['label'])
                n['start'] = [c, v]
                fixed += 1
    print(fixed, 'chapters fixed', file=sys.stderr)
    json.dump({'notes': notes, 'xstream': xstream, 'parallels': parallels,
               'textmarks': [[*k, v] for k, v in textmarks.items()],
               'vnums': {b: sorted(v) for b, v in vnums.items()},
               'prose': prose, 'pagepos': pagepos}, open(out, 'w'), ensure_ascii=False)
    print(len(notes), 'notes', len(xstream), 'xref pages', len(parallels), 'parallel lines', len(textmarks), 'text markers', file=sys.stderr)

if __name__ == '__main__':
    # parse.py <pages.jsonl> [figures.json] <out.json>
    args = sys.argv[1:]
    if len(args) == 3:
        load_figures(args[0], args[1])
        args = [args[0], args[2]]
    main(args[:-1], args[-1])
