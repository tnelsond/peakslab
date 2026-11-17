"use strict";
// The Khmer–English workbench: write (or review) each Khmer word's English senses, beside its dictionaries, read
// with the PeakSlab engine (peakworker.js and peak.wasm, as the site's pages do). Your work stays in this browser
// (IndexedDB); Export saves it as a file (the dictionary is to be built from that).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const norm = s => s.replace(/​/g, '').replace(/្ដ/g, '្ត').trim();
const store = (k, v) => { try { localStorage.setItem('wb-' + k, JSON.stringify(v)) } catch (e) {} };
const stored = (k, d) => { try { const v = JSON.parse(localStorage.getItem('wb-' + k)); return v ?? d } catch (e) { return d } };
const POS = ['', 'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'particle', 'interjection', 'classifier', 'number', 'name', 'phrase', 'prefix', 'suffix'];
const POSOF = {adj: 'adjective', adv: 'adverb', noun: 'noun', verb: 'verb', name: 'name', 'proper noun': 'name', pron: 'pronoun', pronoun: 'pronoun', prep: 'preposition', conj: 'conjunction', particle: 'particle', intj: 'interjection', interj: 'interjection', classifier: 'classifier', num: 'number', number: 'number', phrase: 'phrase', prefix: 'prefix', suffix: 'suffix', 'ន.': 'noun', 'កិ.': 'verb', 'គុ.': 'adjective', 'កិ.វិ.': 'adverb', 'សព្វ.': 'pronoun', 'ធ.': 'preposition', 'ឈ.': 'conjunction', 'និ.': 'particle', 'អ.': 'interjection'};
const SRC = {A: 'Aligned', H: 'Headley 97', N: 'Nath 2022', O: 'Nath 1967', W: 'Wiktionary', K: 'Khmer Wiktionary', D: 'WordNet', B: 'Bible words'};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker:', e));

// ---- The engine ----
const DICTS = [
	['wb', 'workbench/data/km-wb.zst', 'Workbench data', 65536],
	['nath1967', 'khmer/dict/km-nath1967.peak.zst', 'Chuon Nath 1967'],
	['kaikki', 'khmer/dict/km-kaikki.peak.zst', 'Wiktionary'],
	['h97', 'khmer/dict/km-h97.peak.zst', 'Headley 1997'],
	['nath2022', 'khmer/dict/km-nath2022.peak.zst', 'Chuon Nath 2022'],
	['kmwikt', 'khmer/dict/km-wiktionary.peak.zst', 'Khmer Wiktionary'],
	['ipa', 'khmer/dict/phonetics/km-ipa.peak.zst', 'IPA'],
	['wn', 'english/thesaurus/en-wn.peak.zst', 'WordNet'],
	['ulb', 'khmer/bible/text/km-ulb.peak.zst', 'Khmer ULB'],
	['enult', 'english/bible/text/en-ult.peak.zst', 'English ULT'],
	// English Wiktionary's senses (headwords "word (gloss)", found by the word), and by the Khmer its translation tables give them
	['ensenses', 'english/wiktionary/en-senses.peak.zst', 'Wiktionary senses'],
	['kmsenses', 'khmer/wiktionary/km-senses.peak.zst', 'Wiktionary translations'],
];
const D = Object.fromEntries(DICTS.map((d, i) => [d[0], i]));
const engine = (() => {
	const worker = new Worker('/peakworker.js');
	const ready = DICTS.map(() => { let r; const p = new Promise(res => r = res); return {p, r} });
	const waits = new Map();
	let tagN = 0, wasm = null, files = null;
	const filesP = fetch('/files.json', {cache: 'no-cache'}).then(r => r.json()).then(f => files = f);
	worker.onmessage = async ({data: m}) => {
		switch (m.type) {
		case 'needwasm': {
			const ts = files.core.find(c => c[0] === 'peak.wasm')?.[1] || 0;
			wasm ??= fetch(`/peak.wasm?v=${ts}`).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b));
			worker.postMessage({type: 'wasm', wasm: await wasm});
			break;
		}
		case 'needbytes': {
			const path = DICTS[m.did][1], ts = timestampOf(path);
			try {
				const buf = await fetch(`/${path}${ts ? '?v=' + ts : ''}`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer() });
				worker.postMessage({type: 'bytes', did: m.did, buf}, [buf]);
			} catch (e) { console.warn(path, e); worker.postMessage({type: 'bytes', did: m.did, buf: null}) }
			break;
		}
		case 'loaded': ready[m.did].r(true); progress(); break;
		case 'loadfailed': ready[m.did].r(false); progress(); break;
		case 'rendered': { const w = waits.get(m.tag); if (w) { waits.delete(m.tag); w(m) } break }
		}
	};
	const timestampOf = path => (files.dicts.find(d => d[0] === path) || files.core.find(c => c[0] === path) || [])[1] || 0;
	const ask = msg => new Promise(res => { const tag = ++tagN; waits.set(tag, res); worker.postMessage({...msg, tag}) });
	let nLoaded = 0;
	const progress = () => { nLoaded++; setStatus() };
	async function start() {
		await filesP;
		const wt = files.core.find(c => c[0] === 'peak.wasm')?.[1] || 0;
		worker.postMessage({type: 'init', id: 1, wasmTimestamp: wt});
		DICTS.forEach(([, path, name, buf], did) => {
			const e = files.dicts.find(d => d[0] === path);
			worker.postMessage({type: 'load', did, msg: [path, name, buf || (e ? e[3] : 65536)], timestamp: timestampOf(path)});
		});
	}
	// Every headword of dict at every place in text: [[start, length, match, index, second]] (UTF-16 offsets)
	async function matchall(dict, text) {
		const did = D[dict];
		if (!text || !await ready[did].p) return [];
		return (await ask({type: 'matchall', did, query: text})).matches;
	}
	// Entries whose headword (or, second, an index word: WordNet's lemmas) is exactly one of keys: {key: [{header, body}]}
	async function lookup(dict, keys, second = false) {
		const did = D[dict];
		keys = [...new Set(keys.filter(Boolean))];
		if (!keys.length || !await ready[did].p) return {};
		const text = keys.join('\n'), at = new Map();
		let o = 0;
		for (const k of keys) { at.set(o + ':' + k.length, k); o += k.length + 1 }
		const {matches} = await ask({type: 'matchall', did, query: text});
		const lines = [], whose = [], seen = new Set();
		for (const [s, len, m, i, sec] of matches) {
			const k = at.get(s + ':' + len);
			if (k == null || (sec && !second) || seen.has(k + '|' + m + '|' + i)) continue;
			seen.add(k + '|' + m + '|' + i); lines.push([m, i]); whose.push(k);
		}
		const out = {};
		if (!lines.length) return out;
		const {entries} = await ask({type: 'renderlines', did, lines});
		entries.forEach((e, j) => e && (out[whose[j]] ??= []).push(e));
		return out;
	}
	const one = async (dict, key, second) => (await lookup(dict, [key], second))[key] || [];
	return {start, lookup, one, matchall, loadedCount: () => nLoaded};
})();

// ---- Your work: IndexedDB ----
const db = (() => {
	let dbp = null;
	const open = () => dbp ??= new Promise((res, rej) => {
		const r = indexedDB.open('peakslab-workbench', 1);
		r.onupgradeneeded = () => r.result.createObjectStore('entries', {keyPath: 'w'});
		r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
	});
	const tx = async (mode, f) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('entries', mode); const out = f(t.objectStore('entries')); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error) }) };
	return {all: () => tx('readonly', s => s.getAll()), put: r => tx('readwrite', s => s.put(r)), putAll: rs => tx('readwrite', s => rs.forEach(r => s.put(r))), del: w => tx('readwrite', s => s.delete(w))};
})();

// ---- State ----
let Q = [], BY = new Map(), ED = new Map();
let mode = stored('mode', 'write'), on = new Set(stored('srcs', Object.keys(SRC))), hide = stored('hide', false);
let shown = [], limit = 300, cur = null, info = null, active = 0, sheet = null, saveT = null, dbOK = true;
const closed = new Set(stored('closed', ['h97', 'nath2022', 'kmwikt']));
const blank = w => ({w, senses: [], strike: [], add: [], done: false, t: 0});
// A saved word as the workbench keeps it: the old word-level Wiktionary matches (match) become pairs of its first sense
function fromStore(r) {
	r = {...blank(r.w), ...r};
	const m = (r.match || []).filter(x => !r.senses.some(s => s.pairs.some(p => p.src === 'wikts' && p.id === x.id)));
	if (m.length) { if (!r.senses.length) r.senses.push(newSense()); r.senses[0].pairs.push(...m.map(x => ({src: 'wikts', id: x.id, text: x.gloss, pos: x.pos}))) }
	delete r.match;
	return r;
}
const newSense = (o = {}) => ({pos: '', def: '', syn: [], note: '', pairs: [], ex: null, from: null, ...o});
// A word opened with no senses of yours yet gets a draft: one sense for each Wiktionary and WordNet sense (DRAFT),
// saved only once you change something (or finish the word)
const DRAFT = new Map();
const rec = () => DRAFT.get(cur) || ED.get(cur) || blank(cur);
const hasSenses = r => !!r && r.senses.some(s => s.def.trim() || s.syn.length || s.note.trim() || s.pairs.length || s.ex);
const started = r => !!r && (r.senses.some(s => s.def.trim() || s.syn.length || s.note.trim() || s.pairs.length || s.ex) || r.strike.length || r.add.length);
const inMode = x => mode === 'write' ? !x[3] : !!x[3];

