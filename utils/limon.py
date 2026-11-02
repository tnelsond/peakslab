"""Limon S (legacy Khmer font encoding) -> Unicode Khmer."""
import re

CO = '្'
M = {
 'k':'ក','x':'ខ','K':'គ','X':'ឃ','g':'ង','c':'ច','q':'ឆ','C':'ជ','Q':'ឈ','j':'ញ',
 'd':'ដ','z':'ឋ','D':'ឌ','Z':'ឍ','N':'ណ','t':'ត','f':'ថ','T':'ទ','F':'ធ','n':'ន',
 'b':'ប','p':'ផ','B':'ព','P':'ភ','m':'ម','y':'យ','r':'រ','l':'ល','v':'វ','s':'ស',
 'h':'ហ','L':'ឡ','G':'អ',
 ')':'ប','\\':'ឥ',']':'ឧ','[':'ឲ្យ','»':'ឱ','É':'ឯ','´':'ខ្ញុំ',
 'a':'ា','i':'ិ','í':'ិ','I':'ី','Í':'ី','w':'ឹ','W':'ឺ','å':'ឺ','u':'ុ','ú':'ុ',
 'U':'ូ','Ú':'ូ','Y':'ួ','Ü':'ួ','M':'ំ','H':'ះ',';':'់',':':'៉','_':'៍',
 'A':'ៅ','ó':'ៀ','O':'ឿ','Ó':'ឿ','×':'ិ៍',
 '0':'០','1':'១','2':'២','3':'៣','4':'៤','5':'៥','6':'៦','7':'៧','8':'៨','9':'៩',
 '.':'។','²':'ៗ','³':'ៈ','½':'័','‘':'៊','’':'៍','¼':'/','¦':')','¬':'(',
 '{':'«','}':'»','>':'.','/':',',
 # subscripts
 ',':CO+'ប','¶':CO+'ង','ñ':CO+'ន','ø':CO+'ល','Þ':CO+'ទ','þ':CO+'ត','S':CO+'ស',
 'V':CO+'វ','o':'ៀ','ü':CO+'យ','J':CO+'ញ','Á':CO+'គ','á':CO+'ក','ß':CO+'ថ',
 'ä':CO+'ឆ','Ø':CO+'ញ','Æ':CO+'ឍ','ð':CO+'ហ','µ':CO+'ម','¥':CO+'អ','<':CO+'ព',
 '§':CO+'ធ','Ö':CO+'ភ','©':CO+'ច','¢':CO+'ជ','æ':CO+'ឋ','ç':CO+'ខ','Ç':CO+'ឃ',
 'Ä':CO+'ឈ','Ð':CO+'ឌ','Ñ':CO+'ណ','\x00':'ឬ','\x01':'ឮ','\x02':'៌',
}
PRE = {'e':'េ', 'E':'ែ', 'é':'ៃ', 'R':CO+'រ', '®':CO+'រ'}
# a pre-written េ joins the vowel part written after the base
JOIN = {'ី':'ើ', 'ើ':'ើ', 'ៀ':'ៀ', 'ឿ':'ឿ', 'ៅ':'ៅ', 'ា':'ោ'}

def is_base(c):
    return 'ក' <= c <= 'ឳ'

def rank(m):
    if m.startswith(CO):
        return 2 if m == CO + 'រ' else 1
    if m in '៉៊': return 3
    if 'ា' <= m <= 'ៅ': return 4
    if m in 'ំះៈ': return 5
    return 6

def flush(out, pre, base, marks):
    if base is None:
        out.extend(PRE.get(p, p) for p in pre)
        return
    pv = [p for p in pre if p in 'eEé']
    marks = marks + [PRE[p] for p in pre if p in 'R®']
    if pv:
        v = PRE[pv[0]]
        if v == 'េ':
            j = [m for m in JOIN if m in marks]
            if j:
                marks[marks.index(j[0])] = JOIN[j[0]]
            else:
                marks.append(v)
        else:
            marks.append(v)
    marks = list(dict.fromkeys(marks))
    vowels = [m for m in marks if rank(m) == 4]
    if 'ុ' in vowels and len(vowels) > 1:  # ុ under another vowel = register shifter
        marks[marks.index('ុ')] = '៉' if base in 'ងញមយរវនល' else '៊'
        vowels.remove('ុ')
    if 'ា' in vowels and len(vowels) > 1:  # typo: ា with another vowel
        marks.remove('ា'); vowels.remove('ា')
    for m in vowels[1:]:  # typo: doubled vowels, keep the first
        marks.remove(m)
    marks.sort(key=rank)
    out.append(base + ''.join(marks))

def convert(s):
    s = re.sub(r'Ba?(?=a?[©äÄ¢ØJð])', 'j', s)  # ញ split as ព+ា before its subscript
    s = s.replace('b¤', '\x00').replace('B¤', '\x01')  # ឬ ឮ: ប ព + tail
    # ’ is ៊ over a vowel, ៌ over a consonant, else ៍
    s = re.sub(r'’(?=[aiíIÍwWåuúUÚYÜAóOÓ×])', '‘', s)
    s = re.sub(r'’(?=[A-Za-z)\\\]\[])', '\x02', s)
    out, pre, base, marks = [], [], None, []
    for ch in s:
        if ch in PRE:
            if base is not None or (ch in 'eEé' and any(p in 'eEé' for p in pre)):
                flush(out, pre, base, marks); pre, base, marks = [], None, []
            pre.append(ch)
            continue
        u = M.get(ch)
        if u and is_base(u[0]) and u not in ('ខ្ញុំ',):
            if base is not None:
                flush(out, pre, base, marks); pre, marks = [], []
            base = u
        elif u and (u.startswith(CO) or 'ា' <= u[0] <= '៝'):
            if base is None:
                out.append(u)
            else:
                marks.append(u)
        else:
            flush(out, pre, base, marks); pre, base, marks = [], None, []
            out.append(u if u else ch)
    flush(out, pre, base, marks)
    t = ''.join(out)
    t = t.replace('ណ្ត', 'ណ្ដ')
    return t
