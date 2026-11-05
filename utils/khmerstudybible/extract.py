import pdfplumber, json, sys
from multiprocessing import Pool
PDF=None
_pdf={}
FONTS={}
def seg_page(args):
    path, i = args
    if path not in _pdf: _pdf[path]=pdfplumber.open(path)
    pdf=_pdf[path]
    if True:
        p = pdf.pages[i]
        segs=[]; cur=None
        for c in p.chars:
            sz=round(c['size'],1); top=c['top']; fid = FONTS.setdefault(c['fontname'], chr(65+len(FONTS)))
            fn=c['fontname'].split('+')[-1]
            if (cur and cur['size']==sz and abs(cur['top']-top)<2.5 and c['x0']>=cur['lx']-9 and c['x0']-cur['x1']<40 and cur['font']==fn):
                if c['x0']-cur['x1']>(1.0 if sz<14 else sz*0.25) and not cur['t'].endswith(' ') and c['text']!=' ':
                    cur['t']+=' '; cur['b']+=fid
            else:
                cur={'size':sz,'top':round(top,1),'x0':round(c['x0'],1),'x1':0,'lx':c['x0'],'t':'','b':'', 'font':fn}
                segs.append(cur)
            cur['t']+=c['text']; cur['b']+= fid
            cur['x1']=max(cur['x1'],c['x1']); cur['lx']=c['x0']
        for s in segs: s['x1']=round(s['x1'],1); del s['lx']
        r= i, segs, [round(x,1) for x in (p.width,p.height)]
        p.close()
        return r+(dict(FONTS),)
if __name__=='__main__':
    path, out = sys.argv[1], sys.argv[2]
    with pdfplumber.open(path) as pdf: n=len(pdf.pages)
    with Pool(8) as pool, open(out,'w') as f:
        for i,segs,wh,fonts in pool.imap(seg_page, [(path,i) for i in range(n)], chunksize=4):
            f.write(json.dumps({'page':i+1,'wh':wh,'segs':segs,'fonts':fonts},ensure_ascii=False)+'\n')
