#!/usr/bin/env python3
"""Load PeakSlab Bible TSVs, clean verse text, tokenize.

Usage: prep.py OUT_DIR KHMER.tsv... -- ENGLISH.tsv...
Writes OUT_DIR/{khm,eng}_<name>.json : {verse_key: [tokens]} (eng tokens are "lemma|POS|surface");
a Bible's name is its file's (km-khsv.tsv: khsv)
"""
import sys, re, json, os, html
from concurrent.futures import ProcessPoolExecutor

OUT = sys.argv[1]
_args = sys.argv[2:]
_cut = _args.index('--') if '--' in _args else len(_args)
KHM, ENG = _args[:_cut], _args[_cut + 1:]
name = lambda path: os.path.basename(path).split('-', 1)[-1].rsplit('.tsv', 1)[0]

DROP_BLOCKS = re.compile(r'<(h\d|p-fn)[^>]*>.*?</\1>', re.S)
TAGS = re.compile(r'<[^>]+>')


def load(path):
    verses = {}
    for line in open(path, encoding='utf-8'):
        if line.startswith('#'):
            continue
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 3:
            continue
        key = parts[0].strip()
        text = ' '.join(parts[2:])
        text = DROP_BLOCKS.sub(' ', text)
        text = TAGS.sub(' ', text)
        text = html.unescape(text).replace('¶', ' ').replace('*', ' ')
        if key in verses:
            verses[key] += ' ' + text
        else:
            verses[key] = text
    return verses


KH_CHAR = re.compile(r'[ក-៿᧠-᧿]')
KH_SPLIT = re.compile(r'[\s​]+')
KH_PUNCT = re.compile(r'[។៕៖ៗ«»“”"\'()\[\],.;:!?\-–—…/៚]+')


def khmer_tokens(text, segmenter=None):
    text = text.replace('‌', '').replace('‍', '').replace('﻿', '')
    text = KH_PUNCT.sub(' ', text)
    out = []
    for chunk in KH_SPLIT.split(text):
        if not chunk:
            continue
        if not KH_CHAR.search(chunk):
            continue  # digits/latin noise
        # strip Khmer digits
        chunk = re.sub(r'[០-៩0-9]+', '', chunk)
        if not chunk:
            continue
        if segmenter and len(chunk) > 6:
            out.extend(t for t in segmenter(chunk) if t.strip() and KH_CHAR.search(t))
        else:
            out.append(chunk)
    return out


def do_khmer(path):
    v = load(path)
    sample = ''.join(list(v.values())[:500])
    zw_ratio = sample.count('​') / max(1, len(sample))
    seg = None
    if zw_ratio < 0.05:  # text without zero-width-space word breaks -> segment it
        import logging
        logging.disable(logging.CRITICAL)
        from khmernltk import word_tokenize
        seg = word_tokenize
    toks = {k: khmer_tokens(t, seg) for k, t in v.items()}
    json.dump(toks, open(f'{OUT}/khm_{name(path)}.json', 'w'), ensure_ascii=False)
    return name(path), len(toks), 'segmented' if seg else 'zwsp'


def do_english(path):
    import spacy
    nlp = spacy.load('en_core_web_sm', disable=['parser', 'ner'])
    v = load(path)
    keys = list(v)
    texts = [re.sub(r'\s+', ' ', v[k]).strip() for k in keys]
    toks = {}
    for k, doc in zip(keys, nlp.pipe(texts, batch_size=256)):
        t = []
        for w in doc:
            if w.is_punct or w.is_space or not re.search(r'[A-Za-z]', w.text):
                continue
            lemma = w.lemma_.lower() if w.pos_ != 'PROPN' else w.text
            lemma = lemma.strip("'’")
            if not lemma:
                continue
            t.append(f'{lemma}|{w.pos_}|{w.text}')
        toks[k] = t
    json.dump(toks, open(f'{OUT}/eng_{name(path)}.json', 'w'), ensure_ascii=False)
    return name(path), len(toks), 'spacy'


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    with ProcessPoolExecutor(max_workers=2) as ex:
        futs = [ex.submit(do_khmer, n) for n in KHM] + [ex.submit(do_english, n) for n in ENG]
        for f in futs:
            print(*f.result(), flush=True)
