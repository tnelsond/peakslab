#!/usr/bin/env python3
"""Old Lao spellings (with ຣ, as the Bibles and songs write them) as second
index words in the Lao dictionaries, which spell them the modern way:

    ພະເຈົ້າ<tab>@ພຣະເຈົ້າ<tab>...

so searching or glossing ພຣະເຈົ້າ finds ພະເຈົ້າ's entry.

The old spellings come from the texts, not from rules alone: each word with
ຣ in them, with each ຣ dropped (ພຣະ -> ພະ) or ລ (ຣາຊະ -> ລາຊະ), that's a
headword in a dictionary. And a ພຣະ... in a longer word: the longest
headword ພະ... it starts, if the texts have it as a word too (not ພຣະກາ
of ພຣະກາຍ). Names that are other words that way (ມາຣີ, Mary: ມາລີ, a
flower) are left out, so are short pieces (fewer than 5 characters, but
for ພຣະ..., and none ending in ພຣະ) and words that could be either of two.

    python3 utils/laoaltspell.py dict_src/lao

changes dict_src/lao/dict/*.tsv in place (each one changed keeps a .bak),
but not word counts and such (#lang aux, csea), and running it again adds
nothing new.
"""
import collections, glob, itertools, os, re, sys

RO, LO = 'ຣ', 'ລ'
PRA_OLD, PRA_NEW = 'ພຣະ', 'ພະ'  # ພຣະ, ພະ
# Names (and such) that would be other words without their ຣ
NOT = {'ມາຣີ', 'ຊາຣາ', 'ຊາຣີ', 'ຊີມຣີ', 'ອິຣັກ', 'ກະເຣຕັນ', 'ມະຫາໄຣ', 'ກຣີດ', 'ໂຣກາ', 'ຄຣິດວ່າ', 'ເຣນັ້ນ', 'ພຣະກະ'}
SPLIT = re.compile(r'[\s​­ .,;:!?“”‘’"\'()\[\]0-9a-zA-Z/@\-–—…«»·]+')

def corpus_files(root):
    fs = glob.glob(f'{root}/bible/**/*.tsv', recursive=True) + glob.glob(f'{root}/music/text/*.tsv')
    return sorted(f for f in fs if 'mien' not in f)  # (Iu Mien in Lao script, not Lao)

def words(files):
    n = collections.Counter()
    for f in files:
        for line in open(f, encoding='utf-8', errors='replace'):
            text = re.sub(r'<[^>]*>', ' ', line.partition('\t')[2])
            n.update(t for t in SPLIT.split(text) if RO in t)
    return n

def modern(w):
    """Each way to write w without its ຣ (dropped, or ລ)"""
    at = [i for i, c in enumerate(w) if c == RO][:4]
    for combo in itertools.product(['', LO], repeat=len(at)):
        s = list(w)
        for i, r in zip(at, combo):
            s[i] = r
        yield ''.join(s)

def old_spellings(corpus, heads):
    """{modern headword: {old spellings}}"""
    alt = collections.defaultdict(set)
    for w in corpus:
        if w in heads or w in NOT or w.endswith(PRA_OLD):
            continue
        # The whole word
        if len(w) >= 5 or w.startswith(PRA_OLD):
            m = {x for x in modern(w) if x != w and x in heads}
            if len(m) == 1:
                alt[m.pop()].add(w)
                continue
        # Each ພຣະ... in it: the longest headword ພະ... there
        for i in [m.start() for m in re.finditer(PRA_OLD, w)]:
            rest = w[i + len(PRA_OLD):]
            for j in range(len(rest), 0, -1):
                if PRA_NEW + rest[:j] in heads and RO not in rest[:j] and corpus[PRA_OLD + rest[:j]] and PRA_OLD + rest[:j] not in NOT:
                    alt[PRA_NEW + rest[:j]].add(PRA_OLD + rest[:j])
                    break
    return alt

def main(root):
    lines = {f: open(f, encoding='utf-8').read().split('\n') for f in sorted(glob.glob(f'{root}/dict/*.tsv'))}
    dicts = [f for f in lines if '#lang\taux' not in lines[f][:20]]
    heads = {f: {l.partition('\t')[0].strip() for l in ls} for f, ls in lines.items()}
    alt = old_spellings(words(corpus_files(root)), set().union(*heads.values()))
    print(f'{sum(map(len, alt.values()))} old spellings of {len(alt)} words')
    for f in dicts:
        added = 0
        out = []
        for l in lines[f]:
            h, tab, rest = l.partition('\t')
            new = [o for o in sorted(alt.get(h.strip(), ())) if o not in heads[f] and f'\t@{o}\t' not in f'\t{rest}\t']
            if tab and new:
                l = h + ''.join(f'\t@{o}' for o in new) + '\t' + rest
                added += len(new)
            out.append(l)
        if added:
            if not os.path.exists(f + '.bak'):
                os.rename(f, f + '.bak')
            open(f, 'w', encoding='utf-8').write('\n'.join(out))
        print(f'{f}: {added} added')

if __name__ == '__main__':
    main(sys.argv[1].rstrip('/'))