function setStatus(msg) {
	const done = [...ED.values()].filter(r => r.done).length;
	const n = engine.loadedCount();
	$('#status').textContent = msg || (!dbOK ? 'Not saving: this browser has no storage for the page' :
		`${n < DICTS.length ? `Loading dictionaries ${n}/${DICTS.length} · ` : ''}Saved on this device · ${done.toLocaleString()} finished`);
}
function counts() {
	let w = 0, r = 0, wd = 0, rd = 0;
	for (const x of Q) { const d = ED.get(x[0])?.done; if (x[3]) { r++; if (d) rd++ } else { w++; if (d) wd++ } }
	$('#nWrite').textContent = `${wd.toLocaleString()}/${w.toLocaleString()}`;
	$('#nReview').textContent = `${rd.toLocaleString()}/${r.toLocaleString()}`;
	$('#mWrite').setAttribute('aria-pressed', mode === 'write'); $('#mReview').setAttribute('aria-pressed', mode === 'review');
}
function renderSrcs() {
	$('#srcs').innerHTML = Object.entries(SRC).map(([k, n]) => `<button type="button" data-src="${k}" aria-pressed="${on.has(k)}">${n}</button>`).join('');
}
function renderQueue() {
	const q = norm($('#q').value);
	shown = Q.filter(x => (q ? x[0].startsWith(q) : inMode(x)) && [...x[2]].some(s => on.has(s)) && !(hide && ED.get(x[0])?.done));
	const ci = shown.findIndex(x => x[0] === cur); if (ci >= limit) limit = Math.ceil((ci + 1) / 300) * 300;
	$('#qcount').textContent = q ? `${shown.length.toLocaleString()} starting ${q}, both modes` : `${shown.length.toLocaleString()} words, commonest first`;
	$('#qlist').innerHTML = shown.slice(0, limit).map(x => {
		const r = ED.get(x[0]);
		return `<button type="button" class="qi${x[0] === cur ? ' cur' : ''}" data-w="${esc(x[0])}"><span class="dot${r?.done ? ' done' : started(r) ? ' started' : ''}"></span><span class="w">${esc(x[0])}</span><span class="n">${x[1].toLocaleString()}</span></button>`;
	}).join('') + (shown.length > limit ? `<button type="button" class="more" data-more="1">Show 300 more</button>` : '');
}
function markQueueItem() {
	document.querySelectorAll('.qi.cur').forEach(e => e.classList.remove('cur'));
	const it = [...document.querySelectorAll('.qi')].find(e => e.dataset.w === cur);
	if (it) { it.classList.add('cur'); const r = ED.get(cur); it.querySelector('.dot').className = 'dot' + (r?.done ? ' done' : started(r) ? ' started' : '') }
}

// ---- One word ----
const VERSES = new Map(); // ref -> [Khmer, English]
async function verses(refs) {
	const need = refs.filter(r => !VERSES.has(r));
	if (need.length) {
		const [k, e] = await Promise.all([engine.lookup('ulb', need), engine.lookup('enult', need)]);
		const text = es => es?.[0] ? clean(es[0].body.split('\t').slice(1).join(' ')) : '';
		for (const r of need) VERSES.set(r, [text(k[r]), text(e[r])]);
	}
	return refs.map(r => VERSES.get(r));
}
const clean = h => { const d = document.createElement('div'); d.innerHTML = h.replace(/¶/g, ''); return d.textContent.replace(/​/g, '').replace(/\s+/g, ' ').trim() };
const bookName = r => { const [b, cv] = r.split(' '); return `${b[0].toUpperCase()}${b.slice(1)} ${cv.replace('.', ':')}` };
function highlight(text, w) { return esc(text).split(esc(w)).join(`<mark>${esc(w)}</mark>`) }

