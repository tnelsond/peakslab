#!/usr/bin/env python3
"""English -> Chinese or Thai word alignment of the sentences that have Khmer too: the Bible's verses (BSB, ASV, ULB
English; the Chinese Union Version 1919, simplified, or the Thai 1940 and Thai KJV), ALT's sentences and FLORES-200's
(dev then devtest: "flores 1" to "flores 2009"). Each sentence's English words (spaCy lemmas, and the word as
written) and the words they were aligned with (eflomal, both ways where it can). Chinese cut by jieba (the Chinese
WordNet's words kept whole), Thai by PyThaiNLP (newmm).
Usage: pivot.py <zh|th> <dict_src> <ALT dir (data_*.txt)> <ALT English tsv> <FLORES-200 dir> <work dir> <out.pkl>
       [extra.tsv: key, English, the other language (opusjoin.py's)]
  out: {sentence key: {English word: Counter(its words)}}"""
import html, os, pickle, re, subprocess, sys
from collections import Counter, defaultdict
import spacy

LANG, SRC, ALT, ALTEN, FL, WD, OUT = sys.argv[1:8]
EXTRA = sys.argv[8] if len(sys.argv) > 8 else None
os.makedirs(WD, exist_ok=True)
if LANG == 'zh':
    import jieba
    from opencc import OpenCC
    t2s = OpenCC('t2s').convert
    jieba.setLogLevel(60)
    for l in open(f'{SRC}/chinese/thesaurus/zh-wn.tsv', encoding='utf-8'):
        if not l.startswith('#'):
            for w in re.findall(r'@([^\t<]+)', l):
                if 1 < len(w) <= 6 and re.fullmatch(r'[一-鿿]+', w):
                    jieba.add_word(w)
    cut = lambda t: jieba.cut(t)
    BIBLES, conv, ALTF, FLF = ['chinese/bible/text/zh-cuv1919t.tsv'], t2s, 'data_zh.txt', 'zho_Hans'
else:
    from pythainlp.tokenize import word_tokenize
    cut = lambda t: word_tokenize(t, engine='newmm')
    BIBLES, conv, ALTF, FLF = ['thai/bible/text/th-1940.tsv', 'thai/bible/text/th-kjv.tsv'], (lambda t: t), 'data_th.txt', 'tha_Thai'


def verses(path):
    for l in open(path, encoding='utf-8'):
        a = l.rstrip('\n').split('\t')
        if len(a) >= 3 and re.match(r'^[1-3]?[a-z]{2,3} \d+\.\d+$', a[0]):
            yield a[0], html.unescape(re.sub(r'<[^>]*>|¶', ' ', a[2]))


pairs = []  # (key, English, the other)
for bf in BIBLES:
    other = {k: conv(t) for k, t in verses(f'{SRC}/{bf}')}
    for b in ('en-bsb', 'en-asv', 'en-ULB'):
        for k, t in verses(f'{SRC}/english/bible/text/{b}.tsv'):
            if k in other:
                pairs.append((k, t, other[k]))
alt = {}
for l in open(f'{ALT}/{ALTF}', encoding='utf-8'):
    i, _, t = l.rstrip('\n').partition('\t')
    m = re.match(r'SNT\.(\d+)\.(\d+)', i)
    if m:
        alt[f'alt {m[1]}_{m[2]}'] = conv(t)
for l in open(ALTEN, encoding='utf-8'):
    a = l.rstrip('\n').split('\t')
    if len(a) >= 3 and a[0] in alt:
        pairs.append((a[0], a[2], alt[a[0]]))
n = 0
for part in ('dev', 'devtest'):
    for e, o in zip(open(f'{FL}/{part}/eng_Latn.{part}', encoding='utf-8'), open(f'{FL}/{part}/{FLF}.{part}', encoding='utf-8')):
        n += 1
        pairs.append((f'flores {n}', e.strip(), conv(o.strip())))
if EXTRA:
    for l in open(EXTRA, encoding='utf-8'):
        a = l.rstrip('\n').split('\t')
        if len(a) == 3 and a[1] and a[2]:
            pairs.append((a[0], a[1], conv(a[2])))
print(len(pairs), 'sentence pairs', file=sys.stderr, flush=True)

nlp = spacy.load('en_core_web_sm', disable=['parser', 'ner'])
en_lem, ot = [], []
for doc in nlp.pipe((t for _, t, _ in pairs), batch_size=1000):
    en_lem.append([(x.text.lower(), x.lemma_.lower()) for x in doc if not x.is_punct and not x.is_space])
for _, _, z in pairs:
    ot.append([w for w in cut(z) if w.strip() and not re.fullmatch(r'[\W\d_]+', w)])
with open(f'{WD}/en', 'w') as f:
    f.write(''.join(' '.join(t for t, _ in s) + '\n' for s in en_lem))
with open(f'{WD}/{LANG}', 'w') as f:
    f.write(''.join(' '.join(s) + '\n' for s in ot))
print('aligning', file=sys.stderr, flush=True)
subprocess.run(['eflomal-align', '-s', f'{WD}/en', '-t', f'{WD}/{LANG}', '-f', f'{WD}/fwd', '-r', f'{WD}/rev', '-m', '3',
                '--overwrite'], check=True)
out = defaultdict(lambda: defaultdict(Counter))
for (key, _, _), en, z, f, r in zip(pairs, en_lem, ot, open(f'{WD}/fwd'), open(f'{WD}/rev')):
    F = {tuple(map(int, x.split('-'))) for x in f.split()}
    R = {tuple(map(int, x.split('-'))) for x in r.split()}
    for i, j in (F & R) or F:  # (both ways, else forward)
        if i < len(en) and j < len(z):
            out[key][en[i][1]][z[j]] += 1
            if en[i][0] != en[i][1]:
                out[key][en[i][0]][z[j]] += 1
pickle.dump({k: dict(v) for k, v in out.items()}, open(OUT, 'wb'))
print(OUT, len(out), 'sentences', file=sys.stderr)
