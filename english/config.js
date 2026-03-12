const tablayout = [
	{name: "Dict", dicts: [
		["english/db/opted.peak.zst", "En OPTED", 2*1024, `Online Plain Text English dictionary from Australian National University by Ralph S. Sutherland accessed via <a href="https://github.com/benjihillard/English-Dictionary-Database/">Benjihillard</a>`]]},
	{name: "Bible", dicts: [
		["english/db/engULB.peak.zst", "Bible En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/eng-kjv.peak.zst", "Bible KJV", 8*1024, `KJV bible from <a href="https://ebible.org">eBible</a>`],
		["english/db/eng-bsb.peak.zst", "Bible BSB", 8*1024, `Berean Standard Bible from <a href="https://ebible.org">eBible</a>`]]},
	{name: "BibleDic", dicts: [
		["english/db/bibleworden.peak.zst", "Bible tw", 32*1024, `Translation words from door43 via bibleineverylanguage`],
		["english/db/strongs.peak.zst", "Strongs", 2*1024, `<a href="https://github.com/openscriptures/strongs">Strongs by Openscriptures</a>`]]}
];

const scope = '/english/';
const lang = [
	{name: "English", val: 'en-US'}
];
const appname = 'en';
