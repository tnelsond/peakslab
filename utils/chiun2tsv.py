"""ChiUn (CrossWire's SWORD module of the Chinese Union Version, traditional, FHL's Strong's tags, public
domain) into a peakslab Bible .tsv: a word's Strong's number <p-w s=H7225>; its book codes and names
zh-cuv1919t's. Usage: chiun2tsv.py <module dir> <zh-cuv1919t.tsv> <out.tsv>"""
import sys, re
from pysword.modules import SwordModules
X, REF, OUT = sys.argv[1:4]
m = SwordModules(X); m.parse_modules(); b = m.get_bible_from_module('ChiUn')
st = b.get_structure()
books = [bk for t in ('ot', 'nt') for bk in st.get_books()[t]]
codes, names = [], {}
for l in open(REF, encoding='utf-8'):
    a = l.split('\t')
    if len(a) >= 3 and re.match(r'^[1-3]?[a-z]{2,3} \d+\.\d+$', a[0]):
        c = a[0].split()[0]
        if c not in names:
            codes.append(c); names[c] = a[1].rsplit(' ', 1)[0].lstrip('@')
assert len(codes) == len(books) == 66, (len(codes), len(books))
def tag(m):  # (its first number, not a prefix's (H9002, "in"); the morphology codes after it (H8804, G5656))
    ss = [re.sub(r'^([HG])0*', r'\1', s) for s in re.findall(r'strong:([HG]\d+)', m[1])]
    ss = [s for s in ss if not re.fullmatch(r'H9\d{3}', s)]
    return f'<p-w s={ss[0]}>{m[2]}</p-w>' if ss and m[2] else m[2]
n = 0
with open(OUT, 'w', encoding='utf-8') as o:
    for code, bk in zip(codes, books):
        for c in range(1, bk.num_chapters + 1):
            for v in range(1, bk.chapter_lengths[c - 1] + 1):
                t = b.get(books=[bk.osis_name], chapters=[c], verses=[v], clean=False)
                t = re.sub(r'<note.*?</note>', '', t)
                t = re.sub(r'<w lemma="([^"]*)"[^>]*>([^<]*)</w>', tag, t)
                t = re.sub(r'\s+', '', re.sub(r'<(?!/?p-w)[^>]*>', '', t)).replace('　', '').replace('<p-ws=', '<p-w s=')  # (no spaces between Chinese words)
                if t:
                    o.write(f'{code} {c}.{v}\t@{names[code]} {c}:{v}\t{t}\n'); n += 1
print(n, 'verses', file=sys.stderr)
