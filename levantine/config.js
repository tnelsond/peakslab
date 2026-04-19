const tablayout = [
	{name: "Bible", dicts: [
		["levantine/db/vandyke.peak.zst", "apcBible", 8*1024, `Levantine Van Dyke bible from <a href="https://ebible.org/">ebible</a>.`],
		["english/db/engULB.peak.zst", "enULB", 8*1024, `English Unlocked Literal Bible from door43 and <a href=""https://bibleineverylanguage.org/>thebibleineverylanguage</a>.`],
	]},
	{name: "Dict", dicts: [
	]}
];

const scope = '/levantine/';
const lang = [
	{name: "Levantine", val: 'ar_APC'},
	{name: "English", val: 'en_US'}
];
const appname = 'apc';
