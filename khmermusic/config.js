const tablayout = [
	{name: "♫", dicts: [
		["khmer/db/hymns7.peak.zst", "Hymn", 32*1024, `<a href="https://www.khmerworship.com/">Khmer Worship</a>`],
		["khmer/db/kora.slab", "Kora", 64*1024, `<a href="https://www.korapraise.com/">Kora Praise</a>`, true],
	]},
];

function trans_kora(sh){
	console.log(sh);
	if(sh && sh[sh.length-2]){
		let num = sh[sh.length-2];
		sh[sh.length-2] = `<a href="https://korapraise.com/sheet/${num}">Kora Praise ${num}</a>`;
	}
	return sh;
}

const subheader_trans = {
	Kora : trans_kora
};

const scope = '/khmermusic/';
const lang = [
	{name: "Khmer", val: 'kh_KM'},
	{name: "English", val: 'en_US'}
];
const appname = 'kh𝄞';
