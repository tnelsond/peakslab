#!/usr/bin/env python3
"""FLORES-200 (dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz, CC BY-SA 4.0:
the same 2,009 sentences in 200 languages) as the TSVs utils/bible2dict reads:
<code>-flores.tsv, a line each sentence, keyed "flores <n>" (dev, then devtest)

Usage: florestotsv.py TAR OUT_DIR CODE=FLORES_CODE...   (e.g. km=khm_Khmr lo=lao_Laoo en=eng_Latn)
"""
import os, sys, tarfile

TAR, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
t = tarfile.open(TAR)
names = {os.path.basename(m.name): m for m in t.getmembers() if m.isfile()}
for arg in sys.argv[3:]:
    code, fl = arg.split('=', 1)
    lines = [l for part in ('dev', 'devtest') for l in t.extractfile(names[f'{fl}.{part}']).read().decode('utf-8').splitlines()]
    with open(f'{OUT}/{code}-flores.tsv', 'w', encoding='utf-8') as f:
        f.writelines(f'flores {n}\t\t{l.replace(chr(9), " ").strip()}\n' for n, l in enumerate(lines, 1))
    print(code, len(lines))
