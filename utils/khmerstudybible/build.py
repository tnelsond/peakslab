#!/usr/bin/env python3
"""Turn parse.py's output (Limon text) into a peakslab Bible-notes .tsv keyed
to the KHOV verses: one entry per verse with its study notes, its cross
references (each with the words of the verse it's on) and parallel passages.

Usage: build.py <khov_verses.json> <out.tsv> <parsed.json>...
"""
import json, re, subprocess, sys, os
from html import escape
from collections import defaultdict
sys.path.insert(0, os.path.dirname(__file__))
from books import ORDER, ABBR, ABBR2CODE, ONECHAPTER

VERSES, OUT, PARSED = sys.argv[1], sys.argv[2], sys.argv[3:]
HERE = os.path.dirname(os.path.abspath(__file__))
MARKERS = 'kxKXgcqCQjdzDZNtfTFnbpBPmyrlvshLG'
NUMBERED = ['sy', 'Bv', 'rb', 'kf', 'fn', 'Ff', 'Bt', 'yh']
PLAIN = sorted((a for a in ABBR if not a[0].isdigit()), key=len, reverse=True)
BOOKRE = r'(?:([123]) ?(' + '|'.join(NUMBERED) + r')|(' + '|'.join(re.escape(a) for a in PLAIN) + r'))'
KH = str.maketrans('0123456789', '០១២៣៤៥៦៧៨៩')

khov = defaultdict(set)
for b, c, v in json.load(open(VERSES)):
    khov[b].add((c, v))
lastv = defaultdict(int)
for b, s in khov.items():
    for c, v in s:
        lastv[b, c] = max(lastv[b, c], v)
NAMES = {}  # khov's book names, for the entries' labels
for line in open(os.path.join(os.path.dirname(os.path.abspath(VERSES)), 'khov_names.tsv'), encoding='utf-8'):
    k, n = line.rstrip('\n').split('\t')
    NAMES[k] = n

# --------------------------------------------------------------- Limon -> Unicode
conv_in, conv_out = [], None
def L(s):
    """A placeholder for s converted (all of them converted at once later)"""
    conv_in.append(s)
    return f'\x00{len(conv_in) - 1}\x00'
def resolve(s):
    return re.sub(r'\x00(\d+)\x00', lambda m: conv_out[int(m.group(1))], s)

def kd(s): return str(s).translate(KH)

# --------------------------------------------------------------- references
REF = re.compile(r'(\d+)³(\d+)((?:\s?-\s?\d+(?:³\d+)?)?(?:/\d+(?:-\d+)?)*)')
def unglue(s):
    """'1³161Ff6³2' -> '1³16 1Ff 6³2'; 'mf23³8' -> 'mf 23³8'"""
    s = re.sub(r'(³\d*?\d)([123](?:' + '|'.join(NUMBERED) + r'))', r'\1 \2', s)
    s = re.sub(r'(?<=\d)>(?=\d)', '/', s)  # "9³6>7": 9:6, 7
    return s

def book_at(s, i, loose=False):
    """A book abbreviation at s[i] followed by a reference: (code, end, text)"""
    m = re.compile(BOOKRE + (r'(?=\s?\d)' if loose else r'(?=\s?\d+³\d)')).match(s, i)
    if not m:  # (after a word, too: Khmer has no spaces between words, "emIlCn 1³3")
        return None
    ab = (m.group(1) + m.group(2)) if m.group(2) else m.group(3)
    return ABBR2CODE[ab], m.end(), m.group(0)

