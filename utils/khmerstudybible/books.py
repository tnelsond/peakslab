# Limon-encoded running heads of the study Bible -> peakslab (khov) book codes
HEADS = {
 'elakub,tþi':'gen','nikçmnM':'exo','nikçmn':'exo','nikkçmnM':'exo','nkçmnM':'exo',
 'elvIvin½y':'lev','elvivin½y':'lev','CnKNna':'num','ecaTiykfa':'deu','ecaTiyfa':'deu',
 'y:UesV':'jos','ecAhVay':'jdg','nagrs;':'rut','1saMyUEGl':'1sa','1saMy:UEGl':'1sa',
 '2saMyUEGl':'2sa','1BgSavtarkSRt':'1ki','1BgSvtarkSRt':'1ki','1BgSavtakSRt':'1ki',
 '2BgSavtarkSRt':'2ki','2BgSavtakSRt':'2ki','2BgSavtarkSt':'2ki','2BgSavtarRt':'2ki',
 '1r)akSRt':'1ch','1)akSRt':'1ch','2r)akSRt':'2ch','20r)akSRt':'2ch','2)akSRt':'2ch',
 'EGsr:a':'ezr','enehma':'neh','nageGseFIr':'est','y:Ub':'job','y::Ub':'job',
 'TMnukdMekIg':'psa','TMnudMekIg':'psa','TMnudkMekIg':'psa','suPasit':'pro','sasþa':'ecc',
 'bTcMerogsaLÚm:Un':'sol','eGsay':'isa','Gsay':'isa','eyerma':'jer','brieTv':'lam',
 'eGesKal':'eze','eGesKa':'eze','danIEy:l':'dan','hUes':'hos','y:UEGl':'joe','yU:EGl':'joe',
 'eGm:us':'amo','GU)aDa':'oba','y:UNas':'jon','yU:Nas':'jon','mIka':'mic','Nah‘um':'nah',
 'ha)aKuk':'hab','espana':'zep','hakay':'hag','sakarI':'zec','m:aLaKI':'mal',
 'm:afay':'mat','m:akus':'mar','lUka':'luk','y:Uhan':'joh','kic©kar':'act','r:Um':'rom',
 '1kUrinfUs':'1co','1kUrisfUs':'1co','2kUrinfUs':'2co','kaLaTI':'gal','eGePsUr':'eph',
 'PIlIB':'phi','kUlu:s':'col','1EfsSaLÚnIc':'1th','2EfsSaLÚnIc':'2th','1FIm:Uef':'1ti',
 '2FIm:Uef':'2ti','TItus':'tit','PIelm:Un':'phm','eheRBIr':'heb','y:akub':'jam',
 '1eBRtús':'1pe','2eBRtús':'2pe','1y:Uhan':'1jo','2y:Uhan':'2jo','3y:Uhan':'3jo',
 'yUdas':'jud','vivrN³':'rev',
}
ORDER = ['gen','exo','lev','num','deu','jos','jdg','rut','1sa','2sa','1ki','2ki','1ch','2ch',
 'ezr','neh','est','job','psa','pro','ecc','sol','isa','jer','lam','eze','dan','hos','joe',
 'amo','oba','jon','mic','nah','hab','zep','hag','zec','mal','mat','mar','luk','joh','act',
 'rom','1co','2co','gal','eph','phi','col','1th','2th','1ti','2ti','tit','phm','heb','jam',
 '1pe','2pe','1jo','2jo','3jo','jud','rev']
# The study Bible's own abbreviations (its table of books), Limon-encoded, in order
ABBR = ['lb','nk','lv','Cn','cT','ys','Bc','nr','1sy','2sy','1Bv','2Bv','1rb','2rb','Gr','nh',
 'nG','yb','Td','sP','ss','bs','Gs','yr','bT','GK','dy','hs','yG','Gm','Gb','yN','mIk','Nh',
 'hb','sp','hk','sk','mL','mf','mk','lk','yh','kc','rm','1kf','2kf','kT','GP','Pl','kl',
 '1fn','2fn','1Ff','2Ff','Tt','Pm','hB','yk','1Bt','2Bt','1yh','2yh','3yh','yd','vv']
ABBR2CODE = dict(zip(ABBR, ORDER))
ONECHAPTER = {'oba','phm','2jo','3jo','jud'}
