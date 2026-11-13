#!/usr/bin/env python3
"""OPUS corpora (moses zips: <Corpus>.en-km.en, .km) as the TSVs utils/bible2dict
reads: <a>-<name>.tsv and <b>-<name>.tsv, a line each pair, keyed "<name> <n>"
(so one corpus's lines pair only with its own).

A pair is kept if each side is mostly its script (Khmer, Lao or Latin letters),
the lengths are within 3 times each other, and it's not a pair already kept.

Usage: opustotsv.py OUT_DIR [A,B] NAME=ZIP...   (languages A,B: km,en if not given;
  e.g. opustotsv.py out subs=OpenSubtitles.zip kde=KDE4.zip; opustotsv.py out km,lo xlent=XLEnt.zip)
"""
import os, re, sys, zipfile

OUT = sys.argv[1]
args = sys.argv[2:]
A, B = args.pop(0).split(',') if args and '=' not in args[0] else ('km', 'en')
SCRIPT = {'km': re.compile(r'[ក-៿]'), 'lo': re.compile(r'[ກ-໿]'), 'en': re.compile(r'[A-Za-z]')}


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
            if not e or not k or not mostly(e, SCRIPT[B]) or not mostly(k, SCRIPT[A]) or (e, k) in seen:
                continue
            if not (1 / 3 <= len(k) / len(e) <= 3):
                continue
            seen.add((e, k))
            kept += 1
            oe.write(f'{name} {n}\t\t{e}\n')
            ok.write(f'{name} {n}\t\t{k}\n')
    print(name, n, 'pairs,', kept, 'kept', flush=True)
