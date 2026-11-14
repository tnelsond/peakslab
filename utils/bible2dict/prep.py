#!/usr/bin/env python3
"""Load PeakSlab Bible TSVs, clean verse text, tokenize.

Usage: prep.py OUT_DIR WORDS.txt SOURCE.tsv... -- TARGET.tsv...
Writes OUT_DIR/{khm,eng}_<name>.json : {verse_key: [tokens]} (eng tokens are "lemma|POS|surface",
the lemma lowercase: God and god, LORD and Lord one word);
a Bible's name is its file's (km-khsv.tsv: khsv)

A source is Khmer, Lao (laonlp's words, any zero-width spaces dropped) or a language
written with spaces; a target English (spaCy's), or Lao ("word|W|word": no lemmas,
no parts of speech)

WORDS.txt: Khmer words, one a line (the Khmer dictionaries' headwords). A word a
Bible writes in pieces (ZWSP between: ផ្ទៃ​មេឃ) is one token, the longest it makes
(្ដ and ្ត one letter: សេចក្តីស្រឡាញ់ is the dictionaries' សេចក្ដីស្រឡាញ់); and a run
that isn't a word (ULB's ព្រះរបស់, ដល់ដី: khmer-nltk's, or a Bible's own) is its
words, if it's 2 or 3 common ones (a name, ដាវីឌ, isn't ដា + វីឌ). A word is one
the dictionaries have, or one the word-spaced Bibles write whole more often than
in pieces (ព្រះយេស៊ូ 1,258 times whole in KHSV; ព្រះនៃ 8 times, against hundreds split)
"""
import sys, re, json, os, html
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor

OUT, WORDS = sys.argv[1:3]
_args = sys.argv[3:]
_cut = _args.index('--') if '--' in _args else len(_args)
KHM, ENG = _args[:_cut], _args[_cut + 1:]
name = lambda path: os.path.basename(path).split('-', 1)[-1].rsplit('.tsv', 1)[0]

DROP_BLOCKS = re.compile(r'<(h\d|p-fn)[^>]*>.*?</\1>', re.S)
INLINE = re.compile(r'</?(p-w|i|b|em|strong|span|a|u|small|sup|sub)(?=[\s/>])[^>]*>', re.I)  # in a word (its Strong's: <p-w>doesn</p-w>’t): nothing
TAGS = re.compile(r'<[^>]+>')  # the rest (lines: <p-q>, <p>, <br>): a space


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
        text = TAGS.sub(' ', INLINE.sub('', text))
        text = html.unescape(text).replace('¶', ' ').replace('*', ' ')
        if key in verses:
            verses[key] += ' ' + text
        else:
            verses[key] = text
    return verses


KH_CHAR = re.compile(r'[ក-៿᧠-᧿]')
KH_SPLIT = re.compile(r'[\s​]+')
KH_PUNCT = re.compile(r'[។៕៖ៗ«»“”"\'()\[\],.;:!?\-–—…/៚]+')


JOIN, JOIN_LEN = 3, 15  # at most 3 pieces, 15 letters, make a word


def whole_words(toks, words):
    """The pieces as whole words: at each, the longest run of pieces that's a word"""
    out, i = [], 0
    while i < len(toks):
        n = 1
        for m in range(min(JOIN, len(toks) - i), 1, -1):
            w = ''.join(toks[i:i + m])
            if len(w) <= JOIN_LEN and w.replace('\u17d2\u178f', '\u17d2\u178a') in words:
                n = m
                break
        out.append(''.join(toks[i:i + n]))
        i += n
    return out


COMMON = 50  # a word that splits a run: one the Bibles have on its own this often


def norm(w):
    return w.replace('\u17d2\u178f', '\u17d2\u178a')


def split_run(t, words, common, memo={}):
    """A run that's no word as its fewest common words (2 or 3), or itself"""
    if norm(t) in words or len(t) < 4:
        return [t]
    if t not in memo:
        best = None
        for i in range(1, len(t)):
            a, b = t[:i], t[i:]
            if norm(a) not in common:
                continue
            if norm(b) in common:
                best = [a, b]
                break
            for j in range(1, len(b)):
                if norm(b[:j]) in common and norm(b[j:]) in common and not best:
                    best = [a, b[:j], b[j:]]
        memo[t] = best or [t]
    return memo[t]


def khmer_tokens(text, segmenter=None, longer=6):
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
        if segmenter and len(chunk) > longer:
            out.extend(t for t in segmenter(chunk) if t.strip() and KH_CHAR.search(t))
        else:
            out.append(chunk)
    return out


def spaced(t):
    """A line already in words: zero-width spaces between them (as many as spaces at least, and
    one every 12 letters at least: a word-spaced Bible's is every 5; ULB's lines with a stray
    one, ស្ត្រីនិយាយទៅកាន់សត្វពស់ថា៖<ZWSP> «យើងអាច..., aren't)"""
    z = t.count('\u200b')
    return z > 0 and z >= t.count(' ') and len(KH_CHAR.findall(t)) <= 12 * z


