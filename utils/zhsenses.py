#!/usr/bin/env python3
"""Senses by Chinese and Thai: an English word's Khmer words (flatalign.py's list) grouped by the Chinese and the
Thai they go with (zhpairs.py's, on pivot.py's sentences: the same English word, the same sentence, its Khmer and its
Chinese or Thai). In each language a Khmer word goes with the word it was most with (MIN sentences at least, SHARE
of them; its words one inside another one word: 光, 光明, 亮光); Khmer words one language puts together are one
sense (so Thai's royal and common words, หัตถ์ มือ, or Chinese synonyms, 争战 争斗, don't split one), named by
its Chinese (its shortest CC-CEDICT or Wiktionary word of weight, and three meanings, one with the English word in
it first: 光 “light; ray; bright”), and its Thai word; the rest last; a word whose senses don't hold most of it
(COVER) stays a list. The same the other way round: a Khmer word's English (flatalign.py's reverse list).
Usage: zhsenses.py <flat km-align.tsv> <flat Khmer-English.tsv> <zh-cedict.tsv> <zh-kaikki.tsv> <out km-align.tsv>
       <out Khmer-English.tsv> <zh pairs.json> [<th pairs.json>]"""
import html, json, re, sys
from collections import defaultdict

FA, FK, CED, KAI, OUT, REV, ZP = sys.argv[1:8]
TP = sys.argv[8] if len(sys.argv) > 8 else None
MIN, SHARE, COVER, CROSS = 2, .4, .6, .3
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()
PIV = {'zh': json.load(open(ZP))}
if TP:
    PIV['th'] = json.load(open(TP))
ced = {}
for l in (x for f in (CED, KAI) for x in open(f, encoding='utf-8')):
    if not l.startswith('#') and '\t' in l:
        h, body = l.rstrip('\n').split('\t', 1)
        ms = [re.sub(r'\s*\(?CL:[^)]*\)?', '', html.unescape(re.sub(r'<[^>]+>', '', m))).strip(' ;')
              for m in re.findall(r'<li>(.*?)</li>', body) or re.findall(r'<p>([^@].*?)</p>', body)]
        ced.setdefault(h, []).extend(m for m in ms if m)

SKIP = re.compile(r'^(a )?(surname|variant of|old variant|abbr\.|see |used in|short name|\(old\)|\(archaic\))', re.I)
def mentions(z, ens):
    return any(re.search(r'\b' + re.escape(e) + r'(s|es)?\b', m, re.I) for m in ced.get(z, []) for e in ens)

def label(z, ens):
    """(a part of the Chinese word whose meanings have the English word, the shortest: 岸 of 两岸, 灯 of 点灯)"""
    subs = [z[i:j] for i in range(len(z)) for j in range(i + 1, len(z) + 1) if z[i:j] != z and z[i:j] in ced]
    hit = [x for x in subs if mentions(x, ens)]
    if hit and not mentions(z, ens):  # (the whole word, where its meanings have it: 银行, 点灯, not 行, 点)
        z = min(hit, key=len)
    return label1(z, ens)

def label1(z, ens):
    """the Chinese word and three of its meanings (CC-CEDICT's, then Wiktionary's), one with the English word in it
    first: 灵 “spirit; quick; alert”, 灯 “light; lamp; lantern”"""
    parts = []
    for m in ced.get(z, []):
        if SKIP.match(m):
            continue
        for p in m.split(';'):
            p = re.sub(r'\((bound form|formal|literary|computing|coll\.|colloquial)\)\s*|\s*\(as in [^)]*\)|\[[^\]]*\]', '', p).strip()
            if p and len(p) <= 40 and not re.search('[一-鿿]| — |Synonyms', p) and not SKIP.match(p):  # (not an example)
                parts.append(p)
    parts = list(dict.fromkeys(parts))
    hit = [p for p in parts if any(re.search(r'\b' + re.escape(e) + r'(s|es)?\b', p, re.I) for e in ens)][:1]
    parts = (hit + [p for p in parts if p not in hit])[:3]
    return html.escape(z + (f' “{"; ".join(parts)}”' if parts else ''), quote=False)

def assign(items, dist, known=None):
    """one language: each item's word (its head), or none; and the words' weights and heads"""
    freq = defaultdict(float)
    for it in items:
        for z, x in dist(it).items():
            freq[z] += x
    head = {}
    for z in sorted(freq, key=lambda z: -freq[z]):
        head[z] = next((h for h in dict.fromkeys(head.values()) if h in z or z in h), z)
    out = {}
    for it in items:
        d = defaultdict(float)
        for z, x in dist(it).items():
            d[head[z]] += x
        t = sum(d.values())
        h = max(d, key=d.get) if d else None
        if h and t >= MIN and d[h] >= SHARE * t:
            out[it] = h
    if known is not None:  # (a Chinese word CC-CEDICT and Wiktionary know: not a segmenting slip, 上直奔)
        ok = {h for h in set(out.values()) if any(z in known for z in freq if head[z] == h)}
        out = {it: h for it, h in out.items() if h in ok}
    return out, freq, head

