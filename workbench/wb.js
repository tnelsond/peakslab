"use strict";
// The workbench: 👍 or 👎 for each questionable Khmer sense word (data/review.json: those the judge rejected or was
// unsure of), beside Chuon Nath 2022 and Headley 97 (read with the PeakSlab engine). Votes stay in this browser
// (localStorage); Export saves them as a file (km<TAB>sense<TAB>word<TAB>up|down) for the kept and rejected lists.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const store = (k, v) => { try { localStorage.setItem('wb-' + k, JSON.stringify(v)) } catch (e) {} };
const stored = (k, d) => { try { const v = JSON.parse(localStorage.getItem('wb-' + k)); return v ?? d } catch (e) { return d } };
const DICTS = [['nath', 'khmer/dict/km-nath2022.peak.zst', 'Chuon Nath 2022'], ['h97', 'khmer/dict/km-h97.peak.zst', 'Headley 1997']];

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker:', e));

// ---- The engine: each dictionary's entries for a word ----
const engine = (() => {
	const worker = new Worker('/peakworker.js');
	const ready = DICTS.map(() => { let r; const p = new Promise(res => r = res); return {p, r} });
	const waits = new Map();
	let tag = 0, wasm = null;
	const files = fetch('/files.json', {cache: 'no-cache'}).then(r => r.json());
	const ts = async path => { const f = await files; return ((f.dicts.find(d => d[0] === path) || f.core.find(c => c[0] === path)) || [])[1] || 0 };
	worker.onmessage = async ({data: m}) => {
		if (m.type === 'needwasm') {
			const t = await ts('peak.wasm');
			wasm ??= fetch(`/peak.wasm?v=${t}`).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b));
			worker.postMessage({type: 'wasm', wasm: await wasm});
		} else if (m.type === 'needbytes') {
			const path = DICTS[m.did][1], t = await ts(path);
			try {
				const buf = await fetch(`/${path}?v=${t}`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer() });
				worker.postMessage({type: 'bytes', did: m.did, buf}, [buf]);
			} catch (e) { console.warn(path, e); worker.postMessage({type: 'bytes', did: m.did, buf: null}) }
		} else if (m.type === 'loaded' || m.type === 'loadfailed') ready[m.did].r(m.type === 'loaded');
		else if (m.type === 'rendered') { const w = waits.get(m.tag); if (w) { waits.delete(m.tag); w(m) } }
	};
	const ask = msg => new Promise(res => { const t = ++tag; waits.set(t, res); worker.postMessage({...msg, tag: t}) });
	files.then(async f => {
		worker.postMessage({type: 'init', id: 1, wasmTimestamp: await ts('peak.wasm')});
		for (const [did, [, path, name]] of DICTS.entries()) {
			const e = f.dicts.find(d => d[0] === path);
			worker.postMessage({type: 'load', did, msg: [path, name, e ? e[3] : 65536], timestamp: await ts(path)});
		}
	});
	// The entries whose headword is exactly w
	return async (did, w) => {
		if (!await ready[did].p) return [];
		const {matches} = await ask({type: 'matchall', did, query: w});
		const lines = matches.filter(([s, len, , , sec]) => s === 0 && len === w.length && !sec).map(([, , m, i]) => [m, i]);
		if (!lines.length) return [];
		return (await ask({type: 'renderlines', did, lines})).entries.filter(Boolean);
	};
})();
const cache = new Map();
const entries = w => { if (!cache.has(w)) cache.set(w, Promise.all(DICTS.map((_, did) => engine(did, w)))); return cache.get(w) };
const dictHtml = es => es.map(e => `<div class="d">${e.body.split('\t').filter(c => !/^\[.*\]$/.test(c.trim())).join(' ').replace(/<details>.*?<\/details>/gs, '')}</div>`).join('');

// ---- The list and the votes ----
let R = [], at = 0;
const votes = stored('votes', {});  // "sense<TAB>word": 1 up, 0 down
const id = (w, s) => s[0] + '\t' + w;
const open = i => R[i][1].findIndex(s => !(id(R[i][0], s) in votes));
const CLAUDE = {n: 'Claude: doesn’t fit', '?': 'Claude: unsure'};