def ref_links(code, c, v, rest, show_book):
    """'3³22/24' -> links; rest the '-5', '/24' part"""
    out = []
    first = True
    def link(target, text):
        return f'<p-a s="{target}">{escape(text)}</p-a>'
    m = re.match(r'\s?-\s?(\d+)(?:³(\d+))?', rest)
    lab = (L(show_book) + ' ' if show_book else '')
    if m:
        if m.group(2):
            c2, v2 = int(m.group(1)), int(m.group(2))
            out.append(link(f'{code} {c}.{v}-{c2}.{v2}', f'{kd(c)}:{kd(v)}-{kd(c2)}:{kd(v2)}'))
        else:
            v2 = int(m.group(1))
            out.append(link(f'{code} {c}.{v}-{v2}', f'{kd(c)}:{kd(v)}-{kd(v2)}'))
        rest = rest[m.end():]
    else:
        out.append(link(f'{code} {c}.{v}', f'{kd(c)}:{kd(v)}'))
    for m in re.finditer(r'/(\d+)(?:-(\d+))?', rest):
        a, b = int(m.group(1)), m.group(2)
        out.append(link(f'{code} {c}.{a}' + (f'-{b}' if b else ''), kd(a) + (f'-{kd(b)}' if b else '')))
    return lab + ', '.join(out)

def linkify(s, book, ch):
    """Limon text with references in it -> HTML (placeholders for the rest)"""
    s = re.sub(r'(?<=[\d³]) {2,}| {2,}(?=\d)', ' ', unglue(s))
    out, i, plain, cur = [], 0, '', book
    def flush():
        nonlocal plain
        if plain:
            out.append(L(plain))
            plain = ''
    while i < len(s):
        b = book_at(s, i)
        if b:
            code, j, txt = b
            m = REF.match(s, j + (1 if s[j:j + 1] == ' ' else 0))
            if m:
                flush()
                out.append(f'<span class="ref">{ref_links(code, int(m.group(1)), int(m.group(2)), m.group(3), txt)}</span>')
                cur, i = code, m.end()
                continue
        m = REF.match(s, i) if (i == 0 or not s[i - 1].isdigit()) else None
        if m:
            flush()
            out.append(ref_links(cur, int(m.group(1)), int(m.group(2)), m.group(3), None))
            i = m.end()
            continue
        m = re.compile(r'x>\s?(\d+)((?:/\d+|-\d+)*)').match(s, i) if ch and (i == 0 or not s[i - 1].isalpha()) else None
        if m:
            flush()
            out.append(L('x>'))
            # rebuild simply: each number (with its range) a link to this chapter
            seq = re.findall(r'(\d+)(?:-(\d+))?', re.sub(r'^x>\s?', '', m.group(0)))
            out.append(', '.join(f'<p-a s="{book} {ch}.{a}' + (f'-{b2}' if b2 else '') + f'">{kd(a)}' + (f'-{kd(b2)}' if b2 else '') + '</p-a>' for a, b2 in seq))
            i = m.end()
            continue
        ch_ = s[i]
        if ch_ in '¦.':
            cur = book
        plain += ch_
        i += 1
    flush()
    return ''.join(out)

# --------------------------------------------------------------- key a verse to KHOV
unaligned = defaultdict(int)
def key(code, c, v):
    """The KHOV verse a note on code c:v goes with (KHOV has it; else the
    nearest before it)"""
    if (c, v) in khov[code]:
        return c, v
    unaligned[code] += 1
    vs = [x for x in khov[code] if x[0] == c and x[1] <= v]
    if vs:
        return max(vs)
    vs = [x for x in khov[code] if x[0] == c]
    return min(vs) if vs else None

entries = defaultdict(lambda: {'notes': [], 'xrefs': [], 'par': []})  # (code, c, v)

