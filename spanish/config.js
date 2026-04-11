const tablayout = [
	{name: "Dict", dicts: [
		["spanish/db/esoxford.peak.zst", "EsOxford", 8*1024, `Oxford Spanish English Dictionary from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs?dir=/SPANISH/Spa-Eng">freemdict</a>`],
		]},
	{name: "Bible", dicts: [
		["spanish/db/esULB.peak.zst", "Bible Es_ULB", 8*1024, `Spanish Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["spanish/db/es_biblewords.peak.zst", "EsWords", 8*1024, `Spanish Bible Translation words from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/engULB.peak.zst", "Bible En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/bibleworden.peak.zst", "Bible tw", 32*1024, `Translation words from door43 via bibleineverylanguage`],
	]}
];

const scope = '/spanish/';
const lang = [
	{name: "Spanish", val: 'es_SP'},
	{name: "English", val: 'en_US'}
];
const appname = 'es';
