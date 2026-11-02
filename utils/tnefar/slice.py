#!/usr/bin/env python3
"""Cut each word clip's FARGAN features out of its whole recording's features.

usage: slice.py split/index.tsv raw_dir out_dir
Names are towebm.py's (zero-width chars and trailing punctuation dropped, _2, _3 for repeats),
so <out_dir>/<name>.f32 lines up with the webm slab's <name>.webm.
"""
import csv, os, re, sys
import numpy as np

index, raw_dir, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)

def clean(word):
    word = re.sub(r'[​-‍]', '', word)
    word = re.sub(r'[/\\:*?"<>|]', '_', word)
    return word.strip(' ,.៖')

used, feats = {}, {}
with open(index, encoding='utf-8') as f:
    for row in csv.DictReader(f, delimiter='\t'):
        word = clean(row['word'])
        used[word] = used.get(word, 0) + 1
        name = word if used[word] == 1 else f'{word}_{used[word]}'
        src = os.path.splitext(row['source'])[0]
        if src not in feats:
            feats[src] = np.fromfile(os.path.join(raw_dir, src + '.f32'), np.float32).reshape(-1, 20)
        x = feats[src]
        a = max(0, int(round(float(row['start']) * 100)))
        b = min(len(x), int(round(float(row['end']) * 100)))
        x[a:b].tofile(os.path.join(out_dir, name + '.f32'))
print(sum(used.values()), 'clips')
