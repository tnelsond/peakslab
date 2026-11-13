"""The Greek and Hebrew of STEPBible's TAGNT and TAHOT (grc-tagnt.tsv, hbo-tahot.tsv),
for strongs.py and taggedstrongs.py: each verse's Strong's numbers, and each number's
word, transliteration and English gloss (its commonest; the lexicons' dictionary form,
grc-tbesg.tsv and hbo-tbesh.tsv, where they have it)"""
import re
from collections import Counter, defaultdict


def originals(tagnt, tahot, lexicons):
    orig = {}   # verse -> [Strong's]
    forms = defaultdict(Counter)
    for path in (tagnt, tahot):
        for line in open(path, encoding='utf-8'):
            if line.startswith('#'):
                continue
            key, _, body = line.rstrip('\n').split('\t', 2)
            body = re.sub(r'<[^>]+>', '', body)
            ss = []
            for w in body.split(' ¦ '):
                f = w.split('|')
                if len(f) < 4 or not re.match(r'[GH]\d+', f[3]):
                    continue
                s = re.match(r'[GH]\d+', f[3])[0]
                ss.append(s)
                forms[s][(re.sub(r'[^\w֐-׿Ͱ-Ͽἀ-῿]', '', f[0]), f[1], re.sub(r'[\[\]‹›]', '', f[2]).strip('.,;:'))] += 1
            orig[key] = ss
    word = {s: c.most_common(1)[0][0] for s, c in forms.items()}
    for path in lexicons:
        for line in open(path, encoding='utf-8'):
            m = re.match(r'([GH]\d+)\t<b>@([^\t<]+)\t</b>(?:<p-ipa>@([^<]*)</p-ipa>)?', line)
            if m and m[1] in word:
                word[m[1]] = (m[2].strip(), (m[3] or word[m[1]][1]).strip(), word[m[1]][2])
    return orig, word


def code(key):
    """"1sa 17.1" -> "1Sa 17.1", the form a verse link takes"""
    b, rest = key.split(' ', 1)
    return (b[:2].upper() + b[2:] if b[0].isdigit() else b.capitalize()) + ' ' + rest
