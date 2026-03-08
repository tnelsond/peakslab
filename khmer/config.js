const tablayout = [
	{name: "Dict", dicts: [
		["khmer/db/sonv3.peak.zst", "En→Km", 32*1024],
		["khmer/db/khmer92_h97.peak.zst", "Km→En", 32*1024],
		["khmer/db/baby.peak.zst", "Baby", 4*1024],
		["khmer/db/plantdict.peak.zst", "Plants", 3*1024],
		["khmer/db/ant.peak.zst", "ANT", 32*1024],
		["khmer/db/nath2022_8.peak.zst", "Km→Km", 32*1024],
		["khmer/db/seacount.peak.zst", "Count", 1*1024],
	]},
	{name: "♫", dicts: [
		["khmer/db/hymns7.peak.zst", "Hymn", 32*1024],
	]},
	{name: "Bible", dicts: [
		["khmer/db/bible.peak.zst", "Bible", 16*1024],
		["khmer/db/bibletrans.peak.zst", "Bible2", 64*1024],
		["khmer/db/km_ulb2.peak.zst", "Km_ULB", 32*1024],
		["khmer/db/strongs.peak.zst", "Strongs", 2*1024],
	]},
	{name: "Media", dicts: [
		["khmer/db/zzz.slab.zst", "Assets", 256*1024],
	]}
];

const scope = '/khmer/';
const tts = 'kh-KM';
const appname = 'kh';
