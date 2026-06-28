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
