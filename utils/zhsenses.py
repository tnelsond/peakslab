#!/usr/bin/env python3
"""Senses by Chinese: an English word's Khmer words (flatalign.py's list) grouped by the Chinese they go with
(zhpairs.py's: the same English word, the same verse, its Khmer and its Chinese), a sense a Chinese word, labelled
with it and its CC-CEDICT meaning with the English word in it (light: 光 "light; ray" ពន្លឺ ភ្លឺ, 灯 "lamp"
ចង្កៀង, 轻 "light" ស្រាល); the Chinese words one inside another one sense (光, 光明, 亮光). A Khmer word goes
with the Chinese it was most with (MIN verses at least, SHARE of them), the rest last; a word with one sense stays
a list. And the same the other way round: a Khmer word's English (flatalign.py's reverse list) by the Chinese.
Usage: zhsenses.py <flat km-align.tsv> <flat Khmer-English.tsv> <zhpairs.json> <zh-cedict.tsv> <out km-align.tsv>
       <out Khmer-English.tsv> [zh-kaikki.tsv]"""
import html, json, re, sys
from collections import defaultdict

FA, FK, ZP, CED, OUT, REV = sys.argv[1:7]
KAI = sys.argv[7] if len(sys.argv) > 7 else None  # (zh-kaikki: Wiktionary's Chinese, its words and meanings too)
MIN, SHARE, COVER = 2, .4, .6
norm = lambda k: k.replace('​', '').replace('្ដ', '្ត').strip()
zp = json.load(open(ZP))
ced = {}
for l in (x for f in [CED] + ([KAI] if KAI else []) for x in open(f, encoding='utf-8')):
    if not l.startswith('#') and '\t' in l:
        h, body = l.rstrip('\n').split('\t', 1)
        ms = [re.sub(r'\s*\(?CL:[^)]*\)?', '', html.unescape(re.sub(r'<[^>]+>', '', m))).strip(' ;')
              for m in re.findall(r'<li>(.*?)</li>', body) or re.findall(r'<p>([^@].*?)</p>', body)]
        ced.setdefault(h, []).extend(m for m in ms if m)

SKIP = re.compile(r'^(surname|variant of|old variant|abbr\.|see |used in|\(old\)|\(archaic\))', re.I)
def label(z, ens):
    """the Chinese word and three of its meanings (CC-CEDICT's, then Wiktionary's), one with the English word in it
    first: 灵 “spirit; quick; alert”, 灯 “light; lamp; lantern”"""
    parts = []
    for m in ced.get(z, []):
        if SKIP.match(m):
            continue
        for p in m.split(';'):
            p = re.sub(r'\((bound form|formal|literary|computing|coll\.|colloquial)\)\s*|\s*\(as in [^)]*\)|\[[^\]]*\]', '', p).strip()
            if p and len(p) <= 40:
                parts.append(p)
    parts = list(dict.fromkeys(parts))
    hit = [p for p in parts if any(re.search(r'\b' + re.escape(e) + r'(s|es)?\b', p, re.I) for e in ens)][:1]
    parts = (hit + [p for p in parts if p not in hit])[:3]
    return html.escape(z + (f' “{"; ".join(parts)}”' if parts else ''), quote=False)

def senses(items, dist):
    """items in their order; dist(item) -> {Chinese: weight}. -> [(head, [items])], [the rest]"""
    freq = defaultdict(float)
    for it in items:
        for z, x in dist(it).items():
            freq[z] += x
    head = {}
    for z in sorted(freq, key=lambda z: -freq[z]):
        head[z] = next((h for h in dict.fromkeys(head.values()) if h in z or z in h), z)
    groups, rest = defaultdict(list), []
    for it in items:
        d = defaultdict(float)
        for z, x in dist(it).items():
            d[head[z]] += x
        t = sum(d.values())
        h = max(d, key=d.get) if d else None
        if h and t >= MIN and d[h] >= SHARE * t:
            groups[h].append(it)
        else:
            rest.append(it)
    order = sorted(groups, key=lambda h: -sum(freq[z] for z in freq if head[z] == h))
    def name(h):
        """the sense's Chinese word: its shortest CC-CEDICT one of some weight (灯, not 点灯; 岸, not 两岸)"""
        ms = [z for z in freq if head[z] == h]
        top = max(freq[z] for z in ms)
        ok = [z for z in ms if z in ced and freq[z] >= .15 * top]
        return min(ok, key=lambda z: (len(z), -freq[z])) if ok else None
    out = []
    for h in order:
        z = name(h)
        if z:
            out.append((z, groups[h]))
        else:  # (no Chinese word CC-CEDICT knows: a segmenting slip, 上直奔)
            rest += groups[h]
    rest.sort(key=items.index)
    # (split only where the senses hold most of it: not make, its ធ្វើ 做 作 造 使 none of them alone)
    w = lambda it: sum(dist(it).values())
    if sum(w(it) for _, g in out for it in g) < COVER * (sum(w(it) for it in items) or 1):
        return [], items
    return out, rest

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
                    l = a + ('; by sense where the Chinese Bible tells them apart (the Chinese Union Version: the Khmer '
                             'words the same English word goes with in the same verses, by the Chinese it goes with '
                             'there; a sense a Chinese word, with its meanings from CC-CEDICT and Wiktionary, CC BY-SA 4.0). ') + b
                o.write(l)
                continue
            n += 1
            cells = body.split('\t')
            note = [c for c in cells[:1] if c.startswith('<p-n>(')]
            words = [c[1:] for c in cells if c.startswith('@')]
            after = [c for c in cells if not c.startswith('@') and c not in note]
            gs, rest = senses(words, lambda w: dist_of(h, w))
            if len(gs) < 2:
                o.write(l)
                continue
            split += 1
            lis = [f'<li><p-n>{label(z, gloss_ens(h, ws))}</p-n> ' + '\t'.join('@' + w for w in ws) + '</li>' for z, ws in gs]
            if rest:
                lis.append('<li>' + '\t'.join('@' + w for w in rest) + '</li>')
            o.write('\t'.join([h] + note + ['<ol>' + ''.join(lis) + '</ol>'] + after) + '\n')
    print(path_out, n, 'entries,', split, 'by sense', file=sys.stderr)

# English -> Khmer: the Khmer words' Chinese for that English word
write(FA, OUT, lambda e, k: zp.get(e.lower(), {}).get(norm(k), {}), lambda e, ws: [e])
# Khmer -> English: each English word's Chinese with that Khmer word
write(FK, REV, lambda k, e: zp.get(e.lower(), {}).get(norm(k), {}), lambda k, es: es)