LO_CHAR = re.compile('[\u0e81-\u0ecd\u0edc-\u0edf]')  # (Lao letters and marks: not its digits, ໐-໙)
LO_MARK = re.compile('[\u0eb0-\u0ebc\u0ec8-\u0ecd]')  # (a vowel sign, tone or mark: never a word's first)
LO_PUNCT = re.compile('[^\\s\u0e81-\u0ecd\u0edc-\u0edf]+')


# Lao written more than one way: ນໍ້າ, ນ້ໍາ, ນຳ້ are ນ້ຳ (ໍ + າ is ຳ, the tone before it); ໜ, ໝ are ຫນ, ຫມ
LO_SAME = [('\u0ecd\u0ec9\u0eb2', '\u0ec9\u0eb3'), ('\u0ec9\u0ecd\u0eb2', '\u0ec9\u0eb3'), ('\u0ecd\u0eb2', '\u0eb3'),
           ('\u0eb3\u0ec9', '\u0ec9\u0eb3'), ('\u0eb0\u0eb0', '\u0eb0'), ('\u0eb3\u0ec8', '\u0ec8\u0eb3'), ('\u0edc', '\u0eab\u0e99'), ('\u0edd', '\u0eab\u0ea1')]


def lao_norm(t):
    for a, b in LO_SAME:
        t = t.replace(a, b)
    return t


def lao(v):
    """Lao lines as laonlp's words"""
    from laonlp.tokenize import word_tokenize
    out = {}
    for k, t in v.items():
        t = LO_PUNCT.sub(' ', lao_norm(t.replace('\u200b', '').replace('‌', '').replace('‍', '').replace('ໆ', ' ')))
        ws = []
        for w in word_tokenize(t):
            if not LO_CHAR.search(w):
                continue
            if ws and LO_MARK.match(w):  # (a piece that starts with a vowel sign or tone: the word before's, from a typo, ປະຖົມ + ະ)
                ws[-1] += w
            else:
                ws.append(w)
        out[k] = ws
    return out


def script(v, char):
    return char.search(''.join(list(v.values())[:200]))


def thai(v):
    from pythainlp import word_tokenize
    return {k: [w for w in word_tokenize(t, keep_whitespace=False) if TH_CHAR.search(w)] for k, t in v.items()}


def chinese(v):
    import jieba, logging
    jieba.setLogLevel(logging.ERROR)
    return {k: [w for w in jieba.lcut(t) if HAN.search(w)] for k, t in v.items()}


def japanese(v):
    """janome's words, a verb's or adjective's dictionary form (された: する)"""
    from janome.tokenizer import Tokenizer
    tk, out = Tokenizer(), {}
    for k, t in v.items():
        ws = []
        for m in tk.tokenize(t):
            pos = m.part_of_speech.split(',')[0]
            w = m.base_form if pos in ('動詞', '形容詞') and m.base_form != '*' else m.surface
            if pos != '記号' and JA_CHAR.search(w):
                ws.append(w)
        out[k] = ws
    return out


def korean(v):
    """kiwi's words: not its particles and endings (하나님이: 하나님), a verb's or adjective's stem + 다"""
    from kiwipiepy import Kiwi
    kw, out = Kiwi(), {}
    for k, t in v.items():
        ws = []
        for m in kw.tokenize(t):
            if m.tag.startswith(('J', 'E', 'S', 'XS', 'XP', 'W', 'U')) or not KO_CHAR.search(m.form):
                continue
            ws.append(m.form + '다' if m.tag in ('VV', 'VA', 'VX', 'VV-R', 'VA-R', 'VV-I', 'VA-I') else m.form)
        out[k] = ws
    return out


TH_CHAR = re.compile('[\u0e01-\u0e4e]')
HAN = re.compile('[\u4e00-\u9fff\u3400-\u4dbf]')
JA_CHAR = re.compile('[\u3040-\u30ff\u4e00-\u9fff]')
KANA = re.compile('[\u3040-\u30ff]')
KO_CHAR = re.compile('[\uac00-\ud7a3]')
# languages written without spaces between words (or with particles on them, Korean), their word splitters
OTHERS = [(TH_CHAR, thai, 'thai'), (KANA, japanese, 'japanese'), (HAN, chinese, 'chinese'), (KO_CHAR, korean, 'korean')]
import regex
WORD = regex.compile(r"[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*")  # (a letter's marks in it: परमेश्वर, not परम + श + वर)
LATIN_WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*")


def lower_latin(texts):
    """A language written with spaces (ChiTonga), over all its texts: words lowercase
    unless written with a capital 85% of the time at least (Leza; not a sentence's first)"""
    caps = defaultdict(Counter)
    for toks in texts:
        for ws in toks.values():
            for w in ws:
                caps[w.lower()][w[:1].isupper()] += 1
    keep = {w for w, c in caps.items() if c[True] >= 0.85 * sum(c.values())}
    for toks in texts:
        for k, ws in toks.items():
            toks[k] = [w if w.lower() in keep else w.lower() for w in ws]


