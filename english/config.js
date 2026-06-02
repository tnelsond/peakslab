const tablayout = [
	{name: "Dict", dicts: [
		["english/db/opted.peak.zst", "En OPTED", 2*1024, `Online Plain Text English dictionary from Australian National University by Ralph S. Sutherland accessed via <a href="https://github.com/benjihillard/English-Dictionary-Database/">Benjihillard</a>`],
		["english/db/oxforden.peak.zst", "oxford", 3*1024, `Oxford English dictionary from <a href="https://dic.1963.ru">https://dic.1963.ru</a>`]]},
	{name: "Bible", dicts: [
		["english/db/engULB.peak.zst", "Bible En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["english/db/eng-kjv.peak.zst", "Bible KJV", 8*1024, `KJV bible from <a href="https://ebible.org">eBible</a>`, false],
		["english/db/eng-bsb.peak.zst", "Bible BSB", 8*1024, `Berean Standard Bible from <a href="https://ebible.org">eBible</a>`, false],
		["english/db/eng-nasb.peak.zst", "Bible NASB", 8*1024, `New American Standard Bible from <a href="https://beblia.com">beblia</a>`, true],
		["english/db/eng-nkjv.peak.zst", "Bible NKJV", 8*1024, `New King James Version bible from <a href="https://beblia.com">beblia</a>`, false],
		["english/db/eng-amp.peak.zst", "Bible AMP", 8*1024, `Amplified bible from <a href="https://beblia.com">beblia</a>`, false]]},
	{name: "Music", dicts: [
		["english/db/hymn-collection.slab", "hymns", 32*1024, `from <a href="https://www.music-folk-play-hymns.com/Hymn-Lead-Sheets.html">Music-Folk-Play-Hymns.com</a>`],
		["english/db/psabradytate.peak.zst", "PsaBrady&Tate", 16*1024, `Psalter Brady & Tate from <a href="https://www.friendsofsabbath.org/cgmusic.com/workshop/index.htm">friends of sabbath</a>`],
		["english/db/psa1562.peak.zst", "PsaOld", 16*1024, `Psalter Old Version <a href="https://www.friendsofsabbath.org/cgmusic.com/workshop/index.htm">friends of sabbath</a>`],
		["english/db/psascott.peak.zst", "PsaScott", 16*1024, `The Scottish Psalter from <a href="https://www.friendsofsabbath.org/cgmusic.com/workshop/index.htm">friends of sabbath</a>`],
	]},
	{name: "BibleDic", dicts: [
		["english/db/bibleworden.peak.zst", "Bible tw", 32*1024, `Translation words from door43 via bibleineverylanguage`],
		["english/db/strongs.peak.zst", "Strongs", 2*1024, `<a href="https://github.com/openscriptures/strongs">Strongs by Openscriptures</a>`]]},
	{name: "Media", dicts: [
		["english/db/oxford-a.slab", "oxford-res", 16*1024, `Oxford English dictionary from <a href="https://dic.1963.ru">https://dic.1963.ru</a>`]
]},
];

const scope = '/english/';
const lang = [
	{name: "English", val: 'en_US'}
];
const appname = 'en';
