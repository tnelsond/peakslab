const tablayout = [
	{name: "Dict", dicts: [
		["khmer/db/sonv3.peak.zst", "En→Km", 32*1024, `From <a href="https://play.google.com/store/apps/details?id=com.sonveasna.dictionary&hl=en">English Khmer Dictionary</a> by DroidSVS`, true],
		["khmer/db/khmer92_h97.peak.zst", "Km→En", 32*1024, `<em>Cambodian-English Dictionary</em> by Robert K. Headley, Rath Chim, and Ok Soeum <em>(1997, Dunwoody Press, ISBN 0-931745-78-0)</em> via <a href="https://sealang.net/khmer/dictionary.htm">Sealang</a>.`, true],
		["khmer/db/khmerwiktionary.peak.zst", "KmWikt", 8*1024, `Khmer Wiktionary.`, true],
		["khmer/db/baby.peak.zst", "Baby", 4*1024, `Tovnah.com (URL stopped working)`, false],
		["khmer/db/plantdict.peak.zst", "Plants", 3*1024, `<a href="https://www.plantsdictionarykh.com/">PlantsDictionaryKh.com</a>`, true],
		["khmer/db/ant.peak.zst", "ANT", 32*1024, `<a href="https://antkh.com/">antkh.com</a>`, false],
		["khmer/db/nath2022_8.peak.zst", "Km→Km", 32*1024, `2022 version of the <a href="https://play.google.com/store/apps/details?id=com.optimiskh.chuonnathdictionary&hl=en-US">Chuon Nath Digital Dictionary</a>.`, true],
		["khmer/db/seacount.peak.zst", "Count", 1*1024, `via <a href="https://sealang.net/khmer/dictionary.htm">Sealang</a>.`, false],
		["khmer/db/cambogeo.peak.zst", "Geo", 16*1024, `Village names.`, true],
	]},
	{name: "Ref", dicts: [
		["khmer/db/choukprov.peak.zst", "Proverbs", 8*1024, `Proverbs from <a href="https://choukhmer.wordpress.com/literature/descriptive-proverbs-kar/">Chouk Khmer</a>.`, true],
		["khmer/db/kmwiki.peak.zst", "Wikipedia", 30*1024, `Khmer Wikipedia.`, false],
	]},
	{name: "♫", dicts: [
		["khmer/db/hymns7.peak.zst", "Hymn", 32*1024, `<a href="https://www.khmerworship.com/">Khmer Worship</a>`, true],
		["khmer/db/kora-pb1.slab", "Purple1", 64*1024, `First half of the purple book <a href="https://www.korapraise.com/">Kora Praise</a>`, false],
		["khmer/db/kora-pb2.slab", "Purple2", 64*1024, `Second half of the purple book <a href="https://www.korapraise.com/">Kora Praise</a>`, true],
		["khmer/db/kora-snl.slab", "SnL", 64*1024, `Other songs from <a href="https://www.korapraise.com/">Kora Praise</a>`, false],
		["khmer/db/kora-misc.slab", "Kora", 64*1024, `Other songs from <a href="https://www.korapraise.com/">Kora Praise</a>`, false],
	]},
	{name: "Bible Dicts", dicts: [
		["khmer/db/bible.peak.zst", "Bible", 16*1024, "From my khsv bible and a blue bible dictionary.", true],
		["khmer/db/biblewordkm.peak.zst", "Words Km", 64*1024, `Translation words from <a href="https://door43.org/">door43</a>`, true],
		["english/db/bibleworden.peak.zst", "Words En", 64*1024, `Translation words from <a href="https://door43.org/">door43</a>`, false],
		["english/db/strongs.peak.zst", "Strongs", 2*1024, `<a href="https://github.com/openscriptures/strongs">Strongs by Openscriptures</a>`, false],
	]},
	{name: "Bible", dicts: [
		["khmer/db/kmULB.peak.zst", "Km_ULB", 32*1024, `Khmer Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`, false],
		["khmer/db/khsv.peak.zst", "Khsv", 32*1024, `Khmer Standard Version from <a href="https://ebible.org/study/content/texts/khm/">eBible</a>`, true],
		["khmer/db/khov.peak.zst", "Khov", 32*1024, `Khmer Old Version (Hammond 1954) from <a href="https://ebible.org/study/content/texts/khm-h/">eBible</a>`, false],
		["khmer/db/khov2016.peak.zst", "Khov2016", 32*1024, `Khmer Old Version 2016 from <a href="https://beblia.com">beblia</a>`, false],
		["khmer/db/kcb2012.peak.zst", "KCB", 32*1024, `Khmer Christian Bible 2012 via <a href="https://beblia.com">beblia</a>`, false],
		["khmer/db/gkb.peak.zst", "GKB", 32*1024, `Global Khmer Bible 2023 by Global Bible Initiative via <a href="https://beblia.com">beblia</a>`, false],
		["khmer/db/khbiblemuslim.peak.zst", "KhMus", 32*1024, `A Khmer bible that uses the word "Allah" 2014 United Bible Societies  via <a href="https://beblia.com">beblia</a>`, false],
		["english/db/engULB.peak.zst", "En_ULB", 8*1024, `English Unlocked Literal Bible from <a href="https://door43.org">Door43</a>, Wycliffe Associates`, true],
		["english/db/eng-nkjv.peak.zst", "En_NKJV", 8*1024, `New King James Version from <a href="https://beblia.com">Beblia</a>.`, false],
		["english/db/eng-kjv.peak.zst", "EnKJV", 8*1024, `King James Version <a href="https://ebible.org">eBible</a>`, false],
	]},
	{name: "Media", dicts: [
		["khmer/db/media.slab.zst", "Media", 256*1024, `Contains images from the plantsdictionarykh.com as well as audio from <a href="kheng.info">kheng.info</a>.`, true],
		["khmer/db/khsv-ant.slab.zst", "khsv-a-nt", 128*1024, `Audio bible new testament KHSV in c2 format. Very small, but very low quality.`, false],
		["khmer/db/khsv-aot.slab.zst", "khsv-a-ot", 256*1024, `Audio bible old testament KHSV in c2 format. Very small, but very low quality.`, false],
	]}
];

function trans_kora(sh){
	if(sh && sh[sh.length-2]){
		let num = sh[sh.length-2];
		sh[sh.length-2] = `<a href="https://korapraise.com/sheet/${num}">Kora Praise ${num}</a>`;
	}
	return sh;
}

const subheader_trans = {
	Kora : trans_kora,
	SnL : trans_kora,
	Purple1 : trans_kora,
	Purple2 : trans_kora
};

const scope = '/khmer/';
const lang = [
	{name: "Khmer", val: 'km_KH'},
	{name: "English", val: 'en_US'}
];
const appname = 'kh';
