#!/usr/bin/env python3
"""OPUS corpora (moses zips: <Corpus>.en-km.en, .km) as the TSVs utils/bible2dict
reads: <a>-<name>.tsv and <b>-<name>.tsv, a line each pair, keyed "<name> <n>"
(so one corpus's lines pair only with its own).

A pair is kept if each side is mostly its script (Khmer, Lao or Latin letters),
the lengths are within 3 times each other, and it's not a pair already kept.

Usage: [MAX=n] opustotsv.py OUT_DIR [A,B] NAME=ZIP...   (languages A,B: km,en if not given;
  e.g. opustotsv.py out subs=OpenSubtitles.zip kde=KDE4.zip; opustotsv.py out km,lo xlent=XLEnt.zip)
"""
import os, re, sys, zipfile

OUT = sys.argv[1]
args = sys.argv[2:]
A, B = args.pop(0).split(',') if args and '=' not in args[0] else ('km', 'en')
# each language's letters (Latin if not here)
RANGES = {'km': 'ក-៿', 'lo': 'ກ-໿', 'th': 'ก-๏', 'my': 'က-႟', 'ar': 'ء-ۿ', 'ur': 'ء-ۿ', 'apc': 'ء-ۿ', 'ru': 'Ѐ-ӿ',
          'hi': 'ऀ-ॿ', 'mr': 'ऀ-ॿ', 'ne': 'ऀ-ॿ', 'bn': 'ঀ-৿', 'as': 'ঀ-৿', 'pa': '਀-੿', 'gu': '઀-૿', 'or': '଀-୿',
          'ta': '஀-௿', 'te': 'ఀ-౿', 'kn': 'ಀ-೿', 'ml': 'ഀ-ൿ', 'am': 'ሀ-፿', 'ko': '가-힣ᄀ-ᇿ',
          'zh': '一-鿿', 'zh_cn': '一-鿿', 'zh_tw': '一-鿿', 'ja': '぀-ヿ一-鿿'}
SCRIPT = {c: re.compile(f'[{r}]') for c, r in RANGES.items()}
SCRIPT['en'] = LAT = re.compile('[A-Za-z]')
script = lambda c: SCRIPT.get(c, LAT)
MAX = int(os.environ.get('MAX', 0))  # (MAX=200000: a corpus's first that many pairs kept, at most)
# a pair's lengths (in letters) within these of each other: Chinese and Japanese are about a quarter of English
RATIO = {'zh': (1 / 8, 2), 'zh_cn': (1 / 8, 2), 'zh_tw': (1 / 8, 2), 'ja': (1 / 6, 2), 'ko': (1 / 5, 3)}


def mostly(text, script):
    letters = [c for c in text if c.isalpha() or any(r.match(c) for r in SCRIPT.values())]
    return letters and sum(bool(script.match(c)) for c in letters) >= 0.8 * len(letters)


os.makedirs(OUT, exist_ok=True)
for arg in args:
    name, path = arg.split('=', 1)
    z = zipfile.ZipFile(path)
    en = next(n for n in z.namelist() if n.endswith('.' + B))
    km = next(n for n in z.namelist() if n.endswith('.' + A))
    seen, n, kept = set(), 0, 0
    with z.open(en) as fe, z.open(km) as fk, \
            open(f'{OUT}/{B}-{name}.tsv', 'w', encoding='utf-8') as oe, open(f'{OUT}/{A}-{name}.tsv', 'w', encoding='utf-8') as ok:
        for le, lk in zip(fe, fk):
            n += 1
            e = le.decode('utf-8', 'replace').replace('\t', ' ').strip()
            k = lk.decode('utf-8', 'replace').replace('\t', ' ').strip()
            if not e or not k or not mostly(e, script(B)) or not mostly(k, script(A)) or hash((e, k)) in seen:
                continue
            lo, hi = RATIO.get(A, (1 / 3, 3))
            if not (lo <= len(k) / len(e) <= hi):
                continue
            seen.add(hash((e, k)))  # (a hash: millions of pairs, NLLB's)
            kept += 1
            if kept == MAX:
                break
            oe.write(f'{name} {n}\t\t{e}\n')
            ok.write(f'{name} {n}\t\t{k}\n')
    print(name, n, 'pairs,', kept, 'kept', flush=True)
