const tablayout = [
	{name: "Dict", dicts: [
		["khmer/db/sonv3.peak.zst", "En→Km", 32*1024, `From <a href="https://play.google.com/store/apps/details?id=com.sonveasna.dictionary&hl=en">English Khmer Dictionary</a> by DroidSVS`],
		["khmer/db/khmer92_h97.peak.zst", "Km→En", 32*1024, `<em>Cambodian-English Dictionary</em> by Robert K. Headley, Rath Chim, and Ok Soeum <em>(1997, Dunwoody Press, ISBN 0-931745-78-0)</em> via <a href="https://sealang.net/khmer/dictionary.htm">Sealang</a>.`],
		["khmer/db/baby.peak.zst", "Baby", 4*1024, `Tovnah.com (URL stopped working)`],
		["khmer/db/plantdict.peak.zst", "Plants", 3*1024, `<a href="https://www.plantsdictionarykh.com/">PlantsDictionaryKh.com</a>`],
		["khmer/db/ant.peak.zst", "ANT", 32*1024, `<a href="https://antkh.com/">antkh.com</a>`],
		["khmer/db/nath2022_8.peak.zst", "Km→Km", 32*1024, `2022 version of the <a href="https://play.google.com/store/apps/details?id=com.optimiskh.chuonnathdictionary&hl=en-US">Chuon Nath Digital Dictionary</a>.`],
		["khmer/db/seacount.peak.zst", "Count", 1*1024, `via <a href="https://sealang.net/khmer/dictionary.htm">Sealang</a>.`],
	]},
	{name: "♫", dicts: [
		["khmer/db/hymns7.peak.zst", "Hymn", 32*1024, `<a href="https://www.khmerworship.com/">Khmer Worship</a>`],
	]},
	{name: "Bible", dicts: [
		["khmer/db/bible.peak.zst", "Bible", 16*1024, "From my khsv bible and a blue bible dictionary."],
		["khmer/db/bibletrans.peak.zst", "Bible2", 64*1024, `Translation words from <a href="https://door43.org/">door43</a>`],
		["khmer/db/kmULB.peak.zst", "Km_ULB", 32*1024, `Khmer Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["khmer/db/engULB.peak.zst", "En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`],
		["khmer/db/strongs.peak.zst", "Strongs", 2*1024, `<a href="https://github.com/openscriptures/strongs">Strongs by Openscriptures</a>`],
	]},
	{name: "Media", dicts: [
		["khmer/db/zzz.slab.zst", "Assets", 256*1024, `Contains images from the plantsdictionarykh.com as well as audio from <a href="kheng.info">kheng.info</a>.`],
	]}
];

const scope = '/khmer/';
const lang = [
	{name: "Khmer", val: 'kh-KM'},
	{name: "English", val: 'en-US'}
];
const appname = 'kh';