def note_html(n):
    runs = n['runs']
    # A bold word's last letter is often set in the plain font: give it back
    for i in range(len(runs) - 1):
        a, b = runs[i], runs[i + 1]
        if a[1] and a[2] and not b[1] and b[2]:
            m = re.match(r'[^\s¬{]{1,2}(?=\s|$)', b[0])
            if m and not re.search(r'\d$', a[0]):
                a[0] += m.group(0)
                b[0] = b[0][m.end():]
    # Lines: Khmer runs on, a hyphen at a line's end joins the word
    parts = []
    for r in runs:
        if r[0] == '\n':
            if parts and parts[-1][2] and re.search(r'[^\d\s]-$', parts[-1][0]):
                parts[-1][0] = parts[-1][0][:-1]
            elif parts and re.search(r'\S$', parts[-1][0]):
                parts[-1][0] += '\x01'  # a line break: a space only if a number is next to it
            continue
        if parts and parts[-1][1] == r[1] and parts[-1][2] == r[2]:
            parts[-1][0] += r[0]
        else:
            parts.append(list(r))
    for i, p in enumerate(parts):
        nxt = parts[i + 1][0][:1] if i + 1 < len(parts) else ''
        p[0] = re.sub(r'(?<=[\d¦)])\x01|\x01(?=[\d¬(])', ' ', p[0])
        if p[0].endswith('\x01') and (nxt.isdigit() or p[0][-2:-1].isdigit()):
            p[0] = p[0][:-1] + ' '
        p[0] = p[0].replace('\x01', '')
        if p[1] and p[2] and nxt and not nxt.isspace() and not re.search(r'\s$', p[0]) and i + 1 < len(parts) and not parts[i + 1][1]:
            p[0] += ' '  # after a bold word
    c = n['start'][0]
    html = ''
    for t, b, lim in parts:
        if not t:
            continue
        h = linkify(t, n['book'], c) if lim else escape(t)
        html += f'<b>{h}</b>' if b and t.strip() else h
    lab = re.sub(r'(\d+)³', r'\1:', n['label']).replace('/', ',')
    return f'<p><b>{kd(lab)}</b>{html.rstrip()}</p>'

def ctx_text(ctx):
    """The words of the verse just before a marker (Limon): its last phrase"""
    ctx = ctx.rstrip()
    ph = ctx.rsplit(' ', 1)[-1] if ' ' in ctx else ctx
    return ph, ph != ctx

def build_xrefs(xstream, textmarks):
    tm, tmp = {}, set()
    for b, c, v, m, pg, ctx in textmarks:
        tm[b, c, v, m] = ctx
        tmp.add((b, c, v, m, pg))
    cur = None  # [code, c, v, groups]
    last = {}
    stats = defaultdict(int)
    for book, page, txt in xstream:
        s = re.sub(r'\s+', ' ', unglue(txt))
        toks = []
        i = 0
        while i < len(s):
            if s[i].isspace():
                i += 1
                continue
            m = re.compile(r'x>\s?(\d+(?:[-/]\d+)*)').match(s, i)
            if m:
                toks.append(('x', m.group(1)))
                i = m.end()
                continue
            b = book_at(s, i, True)
            if b:
                toks.append(('book', b[0], b[2]))
                i = b[1]
                continue
            m = REF.match(s, i)
            if m:
                toks.append(('ref', int(m.group(1)), int(m.group(2)), m.group(3)))
                i = m.end()
                continue
            m = re.compile(r'(\d+)(?=\s|$)').match(s, i)
            if m:
                toks.append(('num', int(m.group(1))))
                i = m.end()
                continue
            if s[i] in MARKERS:
                toks.append(('mk', s[i]))
                i += 1
                continue
            toks.append(('junk', s[i]))
            i += 1
        rb = None  # the book refs are in
        for k, t in enumerate(toks):
            nxt = toks[k + 1] if k + 1 < len(toks) else None
            prev = toks[k - 1] if k else None
            if t[0] == 'ref' and not t[3] and nxt and nxt[0] == 'mk':
                c, v, mk = t[1], t[2], nxt[1]
                lc = last.get(book, (0, 0))
                ok = (prev is None or prev[0] != 'book') and (
                    (book, c, v, mk, page) in tmp or (c, v) > lc and (c, v) in khov[book] and (
                        c == lc[0] and v - lc[1] <= 12 or c == lc[0] + 1 and v <= 12))
                if ok:
                    stats['anchors'] += 1
                    stats['in text' if (book, c, v, mk, page) in tmp else 'not in text'] += 1
                    last[book] = (c, v)
                    cur = [book, c, v, []]
                    xrefs_by_verse.setdefault((book, c, v), []).append(cur)
                    continue
            if not cur or cur[0] != book:
                stats['orphan'] += 1
                continue
            if t[0] == 'mk':
                ctx = tm.get((book, cur[1], cur[2], t[1]))
                cur[3].append([t[1], ctx, []])
                rb = None
                continue
            if not cur[3]:
                cur[3].append(['', None, []])
            g = cur[3][-1][2]
            if t[0] == 'book':
                rb = (t[1], t[2])
                g.append(('book',) + rb)
            elif t[0] == 'ref':
                code = rb[0] if rb else cur[0]
                if (t[1], t[2]) not in khov[code]:  # a group that runs on with the last group's book
                    alt = next((x[1] for gg in reversed(cur[3]) for x in reversed(gg[2]) if x[0] == 'book'), None)
                    if alt and (t[1], t[2]) in khov[alt]:
                        code = alt
                        rb = (alt, ABBR[ORDER.index(alt)])
                        g.append(('book',) + rb)
                g.append(('ref', code, t[1], t[2], t[3]))
            elif t[0] == 'x':
                g.append(('x', cur[0], cur[1], t[1]))
            elif t[0] == 'num' and rb and rb[0] in ONECHAPTER:
                g.append(('ref', rb[0], 1, t[1], ''))
            elif t[0] == 'num' and g and g[-1][0] in ('ref', 'v') and (g[-1][2], t[1]) in khov[g[-1][1]]:
                g.append(('v', g[-1][1], g[-1][2], t[1]))  # "15³35 36": a verse more
            elif t[0] == 'num' and rb and g and g[-1][0] == 'book':
                g.append(('ch', rb[0], t[1]))
    return stats

