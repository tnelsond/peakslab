#!/usr/bin/env python3
"""OPUS English-Khmer corpora (moses zips: <Corpus>.en-km.en, .km) as the TSVs
utils/bible2dict reads: km-<name>.tsv and en-<name>.tsv, a line each pair,
keyed "<name> <n>" (so one corpus's lines pair only with its own).

A pair is kept if each side is mostly its script (Khmer letters; Latin), the
lengths are within 3 times each other, and it's not a pair already kept.

Usage: opustotsv.py OUT_DIR NAME=ZIP...   (e.g. subs=OpenSubtitles.zip kde=KDE4.zip)
"""
import os, re, sys, zipfile

OUT = sys.argv[1]
KH = re.compile(r'[ក-៿]')
LAT = re.compile(r'[A-Za-z]')


def mostly(text, script):
    letters = [c for c in text if c.isalpha() or KH.match(c)]
    return letters and sum(bool(script.match(c)) for c in letters) >= 0.8 * len(letters)


os.makedirs(OUT, exist_ok=True)
for arg in sys.argv[2:]:
    name, path = arg.split('=', 1)
    z = zipfile.ZipFile(path)
    en = next(n for n in z.namelist() if n.endswith('.en'))
    km = next(n for n in z.namelist() if n.endswith('.km'))
    seen, n, kept = set(), 0, 0
    with z.open(en) as fe, z.open(km) as fk, \
            open(f'{OUT}/en-{name}.tsv', 'w', encoding='utf-8') as oe, open(f'{OUT}/km-{name}.tsv', 'w', encoding='utf-8') as ok:
        for le, lk in zip(fe, fk):
            n += 1
            e = le.decode('utf-8', 'replace').replace('\t', ' ').strip()
            k = lk.decode('utf-8', 'replace').replace('\t', ' ').strip()
            if not e or not k or not mostly(e, LAT) or not mostly(k, KH) or (e, k) in seen:
                continue
            if not (1 / 3 <= len(k) / len(e) <= 3):
                continue
            seen.add((e, k))
            kept += 1
            oe.write(f'{name} {n}\t\t{e}\n')
            ok.write(f'{name} {n}\t\t{k}\n')
    print(name, n, 'pairs,', kept, 'kept', flush=True)
