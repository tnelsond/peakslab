const tablayout = [
	{name: "Dict", dicts: [
		["nepali/db/ne-kaikki.peak.zst", "ne-kaikki", 8*1024, `From freemdict.`],
		["nepali/db/ne-sabdakosh.peak.zst", "ne-sab", 8*1024, `Nepali to Nepali dictionary (Nepali Brihat Sabdakosh by Nepal Academy) from freemdict.`],
		["nepali/db/ne-gp.peak.zst", "ne-gp", 8*1024, `Nepali English dictionary from Green Petal via freemdict.`],
	]},
	{name: "Bibles", dicts: [
		["nepali/db/ne-ULB.peak.zst", "ne-ULB", 16*1024, `Nepali Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/eng-bsb.peak.zst", "en-BSB", 8*1024, `Berean Standard Bible from <a href="https://ebible.org">eBible</a>`],
		["nepali/db/biblewordne.peak.zst", "neBibleWords", 32*1024, `Translation words from door43 via bibleineverylanguage`],
		["english/db/bibleworden.peak.zst", "Bible tw", 32*1024, `Translation words from door43 via bibleineverylanguage`],
	]},
	{name: "Media", dicts: [
		["nepali/db/ne-audio.slab", "ne-Forvo", 16*1024, `Nepali Forvo audio from <a href="https://cloud.freemdict.com/index.php/s/pgKcDcbSDTCzXCs">freemdict</a>`],
	]}
];

const scope = '/nepali/';
const lang = [
	{name: "Nepali", val: 'ne_NEP'},
	{name: "English", val: 'en_US'}
];
const appname = 'nep';