def group_html(g):
    out, pend = [], None
    for it in g:
        if it[0] == 'book':
            pend = it[2]
        elif it[0] == 'ref':
            out.append(ref_links(it[1], it[2], it[3], it[4], pend))
            pend = None
        elif it[0] == 'x':
            seq = re.findall(r'(\d+)(?:-(\d+))?', it[3])
            out.append(L('x>') + ', '.join(f'<p-a s="{it[1]} {it[2]}.{a}' + (f'-{b}' if b else '') + f'">{kd(a)}' + (f'-{kd(b)}' if b else '') + '</p-a>' for a, b in seq))
        elif it[0] == 'v':
            out[-1] += f', <p-a s="{it[1]} {it[2]}.{it[3]}">{kd(it[3])}</p-a>' if out else ''
        elif it[0] == 'ch':
            out.append((L(pend) + ' ' if pend else '') + f'<p-a s="{it[1]} {it[2]}.1">{L("CMBUk")} {kd(it[2])}</p-a>')
            pend = None
    return '; '.join(out)

def parallels_of(lines):
    res = []
    for book, page, txt in lines:
        s = unglue(txt)
        for m in re.finditer(r'(\d+)³(\d+)((?:-\d+(?:³\d+)?)?)\s*=\s*(.*?)(?=\s\d+³\d+(?:-\d+(?:³\d+)?)?\s*=|$)', s):
            c, v = int(m.group(1)), int(m.group(2))
            res.append((book, c, v, f'{c}³{v}{m.group(3)}', m.group(4)))
    return res

xrefs_by_verse = {}
allnotes, allx, alltm, allpar = [], [], [], []
for f in PARSED:
    d = json.load(open(f))
    allnotes += d['notes']
    allx += d['xstream']
    alltm += d['textmarks']
    allpar += d['parallels']

stats = build_xrefs(allx, alltm)
_tm = {(t[0], t[1], t[2], t[3]) for t in alltm}
_g = [(k, mk) for k, anchors in xrefs_by_verse.items() for a in anchors for mk, ctx, g in a[3]]
stats['groups'] = len(_g)
stats['groups matching a marker in the text'] = sum((*k, mk) in _tm for k, mk in _g)
stats['markers in the text'] = len(_tm)
stats['markers with refs'] = len(_tm & {(*k, mk) for k, mk in _g})
print('xrefs:', dict(stats), file=sys.stderr)

