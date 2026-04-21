const tablayout = [
	{name: "Dict", dicts: [
		["portuguese/db/pt_oxford.peak.zst", "PtOxford", 8*1024, `Oxford Escolar Dicionário de Inglês-Português (1999) from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs?dir=/SPANISH/Spa-Eng">freemdict</a>`],
		["portuguese/db/pt-eng.peak.zst", "PT-ENG", 4*1024, `Portuguese English Dictionary from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs?dir=/SPANISH/Spa-Eng">freemdict</a>`],
		]},
	{name: "Bible", dicts: [
		["portuguese/db/pt-b-onv.peak.zst", "PtBOnv", 2*1024, `Portuguese Bible from <a href="https://ebible.org">eBible</a>.`, false],
		["portuguese/db/pt-b-mundial.peak.zst", "PtBMun", 2*1024, `Portuguese Bible from <a href="https://ebible.org">eBible</a>.`, false],
		["portuguese/db/pt-b-livre.peak.zst", "PtBLivre", 2*1024, `Portuguese Bible from <a href="https://ebible.org">eBible</a>.`],
		["english/db/eng-bsb.peak.zst", "engBSB", 2*1024, `(English) Berean Standard Bible from <a href="https://ebible.org">eBible</a>.`],
		["portuguese/db/pt_biblewords.peak.zst", "PtWords", 8*1024, `Portuguese Bible Translation words from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/bibleworden.peak.zst", "Bible tw", 32*1024, `Translation words from door43 via bibleineverylanguage`, false],
	]}
];

const scope = '/portuguese/';
const lang = [
	{name: "Portuguese", val: 'pt_BR'},
	{name: "English", val: 'en_US'}
];
const appname = 'pt';
