const tablayout = [
	{name: "Dict", dicts: [
		["lao/db/kerr4.peak.zst", "Lo→En", 16*1024, `via <a href="https://sealang.net/lao/dictionary.htm">Sealang</a>.`],
		["lao/db/pat4.peak.zst", "Lo→En2", 16*1024, `via <a href="https://sealang.net/lao/dictionary.htm">Sealang</a>.`],
		["lao/db/csea.peak.zst", "Count", 1*1024, `via <a href="https://sealang.net/lao/dictionary.htm">Sealang</a>.`],
		["lao/db/agrilao.peak.zst", "Ag", 16*1024, `Agricultural dictionary from`],
		["lao/db/laotech.peak.zst", "IT", 8*1024, `IT dictionary from`],
	]},
	{name: "Bible", dicts: [
		["lao/db/lo_ulb.peak.zst", "laoULB", 32*1024, `Lao Unlocked Literal Bible from <a href="https://bibleineverylanguage.org/resources/languages/lo">Bible in every language</a>.`],
		["english/db/engULB.peak.zst", "enULB", 32*1024, `English Unlocked Literal Bible from <a href="https://bibleineverylanguage.org/resources/languages/en">Bible in every language</a>.`],
	]},
	{name: "Bible Notes", dicts: [
		["lao/db/laobibleword.peak.zst", "bibletran_lao", 32*1024, `Lao Bible translation words from <a href="https://bibleineverylanguage.org/resources/languages/lo?resource-type=tw">Bible in every language</a>.`],
		["english/db/bibleworden.peak.zst", "bibletran_en", 32*1024, `English Bible translation words from <a href="https://bibleineverylanguage.org/resources/languages/lo?resource-type=tw">Bible in every language</a>.`],
	]}
];

const scope = '/lao/';
const lang = [
	{name: "Lao", val: 'lo_LA'},
	{name: "English", val: 'en_US'}
];
const appname = 'lao';