def do_khmer(path):
    """Its lines as words: as written if word-spaced (ZWSP), else khmer-nltk's (a line at a
    time: a corpus can be both); a text mostly word-spaced counts as such (zwsp). Not
    Khmer (another language beside the English: ChiTonga), its words as spaced"""
    import logging
    logging.disable(logging.CRITICAL)
    from khmernltk import word_tokenize
    v = load(path)
    if script(v, LO_CHAR):
        return name(path), lao(v), 'lao'
    for char, words, how in OTHERS:
        if script(v, char):
            return name(path), words(v), how
    if not script(v, KH_CHAR):
        return name(path), {k: WORD.findall(t) for k, t in v.items()}, 'latin'
    # (a word-spaced line's runs of several words too, ULB's: ...គ្រិស្ត ដោយសារជំនឿបានក្លាយជាប្រជារាស្រ្ត ដែល...)
    toks = {k: khmer_tokens(t, word_tokenize, 12 if spaced(t) else 6) for k, t in v.items()}
    return name(path), toks, 'zwsp' if sum(map(spaced, v.values())) * 2 > len(v) else 'segmented'


def do_english(path):
    v = load(path)
    if script(v, LO_CHAR):
        return name(path), {k: [f'{w}|W|{w}' for w in ws] for k, ws in lao(v).items()}, 'lao'
    import spacy
    nlp = spacy.load('en_core_web_sm', disable=['parser', 'ner'])
    keys = list(v)
    texts = [re.sub(r'\s+', ' ', v[k].replace('’', "'").replace('‘', "'")).strip() for k in keys]  # (spaCy splits doesn't, not doesn’t)
    toks = {}
    for k, doc in zip(keys, nlp.pipe(texts, batch_size=256)):
        t = []
        for w in doc:
            if w.is_punct or w.is_space or not re.search(r'[A-Za-z]', w.text) or '|' in w.text + w.lemma_:  # (| parts a token)
                continue
            low = w.text.lower().replace('’', "'")
            if low == "'s" or low == "'":  # a possessive: grammar (Khmer has it as របស់, or not at all)
                continue
            lemma = 'not' if low == "n't" else (w.lemma_ if w.pos_ != 'PROPN' else w.text).lower().replace('’', "'").strip("'")
            if not lemma or (len(lemma) == 1 and lemma not in 'io'):
                continue
            t.append(f'{lemma}|{w.pos_}|{w.text}')
        toks[k] = t
    return name(path), toks, 'spacy'


def possessives(eng):
    """A Bible without apostrophes (the ASV's "Abrahams", "Gods"): a capitalized
    word "Xs" it has far more often than any other Bible (the KJV has "Gods" twice),
    where it has the name X too, is X's (X)"""
    caps = {n: Counter(t.split('|', 2)[2] for v in toks.values() for t in v) for n, toks in eng.items()}
    for n, toks in eng.items():
        others = Counter()
        for m, c in caps.items():
            if m != n:
                others |= c  # (each word's most in another Bible)
        for v in toks.values():
            for i, t in enumerate(v):
                l, pos, w = t.split('|', 2)
                if len(w) > 2 and w[0].isupper() and w.endswith('s') and caps[n][w] > 3 * others[w] and caps[n][w[:-1]]:
                    v[i] = f'{w[:-1].lower()}|PROPN|{w[:-1]}'


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    with ProcessPoolExecutor(max_workers=2) as ex:
        futs = [ex.submit(do_english, n) for n in ENG]
        khm = [ex.submit(do_khmer, n) for n in KHM]
        khm = [f.result() for f in khm]
        lower_latin([toks for _, toks, how in khm if how == 'latin'])
        # whole words: the dictionaries' (a Bible's unsplit runs are phrases as often: ដល់ដី, មុខគេ)
        words = {l.strip().replace('\u17d2\u178f', '\u17d2\u178a') for l in open(WORDS, encoding='utf-8') if l.strip()}
        seen = Counter(norm(t) for _, toks, _ in khm for v in toks.values() for t in v)
        common = {w for w in words if seen[w] >= COMMON}
        whole, pieces = Counter(), Counter()  # in the word-spaced Bibles
        for _, toks, how in khm:
            if how == 'zwsp':
                for v in toks.values():
                    whole.update(norm(t) for t in v)
                    for i in range(len(v)):
                        for m in (2, 3):
                            if i + m <= len(v):
                                pieces[norm(''.join(v[i:i + m]))] += 1
        words |= {w for w, n in whole.items() if n >= 3 and n > pieces[w] and len(w) > 1}
        for n, toks, how in khm:
            if how in ('zwsp', 'segmented'):  # (Khmer)
                toks = {k: whole_words([x for t in v for x in split_run(t, words, common)], words) for k, v in toks.items()}
            json.dump(toks, open(f'{OUT}/khm_{n}.json', 'w'), ensure_ascii=False)
            print(n, len(toks), how, flush=True)
        eng = {}
        for f in futs:
            n, toks, how = f.result()
            eng[n] = toks
            print(n, len(toks), how, flush=True)
        possessives(eng)
        for n, toks in eng.items():
            json.dump(toks, open(f'{OUT}/eng_{n}.json', 'w'), ensure_ascii=False)
