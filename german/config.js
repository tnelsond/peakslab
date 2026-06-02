const tablayout = [
	{name: "Dict", dicts: [
		["german/db/oxford-de.peak.zst", "Oxford-de", 4*1024, `Oxford German English Dictionary (German Edition) version 3.0 from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs">freemdict</a>`],
		["german/db/duden.peak.zst", "de-de", 6*1024, `Duden - Das große Wörterbuch der deutschen Sprache from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs">freemdict</a>`],
	]},
	{name: "Bible", dicts: [
		["german/db/deuSchBible.peak.zst", "deBible", 4*1024, `Die Schlachter Bibel 1951 from <a href="https://ebible.org/details.php?id=deu1951">ebible</a>`],
		["english/db/engULB.peak.zst", "En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/engULB.peak.zst", "En_NASB", 8*1024, `New American Standard Bible from <a href="https://beblia.com">Beblia</a>`, false],
	]}
];

const scope = '/german/';
const lang = [
	{name: "German", val: 'de_GE'},
	{name: "English", val: 'en_US'}
];
const appname = 'de';