async function show(i) {
	at = Math.max(0, Math.min(R.length - 1, i)); store('at', at);
	const [w, senses] = R[at], cur = open(at);
	$('#where').textContent = `${at + 1} / ${R.length}`;
	$('#count').textContent = `${Object.keys(votes).length} of ${R.reduce((n, x) => n + x[1].length, 0)} voted`;
	const sensesHtml = senses.map((s, j) => {
		const v = votes[id(w, s)];
		return `<div class="sense${j === cur ? ' cur' : ''}"><div class="t"><span class="pos">${esc(s[1])}</span>${esc(s[0])}<span class="c">${CLAUDE[s[2]]}</span></div>` +
			`<button type="button" class="v up${v === 1 ? ' on' : ''}" data-j="${j}" data-v="1" title="Right">👍</button>` +
			`<button type="button" class="v down${v === 0 ? ' on' : ''}" data-j="${j}" data-v="0" title="Wrong">👎</button></div>`;
	}).join('');
	const page = d => `<div class="card"><h1>${esc(w)}</h1></div><div class="card">${sensesHtml}</div>` +
		DICTS.map(([, , name], k) => `<div class="card"><div class="lbl">${name}</div>${d ? (d[k].length ? dictHtml(d[k]) : '<div class="none">Not in it</div>') : '<div class="none">Loading…</div>'}</div>`).join('');
	$('#word').innerHTML = page(null);
	const d = await entries(w);
	if (R[at][0] === w) $('#word').innerHTML = page(d);
	for (const k of [1, 2]) if (R[at + k]) entries(R[at + k][0]);  // (the next ones, ready)
}
function vote(j, v) {
	const [w, senses] = R[at];
	if (votes[id(w, senses[j])] === v) delete votes[id(w, senses[j])]; else votes[id(w, senses[j])] = v;
	store('votes', votes);
	if (open(at) < 0 && votes[id(w, senses[j])] === v) setTimeout(() => R[at][0] === w && next(), 200);
	else show(at);
}
const next = () => { for (let i = at + 1; i < R.length; i++) if (open(i) >= 0) return show(i); show(at + 1) };

document.addEventListener('click', e => {
	const b = e.target.closest('button'); if (!b) return;
	if (b.dataset.v) vote(+b.dataset.j, +b.dataset.v);
	else if (b.id === 'next') next();
	else if (b.id === 'prev') show(at - 1);
	else if (b.id === 'export') exportVotes();
	else if (b.id === 'old') exportOld();
});
document.addEventListener('keydown', e => {
	if (e.ctrlKey || e.metaKey || e.altKey || !R.length) return;
	const k = e.key, cur = open(at);
	if ((k === 'y' || k === 'ArrowUp') && cur >= 0) vote(cur, 1);
	else if ((k === 'n' || k === 'ArrowDown') && cur >= 0) vote(cur, 0);
	else if (k === 'Enter' || k === 'ArrowRight') next();
	else if (k === 'ArrowLeft') show(at - 1);
	else return;
	e.preventDefault();
});

function save(name, text, type) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const exportVotes = () => save(`workbench-votes-${new Date().toISOString().slice(0, 10)}.tsv`,
	'#workbench votes\n' + Object.entries(votes).map(([k, v]) => `km\t${k}\t${v ? 'up' : 'down'}`).join('\n') + '\n', 'text/tab-separated-values');

// The earlier workbench's work (IndexedDB 'peakslab-workbench'), if this browser has any: Export earlier work
let oldDb = null;
function openOld() {
	return new Promise(res => {
		const r = indexedDB.open('peakslab-workbench');
		r.onupgradeneeded = () => r.transaction.abort();  // (none here: don't make one)
		r.onsuccess = () => res(r.result.objectStoreNames.contains('entries') ? r.result : null);
		r.onerror = () => res(null);
	});
}
openOld().then(d => {
	if (!d) return;
	const q = d.transaction('entries').objectStore('entries').count();
	q.onsuccess = () => { if (q.result) { oldDb = d; $('#old').hidden = false } };
});
function exportOld() {
	const q = oldDb.transaction('entries').objectStore('entries').getAll();
	q.onsuccess = () => save('peakslab-workbench.json', JSON.stringify({format: 'peakslab-workbench', version: 1, exported: new Date().toISOString(), entries: q.result}), 'application/json');
}

fetch('data/review.json').then(r => r.json()).then(r => {
	R = r;
	const w = decodeURIComponent(location.hash.slice(1)), i = R.findIndex(x => x[0] === w);
	if (i >= 0) return show(i);
	const s = stored('at', 0); at = s - 1; open(Math.min(s, R.length - 1)) >= 0 ? show(s) : next();
});