def senses(items, dists):
    """items in their order; dists: {language: item -> {its word: weight}}. -> [(label, [items])], [the rest]"""
    got = {lg: assign(items, d, ced if lg == 'zh' else None) for lg, d in dists.items()}
    up = {it: it for it in items}
    def find(x):
        while up[x] != x:
            up[x] = up[up[x]]; x = up[x]
        return x
    for lg, (a, _, _) in got.items():
        by = defaultdict(list)
        for it, h in a.items():
            by[h].append(it)
        for g in by.values():
            for it in g[1:]:
                up[find(it)] = find(g[0])
    comps = defaultdict(list)
    for it in items:
        if any(it in a for a, _, _ in got.values()):
            comps[find(it)].append(it)
    w = lambda it: sum(sum(d(it).values()) for d in dists.values())
    def name(g):
        out = []
        if 'zh' in got:
            a, freq, head = got['zh']
            hs = {a[it] for it in g if it in a}
            # (its weightiest Chinese word CC-CEDICT or Wiktionary has, in Chinese characters: not Windows' "Name")
            c = defaultdict(float)
            for it in g:
                for z, x in dists['zh'](it).items():
                    if head.get(z) in hs and z in ced and re.search('[一-鿿]', z):
                        c[z] += x
            if c:
                out.append(('zh', max(c, key=c.get)))
        if 'th' in got:
            a, freq, head = got['th']
            c = defaultdict(float)
            for it in g:
                if it in a:
                    c[a[it]] += sum(dists['th'](it).values())
            c = {z: x for z, x in c.items() if re.search('[\u0e01-\u0e5b]', z)}  # (Thai script: not "Name")
            if c:
                out.append(('th', max(c, key=c.get)))
        return out
    # Synonyms, not senses: two groups one of whose words a share (CROSS) of the other's alignments go to (defer's
    # 延 推迟 cross over; light's 光 轻 never do) are one
    def heads(lg, g):
        a, _, _ = got[lg]
        return {a[it] for it in g if it in a}
    def cross(lg, g1, g2):
        _, _, head = got[lg]
        H = heads(lg, g1)
        t = sum(sum(dists[lg](it).values()) for it in g2) or 1
        return sum(x for it in g2 for z, x in dists[lg](it).items() if head.get(z) in H) / t
    gl = list(comps.values())
    merged = True
    while merged and len(gl) > 1:
        merged = False
        for i in range(len(gl)):
            for j in range(i + 1, len(gl)):
                if any(max(cross(lg, gl[i], gl[j]), cross(lg, gl[j], gl[i])) >= CROSS for lg in got):
                    gl[i] = sorted(gl[i] + gl[j], key=items.index); del gl[j]; merged = True
                    break
            if merged:
                break
    gs = sorted(gl, key=lambda g: -sum(w(it) for it in g))
    rest = [it for it in items if not any(it in g for g in gs)]
    if len(gs) < 2 or sum(w(it) for g in gs for it in g) < COVER * (sum(w(it) for it in items) or 1):
        return [], items
    return [(name(g), g) for g in gs], rest

def rows(path):
    for l in open(path, encoding='utf-8'):
        if l.startswith('#'):
            yield l, None, None
        elif '\t' in l:
            h, body = l.rstrip('\n').split('\t', 1)
            yield l, h, body

def write(path_in, path_out, dist_of, gloss_ens):
    n = split = 0
    with open(path_out, 'w', encoding='utf-8') as o:
        for l, h, body in rows(path_in):
            if h is None:
                if l.startswith('#desc\t'):
                    a, b = l.split('. ', 1)
                    l = a + ('; by sense where Chinese and Thai tell them apart (the Khmer words the same English word goes '
                             'with in the same sentences, by the Chinese and Thai it goes with there: the Bible, the Chinese '
                             'Union Version and the Thai 1940 and KJV; ALT; FLORES-200; OPUS’s subtitles, TED talks, KDE, QED, '
                             'Wikimedia and TICO-19 by the same English sentence; a sense named by its Chinese, with meanings '
                             'from CC-CEDICT and Wiktionary, CC BY-SA 4.0, and its Thai). ') + b
                o.write(l)
                continue
            n += 1
            cells = body.split('\t')
            note = [c for c in cells[:1] if c.startswith('<p-n>(')]
            words = [c[1:] for c in cells if c.startswith('@')]
            after = [c for c in cells if not c.startswith('@') and c not in note]
            gs, rest = senses(words, {lg: (lambda P: lambda w: dist_of(P, h, w))(P) for lg, P in PIV.items()})
            if len(gs) < 2:
                o.write(l)
                continue
            split += 1
            def lab(nm, ws):
                zh = [z for lg, z in nm if lg == 'zh']
                th = [html.escape(z, quote=False) for lg, z in nm if lg == 'th']
                return ' · '.join(([label(zh[0], gloss_ens(h, ws))] if zh else []) + th)
            lis = [(f'<li><p-n>{lab(nm, ws)}</p-n> ' if lab(nm, ws) else '<li>') + '\t'.join('@' + w for w in ws) + '</li>'
                   for nm, ws in gs]
            if rest:
                lis.append('<li>' + '\t'.join('@' + w for w in rest) + '</li>')
            o.write('\t'.join([h] + note + ['<ol>' + ''.join(lis) + '</ol>'] + after) + '\n')
    print(path_out, n, 'entries,', split, 'by sense', file=sys.stderr)

# English -> Khmer: the Khmer words' Chinese for that English word
write(FA, OUT, lambda P, e, k: P.get(e.lower(), {}).get(norm(k), {}), lambda e, ws: [e])
# Khmer -> English: each English word's Chinese with that Khmer word
write(FK, REV, lambda P, k, e: P.get(e.lower(), {}).get(norm(k), {}), lambda k, es: es)