// Wiktionary's senses in an entry: [{pos, text}]
function wiktSenses(body) {
	const d = document.createElement('div');
	d.innerHTML = body.replace(/<details>.*?<\/details>/gs, '');
	const out = [];
	let pos = '';
	d.querySelectorAll('p-n, ol').forEach(el => {
		if (el.tagName === 'P-N') { pos = el.textContent.trim(); return }
		if (el.parentElement.closest('ol')) return;
		for (const li of el.children) {
			if (li.tagName !== 'LI') continue;
			const c = li.cloneNode(true);
			c.querySelectorAll('ul, ol, p, details').forEach(x => x.remove());
			const t = c.textContent.replace(/\s+/g, ' ').trim();
			if (t) out.push({pos, text: t});
		}
	});
	return out;
}
// A WordNet sense (en-wn's headword "lemma (gloss…)"): its part of speech, gloss and lemmas
const WN = new Map();
async function wnSense(id) {
	if (WN.has(id)) return WN.get(id);
	const e = (await engine.one('wn', id))[0];
	const v = e ? wnParse(e) : {id, pos: '', gloss: id, lemmas: []};
	WN.set(id, v); return v;
}
function wnParse(e) {
	const cells = e.body.split('\t');
	const pos = clean(cells[0] || ''), lemmas = cells.slice(1).filter(c => c && !c.startsWith('<')).map(c => c.trim());
	const p = (e.body.match(/<p>(.*?)<\/p>/s) || [])[1];
	return {id: e.header, pos, gloss: p ? clean(p) : e.header.replace(/^[^(]*\(|\)$/g, ''), lemmas};
}
// An English Wiktionary sense (en-senses', km-senses' headword "word (gloss)"): its word, part of speech and gloss
function wsParse(e) {
	return {id: e.header, word: e.header.replace(/ \(.*$/s, ''), pos: clean(e.body.split('\t')[0] || ''), gloss: e.header.replace(/^[^(]*\(|\)$/g, '')};
}
const PAIRSRC = {wn: 'WordNet', wd: 'Wikidata', wikt: 'Wiktionary', wikts: 'Wiktionary'};
const isWikt = src => src === 'wikt' || src === 'wikts';

async function show(w) {
	const x = BY.get(w);
	if (x && !inMode(x) && !$('#q').value) { mode = x[3] ? 'review' : 'write'; store('mode', mode); counts(); renderQueue() }
	cur = w; info = null; active = 0;
	try { history.replaceState(null, '', '#' + encodeURIComponent(w)) } catch (e) {}
	if (!document.querySelector('.qi.cur') && shown.some(x => x[0] === w)) renderQueue();
	markQueueItem();
	document.querySelector('.qi.cur')?.scrollIntoView({block: 'nearest'});
	$('#app').classList.remove('qopen');
	renderWork(); renderRef();
	const [[wb, nath1967, kaikki, h97, nath2022, kmwikt, ipa], kms] = await Promise.all([
		Promise.all(['wb', 'nath1967', 'kaikki', 'h97', 'nath2022', 'kmwikt', 'ipa'].map(d => engine.one(d, w))),
		engine.one('kmsenses', w, true)]);
	if (cur !== w) return;
	let data = {};
	try { data = wb[0] ? JSON.parse(wb[0].body) : {} } catch (e) { console.warn(e) }
	info = {data, nath1967, kaikki, h97, nath2022, kmwikt, ipa: ipa[0] ? clean(ipa[0].body) : '', wikt: kaikki.flatMap(e => wiktSenses(e.body)),
		wikts: kms.map(wsParse).filter((s, j, a) => a.findIndex(x => x.id === s.id) === j)};
	if (!hasSenses(ED.get(w)) && !DRAFT.has(w)) { const d = await draftFor(w); if (cur !== w) return; if (d) DRAFT.set(w, d) }
	renderWork(); renderRef();
	const exs = rec().senses.map(s => s.ex?.ref).filter(Boolean);
	if (exs.length) { await verses(exs); if (cur === w) renderWork() }
}

function edit(f, rerender = true) {
	const r = structuredClone(rec()); f(r); r.t = Date.now(); ED.set(cur, r); DRAFT.delete(cur);
	if (rerender) renderWork();
	markQueueItem(); counts();
	clearTimeout(saveT); const copy = r; saveT = setTimeout(() => db.put(copy).then(() => setStatus(), e => { dbOK = false; setStatus(); console.warn(e) }), 400);
}

function fromTag(s) {
	if (!s.from) return '';
	const edited = s.def.trim() !== s.from.text.trim();
	return `<span class="from" title="${esc(s.from.text)}">from ${esc(s.from.src)}${edited ? ', edited' : ''}</span>`;
}
function renderWork() {
	const w = cur;
	if (!w) { $('#work').innerHTML = '<div class="card empty">Pick a word.</div>'; return }
	const x = BY.get(w), r = rec(), d = info?.data || {};
	const senses = r.senses.length ? r.senses : [newSense()];
	const rank = x ? Q.indexOf(x) + 1 : 0;
	const struck = new Set(r.strike);
	const pairIn = new Map(); senses.forEach((s, i) => s.pairs.forEach(p => pairIn.set(p.src + '|' + p.id, i)));
	const alw = [...(d.al || []).map(a => a[0]).filter(e => !struck.has(e)), ...r.add.filter(e => !(d.al || []).some(a => a[0] === e))];
	const synIn = new Map(); senses.forEach((s, i) => s.syn.forEach(y => synIn.set(y.toLowerCase(), i)));
	const ov = overlaps(senses), nov = [...ov.values()].reduce((n, js) => n + js.length, 0), draft = DRAFT.has(w) && r.senses.length;
	const keep = scrolls();
	$('#work').innerHTML = `
	<div class="card whead">
		<span class="word">${esc(w)}</span>${info?.ipa ? `<span class="ipa">/${esc(info.ipa)}/</span>` : ''}
		<span class="meta">${x ? `${x[1].toLocaleString()} uses · #${rank.toLocaleString()}` : 'not in the list'}</span>
		${x ? `<span class="meta">in: ${[...x[2]].map(s => SRC[s]).join(' · ')}</span>` : ''}
		${d.mus ? '<span class="tag mus">muslim word</span>' : ''}
		<span class="nav"><button type="button" class="btn reset" data-act="reset" title="Clear your work on this word and start again from its Wiktionary senses">Reset</button><button type="button" class="btn" data-act="prev" title="Previous ( [ )">← Prev</button><button type="button" class="btn ${r.done ? 'done' : 'go'}" data-act="done" title="Ctrl+Enter">${r.done ? '✓ Finished' : 'Finished → next'}</button></span>
	</div>
	${draft ? `<div class="card draftnote"><span>Suggested from Wiktionary: ${senses.length} sense${senses.length > 1 ? 's' : ''}${nov ? `, ${nov} that may be the same meaning (combine them below)` : ''}. Saved when you change something or press Finished.</span><button type="button" class="dash" data-act="nodraft">Start empty instead</button></div>` : ''}
	${senses.map((s, i) => `
	<section class="card sense" data-i="${i}" style="${i === active && senses.length > 1 ? 'box-shadow: 0 0 0 3px var(--tab)' : ''}">
		<div class="bar"><span>Sense ${i + 1}</span>
			<select data-f="pos" data-i="${i}" aria-label="Part of speech">${POS.map(p => `<option value="${p}"${p === s.pos ? ' selected' : ''}>${p || 'part of speech'}</option>`).join('')}</select>
			${fromTag(s)}<span class="sp"></span>
			${i > 0 ? `<button type="button" data-act="up" data-i="${i}" title="Move up" aria-label="Move sense ${i + 1} up">↑</button>` : ''}
			<button type="button" data-act="delsense" data-i="${i}" title="Remove this sense" aria-label="Remove sense ${i + 1}">×</button></div>
		${(ov.get(i) || []).length ? `<div class="combine"><div class="l">Same meaning as one of Wiktionary's translation-table senses? Combine them into this one, or say they're not the same.</div>${ov.get(i).map(j => `<div class="cand"><span><b>Sense ${j + 1}</b> · Wiktionary table <span class="r">${esc(senses[j].pos)}</span> ${esc(senses[j].def)}${senses[j].syn.length ? ` <span class="r">(${esc(senses[j].syn.join(', '))})</span>` : ''}</span>
				<span class="acts"><button type="button" data-act="combine" data-i="${i}" data-j="${j}" data-keep="i">Combine, keep this wording</button><button type="button" data-act="combine" data-i="${i}" data-j="${j}" data-keep="j">Combine, keep the table's</button><button type="button" data-act="apart" data-i="${i}" data-j="${j}">Not the same</button></span></div>`).join('')}</div>` : ''}
		<div class="fields">
			<label class="l" for="def-${i}">Definition</label>
			<textarea id="def-${i}" data-f="def" data-i="${i}" rows="1" placeholder="What it means, in English">${esc(s.def)}</textarea>
			<span class="l">Synonyms</span>
			<div class="chips">${s.syn.map((y, j) => `<span class="chip">${esc(y)}<button type="button" class="x" data-act="delsyn" data-i="${i}" data-j="${j}" aria-label="Remove ${esc(y)}">×</button></span>`).join('')}<form class="synf" data-i="${i}"><input class="syn-in" id="syn-${i}" data-f="syn" data-i="${i}" placeholder="+ English word" aria-label="Add a synonym to sense ${i + 1}" enterkeyhint="done" autocomplete="off"><button type="submit" class="dash" aria-label="Add the synonym to sense ${i + 1}">Add</button></form></div>
			${(left => left.length ? `<span class="l">Aligned</span><div class="chips alrow">${left.map(e => { const o = synIn.get(e.toLowerCase());
				return `<button type="button" class="alq${o != null ? ' used' : ''}" data-act="synto" data-i="${i}" data-e="${esc(e)}" title="Add “${esc(e)}” to sense ${i + 1}'s synonyms${o != null ? ` (it's sense ${o + 1}'s)` : ''}">+ ${esc(e)}</button>` }).join('')}</div>` : '')(alw.filter(e => !s.syn.some(y => y.toLowerCase() === e.toLowerCase())))}
			<label class="l" for="note-${i}">Notes</label>
			<textarea id="note-${i}" data-f="note" data-i="${i}" rows="1" placeholder="Notes for this sense">${esc(s.note)}</textarea>
			<span class="l">Paired with</span>
			<div class="chips">${s.pairs.map((p, j) => `<span class="pair${isWikt(p.src) ? ' wikt' : ''}" title="${esc(p.id)}">${PAIRSRC[p.src] || 'Wiktionary'} · ${esc(p.src === 'wikts' ? p.id :p.text.length > 70 ? p.text.slice(0, 68) + '…' : p.text)}<button type="button" class="x" data-act="delpair" data-i="${i}" data-j="${j}" aria-label="Unpair">×</button></span>`).join('')}<button type="button" class="dash" data-act="pair" data-i="${i}">Pair…</button></div>
			<span class="l">Example</span>
			<div class="row">${s.ex ? (() => { const v = VERSES.get(s.ex.ref); return `<div class="exv"><div class="k">${v ? highlight(v[0], w) : '…'}</div><div class="e">${v ? esc(v[1]) : ''}</div><div class="r">${esc(bookName(s.ex.ref))} · km-ulb, en-ult</div></div>` })() : '<span class="none">None chosen.</span>'}
				<button type="button" class="dash" data-act="verse" data-i="${i}">${s.ex ? 'Change' : 'Choose a verse'}${d.v ? ` · ${(d.vn || d.v.length).toLocaleString()}` : ''}</button></div>
		</div>
	</section>`).join('')}
	<div class="addsense"><button type="button" class="btn" data-act="addsense">+ Add a sense</button><span class="hint">Tab: Definition → Synonyms → Notes · Enter adds a synonym · Ctrl+Enter: finished, next word</span></div>
	<section class="card aligned">
		<div class="sect">ALIGNED ENGLISH · tap a wrong one to strike it (it leaves every sense's list); add one it's missing</div>
		<div class="chips">${(d.al || []).map(([e, c]) => `<span class="al${struck.has(e) ? ' struck' : ''}"><button type="button" class="t" data-act="strike" data-e="${esc(e)}">${esc(e)}</button><span class="c">${c ? c.toLocaleString() : 'dict'}</span></span>`).join('') || (info ? '<span class="none">No aligned English.</span>' : '…')}
		${r.add.map(e => `<span class="al added"><span>${esc(e)}</span><button type="button" data-act="unadd" data-e="${esc(e)}" aria-label="Remove ${esc(e)}">×</button></span>`).join('')}</div>
		<form class="addw" id="addw"><input id="addq" placeholder="Add an English word the aligned list is missing" autocomplete="off" aria-label="Add an English word"><button type="submit" class="btn">Add</button></form>
	</section>`;
	document.querySelectorAll('#work textarea').forEach(fit);
	keep();
}
const fit = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px' };
// Where #work, #ref and the page are scrolled, to put back after redrawing one (a redraw, or fit()'s
// shrinking a textarea for a moment, would otherwise pull them up)
function scrolls() {
	const els = [$('#work'), $('#ref'), document.scrollingElement].filter(Boolean), at = els.map(e => e.scrollTop);
	return () => els.forEach((e, i) => { if (e.scrollTop !== at[i]) e.scrollTop = at[i] });
}

function card(id, title, tag, body, cls = '') {
	return `<section class="card rc${closed.has(id) ? ' closed' : ''}" data-card="${id}"><button type="button" class="rh" data-act="fold" data-card="${id}">${closed.has(id) ? '▸ ' : ''}${esc(title)}${tag ? `<span class="d">${esc(tag)}</span>` : ''}</button><div class="rb ${cls}">${body}</div></section>`;
}
const dictHtml = es => es.map(e => e.body.split('\t').filter(c => !/^\[.*\]$/.test(c.trim())).join(' ').replace(/<details>.*?<\/details>/gs, '')).join('<hr>');
function renderRef() {
	if (!info) { $('#ref').innerHTML = cur ? '<div class="card empty">Looking it up…</div>' : ''; return }
	const r = rec(), d = info.data;
	const pairIn = new Map(); r.senses.forEach((s, i) => s.pairs.forEach(p => pairIn.set(p.src + '|' + p.id, i)));
	const where = k => pairIn.has(k) ? `<span class="in">· sense ${pairIn.get(k) + 1}</span>` : '';
	const wikt = info.wikt.map((s, j) => `<div class="ws"><div><span class="pos">${esc(s.pos)}</span>${esc(s.text)} ${where('wikt|' + cur + '#' + j)}</div><div class="acts"><button type="button" data-act="usewikt" data-j="${j}">Use</button><button type="button" data-act="pairwikt" data-j="${j}">Pair</button></div></div>`).join('');
	const wikts = info.wikts.map((s, j) => `<div class="ws"><div><b>${esc(s.word)}</b> <span class="pos">${esc(s.pos)}</span>${esc(s.gloss)} ${where('wikts|' + s.id)}</div><div class="acts"><button type="button" data-act="usewikts" data-j="${j}">Use</button><button type="button" data-act="pairwikts" data-j="${j}">Pair</button></div></div>`).join('');
	const wn = (d.wn || []).filter(s => !/[ក-៿]/.test(s[0])).map((s, j) => { const wd = s[1] === 'Wikidata'; return `<div class="ws"><div><span class="pos">${esc(s[1])}</span>${esc(s[0])} <span class="how">· ${esc(s[3])} ${s[2]}</span> ${where((wd ? 'wd|' : 'wn|') + s[0])}</div><div class="acts">${wd ? '' : `<button type="button" data-act="usewn" data-id="${esc(s[0])}">Use</button>`}<button type="button" data-act="pairwn" data-id="${esc(s[0])}" data-wd="${wd ? 1 : ''}">Pair</button></div></div>` }).join('');
	const keep = scrolls();
	$('#ref').innerHTML =
		card('nath1967', 'Chuon Nath 1967', 'km-nath1967', info.nath1967.length ? dictHtml(info.nath1967) : '<span class="none">Not in the 1967 edition.</span>', 'kmtext') +
		card('kaikki', 'Wiktionary', 'km-kaikki', wikt || '<span class="none">No English Wiktionary entry.</span>') +
		card('wikts', 'Wiktionary · translation tables', 'km-senses', wikts || `<span class="none">No English Wiktionary sense gives <span class="km">${esc(cur)}</span> as a translation.</span>`) +
		card('wnl', 'WordNet · linked by votes', 'machine-linked', wn || '<span class="none">No WordNet senses linked.</span>') +
		card('h97', 'Headley 1997', 'km-h97', info.h97.length ? dictHtml(info.h97) : '<span class="none">Not in Headley.</span>') +
		card('nath2022', 'Chuon Nath 2022', 'km-nath2022', info.nath2022.length ? dictHtml(info.nath2022) : '<span class="none">Not in the 2022 edition.</span>', 'kmtext') +
		card('kmwikt', 'Khmer Wiktionary', 'km-wiktionary', info.kmwikt.length ? dictHtml(info.kmwikt) : '<span class="none">Not in Khmer Wiktionary.</span>', 'kmtext');
	keep();
}

// ---- The draft: a sense for each of the word's Wiktionary senses (its own entry's, then the translation tables'),
// each paired with its source. Not the WordNet links: those are machine-made (votes), so they're only in the
// reference and the Pair sheet, for you to choose.
async function draftFor(w) {
	const r = structuredClone(ED.get(w) || blank(w)), out = [];
	info.wikt.forEach((x, j) => { const id = w + '#' + j;
		out.push(newSense({pos: POSOF[x.pos] || '', def: x.text, from: {src: 'Wiktionary', id, text: x.text}, pairs: [{src: 'wikt', id, text: x.text, pos: x.pos}], pre: 1})) });
	// A translation table is for one sense: it goes into the entry's sense whose words have its English word (and
	// the same part of speech, or one unknown), with that word among the sense's synonyms; one that fits none of
	// them (or a word with no entry of its own) is a sense of its own
	const own = out.map(s => ({s, words: wordsOf(s)}));
	info.wikts.forEach(x => {
		const pos = POSOF[x.pos] || '', word = x.word.toLowerCase(), pair = {src: 'wikts', id: x.id, text: x.gloss, pos: x.pos};
		const home = own.find(o => o.words.has(word) && !(o.s.pos && pos && o.s.pos !== pos));
		if (!home) return out.push(newSense({pos, def: x.gloss, syn: [x.word], from: {src: 'Wiktionary', id: x.id, text: x.gloss}, pairs: [pair], pre: 1}));
		home.s.pairs.push(pair);
		if (!home.s.syn.some(y => y.toLowerCase() === word)) home.s.syn.push(x.word);
	});
	if (!out.length) return null;
	r.senses = out; return r;
}
// The English words a sense's sources give it: a Wiktionary sense's own words ("to get, obtain": get, obtain),
// a translation table's headword, a WordNet sense's lemmas
function wordsOf(s) {
	const ws = [];
	for (const p of s.pairs) {
		if (p.src === 'wikts') ws.push(p.id.replace(/ \(.*$/s, ''));
		else if (p.src === 'wikt') p.text.replace(/\(.*?\)/g, '').split(/[;,]/).forEach(t => ws.push(t.replace(/^\s*(to|a|an|the)\s+/i, '')));
		else if (p.src === 'wn') ws.push(p.id.replace(/ \(.*$/s, ''), ...(WN.get(p.id)?.lemmas || []));
	}
	return new Set(ws.map(x => x.toLowerCase().replace(/_/g, ' ').trim()).filter(Boolean));
}
// The drafted translation-table senses (Wiktionary's English senses giving the word) that may be the same meaning
// as a drafted sense of the word's own Wiktionary entry: sharing an English word, and the same part of speech (or
// one unknown); i -> [j…]. You combine them, or say they're not the same.
function overlaps(senses) {
	const out = new Map();
	senses.forEach((a, i) => {
		if (!a.pre || !a.pairs.some(p => p.src === 'wikt')) return;
		const wa = wordsOf(a);
		senses.forEach((b, j) => {
			if (j === i || !b.pre || b.pairs.some(p => p.src === 'wikt') || !b.pairs.some(p => p.src === 'wikts')) return;
			if (b.pairs.some(p => (a.apart || []).includes('wikts|' + p.id))) return;
			if (a.pos && b.pos && a.pos !== b.pos) return;
			if ([...wordsOf(b)].some(x => wa.has(x))) (out.get(i) || out.set(i, []).get(i)).push(j);
		});
	});
	return out;
}
// Sense j put into sense i: their pairs, synonyms and notes together; the wording of the one you keep (keep: 'i' or 'j')
function combine(i, j, keep) {
	edit(r => {
		const a = r.senses[i], b = r.senses[j], w = keep === 'j' ? b : a;
		const syn = []; for (const y of [...a.syn, ...b.syn]) if (!syn.some(z => z.toLowerCase() === y.toLowerCase())) syn.push(y);
		r.senses[i] = {...a, pos: w.pos || a.pos || b.pos, def: w.def, from: w.from, syn,
			note: [a.note, b.note].filter(x => x.trim()).join(' · '), ex: a.ex || b.ex,
			pairs: [...a.pairs, ...b.pairs.filter(p => !a.pairs.some(q => q.src === p.src && q.id === p.id))]};
		r.senses.splice(j, 1);
		active = j < i ? i - 1 : i;
	});
	renderRef();
}

// Using a source's sense: a new sense (or the first empty one) with its text, tagged with where it came from, and paired
function useSense(s) {
	edit(r => {
		if (!r.senses.length) r.senses.push(newSense());
		let i = r.senses.findIndex(x => !x.def.trim() && !x.syn.length && !x.pairs.length && !x.from);
		if (i < 0) { r.senses.push(newSense()); i = r.senses.length - 1 }
		r.senses[i] = {...r.senses[i], ...s, syn: [...new Set([...r.senses[i].syn, ...(s.syn || [])])], pairs: [...r.senses[i].pairs, ...(s.pairs || [])]};
		active = i;
	});
	renderRef();
}
// Synonyms typed into sense i's box (one, or several between commas), added once each (case aside); refocus: keep typing
function addSyn(i, raw, refocus = true) {
	const vs = raw.split(/[,;，]/).map(v => v.trim()).filter(Boolean);
	if (!vs.length) return;
	edit(r => { if (!r.senses.length) r.senses.push(newSense()); const s = r.senses[i]; if (!s) return;
		for (const v of vs) if (!s.syn.some(y => y.toLowerCase() === v.toLowerCase())) s.syn.push(v) });
	if (refocus) $(`#syn-${i}`)?.focus();
}
function pairActive(p) {
	edit(r => {
		if (!r.senses.length) r.senses.push(newSense());
		const s = r.senses[Math.min(active, r.senses.length - 1)];
		if (!s.pairs.some(x => x.src === p.src && x.id === p.id)) s.pairs.push(p);
	});
	renderRef();
}

// ---- Pairing ----
async function openPair(i) {
	const s = (rec().senses[i] || newSense());
	sheet = {kind: 'pair', i, q: '', f: 'all', sel: new Map(s.pairs.map(p => [p.src + '|' + p.id, p])), groups: []};
	renderSheet(); await pairSearch();
}
async function pairSearch() {
	const sh = sheet, s = rec().senses[sh.i] || newSense(), d = info?.data || {};
	const groups = [];
	const linked = [];
	const wikts = es => es.map(wsParse).filter((e, j, a) => a.findIndex(x => x.id === e.id) === j).map(e => ({src: 'wikts', id: e.id, text: e.gloss, pos: e.pos, label: e.word}));
	info?.wikt.forEach((x, j) => linked.push({src: 'wikt', id: cur + '#' + j, text: x.text, pos: x.pos, label: 'Wiktionary'}));
	(info?.wikts || []).forEach(e => linked.push({src: 'wikts', id: e.id, text: e.gloss, pos: e.pos, label: e.word, how: 'Wiktionary translation table'}));
	for (const l of (d.wn || []).filter(l => !/[ក-៿]/.test(l[0]))) {
		const wd = l[1] === 'Wikidata';
		linked.push({src: wd ? 'wd' : 'wn', id: l[0], text: l[0], pos: l[1], label: wd ? 'Wikidata' : 'WordNet', how: `${l[3]} ${l[2]}`});
	}
	groups.push([`LINKED TO ${cur}`, linked]);
	const q = sh.q.trim();
	const words = [...new Set([...(q && !/[ក-៿]/.test(q) ? [q] : []), ...s.syn].map(x => x.toLowerCase()))];
	if (words.length) {
		const [got, gotW] = await Promise.all([engine.lookup('wn', words, true), engine.lookup('ensenses', words, true)]);
		for (const wd of words) {
			const es = (got[wd] || []).map(wnParse);
			es.forEach(e => WN.set(e.id, e));
			groups.push([`WORDNET · “${wd}”`, es.map(e => ({src: 'wn', id: e.id, text: e.gloss, pos: e.pos, label: e.lemmas.join(', ')}))]);
			groups.push([`WIKTIONARY · “${wd}”`, wikts(gotW[wd] || [])]);
		}
	}
	if (q && /[ក-៿]/.test(q) && norm(q) !== cur) {
		const [es, kms] = await Promise.all([engine.one('kaikki', norm(q)), engine.one('kmsenses', norm(q), true)]);
		groups.push([`WIKTIONARY · ${norm(q)}`, [...es.flatMap(e => wiktSenses(e.body)).map((x, j) => ({src: 'wikt', id: norm(q) + '#' + j, text: x.text, pos: x.pos, label: 'Wiktionary · ' + norm(q)})), ...wikts(kms)]]);
	}
	if (sheet !== sh) return;
	for (const [, xs] of groups) for (const x of xs) if (x.src === 'wn' && x.text === x.id) { const v = WN.get(x.id); if (v) x.text = v.gloss }
	sh.groups = groups; sh.top = true; renderSheet();
}

// ---- Choosing an example ----
async function openVerse(i) {
	const d = info?.data || {};
	const s = rec().senses[i];
	sheet = {kind: 'verse', i, group: '', q: '', pick: s?.ex?.ref || null, rows: null};
	renderSheet(); await verseLoad();
	void d;
}
async function verseLoad() {
	const sh = sheet, d = info?.data || {};
	const refs = sh.group ? (d.vi?.[sh.group] || []) : (d.v || []);
	sh.rows = null; renderSheet();
	const vs = await verses(refs);
	if (sheet !== sh) return;
	sh.rows = refs.map((r, j) => [r, ...vs[j]]); sh.top = true; renderSheet();
}

function renderSheet() {
	// The same sheet redrawn (a box ticked, a search's results): its list stays where it was scrolled (unless new
	// results came: sheet.top), and the field being typed in keeps the focus and the cursor
	const old = document.querySelector('.sheet'), same = !!old && old._sh === sheet, ae = document.activeElement;
	const st = same && !sheet.top ? old.querySelector('.sb').scrollTop : 0;
	const fo = same && ae?.id && old.contains(ae) ? [ae.id, ae.selectionStart, ae.selectionEnd] : null;
	if (sheet) delete sheet.top;
	document.querySelector('.scrim')?.remove(); old?.remove();
	if (!sheet) return;
	drawSheet();
	const now = document.querySelector('.sheet'); now._sh = sheet; now.querySelector('.sb').scrollTop = st;
	if (fo) { const n = document.getElementById(fo[0]); if (n) { n.focus({preventScroll: true}); try { n.setSelectionRange(fo[1], fo[2]) } catch (e) {} } }
}
function drawSheet() {
	if (sheet.kind === 'tag') return drawTagSheet();
	const s = rec().senses[sheet.i] || newSense(), sh = sheet;
	const head = `<div class="sh"><div class="t"><span>${sh.kind === 'pair' ? 'PAIR' : 'EXAMPLE FOR'} SENSE ${sh.i + 1} OF <span class="km" style="letter-spacing:0">${esc(cur)}</span></span><button type="button" data-act="close" aria-label="Close">×</button></div><div class="d">${esc(s.def || '(no definition yet)')}</div>${s.syn.length ? `<div style="font-size:13px;opacity:.85">synonyms: ${esc(s.syn.join(', '))}</div>` : ''}</div>`;
	let body = '', filters = '', foot = '';
	if (sh.kind === 'pair') {
		const pairIn = new Map(); rec().senses.forEach((x, i) => i !== sh.i && x.pairs.forEach(p => pairIn.set(p.src + '|' + p.id, i)));
		const fits = x => sh.f === 'all' || (sh.f === 'wikt' ? isWikt(x.src) : !isWikt(x.src));
		filters = `<input type="search" id="pairq" value="${esc(sh.q)}" placeholder="Any English word (WordNet and Wiktionary), or a Khmer word" aria-label="Search senses">
			<div class="pills">${[['all', 'All'], ['wn', 'WordNet'], ['wikt', 'Wiktionary']].map(([f, n]) => `<button type="button" data-act="pf" data-f="${f}" aria-pressed="${sh.f === f}">${n}</button>`).join('')}</div>`;
		const shownGroups = sh.groups.map(([t, xs]) => [t, xs.filter(fits)]).filter(([, xs]) => xs.length || sh.f === 'all');
		body = !sh.groups.length ? '<div class="none">Looking…</div>' : shownGroups.length ? shownGroups.map(([t, xs]) => `<div class="sect">${esc(t)}</div>` + (xs.length ? xs.map(x => {
			const k = x.src + '|' + x.id, other = pairIn.get(k), on = sh.sel.has(k);
			return `<label class="opt${on ? ' on' : ''}${other != null ? ' off' : ''}"><input type="checkbox" data-pk="${esc(k)}"${on ? ' checked' : ''}${other != null ? ' disabled' : ''}><span><b>${esc(x.label)}</b> <span class="r">${esc(x.pos)}</span> ${esc(x.text)}${x.how ? ` <span class="e">· ${esc(x.how)}</span>` : ''}${other != null ? ` <span class="e">· in sense ${other + 1}</span>` : ''}</span></label>`;
		}).join('') : '<div class="none">Nothing.</div>')).join('') : `<div class="none">No ${sh.f === 'wikt' ? 'Wiktionary' : 'WordNet'} sense here: search an English word above.</div>`;
		sh.all = new Map(sh.groups.flatMap(([, xs]) => xs).map(x => [x.src + '|' + x.id, x]));
		foot = `<span>${sh.sel.size} chosen. A pairing is a link: your definition stays yours.</span><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn go" data-act="pairdone">Pair ${sh.sel.size}</button>`;
	} else {
		const d = info?.data || {}, vi = d.vi || {};
		filters = `<div class="pills"><button type="button" data-group="" aria-pressed="${!sh.group}"><span class="km">${esc(cur)}</span> as its own word · ${(d.vn || (d.v || []).length).toLocaleString()}</button>${Object.keys(vi).length ? '<span class="e">inside other words:</span>' : ''}${Object.entries(vi).map(([t, rs]) => `<button type="button" class="km" data-group="${esc(t)}" aria-pressed="${sh.group === t}">${esc(t)} ${rs.length}</button>`).join('')}</div>
			<input type="search" id="verseq" value="${esc(sh.q)}" placeholder="Narrow the verses (Khmer or English)" aria-label="Narrow the verses">`;
		const q = norm(sh.q).toLowerCase();
		const rows = (sh.rows || []).filter(r => !q || r[1].includes(q) || r[2].toLowerCase().includes(q));
		const used = new Map(); rec().senses.forEach((x, i) => i !== sh.i && x.ex && used.set(x.ex.ref, i));
		const mark = sh.group || cur;
		body = sh.rows == null ? '<div class="none">Finding the verses…</div>' : rows.length ? rows.map(([r, k, e]) => `<label class="opt${sh.pick === r ? ' on' : ''}"><input type="radio" name="ex" data-ref="${esc(r)}"${sh.pick === r ? ' checked' : ''}><span><div class="k">${highlight(k, mark)}</div><div class="e">${esc(e)}</div><div class="r">${esc(bookName(r))}${used.has(r) ? ` · the example for sense ${used.get(r) + 1}` : ''}</div></span></label>`).join('') : '<div class="none">No verse in the Khmer ULB.</div>';
		foot = `<span>${sh.rows ? `${rows.length.toLocaleString()} verses, shortest first${d.vn && !sh.group ? ` (the shortest 400 of ${d.vn.toLocaleString()})` : ''}` : ''}</span>${s.ex ? '<button type="button" class="btn" data-act="noex">No example</button>' : ''}<button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn go" data-act="versedone"${sh.pick ? '' : ' disabled'}>Use ${sh.pick ? esc(bookName(sh.pick)) : 'it'}</button>`;
	}
	document.body.insertAdjacentHTML('beforeend', `<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${sh.kind === 'pair' ? 'Pair' : 'Example for'} sense ${sh.i + 1}">${head}<div class="sf">${filters}</div><div class="sb">${body}</div><div class="sfoot">${foot}</div></section>`);
}

// ---- Moving through the queue ----
function go(step) { const i = shown.findIndex(x => x[0] === cur), n = shown[i + step]; if (n) show(n[0]) }
// Finished: the word marked done, and on to the next word in the list, finished or not (picked before the list is
// redrawn, which drops this word when finished ones are hidden)
function finish(toggle) {
	const was = rec().done, i = shown.findIndex(x => x[0] === cur), next = i >= 0 ? shown[i + 1] : null;
	edit(r => r.done = toggle ? !was : true);
	renderQueue();
	if ((!toggle || !was) && next) show(next[0]);
}
function setMode(m) {
	mode = m; store('mode', m); $('#q').value = ''; limit = 300; counts(); renderQueue();
	const first = shown.find(x => !ED.get(x[0])?.done) || shown[0]; if (first) show(first[0]);
}

// ---- Reading the Bible (the Khmer ULB), every word glossed with your senses ----
// A word's gloss is blank until you've finished it. Tap a word to tag which of its senses it is there: that sense
// is then first in its gloss, in bold. Tags are the word's (tags: {"joh 3.16 2": a sense's id}: its second time
// in that verse), saved and exported with it.
const BOOKS = [['gen', 'Genesis'], ['exo', 'Exodus'], ['lev', 'Leviticus'], ['num', 'Numbers'], ['deu', 'Deuteronomy'], ['jos', 'Joshua'], ['jdg', 'Judges'], ['rut', 'Ruth'],
	['1sa', '1 Samuel'], ['2sa', '2 Samuel'], ['1ki', '1 Kings'], ['2ki', '2 Kings'], ['1ch', '1 Chronicles'], ['2ch', '2 Chronicles'], ['ezr', 'Ezra'], ['neh', 'Nehemiah'],
	['est', 'Esther'], ['job', 'Job'], ['psa', 'Psalms'], ['pro', 'Proverbs'], ['ecc', 'Ecclesiastes'], ['sol', 'Song of Songs'], ['isa', 'Isaiah'], ['jer', 'Jeremiah'],
	['lam', 'Lamentations'], ['eze', 'Ezekiel'], ['dan', 'Daniel'], ['hos', 'Hosea'], ['joe', 'Joel'], ['amo', 'Amos'], ['oba', 'Obadiah'], ['jon', 'Jonah'], ['mic', 'Micah'],
	['nah', 'Nahum'], ['hab', 'Habakkuk'], ['zep', 'Zephaniah'], ['hag', 'Haggai'], ['zec', 'Zechariah'], ['mal', 'Malachi'],
	['mat', 'Matthew'], ['mar', 'Mark'], ['luk', 'Luke'], ['joh', 'John'], ['act', 'Acts'], ['rom', 'Romans'], ['1co', '1 Corinthians'], ['2co', '2 Corinthians'],
	['gal', 'Galatians'], ['eph', 'Ephesians'], ['phi', 'Philippians'], ['col', 'Colossians'], ['1th', '1 Thessalonians'], ['2th', '2 Thessalonians'], ['1ti', '1 Timothy'],
	['2ti', '2 Timothy'], ['tit', 'Titus'], ['phm', 'Philemon'], ['heb', 'Hebrews'], ['jam', 'James'], ['1pe', '1 Peter'], ['2pe', '2 Peter'], ['1jo', '1 John'],
	['2jo', '2 John'], ['3jo', '3 John'], ['jud', 'Jude'], ['rev', 'Revelation']];
let reading = stored('reading', false), at = stored('readAt', {b: 'joh', c: 1}), CH = null; // CH: the chapter shown
const NCH = new Map(); // a book's number of chapters, once known
// Boxes you've broken: everywhere (all: a word -> its parts) or at one place (at: a verse -> {"word 2": its parts}:
// its second time there). Remembered here, and exported.
let SPL = stored('splits', {all: {}, at: {}});
const saveSplits = () => store('splits', SPL);
// A verse's words with the breaks in: a part knows the box it came from (from, fk: "word 2") and whether it's
// broken there only or everywhere
function broken(v) {
	const seen = new Map(), out = [];
	for (const p of v.words) {
		if (p.t != null) { out.push(p); continue }
		const k = (seen.get(p.w) || 0) + 1; seen.set(p.w, k);
		const fk = `${p.w} ${k}`, here = SPL.at[v.ref]?.[fk], parts = here || SPL.all[p.w];
		if (parts) parts.forEach(x => out.push({w: x, from: p.w, fk, scope: here ? 'here' : 'all'})); else out.push(p);
	}
	return out;
}
// The ways a box's word can be split into shorter words of the list: fewest parts first (six at most)
function splitsOf(word, ms) {
	const starts = Array.from({length: word.length}, () => []), out = [];
	for (const [a, len, , , sec] of ms) if (!sec && len < word.length && a + len <= word.length) starts[a].push(len);
	const go = (i, parts) => { if (out.length >= 200) return; if (i === word.length) return void out.push(parts); for (const len of starts[i]) go(i + len, [...parts, word.slice(i, i + len)]) };
	go(0, []);
	return out.sort((x, y) => x.length - y.length).slice(0, 6);
}
// A verse in words: the longest words of the workbench's list that cover the most of it (fewest letters left
// over, then fewest pieces); what's between them (spaces, punctuation, letters in no word) as it is
function words(text, ms, from = 0) {
	const n = text.length, starts = Array.from({length: n}, () => []), km = c => /[ក-៿᧠-᧿]/.test(c);
	for (const [a, len, , , sec] of ms) if (!sec && a >= from && a - from + len <= n) starts[a - from].push(len);
	const best = new Array(n + 1); best[n] = [0, 0, 0];
	for (let i = n - 1; i >= 0; i--) {
		const k = km(text[i]) ? 1 : 0, nx = best[i + 1];
		let b = [nx[0] + k, nx[1] + k, 0];
		for (const len of starts[i]) { const c = best[i + len]; if (c[0] < b[0] || c[0] === b[0] && c[1] + 1 < b[1]) b = [c[0], c[1] + 1, len] }
		best[i] = b;
	}
	const out = [];
	for (let i = 0; i < n;) {
		const len = best[i][2];
		if (len) { out.push({w: text.slice(i, i + len)}); i += len }
		else { if (typeof out.at(-1)?.t === 'string') out.at(-1).t += text[i]; else out.push({t: text[i]}); i++ }
	}
	return out;
}
// Your gloss of a word: nothing until it's finished; then the first synonym of each of its first three senses (one
// without: the first piece of its definition), or, none having any, the first sentence of the first two senses'
// definitions; the sense tagged here first, in bold
const firstPiece = d => d.split(/[;,]/)[0].replace(/\s*\([^)]*\)/g, '').trim();
const firstSent = d => (d.match(/^.*?[.!?។](?=\s|$)/)?.[0] ?? d).replace(/[.។]$/, '').trim();
function readGloss(w, key) {
	const r = ED.get(w);
	if (!r?.done) return '';
	const ss = r.senses.filter(x => x.def.trim() || x.syn.length), tag = r.tags?.[key], ti = tag ? ss.findIndex(x => x.id === tag) : -1;
	const order = ti > 0 ? [ss[ti], ...ss.filter((_, j) => j !== ti)] : ss;
	const syn = order.slice(0, 3).map(x => x.syn[0]);
	const gs = syn.some(Boolean) ? order.slice(0, 3).map((x, j) => syn[j] || firstPiece(x.def)) : order.slice(0, 2).map(x => firstSent(x.def));
	const seen = new Set();
	return gs.map((g, j) => [g, j === 0 && ti >= 0]).filter(([g]) => g && !seen.has(g.toLowerCase()) && seen.add(g.toLowerCase()))
		.map(([g, bold]) => bold ? `<b>${esc(g)}</b>` : esc(g)).join('; ');
}
async function loadChapter(b, c) {
	const keys = Array.from({length: 176}, (_, v) => `${b} ${c}.${v + 1}`);
	const [k, e] = await Promise.all([engine.lookup('ulb', keys), engine.lookup('enult', keys)]);
	const text = es => es?.[0] ? clean(es[0].body.split('\t').slice(1).join(' ')) : '';
	const vs = keys.filter(r => k[r]).map(r => ({ref: r, km: text(k[r]), en: text(e[r])}));
	const name = k[keys[0]]?.[0]?.body.split('\t')[0].replace(/\s*[\d:]+$/, '') || '';
	// The verses' words: one search of them all (normalized, the list's way: same length), split verse by verse
	const all = vs.map(v => norm(v.km.replace(/​/g, ''))).join('\n'), ms = await engine.matchall('wb', all);
	let o = 0;
	for (const v of vs) { const t = norm(v.km.replace(/​/g, '')); v.words = words(t, ms, o); o += t.length + 1 }
	return {b, c, name, vs};
}
async function chapterCount(b) {
	if (NCH.has(b)) return NCH.get(b);
	const keys = Array.from({length: 150}, (_, c) => `${b} ${c + 1}.1`), got = await engine.lookup('ulb', keys);
	const n = keys.filter(k => got[k]).length || 1;
	NCH.set(b, n); return n;
}
async function openChapter(b, c) {
	at = {b, c}; store('readAt', at);
	$('#read').innerHTML = '<div class="card empty">Loading the chapter…</div>';
	const [ch] = await Promise.all([loadChapter(b, c), chapterCount(b)]);
	if (at.b !== b || at.c !== c) return;
	CH = ch; renderRead(true);
}
function renderRead(top) {
	const el = $('#read'); if (!el || !CH) return;
	const st = el.scrollTop, n = NCH.get(CH.b) || 1, bi = BOOKS.findIndex(x => x[0] === CH.b);
	let total = 0, glossed = 0;
	const verse = v => {
		const seen = new Map();
		const ws = broken(v).map(p => {
			if (p.t != null) return `<span class="rt">${esc(p.t)}</span>`;
			const w = p.w, k = (seen.get(w) || 0) + 1; seen.set(w, k);
			const key = `${v.ref} ${k}`, r = ED.get(w), g = readGloss(w, key), tagged = !!r?.tags?.[key];
			total++; if (g) glossed++;
			const from = p.from ? ` data-from="${esc(p.from)}" data-fk="${esc(p.fk)}" data-scope="${p.scope}"` : '';
			return `<button type="button" class="rw${g ? ' done' : r && hasSenses(r) ? ' started' : ''}${tagged ? ' tagged' : ''}${p.from ? ' part' : ''}" data-rw="${esc(w)}" data-key="${esc(key)}"${from}><span class="k km">${esc(w)}</span><span class="g">${g || '&nbsp;'}</span></button>`;
		}).join('');
		return `<div class="rv"><span class="vn">${v.ref.split('.')[1]}</span><div class="ws">${ws}</div>${v.en ? `<div class="en">${esc(v.en)}</div>` : ''}</div>`;
	};
	const body = CH.vs.map(verse).join('');
	el.innerHTML = `<div class="card rhead">
			<select id="rbook" aria-label="Book">${BOOKS.map(([c, nm]) => `<option value="${c}"${c === CH.b ? ' selected' : ''}>${nm}</option>`).join('')}</select>
			<select id="rch" aria-label="Chapter">${Array.from({length: n}, (_, j) => `<option value="${j + 1}"${j + 1 === CH.c ? ' selected' : ''}>${j + 1}</option>`).join('')}</select>
			<span class="km rname">${esc(CH.name)} ${CH.c}</span>
			<span class="rnav"><button type="button" class="btn" data-act="rprev"${CH.c === 1 && bi === 0 ? ' disabled' : ''}>← Chapter</button><button type="button" class="btn" data-act="rnext"${CH.c === n && bi === BOOKS.length - 1 ? ' disabled' : ''}>Chapter →</button></span>
			<span class="rcount">${glossed.toLocaleString()} of ${total.toLocaleString()} words glossed</span>
		</div>
		<div class="card rtext">${body || '<div class="empty">No verses.</div>'}</div>`;
	el.scrollTop = top ? 0 : st;
}
function setReading(on) {
	reading = on; store('reading', on);
	$('#app').classList.toggle('reading', on);
	$('#readBtn').setAttribute('aria-pressed', String(on));
	$('#readBtn').textContent = on ? 'Words' : 'Bible';
	if (on) CH && CH.b === at.b && CH.c === at.c ? renderRead() : openChapter(at.b, at.c);
}
// A word tapped in the Bible: which of its senses it is there
async function tagEditor(w, key, from) {
	const sh = sheet = {kind: 'tag', w, key, i: 0, from, cands: null}; renderSheet();
	if (from) return;
	const c = splitsOf(w, await engine.matchall('wb', w));
	if (sheet !== sh) return;
	sh.cands = c; renderSheet();
}
function drawTagSheet() {
	const {w, key} = sheet, r = ED.get(w), ss = (r?.senses || []).filter(x => x.def.trim() || x.syn.length), tag = r?.tags?.[key];
	const [b, cv] = key.split(' '), nth = +key.split(' ')[2], bk = BOOKS.find(x => x[0] === b)?.[1] || b;
	const opt = (id, label) => `<label class="opt${(tag || '') === id ? ' on' : ''}"><input type="radio" name="tagsense" data-tagsense="${esc(id)}"${(tag || '') === id ? ' checked' : ''}><span>${label}</span></label>`;
	const body = !ss.length ? `<div class="none">You haven't written senses for <span class="km">${esc(w)}</span> yet.</div>`
		: `<div class="sect">WHICH SENSE IS IT HERE?</div>` + ss.map((x, j) => opt(x.id || `#${j}`, `<b>${j + 1}.</b> ${x.pos ? `<span class="r">${esc(x.pos)}</span> ` : ''}${esc(x.def || '')}${x.syn.length ? ` <span class="e">(${esc(x.syn.join(', '))})</span>` : ''}`)).join('') + opt('', 'Not tagged');
	document.body.insertAdjacentHTML('beforeend', `<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="Tag ${esc(w)} in ${esc(bk)} ${esc(cv)}">
		<div class="sh"><div class="t"><span><span class="km" style="letter-spacing:0">${esc(w)}</span> · ${esc(bk)} ${esc(cv.replace('.', ':'))}${nth > 1 ? ` (its ${nth === 2 ? '2nd' : nth === 3 ? '3rd' : nth + 'th'} time in the verse)` : ''}</span><button type="button" data-act="close" aria-label="Close">×</button></div>
		<div class="d">${r?.done ? `Gloss here: ${readGloss(w, key) || '—'}` : "Not finished yet: its gloss stays blank until you finish it."}</div></div>
		<div class="sb">${body}${splitHTML()}</div>
		<div class="sfoot">${BY.has(w) ? `<button type="button" class="btn go" data-act="ropen">Open <span class="km">${esc(w)}</span> in the Workbench</button>` : '<span class="none">Not in the workbench\'s word list.</span>'}</div></section>`);
}
// The sheet's "Wrong box?": a part of a broken box joins back; a box breaks, here or everywhere, where you put spaces
// (the ways the word list splits it fill them in)
function splitHTML() {
	const {w, key, from} = sheet, ref = key.split(' ').slice(0, 2).join(' ');
	if (from) return `<div class="sect">BROKEN BOX</div><div class="splitb"><span>A part of <span class="km">${esc(from.w)}</span>, broken ${from.scope === 'here' ? 'here only' : 'everywhere it is'}.</span>
		<button type="button" class="btn" data-act="join">Join back into <span class="km">${esc(from.w)}</span>${from.scope === 'all' ? ' everywhere' : ''}</button></div>`;
	const cands = sheet.cands, first = cands?.[0]?.join(' ') ?? [...w].join('');
	return `<div class="sect">WRONG BOX? BREAK IT</div><div class="splitb">
		${cands == null ? '<span class="none">Looking for its parts…</span>' : cands.length ? `<span class="l">As the word list has its parts:</span><div class="chips">${cands.map(c => `<button type="button" class="dash km" data-act="splitpick" data-parts="${esc(c.join(' '))}">${c.map(esc).join(' · ')}</button>`).join('')}</div>` : '<span class="none">No words of the list make it up: put spaces where it breaks.</span>'}
		<input type="text" id="splitq" class="km" value="${esc(cands?.length ? first : w)}" aria-label="The word with spaces where it breaks" autocomplete="off" spellcheck="false">
		<div class="row"><button type="button" class="btn" data-act="splithere">Break it here only</button><button type="button" class="btn" data-act="splitall">Break it everywhere</button><span class="none" id="splitmsg"></span></div></div>`;
}
function doSplit(scope) {
	const {w, key} = sheet, parts = $('#splitq').value.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2 || parts.join('') !== w) { $('#splitmsg').textContent = parts.join('') !== w ? `The parts must make up ${w} exactly.` : 'Put at least one space in it.'; return }
	const ref = key.split(' ').slice(0, 2).join(' '), fk = `${w} ${key.split(' ')[2]}`;
	if (scope === 'all') SPL.all[w] = parts; else (SPL.at[ref] ||= {})[fk] = parts;
	saveSplits(); sheet = null; renderSheet(); renderRead();
}
function joinBack() {
	const {key, from} = sheet, ref = key.split(' ').slice(0, 2).join(' ');
	if (from.scope === 'all') delete SPL.all[from.w];
	else { delete SPL.at[ref]?.[from.fk]; if (SPL.at[ref] && !Object.keys(SPL.at[ref]).length) delete SPL.at[ref] }
	saveSplits(); sheet = null; renderSheet(); renderRead();
}
// Tags a sense (an id, given to the senses that have none: "#2" is the second without one) to w at key; '' untags
function tagSense(w, key, id) {
	const r = structuredClone(ED.get(w)); if (!r) return;
	const ss = r.senses.filter(x => x.def.trim() || x.syn.length);
	if (id.startsWith('#')) { const x = ss[+id.slice(1)]; if (!x) return; id = x.id ||= Math.random().toString(36).slice(2, 9) }
	r.tags = {...r.tags}; if (id) r.tags[key] = id; else delete r.tags[key];
	r.t = Date.now(); ED.set(w, r); DRAFT.delete(w);
	db.put(r).then(() => setStatus(), e => { dbOK = false; setStatus(); console.warn(e) });
	renderRead(); renderSheet();
}

// ---- Events ----
document.addEventListener('click', async e => {
	const t = e.target.closest('[data-act], [data-w], [data-rw], [data-src], [data-more], [data-tab], [data-group]');
	if (!t) return;
	if (t.dataset.rw) return tagEditor(t.dataset.rw, t.dataset.key, t.dataset.from ? {w: t.dataset.from, fk: t.dataset.fk, scope: t.dataset.scope} : null);
	if (t.dataset.w) return show(t.dataset.w);
	if (t.dataset.more) { limit += 300; return renderQueue() }
	if (t.dataset.src) { const k = t.dataset.src; on.has(k) ? on.delete(k) : on.add(k); if (!on.size) on.add(k); store('srcs', [...on]); renderSrcs(); return renderQueue() }
	if (t.dataset.tab) { document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b === t)); $('#app').classList.toggle('tab-ref', t.dataset.tab === 'ref'); return }
	if (t.dataset.group != null && sheet?.kind === 'verse') { sheet.group = t.dataset.group; sheet.pick = rec().senses[sheet.i]?.ex?.ref || null; return verseLoad() }
	const a = t.dataset.act, i = +t.dataset.i;
	switch (a) {
	case 'close': sheet = null; return renderSheet();
	case 'rprev': case 'rnext': {
		const bi = BOOKS.findIndex(x => x[0] === CH.b), d = a === 'rnext' ? 1 : -1;
		if (CH.c + d >= 1 && CH.c + d <= (NCH.get(CH.b) || 1)) return openChapter(CH.b, CH.c + d);
		const nb = BOOKS[bi + d]; if (!nb) return;
		return openChapter(nb[0], d > 0 ? 1 : await chapterCount(nb[0]));
	}
	case 'splitpick': $('#splitq').value = t.dataset.parts; $('#splitmsg').textContent = ''; return;
	case 'splithere': return doSplit('here');
	case 'splitall': return doSplit('all');
	case 'join': return joinBack();
	case 'ropen': { const w = sheet.w; sheet = null; renderSheet(); setReading(false); return show(w) }
	case 'pf': if (sheet?.kind === 'pair') { sheet.f = t.dataset.f; sheet.top = true; renderSheet() } return;
	case 'fold': { const id = t.dataset.card; closed.has(id) ? closed.delete(id) : closed.add(id); store('closed', [...closed]); return renderRef() }
	}
	if (!cur) return;
	switch (a) {
	case 'prev': return go(-1);
	case 'done': return finish(true);
	case 'addsense': edit(r => { if (!r.senses.length) r.senses.push(newSense()); r.senses.push(newSense()); active = r.senses.length - 1 }); return $(`#def-${active}`)?.focus();
	case 'delsense': edit(r => { r.senses.splice(i, 1); active = Math.max(0, Math.min(active, r.senses.length - 1)) }); return renderRef();
	case 'up': edit(r => { [r.senses[i - 1], r.senses[i]] = [r.senses[i], r.senses[i - 1]]; active = i - 1 }); return renderRef();
	case 'delsyn': return edit(r => r.senses[i].syn.splice(+t.dataset.j, 1));
	case 'reset': {
		// The word as if never opened: your senses, synonyms, struck and added words and Finished cleared (here and
		// in this device's store), and its draft made again from Wiktionary
		const w = cur;
		if (ED.has(w) && !confirm(`Reset ${w}? Your senses, synonyms, notes, struck and added words for it are cleared, and it starts again from its Wiktionary senses.`)) return;
		clearTimeout(saveT); ED.delete(w); DRAFT.delete(w); active = 0; counts();
		db.del(w).then(() => setStatus(), e => { dbOK = false; setStatus(); console.warn(e) });
		renderQueue();
		return show(w);
	}
	case 'combine': return combine(i, +t.dataset.j, t.dataset.keep);
	case 'apart': { const j = +t.dataset.j; return edit(r => { const a = r.senses[i]; a.apart = [...new Set([...(a.apart || []), ...r.senses[j].pairs.filter(p => p.src === 'wikts').map(p => 'wikts|' + p.id)])] }) }
	case 'nodraft': DRAFT.set(cur, {...structuredClone(ED.get(cur) || blank(cur)), senses: []}); active = 0; renderWork(); return renderRef();
	case 'delpair': edit(r => r.senses[i].pairs.splice(+t.dataset.j, 1)); return renderRef();
	case 'strike': { const v = t.dataset.e; return edit(r => { r.strike = r.strike.includes(v) ? r.strike.filter(x => x !== v) : [...r.strike, v] }) }
	case 'unadd': { const v = t.dataset.e; return edit(r => r.add = r.add.filter(x => x !== v)) }
	case 'synto': return addSyn(i, t.dataset.e, false);
	case 'syn': { const v = t.dataset.e; return edit(r => { if (!r.senses.length) r.senses.push(newSense()); const s = r.senses[Math.min(active, r.senses.length - 1)]; if (!s.syn.includes(v)) s.syn.push(v) }) }
	case 'pair': if (!rec().senses.length) edit(r => r.senses.push(newSense())); active = i; return openPair(i);
	case 'verse': if (!rec().senses.length) edit(r => r.senses.push(newSense())); active = i; return openVerse(i);
	case 'usewikt': { const s = info.wikt[+t.dataset.j], id = cur + '#' + t.dataset.j; return useSense({pos: POSOF[s.pos] || '', def: s.text, from: {src: 'Wiktionary', id, text: s.text}, pairs: [{src: 'wikt', id, text: s.text, pos: s.pos}]}) }
	case 'usewikts': { const s = info.wikts[+t.dataset.j]; return useSense({pos: POSOF[s.pos] || '', def: s.gloss, syn: [s.word], from: {src: 'Wiktionary', id: s.id, text: s.gloss}, pairs: [{src: 'wikts', id: s.id, text: s.gloss, pos: s.pos}]}) }
	case 'pairwikts': { const s = info.wikts[+t.dataset.j]; return pairActive({src: 'wikts', id: s.id, text: s.gloss, pos: s.pos}) }
	case 'pairwikt': { const s = info.wikt[+t.dataset.j]; return pairActive({src: 'wikt', id: cur + '#' + t.dataset.j, text: s.text, pos: s.pos}) }
	case 'usewn': { const v = await wnSense(t.dataset.id); return useSense({pos: POSOF[v.pos] || '', def: v.gloss, syn: v.lemmas, from: {src: 'WordNet', id: v.id, text: v.gloss}, pairs: [{src: 'wn', id: v.id, text: v.gloss, pos: v.pos}]}) }
	case 'pairwn': { if (t.dataset.wd) return pairActive({src: 'wd', id: t.dataset.id, text: t.dataset.id, pos: 'Wikidata'}); const v = await wnSense(t.dataset.id); return pairActive({src: 'wn', id: v.id, text: v.gloss, pos: v.pos}) }
	case 'pairdone': { const sh = sheet; edit(r => { const s = r.senses[sh.i]; s.pairs = [...sh.sel.values()] }); sheet = null; renderSheet(); return renderRef() }
	case 'versedone': { const sh = sheet; if (!sh.pick) return; edit(r => r.senses[sh.i].ex = {ref: sh.pick, km: 'km-ulb', en: 'en-ult'}); sheet = null; return renderSheet() }
	case 'noex': { const sh = sheet; edit(r => r.senses[sh.i].ex = null); sheet = null; return renderSheet() }
	}
});
document.addEventListener('change', e => {
	const t = e.target;
	if (t.id === 'hide') { hide = t.checked; store('hide', hide); return renderQueue() }
	if (t.id === 'importIn') return importFile(t.files[0]);
	if (t.dataset.f === 'syn' && t.isConnected && t.value.trim()) { const v = t.value; t.value = ''; return addSyn(+t.dataset.i, v, false) }
	if (t.dataset.tagsense != null && sheet?.kind === 'tag') return tagSense(sheet.w, sheet.key, t.dataset.tagsense);
	if (t.id === 'rbook') return openChapter(t.value, 1);
	if (t.id === 'rch') return openChapter(at.b, +t.value);
	if (t.dataset.f === 'pos') { const i = +t.dataset.i, v = t.value; return edit(r => { if (!r.senses.length) r.senses.push(newSense()); r.senses[i].pos = v }, false) }
	if (t.dataset.pk && sheet?.kind === 'pair') { const k = t.dataset.pk; t.checked ? sheet.sel.set(k, (({label, how, ...x}) => x)(sheet.all.get(k))) : sheet.sel.delete(k); return renderSheet() }
	if (t.dataset.ref && sheet?.kind === 'verse') { sheet.pick = t.dataset.ref; return renderSheet() }
});
let pairT = null;
document.addEventListener('input', e => {
	const t = e.target;
	if (t.id === 'q') { limit = 300; return renderQueue() }
	if (t.id === 'pairq') { sheet.q = t.value; clearTimeout(pairT); pairT = setTimeout(pairSearch, 300); return }
	if (t.id === 'verseq') { sheet.q = t.value; sheet.top = true; const pos = t.selectionStart; renderSheet(); const n = $('#verseq'); n.focus(); n.setSelectionRange(pos, pos); return }
	if (t.dataset.f === 'syn' && /[,;，]/.test(t.value)) { const v = t.value, k = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'), v.lastIndexOf('，')); t.value = v.slice(k + 1).trimStart(); const rest = t.value; addSyn(+t.dataset.i, v.slice(0, k)); const n = $(`#syn-${t.dataset.i}`); if (n) n.value = rest; return }
	if (t.dataset.f === 'def' || t.dataset.f === 'note') {
		fit(t); const i = +t.dataset.i, f = t.dataset.f, v = t.value;
		edit(r => { if (!r.senses.length) r.senses.push(newSense()); r.senses[i][f] = v }, false);
		if (f === 'def') { const bar = t.closest('.sense').querySelector('.from'); const s = rec().senses[i]; if (bar && s.from) bar.textContent = `from ${s.from.src}${s.def.trim() !== s.from.text.trim() ? ', edited' : ''}` }
	}
});
document.addEventListener('focusin', e => {
	const s = e.target.closest?.('.sense');
	if (s && +s.dataset.i !== active) { active = +s.dataset.i; document.querySelectorAll('.sense').forEach(x => x.style.boxShadow = rec().senses.length > 1 && +x.dataset.i === active ? '0 0 0 3px var(--tab)' : '') }
});
document.addEventListener('keydown', e => {
	const t = e.target;
	if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (cur) finish(false); return }
	if (e.key === 'Escape' && sheet) { sheet = null; renderSheet(); return }
	if (t.dataset?.f === 'syn') {
		if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) { e.preventDefault(); const v = t.value; t.value = ''; addSyn(+t.dataset.i, v) }
		else if (e.key === 'Backspace' && !t.value) {
			const i = +t.dataset.i; if (rec().senses[i]?.syn.length) { e.preventDefault(); edit(r => r.senses[i].syn.pop()); $(`#syn-${i}`)?.focus() }
		}
		return;
	}
	if (t.matches('input, textarea, select')) return;
	if (e.key === ']') go(1); else if (e.key === '[') go(-1);
	else if (e.key === '/') { e.preventDefault(); $('#app').classList.add('qopen'); $('#q').focus() }
});
document.addEventListener('submit', e => {
	if (e.target.classList.contains('synf')) { e.preventDefault(); const t = e.target.querySelector('.syn-in'), v = t.value; t.value = ''; return addSyn(+e.target.dataset.i, v) }
	if (e.target.id !== 'addw') return;
	e.preventDefault();
	const v = $('#addq').value.trim(); if (!v || !cur) return;
	edit(r => { if (!r.add.includes(v)) r.add.push(v) }); $('#addq')?.focus();
});
$('#mWrite').onclick = () => setMode('write');
$('#mReview').onclick = () => setMode('review');
$('#listBtn').onclick = () => $('#app').classList.add('qopen');
$('#qscrim').onclick = () => $('#app').classList.remove('qopen');
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { const w = norm($('#q').value); if (w) show(BY.has(w) ? w : shown[0]?.[0] || w) } });

