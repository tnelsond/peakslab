const tablayout = [
	{name: "Bible", dicts: [
		["chitonga/db/toibible.peak.zst", "tongaBible", 8*1024, `Tonga Standard Bible from door43 and <a href=""https://bibleineverylanguage.org/>thebibleineverylanguage</a>.`],
		["english/db/engULB.peak.zst", "enULB", 8*1024, `English Unlocked Literal Bible from door43 and <a href=""https://bibleineverylanguage.org/>thebibleineverylanguage</a>.`],
	]},
	{name: "Dict", dicts: [
		["chitonga/db/tother.peak.zst", "other", 8*1024, `From the Chitonga dictionary.`],
		["chitonga/db/tverbs.peak.zst", "verbs", 8*1024, `From the Chitonga dictionary.`],
		["chitonga/db/tnouns.peak.zst", "nouns", 8*1024, `From the Chitonga dictionary.`],
	]}
];

const scope = '/chitonga/';
const lang = [
	{name: "Chitonga", val: 'toi-ZM'},
	{name: "English", val: 'en-US'}
];
const appname = 'tonga';