for n in allnotes:
    k = key(n['book'], *n['start'])
    if k:
        entries[(n['book'],) + k]['notes'].append(note_html(n))
    else:
        print('no verse for note', n['book'], n['label'], file=sys.stderr)

for (book, c, v), anchors in xrefs_by_verse.items():
    k = key(book, c, v)
    if not k:
        continue
    for a in anchors:
        for mk, ctx, g in a[3]:
            h = group_html(g)
            if not h:
                continue
            if ctx:
                ph, cut = ctx_text(ctx)
                lead = f'<i>{"…" if cut else ""}{L(ph)}</i> '
            else:
                lead = ''
            entries[(book,) + k]['xrefs'].append(f'<li>{lead}{h}</li>')

for book, c, v, lab, rest in parallels_of(allpar):
    k = key(book, c, v)
    if not k:
        continue
    g = []
    rb = None
    for t in re.finditer(BOOKRE + r'|(\d+)³(\d+)((?:\s?-\s?\d+(?:³\d+)?)?(?:/\d+(?:-\d+)?)*)', rest):
        if t.group(4):
            if rb:
                g.append(('ref', rb[0], int(t.group(4)), int(t.group(5)), t.group(6)))
        else:
            ab = (t.group(1) + t.group(2)) if t.group(2) else t.group(3)
            rb = (ABBR2CODE[ab], t.group(0))
            g.append(('book',) + rb)
    h = group_html(g)
    if h:
        labh = kd(re.sub(r'(\d+)³', r'\1:', lab))
        entries[(book,) + k]['par'].append(f'<li><b>{labh}</b> = {h}</li>')

# --------------------------------------------------------------- convert, write
conv_tmp = os.path.join(os.path.dirname(OUT) or '.', '.conv.json')
json.dump(conv_in, open(conv_tmp + '.in', 'w'), ensure_ascii=False)
subprocess.run(['node', os.path.join(HERE, 'conv.mjs'), os.path.abspath(conv_tmp + '.in'), os.path.abspath(conv_tmp + '.out')], check=True, cwd=HERE)
conv_out = [escape(x, quote=False).replace('@', '@@').replace('^', '^^') for x in json.load(open(conv_tmp + '.out'))]

rank = {b: i for i, b in enumerate(ORDER)}
lines = []
for (book, c, v) in sorted(entries, key=lambda k: (rank[k[0]], k[1], k[2])):
    e = entries[(book, c, v)]
    body = ''.join(e['notes'])
    if e['xrefs']:
        body += '<h4>ខគម្ពីរយោង</h4><ul class="xref">' + ''.join(e['xrefs']) + '</ul>'
    if e['par']:
        body += '<h4>អត្ថបទស្រដៀងគ្នា</h4><ul class="xref">' + ''.join(e['par']) + '</ul>'
    body = resolve(body)
    body = re.sub(r'\s+', ' ', body).replace('\t', ' ')
    lines.append(f'{book} {c}.{v}\t@{NAMES[book]} {c}:{v}\t{body}\n')

with open(OUT, 'w', encoding='utf-8') as out:
    out.write('#desc\tKhmer Study Bible notes and cross references (ព្រះគម្ពីរបរិសុទ្ធសម្រាប់សិក្សា), '
              'set to the Hammond 1954 Khmer Bible (KHOV). Study Notes © The Bible League; '
              'published by The Bible League Cambodia\n#priority\t3\n#lang\tmono\n#no sort\n#collapsed\n')
    out.writelines(lines)
os.remove(conv_tmp + '.in'); os.remove(conv_tmp + '.out')
print(len(lines), 'verses with notes;', sum(len(e['notes']) for e in entries.values()), 'notes,',
      sum(len(e['xrefs']) for e in entries.values()), 'cross-reference groups,',
      sum(len(e['par']) for e in entries.values()), 'parallels', file=sys.stderr)
print('not in KHOV (moved to the verse before):', dict(unaligned), file=sys.stderr)