// ---- Export / import ----
// Colour scheme: Auto (the device's), Light or Dark, in turn; remembered (wb-theme), and set before the page is
// drawn by index.html's first script
const THEMES = {auto: ['◐', 'Auto: as the device'], light: ['☀', 'Light'], dark: ['☾', 'Dark']};
let theme = stored('theme', 'auto');
function setTheme(t) {
	theme = THEMES[t] ? t : 'auto'; store('theme', theme);
	if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
	const next = {auto: 'light', light: 'dark', dark: 'auto'}[theme], b = $('#themeBtn');
	b.textContent = THEMES[theme][0];
	b.title = `Colours: ${THEMES[theme][1]}. Switch to ${THEMES[next][1].replace(/:.*/, '')}`; b.setAttribute('aria-label', b.title);
}
setTheme(theme);
$('#themeBtn').onclick = () => setTheme({auto: 'light', light: 'dark', dark: 'auto'}[theme]);
$('#exportBtn').onclick = () => {
	const data = {format: 'peakslab-workbench', version: 1, exported: new Date().toISOString(), entries: [...ED.values()].filter(r => started(r) || r.done).map(r => ({...r, senses: r.senses.map(({pre, apart, ...s}) => s)})), splits: SPL};
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], {type: 'application/json'}));
	a.download = `km-en-workbench-${new Date().toISOString().slice(0, 10)}.json`;
	document.body.append(a); a.click(); a.remove();
	setStatus(`Exported ${data.entries.length.toLocaleString()} words`);
};
async function importFile(f) {
	if (!f) return;
	try {
		const data = JSON.parse(await f.text());
		const rs = (data.entries || []).filter(r => r && r.w && Array.isArray(r.senses));
		const newer = rs.filter(r => !(ED.get(r.w)?.t > r.t)).map(fromStore);
		newer.forEach(r => DRAFT.delete(r.w));
		if (data.splits) { Object.assign(SPL.all, data.splits.all); for (const [ref, ks] of Object.entries(data.splits.at || {})) SPL.at[ref] = {...SPL.at[ref], ...ks}; saveSplits() }
		newer.forEach(r => ED.set(r.w, r));
		await db.putAll(newer);
		counts(); renderQueue(); if (cur) { renderWork(); renderRef() } if (reading) renderRead();
		setStatus(`Imported ${newer.length.toLocaleString()} word${newer.length === 1 ? "" : "s"} (${(rs.length - newer.length).toLocaleString()} older than yours kept as they were)`);
	} catch (e) { setStatus(`That file couldn't be read: ${e.message}`) }
	$('#importIn').value = '';
}

// ---- Start ----
(async () => {
	renderSrcs(); $('#hide').checked = hide;
	engine.start();
	try { for (const r of await db.all()) ED.set(r.w, fromStore(r)) } catch (e) { dbOK = false; console.warn(e) }
	Q = await fetch('data/queue.json').then(r => r.json());
	Q.forEach(x => BY.set(x[0], x));
	counts(); renderQueue(); setStatus();
	const h = decodeURIComponent(location.hash.slice(1));
	const first = BY.has(h) ? h : (shown.find(x => !ED.get(x[0])?.done) || shown[0])?.[0];
	if (first) show(first);
	$('#readBtn').onclick = () => setReading(!reading);
	if (reading) setReading(true);
})();
