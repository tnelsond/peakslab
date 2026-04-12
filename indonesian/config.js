const tablayout = [
	{name: "Dict", dicts: [
		["indonesian/db/kaikki-ind.peak.zst", "kaikki", 8*1024, `Kaikki Indonesian Dictionary from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs?dir=/INDONESIAN">freemdict</a>`],
		["indonesian/db/KBBI_EN.peak.zst", "KBBI En", 8*1024, `KBBI English Indonesian Dictionary from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs?dir=/INDONESIAN">freemdict</a>`],
		["indonesian/db/ind-eng.peak.zst", "ind-eng", 2*1024, ` Indonesian English Dictionary from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs?dir=/INDONESIAN">freemdict</a>`],
		]},
	{name: "Bible", dicts: [
		["indonesian/db/indTB.peak.zst", "Bible TB", 8*1024, `Alkitab Terjemahan Baru Indonesian bible from<a href="https://biblics.com/id/alkitab/alkitab-terjemahan-baru">biblics</a>`],
		["english/db/engULB.peak.zst", "Bible En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
	]}
];

const scope = '/indonesian/';
const lang = [
	{name: "Indonesian", val: 'id'},
	{name: "English", val: 'en_US'}
];
const appname = 'id';
