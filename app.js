"use strict";

// Speech-synthesis language list for the selection-menu "speak" buttons.
// Starts as an English-only fallback for the root page (which has no
// per-page language context); repopulated below, once we know the current
// page's language(s), from files.json's abbr table.
let lang = [
	{name: "English", val: 'en_US'}
];
let appname = '?';
// Set inside the non-root branch below, once `dicts` exists. Declared here
// (module scope) because the service-worker 'message' listener below is
// registered before that branch runs, and needs to be able to call it -
// a `function ack(){...}` declared inside the later `else` block would be
// block-scoped and invisible from here, silently throwing a ReferenceError
// on every 'status' message instead of clearing the "not downloaded" state.
let ack = null;
// Reused for every bookmark button (one per result) — defined once so we're
// not rebuilding this markup on every streamed result. CSS fills it in when
// it's bookmarked (aria-pressed).
const bookmarkSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
// Chords (<p-m chord="...">) are hidden by default (CSS). The button toggles
// one class on <body>, remembered; CSS shows them and switches every
// button's label (see .chords-btn).
// Remembered things (null if there's nothing, or no storage)
const stored = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not remembered */ } };
const readList = k => { const l = stored(k); return Array.isArray(l) ? l : []; };
const chordsBtnHTML = '<button class="chords-btn" onclick="toggleChords()" title="Show or hide chords"></button>';
window.toggleChords = () => store('showChords', document.body.classList.toggle('show-chords'));
document.body.classList.toggle('show-chords', stored('showChords') === true);
// Collapse a dictionary: every one of its entries (data-dict) shrinks to its
// first line, everywhere in the results, and stays collapsed (remembered).
// Some start collapsed (files.json's 7th field, #collapsed in the source:
// Bible notes, ...); what's remembered is the ones flipped from that.
// Done with one generated CSS rule per collapsed dictionary.
const collapseBtnHTML = '<button class="collapse-btn" onclick="toggleDict(this)" title="Collapse or expand this dictionary"></button>';
// Glosses an entry word by word, see translateEntry
const translateBtnHTML = '<button class="translate-btn" onclick="translateEntry(this)" title="Gloss word by word">⇄ Gloss</button>';
const collapseStyle = document.head.appendChild(document.createElement('style'));
let collapsedDicts = readList('collapsedDicts'); // Flipped from their default
let startCollapsed = new Set(); // (set once files.json is read)
const applyCollapsed = () => {
	const flipped = new Set(collapsedDicts);
	const sel = [...startCollapsed].filter(d => !flipped.has(d)).concat(collapsedDicts.filter(d => !startCollapsed.has(d)))
		.map(d => `p-e[data-dict="${CSS.escape(d)}"]`);
	collapseStyle.textContent = sel.length ? `${sel.join(',')}{max-height:1.8em;overflow:hidden;opacity:.6;font-size:.8em;margin-top:.4em;padding-top:.2em}` +
		`${sel.map(s => s + ' .collapse-btn::after').join(',')}{content:"+"}` +
		`${sel.map(s => s + ' p-h').join(',')}{padding:0 3px}` : '';
};
applyCollapsed();
window.toggleDict = btn => {
	const d = btn.closest('p-e').dataset.dict;
	collapsedDicts = collapsedDicts.includes(d) ? collapsedDicts.filter(x => x !== d) : [...collapsedDicts, d];
	store('collapsedDicts', collapsedDicts);
	applyCollapsed();
};
// On dictionary pages, start the workers right away, in parallel with
// files.json instead of after it: starting a worker takes ~50 ms, and each
// worker immediately starts reading peak.wasm from the offline cache.
const isDictPage = window.location.pathname.length > 1;
const $ = id => document.getElementById(id);
const earlyWorkers = isDictPage ? [new Worker('/peakworker.js'), new Worker('/peakworker.js')] : [];
const filesJson = await fetch('/files.json').then(r => r.json());

// Ask the browser not to evict the cached dictionaries when disk space is low
navigator.storage?.persisted?.().then(p => p || navigator.storage.persist());

if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/sw.js').catch(err => console.error('Service worker registration failed:', err));

	navigator.serviceWorker.addEventListener('message', ({data}) => {
		// A new files.json applied: the downloaded/version indicators again
		// (new or removed dictionaries show up on the next load)
		if (data?.type === 'filesupdated') requestCacheVersion();
		else if (data?.type === 'status') {
			$('version').textContent = data.version;
			Object.keys(data.files).forEach(url => ack?.(url.replace(/^\//, '')));
		}
	});

	// Right away, not on 'load' (which may have fired during the await
	// above), and again once there's a controller (the first load has none)
	requestCacheVersion();
	navigator.serviceWorker.addEventListener('controllerchange', requestCacheVersion);
	// An installed PWA can sit in the background for days without a
	// navigation, so also ask for a (throttled) files.json check on resume.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && navigator.serviceWorker.controller) {
			navigator.serviceWorker.controller.postMessage({ type: 'checkupdate' });
		}
	});
}
function requestCacheVersion() {
	if (navigator.serviceWorker.controller) {
		navigator.serviceWorker.controller.postMessage({ type: 'getstatus' });
	}
}

function escapeHTML(text){
	return text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
}
const abbr = filesJson.abbr || {};
const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
const langSym = l => abbr[l]?.[1] || cap(l).slice(0, 2);
const chevron = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
// The language panel's rows: the languages, biggest first
const langCounts = {};
filesJson.dicts.forEach(f => { const l = f[0].split('/')[0]; langCounts[l] = (langCounts[l] || 0) + 1; });
const langRow = (href, sym, name, n, cur) => `<li class="row"><a class="row-main lang-row" href="${href}"${cur ? ' aria-current="page"' : ''}><span class="ls-sym">${escapeHTML(sym)}</span><span class="row-w">${escapeHTML(name)}</span><span class="row-t">${n} ${n === 1 ? 'dictionary' : 'dictionaries'}</span></a></li>`;
const langRows = (skip, qs) => '<ul class="rows">' + Object.keys(langCounts).filter(l => l !== skip).sort((a, b) => langCounts[b] - langCounts[a])
	.map(l => langRow(`/${l}${qs}`, langSym(l), cap(l), langCounts[l], false)).join('') + '</ul>';

if(!isDictPage){
	// The root page: the app with nothing but the language button (typing
	// opens it too, and the text goes along), and what Peak Slab is
	const drawer = $('drawer');
	const langBtn = $('langBtn');
	const queryInput = $('queryInput');
	['menuBtn', 'headMenu', 'quick', 'settings', 'controls'].forEach(id => $(id).classList.add('hide'));
	document.querySelector('.sub-div').classList.add('hide');
	$('about').classList.remove('hide');
	langBtn.innerHTML = `<span class="lang-sym">?</span><span class="lang-name">Choose a language</span>${chevron}`;
	const openLangs = () => {
		const qs = queryInput.value ? '?text=' + encodeURIComponent(queryInput.value) : '';
		drawer.querySelector('.drawer-title').textContent = 'Language';
		drawer.querySelector('.drawer-body').innerHTML = langRows('', qs);
		drawer.classList.remove('hide');
	};
	const closeLangs = () => drawer.classList.add('hide');
	langBtn.addEventListener('click', openLangs);
	$('pickLang').addEventListener('click', openLangs);
	queryInput.addEventListener('input', openLangs);
	drawer.querySelector('.drawer-close').addEventListener('click', closeLangs);
	drawer.querySelector('.drawer-bg').addEventListener('click', closeLangs);
	document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLangs(); });
}else{
	let num = 0;
	let mark = true;
	let loader = null;
	let st = 3;
	let nload = 0;
	const timingDiv  = $('timing');

	// Only when a worker has no current cached copy ('needwasm'): fetched
	// through the service worker, ?v= and 'reload' past the CDN's and the
	// browser's caches
	const wasmTimestamp = filesJson.core.find(c => c[0] === 'peak.wasm')?.[1] || 0;
	let wasmModule = null;
	const sharedWasm = () => wasmModule ??= fetch(`/peak.wasm?v=${wasmTimestamp}`, {cache: 'reload'})
		.then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b));

	// Dictionary d is worker d % n's did floor(d / n)
	const workerOf = d => workers[d % workers.length], didOf = d => Math.floor(d / workers.length);
	const dictOf = m => m.did * workers.length + m.id - 1; // (a worker's message)
	// Worker i gets the part of a mask (one per dictionary) that's its
	const forWorkers = (mask, f) => workers.forEach((w, i) => f(w, mask.filter((_, d) => d % workers.length === i), i));

	function createPeakWorker(id){
			const w = earlyWorkers[id - 1] || new Worker('/peakworker.js');
			workers.push(w);
			w.postMessage({ type: "init", id, wasmTimestamp });
			w.onmessage = function(e){
				if(e.data.type == "needwasm"){
					sharedWasm().then(wasm => w.postMessage({type: 'wasm', wasm}));
				}
				else if(e.data.type == "needbytes"){
					const d = dictOf(e.data);
					fetchDict('/' + dicts[d].path)
						.then(buf => w.postMessage({type: 'bytes', did: e.data.did, buf}, [buf]))
						.catch(err => {
							console.warn(`Fetching ${dicts[d].path} failed:`, err);
							w.postMessage({type: 'bytes', did: e.data.did, buf: null});
						});
				}
				else if(e.data.type == "loaded"){
					const d = dictOf(e.data);
					dict_master_code[d] = false;
					loading.delete(d);
					if(!isOn(d) && !extraLoaded.has(d)) // Turned off (or the filter changed) while it loaded
						unloadDict(d);
					(pendingLoad.get(d) || []).forEach(f => f());
					pendingLoad.delete(d);
					downloaded.add(d);
					renderListsSoon();
					timingDiv.insertAdjacentHTML("beforeend", `${Math.round(performance.now())}ms ${e.data.msg}<br>`);
					--nload;
					updateStatus();
					if(nload == 0)
						saveState();
					if(!extraLoaded.has(d)) // Ones just to gloss with aren't searched
						searchAgain();
				}
				else if(e.data.type == "nomore"){
					if(e.data.st == st && e.data.gen === searchGen){
						worker_code[e.data.id-1] = true;
						if(!worker_code.includes(false)){
							if(nextst()){
								continueSearch();
							}else{ // The search is done
								if (loader) {
									loader.remove();
									loader = null;
								}
								if (num == 0) { // Nothing has all of it: none of the last search's, and word by word
									if (query) cleanup(resultsDiv);
									translate();
								}
							}
						}
					}
				}else if(e.data.type == "rendered"){ // A reply (askDict)
					gotReply(e.data);
				}else if(e.data.type == "result"){
					addResult(e.data);
				}
			}
	}

	// A result from a worker (or an entry a translated word came from), into
	// the results or the popup (dest "popup")
	function addResult(data){
		const popup = data.dest == "popup";
		if(!popup && data.gen !== searchGen)
			return; // Sent for an earlier search (it restarts as dictionaries load)
		if(!popup && num == 0){ // Popup results leave the main results alone
			cleanup(resultsDiv);
			if(loader)
				resultsDiv.append(loader)
		}
		let idpre = popup ? "pid" : "mid";
		const nheader = updateQuery(data.header);
		if(!popup && !data.filetype && chapterOf(nheader) === query)
			return addVerse(data, nheader);
		let div = $(`${idpre}-${nheader}`);
		const first = div === null;
		if(first){
			div = document.createElement('p-d');
			div.id = `${idpre}-${nheader}`;
			if(idpre == "mid" || data.st == 2){ // The other dictionaries' entries for it
				const mask = popup ? trMask() : searchMask();
				mask[dicts.findIndex(x => x.name === data.dict)] = false;
				forWorkers(mask, (w, code) => w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: data.dest, dicts: code, gen: searchGen}));
			}
		}
		const d = dictOf(data);
		if(isBibleText(d))
			div.classList.add('verse');
		const seen = div.seen ??= new Set(); // An entry found twice (e.g. a translated word's, then by the popup search) shows once
		if (typeof data.body === 'string' && seen.has(d + '\t' + data.body)) return;
		seen.add(d + '\t' + data.body);
		let el = document.createElement('p-e');
		const sortid = sortId(d); // Starred dictionaries first
		el.dataset.id = sortid;
		el.dataset.dict = data.dict;
		el.dataset.d = d;
		el.classList.toggle('starred', isStar(d));
		el.innerHTML = entryHeadHTML(d);
		if(first){
			const ctx = isBibleText(d) && chapterOf(nheader) && chapterOf(nheader) !== query ? '<button class="ctx-btn" onclick="readInContext(this)">Read in context</button>' : '';
			div.innerHTML += `<h2><span class="hw">${data.header}</span>${ctx}<button class="bm-btn" onclick="toggleBookmark(this)" title="Bookmark" aria-pressed="false">${bookmarkSVG}</button></h2>`;
			markBookmark(div);
		}
		const h = el.querySelector('p-h');
		if(data.filetype){
			if(data.subheader)
				el.insertAdjacentHTML('beforeend', `<p-n>${data.subheader.join(",<br>")}<br></p-n>`);
			el.append(mediaElement(data.filetype, data.body, data.header));
		}else{
			el.insertAdjacentHTML('beforeend', mark ? highlightText(data.body, data.query) : data.body);
			if (data.body?.includes('<p-m')) // Chords: a show/hide button
				h.insertAdjacentHTML('afterend', chordsBtnHTML);
			h.insertAdjacentHTML('afterend', translateBtnHTML);
		}
		h.insertAdjacentHTML('afterend', collapseBtnHTML);
		div.insertBefore(el, [...div.children].find(c => +c.dataset.id > sortid) || null);

		if(!popup && isStar(d)){ // Its sections go above the other dictionaries'
			if(!focusEnd.isConnected)
				resultsDiv.prepend(focusEnd);
			if(first || focusEnd.compareDocumentPosition(div) & Node.DOCUMENT_POSITION_FOLLOWING)
				resultsDiv.insertBefore(div, focusEnd);
		}else if(first){
			(popup ? popupResults : resultsDiv).insertBefore(div, popup ? null : loader);
		}
		if(first && popup){
			popupOpen();
			setTimeout(() => document.addEventListener('click', closePopupClick)); // (after the click that opened it, if one did)
		}
		if(!popup) found();
	}
	// A dictionary's name above its entry, with its star
	const entryHeadHTML = d => `<p-h title="${escapeHTML(typeLabel(dicts[d]))}">${starBtnHTML(d)}<span class="dn">${escapeHTML(dicts[d].name)}</span></p-h>`;
	// One more result: the count, and maybe more of them
	function found(){
		++num;
		queryInput.classList.remove("error");
		updateStatus(`Found ${num}+ matching lines.`);
		loadmore();
	}

	// A media entry: an image, or a player (codec2 is decoded when played)
	function mediaElement(type, bytes, name){
		const t = type.toLowerCase();
		const blob = (data, mime) => URL.createObjectURL(new Blob([data], {type: mime}));
		if (t.includes('webp') || t.includes('jbig2')) {
			const img = document.createElement('img');
			img.alt = name;
			img.style.maxWidth = '100%';
			if (t.includes('webp')) img.src = blob(bytes, 'image/webp');
			else media().then(m => m.jbig2toPng(bytes)).then(b => { img.src = URL.createObjectURL(b); });
			return img;
		}
		const audio = document.createElement('audio');
		audio.controls = true;
		if (t.includes('webm')) audio.src = blob(bytes, audioType(t));
		else if (/codec2|c2/.test(t)) {
			const btn = document.createElement('button');
			btn.textContent = '▶ Play';
			btn.addEventListener('click', () => {
				btn.disabled = true;
				btn.textContent = 'Decoding…';
				media().then(m => m.codec2toWav(bytes)).then(b => {
					audio.src = URL.createObjectURL(b);
					btn.replaceWith(audio);
					audio.play();
				});
			}, {once: true});
			return btn;
		}
		else return document.createTextNode(`${type}: filetype not supported`);
		return audio;
	}

	// A verse of the chapter searched ("rom 8."): each dictionary's verses
	// run together in one card, numbered as its references have them
	// ("យ៉ូហាន ៣:១៦"); the ⇄ after a verse glosses it word by word.
	// Parallel: the Bible texts share one card, verse by verse. Bible notes,
	// with a Bible text showing, are little links on its verses (addNote).
	function addVerse(data, h){
		const d = dictOf(data);
		if (dicts[d].cat === 'bible/commentary' && dictIds.some(t => isBibleText(t) && isOn(t)))
			return addNote(d, data, +h.split('.').pop());
		const label = /<p-n>@?([^<]*)<\/p-n>/.exec(data.body);
		const par = parallel && isBibleText(d);
		const cardId = par ? 'ch-par' : `ch-${d}`, cardSort = par ? -1e6 : sortId(d);
		let card = $(cardId);
		if(!card){
			card = document.createElement('p-d');
			card.id = cardId;
			card.className = par ? 'chapter parallel' : 'chapter';
			card.dataset.id = cardSort;
			card.innerHTML = par ? '<p-e></p-e>' : `<p-e data-dict="${escapeHTML(data.dict)}" data-d="${d}"${isStar(d) ? ' class="starred"' : ''}>${entryHeadHTML(d)}${collapseBtnHTML}</p-e>`;
			const after = [...resultsDiv.querySelectorAll(':scope > p-d.chapter')].find(c => +c.dataset.id > cardSort);
			resultsDiv.insertBefore(card, after || (loader && loader.parentNode === resultsDiv ? loader : null));
		}
		const n = ((label && /\p{Nd}+\s*[:.]\s*(\p{Nd}+)/u.exec(label[1])) || [, h.split('.').pop()])[1];
		let body = data.body.replace(/<p-n>[\s\S]*?<\/p-n>/, '');
		const text = isBibleText(d);
		if(text) // Verses run on
			body = body.replace(/<\/?p(?=[\s>])[^>]*>/gi, ' ');
		// Its headings go above its number, which stays on the line with its
		// first word
		const heads = (/^\s*(?:<h\d[^>]*>[\s\S]*?<\/h\d>\s*)+/i.exec(body) || [''])[0];
		const rest = body.slice(heads.length).trimStart();
		const word = /^[^\s\u200B<]*/.exec(rest)[0];
		const vs = document.createElement(text ? 'span' : 'div');
		vs.className = 'vs';
		vs.dataset.v = +h.split('.').pop();
		vs.innerHTML = `${heads}<span class="vs-start"><span class="vs-n">${escapeHTML(n)}</span>${word}</span>${rest.slice(word.length)}` +
			'<button class="vs-tr" onclick="translateEntry(this)" title="Gloss word by word" aria-label="Gloss this verse">⇄</button> ';
		if(par){ // In the verse's group, by verse, each text as the dictionaries go, with its name
			const pe = card.querySelector('p-e'), v = +h.split('.').pop();
			let group = pe.querySelector(`:scope > .pv[data-v="${v}"]`);
			if(!group){
				group = document.createElement('div');
				group.className = 'pv';
				group.dataset.v = v;
				pe.insertBefore(group, [...pe.children].find(g => +g.dataset.v > v) || null);
			}
			const line = document.createElement('div');
			line.className = 'pv-t';
			line.dataset.id = sortId(d);
			line.innerHTML = `<span class="pv-d">${escapeHTML(dicts[d].name)}</span> `;
			line.append(vs);
			group.insertBefore(line, [...group.children].find(t => +t.dataset.id > sortId(d)) || null);
		}else
			card.querySelector('p-e').append(vs);
		if(text)
			noteLinks(vs);
		if(h === readHl){ // Read in context: the verse in each card, the top one's in view
			vs.classList.add('hl');
			resultsDiv.querySelector('.vs.hl').scrollIntoView({block: 'center'});
		}
		found();
	}

	// The chapter's notes, by verse (the first of the ones each is on):
	// [{d, data}, ...]; a link on the verse (one for each, on one of a
	// parallel verse's texts) shows it in the popup
	let notes = new Map(), notesGen = -1;
	function addNote(d, data, v){
		if (notesGen !== searchGen) {
			notes = new Map();
			notesGen = searchGen;
		}
		const list = notes.get(v) || [];
		if (list.some(n => n.d === d)) return;
		list.push({d, data});
		notes.set(v, list);
		resultsDiv.querySelectorAll(`.vs[data-v="${v}"]`).forEach(noteLinks);
		found();
	}
	function noteLinks(vs){
		const v = +vs.dataset.v, group = vs.closest('.pv');
		if (notesGen !== searchGen || !notes.has(v) || (group && group.querySelector('.vs-note') && !vs.querySelector('.vs-note'))) return;
		const tr = vs.querySelector(':scope > .vs-tr');
		notes.get(v).forEach(({d, data}) => {
			if (vs.querySelector(`.vs-note[data-d="${d}"]`)) return;
			const label = /<p-n>@?([^<]*)<\/p-n>/.exec(data.body);
			tr.insertAdjacentHTML('beforebegin', `<button class="vs-note" data-d="${d}" data-v="${v}" onclick="showNote(this)" title="${escapeHTML(dicts[d].name + (label ? ': ' + label[1] : ''))}" aria-label="Note on this verse (${escapeHTML(dicts[d].name)})">note</button>`);
		});
	}
	window.showNote = b => {
		const n = notes.get(+b.dataset.v)?.find(n => n.d === +b.dataset.d);
		if (!n) return;
		cleanup(popupResults);
		addResult({...n.data, dest: 'popup'});
	};

	// Current page path segments, e.g. ["khmer"] or ["khmer","bible"]
	let pagePath = window.location.pathname.replace(/^\/|\/$/g, ''); // strip leading/trailing slashes
	if(pagePath.match("khmermusic")){
		pagePath = "khmer/music";
	}
	const pParts = pagePath.split('/').filter(Boolean);
	// The path's language segment(s) (usually one, e.g. ["khmer"]): the ones
	// abbr has a locale code for
	const pLangParts = pParts.filter(p => abbr[p]?.[2]);
	const curLang = pLangParts[0] || pParts[0] || '';

	// Every dictionary on the page, from files.json's [path, timestamp,
	// description, buflen, priority, type, collapsed, size]. Its category is
	// its folders after the language's (a Khmer and an English Bible text
	// are both "bible/text"). It's on the page if its path has every one of
	// the page's segments ("primary"), or it's another language's with
	// priority <= 0 in a category that's on the page.
	const allDicts = filesJson.dicts.map(([path, timestamp, desc, buflen, priority, type, collapsed, size]) => {
		const [lang, ...folders] = path.split('/').slice(0, -1);
		return {path, timestamp, desc, buflen, priority, collapsed, lang,
			type: type || '', // mono (in the language), bi (to English), rbi (English to it), phon (pronunciation), aux (audio, images, ...)
			size: size || 0, // To download
			name: path.split('/').pop().replace(/\.(peak|slab)(\.zst)?$/, ''),
			cat: folders.join('/'),
			primary: pParts.every(p => path.includes(p)),
			media: path.includes('.slab'),
			on: [undefined, 1, -1].includes(priority)}; // On by default: priority 1 (or -1, "always first")
	});
	const primaryCats = new Set(allDicts.filter(x => x.primary).map(x => x.cat));
	// Other languages' dictionaries added in the library (their paths)
	const addKey = `peakslab-added-${pagePath}`, addedPaths = new Set(readList(addKey));
	allDicts.forEach(x => { x.added = !x.primary && addedPaths.has(x.path); });
	const dicts = allDicts.filter(x => x.primary || x.added || (x.priority <= 0 && primaryCats.has(x.cat)));
	const dictIds = dicts.map((_, d) => d);
	// Searched: on, and in what the filter has picked (all of it: none picked)
	const isOn = d => libOn[d] && (solo >= 0 || inFilter(d));

	// Order: categories with the most priority-1 dictionaries first, then within
	// a category this page's language first, then by priority (-1 "always
	// first", 1, 2, 3, ..., then cross-language extras <= 0), then name.
	// Search results list each word's entries in this same order.
	const rank = p => p === -1 ? 0 : p == null ? 1 : p > 0 ? p : 100;
	const mainCount = {};
	dicts.forEach(x => { if (x.primary && rank(x.priority) <= 1) mainCount[x.cat] = (mainCount[x.cat] || 0) + 1; });
	dicts.sort((a, b) =>
		(mainCount[b.cat] || 0) - (mainCount[a.cat] || 0) || a.cat.localeCompare(b.cat) || b.primary - a.primary ||
		rank(a.priority) - rank(b.priority) || a.lang.localeCompare(b.lang) || a.path.localeCompare(b.path));

	// Speech synthesis: the page's languages, with their locale codes
	const derivedLang = [...new Set([...pLangParts, ...dicts.map(x => x.lang)])]
		.filter(l => abbr[l]?.[2]).map(l => ({name: cap(l), val: abbr[l][2]}));
	if (derivedLang.length) lang = derivedLang;

	// The app's name: the path's symbols (khmer → ខ, khmer/music → ខ𝄞)
	appname = (pParts.length ? pParts : ['?']).map(p => abbr[p]?.[1] || abbr[p]?.[0] || p).join('');
	const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
	if (appTitle) appTitle.content += appname;
	document.title += appname;

	const byPaths = paths => paths.map(p => dicts.findIndex(x => x.path === p)).filter(d => d >= 0);

	const sizeText = n => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
	startCollapsed = new Set(dicts.filter(x => x.collapsed).map(x => x.name));
	applyCollapsed();

	const typeOf = x => x.type ? `<span class="lib-type type-${x.type}">${escapeHTML(typeLabel(x))}</span>` : '';
	const typeLabel = ({type, lang}) => {
		const l = cap(lang);
		return {mono: l, bi: `${l} → English`, rbi: `English → ${l}`, phon: 'Pronunciation', aux: 'Auxiliary'}[type] || '';
	};

	// The filter: categories made from the dictionaries on the page, by kind
	// (the folders: Bible, Dictionaries, Bible texts, Music, Pronunciation,
	// ...), Bible first. Pick any number of them and searches use just their
	// dictionaries; none picked is All. Each dictionary is on or off, the
	// same in every category.
	const CAT_LABELS = {dict: 'Dictionaries', 'dict/tech': 'Technical terms', bible: 'Bible', 'bible/text': 'Bible texts',
		'bible/dict': 'Bible words', 'bible/commentary': 'Bible notes', 'bible/psalter': 'Psalters', music: 'Music',
		'music/chords': 'Chords', 'music/sheet': 'Sheet music', 'music/text': 'Song lyrics', phonetics: 'Pronunciation', 'phonetics/dict': 'Pronunciation dictionaries', 'phonetics/ref': 'Pronunciation guides',
		media: 'Audio & images', ref: 'Reference'};
	const catLabel = c => CAT_LABELS[c] || cap(c.replace('/', ' / '));
	// Every dictionary, in the order their entries come
	const orderKey = `peakslab-order-${appname}`;
	const order = [...new Set([...byPaths(readList(orderKey)), ...dictIds])];
	// The categories, in the order their entries come (their first
	// dictionary's). Again when a dictionary's added or taken off, or one's
	// moved. Choosing is worth it only with two or more: one category is
	// everything.
	const cats = []; // {id, label, sub, members: [d, ...]}
	let choice;
	function buildCats(){
		cats.length = 0;
		const addCat = (id, label, test, sub) => {
			const members = dictIds.filter(d => test(dicts[d]));
			// Not if it's empty, everything (Greek's Bible) or the same as another
			if (members.length && members.length < dictIds.length && !cats.some(c => c.members.join() === members.join()))
				cats.push({id, label, sub, members});
		};
		const xs = order.filter(d => dictIds.includes(d)).map(d => dicts[d]), top = x => x.cat.split('/')[0] || 'other', two = x => x.cat.split('/').slice(0, 2).join('/');
		[...new Set(xs.map(top))].forEach(c => {
			addCat(c, catLabel(c), x => top(x) === c);
			const subs = new Set(xs.filter(x => top(x) === c && x.cat.includes('/')).map(two));
			if (subs.size > 1) subs.forEach(s => addCat(s, catLabel(s), x => two(x) === s, true));
		});
		choice = cats.length > 1;
	}
	buildCats();
	const catById = id => cats.find(c => c.id === id);
	// A top category (a subcategory with no category too: Greek's Bible is everything)
	const isTop = c => !c.sub || !catById(c.id.split('/')[0]);
	const urlParams = new URLSearchParams(window.location.search);
	const filterKey = `peakslab-filter-${appname}`;
	let selected = (urlParams.has('mode') ? urlParams.get('mode').split(',') : readList(filterKey)).filter(id => choice && catById(id));
	const filtered = () => selected.length > 0;
	const selCats = () => selected.map(catById);
	const inFilter = d => !filtered() || selCats().some(c => c.members.includes(d));

	// Stars: a starred dictionary's entries come first and stand out, in the
	// order they were starred, and its words are the ones searched first.
	// ?dict=h97 is a page with only that dictionary loaded ("solo").
	let solo = dicts.findIndex(x => x.name === urlParams.get('dict'));
	// Each dictionary on or off: saved ([{file, enabled}]), or the defaults.
	// If storage doesn't work (some privacy modes, in-app webviews) the
	// defaults load and the page works normally; it just won't remember.
	const libKey = `peakslab-dicts-${appname}`;
	// The first time (nothing saved), none until asked (firstHTML)
	let asking = solo < 0 && stored(libKey) === null;
	const libOn = solo >= 0 || asking ? dicts.map((_, d) => d === solo) : (saved => dicts.map(x => saved.get(x.path) ?? x.on))(new Map(readList(libKey).map(x => [x.file, !!x.enabled])));
	const downloaded = new Set(); // In the offline cache (the service worker says), or loaded
	const starKey = `peakslab-stars-${appname}`;
	let stars = byPaths(readList(starKey));
	const isStar = d => stars.includes(d);
	const sortId = d => isStar(d) ? stars.indexOf(d) - 1000 : order.indexOf(d) + 1;
	const starBtnHTML = d => `<button class="star-btn" data-d="${d}" onclick="toggleStar(${d})" aria-pressed="${isStar(d)}" title="${isStar(d) ? 'Unstar' : 'Star: show it first'}" aria-label="Star ${escapeHTML(dicts[d].name)}">${isStar(d) ? '★' : '☆'}</button>`;
	const focusEnd = document.createElement('span'); // The starred dictionaries' sections go above this

	const workers = [];
	const workers_num = dicts.length > 1 ? 2 : 1;
	for (let i = 1; i <= workers_num; ++i) createPeakWorker(i);
	earlyWorkers.slice(workers_num).forEach(w => w.terminate()); // started early but not needed
	let worker_code = new Array(workers.length).fill(false);
	let dict_master_code = new Array(dicts.length).fill(true);
	let dict_code = [...dict_master_code];
	const loading = new Set(); // Dictionaries asked for and not loaded yet (loadDict)
	// Loaded just to gloss with (pronunciation), or All's ones while
	// filtering, not to search: they stay loaded, but out of the results
	const extraLoaded = new Set();
	const pendingLoad = new Map(); // dictionary -> what to do once it's loaded
	function ensureLoaded(d, then){
		if (!dict_master_code[d]) return then();
		if (!pendingLoad.has(d)) pendingLoad.set(d, []);
		pendingLoad.get(d).push(then);
		if (!isOn(d)) extraLoaded.add(d);
		loadDict(d);
	}
	const searchMask = () => dicts.map((_, d) => !extraLoaded.has(d) || isOn(d));
	// What translating and the popup use: the ones on, picked by the
	// filter or not, so a filter like Bible still has them
	const trOn = () => d => libOn[d];
	const trMask = () => { const on = trOn(); return dicts.map((_, d) => on(d)); };


	function cleanup(container){
		container.querySelectorAll('img[src^="blob:"], audio[src^="blob:"]').forEach(el => {
			URL.revokeObjectURL(el.src);
			el.src = '';
		});
		if(container == resultsDiv){
			settings.style.display = 'none';
			resultsDiv.replaceChildren();
		}else{
			container.innerHTML = "";
		}
	}

	// The query marked in an entry's text (not in its tags)
	function highlightText(html, query) {
		if (!query || !html) return html;
		const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return html.replace(/<[^>]+>|([^<]+)/g, (m, text) => text ? text.replace(re, '<mark>$1</mark>') : m);
	}

	// The media decoders (media.js, with jbig2.wasm and codec2.wasm), loaded
	// when first used
	const media = () => import('/media.js');

	const queryInput = $('queryInput');

	// The query, newlines and all. The one line search bar can't hold
	// newlines, so it shows them as spaces (same length, so the positions
	// match) and the big text box shows the real thing.
	let queryText = '';
	let query = null; // What's searched: queryText as it's searched (updateQuery)
	function setQueryText(text){
		queryText = (text || '').replace(/\r\n?/g, '\n');
		queryInput.value = queryText.replace(/\n/g, ' ');
	}
	setQueryText(urlParams.get('text'));

	const statusDiv  = $('status');
	const statusText = statusDiv.querySelector('.st-text');
	const resultsDiv = $('results');
	const popupOverlay = $('popupOverlay');
	const popupResults = $('popupResults');

	// Above the results: the big text box for long queries and the
	// starred dictionary's word by word gloss.
	const topDiv = document.createElement('div');
	resultsDiv.insertAdjacentElement('beforebegin', topDiv);
	const bigQuery = topDiv.appendChild(document.createElement('textarea'));
	bigQuery.id = 'bigQuery';
	bigQuery.classList.add('hide');
	const translationDiv = topDiv.appendChild(document.createElement('div'));

	// Fullscreen: just the results, no search bar or buttons (and a popup
	// fills the window)
	const f4 = $('f4');
	f4.addEventListener('click', () => {
		const full = document.body.classList.toggle('fullscreen');
		f4.title = full ? 'Show the search bar' : 'Fullscreen';
	});

	// Small screens: the header's buttons are in a menu (☰)
	const menuBtn = $('menuBtn');
	const headMenu = $('headMenu');
	const setMenu = open => {
		headMenu.classList.toggle('open', open);
		menuBtn.setAttribute('aria-expanded', open);
	};
	menuBtn.addEventListener('click', () => setMenu(!headMenu.classList.contains('open')));
	headMenu.addEventListener('click', e => { if (e.target.closest('button')) setMenu(false); });
	document.addEventListener('click', e => { if (!e.target.closest('#menuBtn, #headMenu')) setMenu(false); });

	// ---------------------------------------------------------------
	// Bible: a Bible text's headwords are its verses ("rom 8.1"), so a
	// chapter is just a search for "rom 8.", which finds its verses, each
	// with every translation and note that's on (notes start collapsed).
	// Books lists the books as a Bible has them.
	// ---------------------------------------------------------------
	const isBibleText = d => dicts[d].cat === 'bible/text';
	const hasBible = dictIds.some(isBibleText);
	// A verse's chapter: "rom 8.1" -> "rom 8.", else null
	const chapterOf = h => (/^(.+ \d+\.)\d+$/.exec(h || '') || [])[1] || null;
	const search = text => { setQueryText(text); startSearch(); addHistory(queryText); };
	let readHl = ''; // The verse to show in its chapter (Read in context)
	window.readInContext = btn => {
		const h = btn.closest('p-d').id.replace(/^[mp]id-/, '');
		closePopup();
		readHl = h;
		query = ''; // (searches again even if it's the chapter showing)
		search(chapterOf(h));
	};

	// The books: a Bible text's headwords in its order give the books and
	// their chapters, and each book's first verse's reference (e.g.
	// "លោកុប្បត្តិ ១:១") its name and digits. From the first Bible that's
	// on. Its code ("gen") shows with its name: it's what to type.
	let books = null; // [{code, n (chapters), name, zero (where its digits' 0 is)}]
	let booksWait = null; // Waiting for them to load
	function loadBooks(then){
		if (books) return then();
		if (booksWait) return booksWait.push(then);
		booksWait = [then];
		const mask = searchMask();
		const d = dictIds.filter(isBibleText).sort((a, b) => mask[b] - mask[a] || sortId(a) - sortId(b))[0];
		ensureLoaded(d, () => askDict(d, {type: 'heads'}, r => {
			const list = [], firsts = [];
			r.heads.forEach((h, i) => {
				const m = /^(.+) (\d+)\.\d+$/.exec(h);
				if (!m) return;
				if (list.at(-1)?.code !== m[1]) { list.push({code: m[1], n: 0, name: m[1], zero: 48}); firsts.push(i); }
				list.at(-1).n = Math.max(list.at(-1).n, +m[2]);
			});
			askDict(d, {type: 'renderlines', lines: firsts.map(i => [i, 3])}, r => {
				r.entries.forEach((e, i) => {
					const ref = e && /<p-n>@?([^<]*?)\s*(\p{Nd})\s*[:.]\s*\p{Nd}+\s*<\/p-n>/u.exec(e.body);
					if (!ref) return;
					list[i].name = ref[1] || list[i].name;
					list[i].zero = ref[2].codePointAt(0) - 1; // (chapter 1)
				});
				books = list;
				booksWait.splice(0).forEach(f => f());
				booksWait = null;
			});
		}));
	}
	const bookName = x => escapeHTML(x.name) + (x.name !== x.code ? `<small>${escapeHTML(x.code.toUpperCase())}</small>` : '');
	const bookNum = (x, n) => String(n).replace(/\d/g, d => String.fromCodePoint(x.zero + +d)); // In the Bible's digits
	// A chapter ("joh 3."): its book and number; and the one before or
	// after it (dir -1 or 1), across books (none at the ends)
	const isChapter = q => !!q && chapterOf(q + '1') === q;
	function chapterAt(ref){
		const [, code, c] = /^(.+) (\d+)\.$/.exec(ref) || [];
		const i = books.findIndex(x => x.code === code);
		return {i, b: books[i], ch: +c};
	}
	function nextChapter(ref, dir){
		const {i, b, ch} = chapterAt(ref), to = ch + dir;
		const bk = b && (to < 1 ? books[i - 1] : to > b.n ? books[i + 1] : b);
		return bk ? `${bk.code} ${to < 1 ? bk.n : bk === b ? to : 1}.` : null;
	}

	// Parallel reading (unless it's turned off): a chapter verse by verse,
	// each verse in every Bible text that's on, one after the other (else
	// each text's chapter in its own card). In the Books drawer, a
	// drop-down: it, and the texts to read.
	const parKey = `peakslab-parallel-${appname}`;
	let parallel = stored(parKey) ?? true;
	const bibleTexts = () => dictIds.filter(isBibleText);
	let parOpen = false; // The drop-down open (it stays so as the drawer's redrawn)
	function parHTML(){
		const texts = bibleTexts();
		if (texts.length < 2) return '';
		return `<details class="par-dd"${parOpen ? ' open' : ''}><summary><span class="row-w">Parallel Bibles</span><span class="row-t">${parallel ? 'On' : 'Off'} · ${texts.filter(d => libOn[d]).length} of ${texts.length} texts</span></summary>` +
			`<ul class="rows"><li class="row"><button class="row-main check" data-par="1" aria-pressed="${parallel}"><span class="row-w">Parallel reading</span><span class="row-t">Verse by verse in each text</span></button></li></ul>` +
			`<h3 class="drawer-h">Texts</h3><ul class="cat-dicts">${texts.map(d =>
				`<li><button class="cat-dict check" data-ptext="${d}" aria-pressed="${libOn[d]}"><span class="cd-name">${escapeHTML(dicts[d].name)}</span>${typeOf(dicts[d])}</button></li>`).join('')}</ul></details>`;
	}

	// Bible mode (a Bible category picked, or a Bible page), and reading a
	// chapter, have the Bible bar at the top of the results: ‹ book and
	// chapter ▾ ›. Its ▾ opens the Books drawer: Parallel Bibles, the
	// books, a book's chapters. The search bar's there to type in too.
	const bibleMode = () => hasBible && (pParts.includes('bible') || selected.some(id => id.startsWith('bible')));
	let lastRead = ''; // The chapter read last ("joh 3.")
	let booksPick = null; // The book whose chapters the drawer shows
	const bibleBar = topDiv.insertBefore(document.createElement('div'), topDiv.firstChild);
	bibleBar.id = 'chNav';
	function renderBibleBar(){
		if (isChapter(query)) lastRead = query;
		bibleBar.hidden = !bibleMode() && !isChapter(query);
		if (bibleBar.hidden) return;
		if (!books) return loadBooks(renderBibleBar);
		const {b, ch} = chapterAt(lastRead);
		const go = (dir, label) => `<button class="ch-go" data-go="${dir}" aria-label="${label} chapter"${nextChapter(lastRead, dir) ? '' : ' disabled'}>${dir < 0 ? '‹' : '›'}</button>`;
		bibleBar.innerHTML = go(-1, 'Previous') + `<button class="ch-book">${b ? `${escapeHTML(b.name)} ${bookNum(b, ch)}` : 'Books'} ▾</button>` + go(1, 'Next');
	}
	bibleBar.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (b?.dataset.go) search(nextChapter(lastRead, +b.dataset.go));
		else if (b) openBooks();
	});
	// The Books drawer, at the chapters of the book read
	function openBooks(){
		booksPick = lastRead.split(' ')[0] || null;
		openDrawer('books');
	}
	function booksHTML(){
		if (!books) {
			loadBooks(() => drawerView === 'books' && renderDrawer());
			return '<p class="empty">Loading…</p>';
		}
		const b = books.find(x => x.code === booksPick), cur = on => on ? ' aria-current="true"' : '';
		return parHTML() + (b ? `<button class="text-btn" data-books-back="1">‹ All books</button><h3 class="drawer-h bk-name">${bookName(b)}</h3>` +
				`<div class="bk-grid ch">${Array.from({length: b.n}, (_, i) => `${b.code} ${i + 1}.`).map((ref, i) => `<button data-read="${ref}"${cur(ref === lastRead)}>${bookNum(b, i + 1)}</button>`).join('')}</div>` :
			`<div class="bk-grid">${books.map(x => `<button data-book="${escapeHTML(x.code)}"${cur(lastRead.startsWith(x.code + ' '))}>${bookName(x)}</button>`).join('')}</div>`);
	}

	// ---------------------------------------------------------------
	// The header's second line: the language, and quick switches for what
	// a search uses (the filter's categories). It hides while scrolling
	// down, and comes back scrolling up.
	// ---------------------------------------------------------------
	const header = $('header');
	const langBtn = $('langBtn');
	const quick = $('quick');
	langBtn.innerHTML = `<span class="lang-sym">${escapeHTML(langSym(curLang))}</span><span class="lang-name">${escapeHTML(cap(curLang))}${pParts.length > 1 ? ' · ' + escapeHTML(pParts.slice(1).map(cap).join(' · ')) : ''}</span>` +
		chevron;
	langBtn.title = langBtn.ariaLabel = `Language: ${cap(curLang)}. Change language`;
	langBtn.addEventListener('click', () => openDrawer('lang'));
	// The language panel: this language and its sections, then the others,
	// biggest first
	function langHTML(){
		const qs = queryText ? '?text=' + encodeURIComponent(queryText) : '', row = langRow;
		const mine = filesJson.dicts.filter(f => f[0].startsWith(curLang + '/'));
		const secs = [...new Set(mine.map(f => f[0].split('/')[1]))].filter(c => !['media', 'phonetics'].includes(c));
		return `<ul class="rows">${row(`/${curLang}${qs}`, langSym(curLang), cap(curLang), langCounts[curLang], pParts.length < 2)}` +
			(secs.length > 1 ? secs.map(c => row(`/${curLang}/${c}${qs}`, langSym(c), `${cap(curLang)}: ${catLabel(c)}`, mine.filter(f => f[0].split('/')[1] === c).length, pParts[1] === c)).join('') : '') + '</ul>' +
			'<h3 class="drawer-h">Other languages</h3>' + langRows(curLang, qs);
	}
	// What the filter searches, as HTML and as text: All; All but the
	// categories left out (struck through), when most are picked; or the
	// ones picked
	function filterLabel(){
		if (!filtered()) return ['All', 'All'];
		const left = cats.filter(c => isTop(c) && !selected.includes(c.id)), names = cs => cs.map(c => c.label);
		if (selCats().every(isTop) && left.length < selected.length)
			return [`All ${names(left).map(l => `<s>${escapeHTML(l)}</s>`).join(' ')}`, `All but ${names(left).join(', ')}`];
		const t = names(cats.filter(c => selected.includes(c.id))).join(' + '); // (in the filter's order)
		return [escapeHTML(t), t];
	}
	// The bar: the filter's button, with what it searches
	function renderQuick(){
		renderBibleBar();
		const [html, text] = filterLabel();
		const b = `<button class="qk" aria-pressed="${filtered()}" aria-label="Filter: ${escapeHTML(text)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>${html}</button>`;
		if (quick._html !== b) { quick._html = b; quick.innerHTML = b; } // Only when changed: keeps it tappable
	}
	quick.addEventListener('click', e => { if (e.target.closest('button')) openDrawer('modes'); });
	let lastY = 0;
	window.addEventListener('scroll', () => {
		const y = window.scrollY;
		if (y > lastY + 6 && y > 80) header.classList.add('compact');
		else if (y < lastY - 6 || y < 40) header.classList.remove('compact');
		lastY = y;
	}, {passive: true});
	// The results start below the whole header
	new ResizeObserver(() => {
		if (!header.classList.contains('compact'))
			document.documentElement.style.setProperty('--hh', header.offsetHeight + 'px');
	}).observe(header);

	// ---------------------------------------------------------------
	// History and bookmarks, remembered per page (e.g. khmer, khmer/music)
	// ---------------------------------------------------------------
	// Both are lists of {w (the search, or the word), g (a bookmark's
	// gloss), t (when)}, newest first; ✕ removes one
	const lists = {
		history: {title: 'History', empty: 'Words you look up show up here.'},
		bookmarks: {title: 'Bookmarks', empty: 'Tap the bookmark next to a word to keep it here.'},
	};
	for (const [k, l] of Object.entries(lists)) {
		l.key = `peakslab-${k}-${appname}`;
		l.items = readList(l.key).map(x => ({...x, w: x.w ?? x.q})); // (the history's were {q, t})
	}
	function setList(k, items){
		lists[k].items = items.slice(0, 200);
		store(lists[k].key, lists[k].items);
		document.querySelectorAll('#results > p-d, #popupResults > p-d').forEach(markBookmark);
		renderHome();
	}
	const listHTML = (k, n) => {
		const items = lists[k].items.slice(0, n);
		return items.length ? `<ul class="rows">${items.map(x => `<li class="row"><button class="row-main" data-q="${escapeHTML(x.w)}"><span class="row-w">${escapeHTML(x.w.replace(/\n/g, ' '))}</span>` +
			(k === 'history' ? `<span class="row-t">${timeAgo(x.t)}</span>` : x.g ? `<span class="row-g">${escapeHTML(x.g)}</span>` : '') +
			`</button><button class="row-x" data-rm="${k}" data-w="${escapeHTML(x.w)}" title="Remove" aria-label="Remove ${escapeHTML(x.w)}">✕</button></li>`).join('')}</ul>` :
			`<p class="empty">${lists[k].empty}</p>`;
	};

	// A search goes in the history once typing stops on it with something
	// found. Typing on from the last one (kh, khm, khmer) replaces it.
	function addHistory(w){
		w = w.trim();
		if (!w) return;
		const t = Date.now(), last = lists.history.items[0];
		const items = last && t - last.t < 60000 && (w.startsWith(last.w) || last.w.startsWith(w)) ? lists.history.items.slice(1) : lists.history.items;
		setList('history', [{w, t}, ...items.filter(x => x.w !== w)]);
	}
	const historyTimer = debounce(() => {
		if (queryText.trim() && (num > 0 || translationDiv.childElementCount)) addHistory(queryText);
	}, 1500);

	const headwordOf = pd => (pd.querySelector(':scope > h2 .hw')?.textContent || '').trim();
	const isBookmarked = w => lists.bookmarks.items.some(b => b.w === w);
	function markBookmark(pd){
		const b = pd.querySelector(':scope > h2 .bm-btn');
		if (!b) return;
		const on = isBookmarked(headwordOf(pd));
		b.setAttribute('aria-pressed', on);
		b.title = on ? 'Remove bookmark' : 'Bookmark';
	}
	// A bookmark keeps the first line of its section's first entry
	window.toggleBookmark = btn => {
		const pd = btn.closest('p-d');
		const w = headwordOf(pd);
		if (!w) return;
		const pe = pd.querySelector(':scope > p-e');
		const g = (pe && entryText(pe).split('\n').find(isText)) || '';
		const items = lists.bookmarks.items.filter(b => b.w !== w);
		setList('bookmarks', isBookmarked(w) ? items : [{w, g: g.length > 120 ? g.slice(0, 119) + '…' : g, t: Date.now()}, ...items]);
		if (pd.closest('#results')) addHistory(queryText);
	};

	function timeAgo(t){
		const m = Math.round((Date.now() - t) / 60000), h = Math.round(m / 60), d = Math.round(h / 24);
		return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : h < 24 ? `${h} h ago` : d < 7 ? `${d} d ago` : new Date(t).toLocaleDateString();
	}

	// The side panel for the whole history or all the bookmarks
	const drawer = $('drawer');
	const drawerBody = drawer.querySelector('.drawer-body');
	drawerBody.addEventListener('toggle', e => { if (e.target.matches('.par-dd')) parOpen = e.target.open; }, true);
	let drawerView = null;
	let showLibrary = false; // The menu's Library and settings, until something is searched
	const drawerTitles = {history: 'History', bookmarks: 'Bookmarks', books: 'Books', lang: 'Language', modes: 'Filter', first: 'Download dictionaries'};
	function renderDrawer(){
		const v = drawerView, scroll = drawerBody.scrollTop;
		drawer.querySelector('.drawer-title').textContent = drawerTitles[v];
		drawerBody.innerHTML = lists[v] ? listHTML(v) + (lists[v].items.length ? `<button class="text-btn" data-clear="${v}">Clear all</button>` : '') :
			v === 'books' ? booksHTML() : v === 'lang' ? langHTML() : v === 'first' ? firstHTML() : filterHTML();
		drawerBody.scrollTop = scroll;
	}
	// The groups opened (▸): a category in the filter or the library
	// ("filter:bible", "library:dict"), another language ("lang:greek")
	const expandedCats = new Set();
	// A group that opens: its header (a button), ▸, and, open, its body
	function groupHTML(key, head, body){
		const open = expandedCats.has(key);
		return `<li class="cat"><div class="cat-row">${head}` +
			`<button class="cat-exp" data-exp="${escapeHTML(key)}" aria-expanded="${open}" aria-label="Show or hide what's in it">▸</button></div>` +
			(open ? `<div class="cat-body">${body()}</div>` : '') + '</li>';
	}
	const groupHead = (key, label, text) => `<button class="cat-sel" data-exp="${escapeHTML(key)}"><span class="row-w">${escapeHTML(label)}</span><span class="row-t">${text}</span></button>`;
	// What a view has: the library, every dictionary; the filter, the
	// downloaded ones
	const inView = view => d => view === 'library' || downloaded.has(d);
	// How many are on, of the ones the view has
	function catCount(c, view){
		const ds = c.members.filter(inView(view));
		return `${ds.filter(d => libOn[d]).length} of ${ds.length} on`;
	}
	// A category's subcategories (Bible's Bible texts, ...)
	const subsOf = c => c.sub ? [] : cats.filter(s => s.sub && s.id.split('/')[0] === c.id);
	// A list's dictionaries, in their order: a category's own (its id; not
	// the ones in its subcategories), or the ones in none (''). The filter
	// has just the downloaded ones.
	function listOf(id, view){
		const c = id && catById(id);
		const ds = c ? c.members.filter(d => !subsOf(c).some(s => s.members.includes(d))) : dictIds.filter(d => !cats.some(c => c.members.includes(d)));
		return ds.filter(inView(view)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
	}
	// A category the view has any of (the filter: any downloaded)
	const shown = (c, view) => c.members.some(inView(view));
	// A dictionary's name, kind, size (with its state, if any) and description
	const infoHTML = (x, size = x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') =>
		`<span class="lib-name"><span class="row-w">${escapeHTML(x.name)}</span>${typeOf(x)}${size}</span><span class="lib-desc">${x.desc}</span>`;
	// ↑ ↓: moves it (a dictionary, data-d, or a category, data-cat) past the
	// one before or after it in its list
	const mvHTML = (data, name, list, it) => '<span class="mv">' + [[-1, 'Up', 'M12 19V5M5 12l7-7 7 7'], [1, 'Down', 'M12 5v14M5 12l7 7 7-7']].map(([dir, title, path]) =>
		`<button data-mv="${dir}" ${data} title="${title}" aria-label="${title}: ${escapeHTML(name)}"${list[list.indexOf(it) + dir] === undefined ? ' disabled' : ''}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="${path}"/></svg></button>`).join('') + '</span>';
	// A dictionary: on or off, what kind it is, downloaded (✓) or not (⬇)
	// and its size, what it is; to delete its download (🗑) or take an added
	// one off the page (✕), its star, and in the filter, to move it (↑ ↓)
	function dictRowHTML(d, view, id, ds){
		const x = dicts[d], state = loading.has(d) ? 'loading' : downloaded.has(d) ? 'got' : 'down';
		return `<li class="row dict-row${isStar(d) ? ' starred' : ''}"><button class="row-main check dict-on" data-on="${d}" aria-pressed="${libOn[d]}">` +
			infoHTML(x, `<span class="lib-size ${state}" title="${{loading: 'Loading', got: 'Downloaded', down: 'Not downloaded yet: it downloads when it\'s on'}[state]}">${{loading: '', got: '✓ ', down: '⬇ '}[state]}${x.size ? sizeText(x.size) : ''}</span>`) + '</button>' +
			(view === 'filter' ? mvHTML(`data-d="${d}" data-list="${id}"`, x.name, ds, d) : '') +
			(x.added ? `<button class="dict-del" data-del="${d}" title="Take it off this page" aria-label="Remove ${escapeHTML(x.name)}">✕</button>` :
				state === 'got' ? `<button class="dict-del" data-del="${d}" title="Delete its download (it's turned off)" aria-label="Delete ${escapeHTML(x.name)}'s download">🗑</button>` : '') +
			`${starBtnHTML(d)}</li>`;
	}
	function rowsHTML(id, view){
		const ds = listOf(id, view);
		return ds.length ? `<ul class="rows dict-rows">${ds.map(d => dictRowHTML(d, view, id, ds)).join('')}</ul>` : '<p class="empty">None downloaded.</p>';
	}
	// The categories; opened, their own dictionaries, then each
	// subcategory's under its heading. Then Other: the ones in none. In the filter a
	// category's name picks it; in the library it opens it, with All on /
	// All off / Defaults.
	function catsHTML(view){
		if (!choice) return rowsHTML('', view);
		const tops = cats.filter(c => isTop(c) && shown(c, view));
		const btn = (c, act, attrs, html) => `<button data-cat="${c.id}" data-act="${act}" ${attrs}>${html}</button>`;
		const cat = c => groupHTML(`${view}:${c.id}`,
			view === 'filter' ? btn(c, 'sel', `class="cat-chk check" aria-pressed="${!filtered() || selected.includes(c.id)}" aria-label="Search ${escapeHTML(c.label)}"`, '') +
				btn(c, 'only', 'class="cat-sel" title="Just this"', `<span class="row-w">${escapeHTML(c.label)}</span><span class="row-t">${catCount(c, view)}</span>`) +
				mvHTML(`data-cat="${c.id}"`, c.label, tops, c) :
				groupHead(`${view}:${c.id}`, c.label, catCount(c, view)),
			() => {
				const subs = subsOf(c).filter(s => shown(s, view));
				return (listOf(c.id, view).length || !subs.length ? rowsHTML(c.id, view) : '') +
					subs.map(s => `<h4 class="cat-subh">${escapeHTML(s.label)}</h4>${rowsHTML(s.id, view)}`).join('') +
					(view === 'library' ? `<div class="cat-acts">${btn(c, 'all', 'class="text-btn"', 'All on')}${btn(c, 'none', 'class="text-btn"', 'All off')}${btn(c, 'reset', 'class="text-btn"', 'Defaults')}</div>` : '');
			});
		const other = listOf('', view);
		return `<ul class="rows cats">${tops.map(cat).join('')}` +
			(other.length ? groupHTML(`${view}:`, groupHead(`${view}:`, 'Other', catCount({members: other}, view)), () => rowsHTML('', view)) : '') + '</ul>';
	}
	// The filter: All (every category ticked), then the categories, with
	// their downloaded dictionaries; untick any to search just the rest, or
	// tap one's name to search just it
	function filterHTML(){
		return (choice ? `<ul class="rows"><li class="row"><button class="row-main radio" data-all="1" aria-pressed="${!filtered()}"><span class="row-w">All</span><span class="row-t">${catCount({members: dictIds}, 'filter')}</span></button></li></ul>` : '') +
			catsHTML('filter') +
			'<p class="empty">Tick as many as you like, or tap a name for just it: searches use their dictionaries that are on. ↑ ↓ change the order their entries come in; starred ones come first.</p>' +
			'<p class="empty">Want more? <button class="text-btn" data-library="1">Go to the library</button></p>';
	}
	// The library: every dictionary on the page, by category; then other
	// languages' to add
	function libraryHTML(){
		const byLang = new Map();
		allDicts.filter(x => !dictIds.some(d => dicts[d] === x)).forEach(x => byLang.set(x.lang, [...(byLang.get(x.lang) || []), x]));
		const lang = ([l, xs]) => groupHTML(`lang:${l}`, groupHead(`lang:${l}`, cap(l), `${xs.length} ${xs.length === 1 ? 'dictionary' : 'dictionaries'}`),
			() => `<ul class="rows dict-rows">${xs.map(x => `<li class="row dict-row"><div class="row-main">${infoHTML(x)}</div>` +
				`<button class="text-btn" data-add="${escapeHTML(x.path)}">Add</button></li>`).join('')}</ul>`);
		const here = sizeOf(dictIds.filter(d => downloaded.has(d) && dicts[d].lang === curLang)); // (not other languages')
		return '<h2>Library</h2><p class="lib-help">Turn dictionaries on or off: ⬇ ones download when they\'re on, and 🗑 deletes a download. Star the ones you use most: their entries come first.</p>' +
			'<p class="lib-help"><button class="text-btn" data-first="again">Download the suggested dictionaries…</button></p>' +
			`<p class="lib-space">Space used: ${sizeText(here)} for ${escapeHTML(cap(curLang) || 'this page')}${usage ? ` · ${sizeText(usage)} for all of PeakSlab` : ''}</p>` +
			catsHTML('library') +
			(byLang.size ? `<ul class="rows cats">${groupHTML('library:langs', groupHead('library:langs', 'Other languages', `${byLang.size} languages: add their dictionaries`),
				() => `<ul class="rows cats">${[...byLang].sort(([a], [b]) => a.localeCompare(b)).map(lang).join('')}</ul>`)}</ul>` : '');
	}
	// The first time (nothing saved): which to download, the priority 1 and 0
	// dictionaries, ticked, by category (the media folder's each under its
	// own: Audio, Images); or choose in the library (all off). Not
	// answered, it asks again next time. The library opens it again too:
	// Download turns the ticked ones on, the rest stay as they are.
	const firstIds = dictIds.filter(d => [0, 1].includes(dicts[d].priority)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
	const firstPick = new Set(firstIds.filter(d => dicts[d].priority === 1 || dicts[d].lang === 'english')); // (another language's priority 0, not ticked)
	const sizeOf = ds => ds.reduce((n, d) => n + dicts[d].size, 0);
	function firstHTML(){
		let prev = null, html = '';
		firstIds.forEach(d => {
			const x = dicts[d], label = x.cat === 'media' ? cap(x.name) : catLabel(x.cat);
			if (label !== prev) html += `${prev === null ? '' : '</ul>'}<h4 class="cat-subh">${escapeHTML(label)}</h4><ul class="rows dict-rows">`;
			prev = label;
			html += `<li class="row dict-row"><button class="row-main check" data-pick="${d}" aria-pressed="${firstPick.has(d)}">${infoHTML(x)}</button></li>`;
		});
		if (prev !== null) html += '</ul>';
		return '<p class="empty">Which dictionaries? They download once, then work offline.</p>' + html +
			`<button class="first-default" data-first="go">Download (${sizeText(sizeOf([...firstPick]))})</button>` +
			'<p class="empty">Or <button class="text-btn" data-first="custom">choose my own in the library</button></p>';
	}
	function firstAnswer(v){
		asking = false;
		closeDrawer();
		if (v === 'go') setOn([...firstPick], true);
		else {
			saveState();
			openLibrary();
		}
	}

	// The filter and the library, where they're showing
	function renderLists(){
		if (drawerView === 'modes') renderDrawer();
		if (showLibrary) listDiv.innerHTML = libraryHTML();
	}
	// Again, once (the service worker says which files it has all at once)
	const renderListsSoon = debounce(() => {
		renderLists();
		refreshUsage();
	}, 50);
	// The space all of PeakSlab takes (the browser's estimate: every
	// language's downloads, and the app); the library shows it
	let usage = 0;
	function refreshUsage(){
		navigator.storage?.estimate?.().then(e => {
			if (e.usage === usage) return;
			usage = e.usage;
			if (showLibrary) listDiv.innerHTML = libraryHTML();
		}).catch(() => {});
	}
	// Another language's dictionary onto the page (or back on it), on: at
	// the end, so every other one keeps its number; its categories opened
	function addDict(path){
		const x = allDicts.find(x => x.path === path);
		if (!x) return;
		x.added = true;
		store(addKey, [...readList(addKey).filter(p => p !== path), path]);
		let d = dicts.indexOf(x);
		if (d < 0) {
			d = dicts.push(x) - 1;
			libOn.push(false);
			dict_master_code.push(true);
		}
		dictIds.push(d);
		order.push(d);
		buildCats();
		cats.filter(c => c.members.includes(d)).forEach(c => expandedCats.add(`library:${c.id}`));
		setOn([d], true);
	}
	// A download deleted (it's turned off: it downloads again when it's
	// on); an added one is taken off the page too (its number stays, unused)
	async function deleteDict(d){
		const x = dicts[d];
		if (libOn[d]) setOn([d], false);
		else if (!dict_master_code[d]) unloadDict(d);
		try {
			const url = new URL('/' + x.path, location.origin);
			for (const k of await caches.keys()) await (await caches.open(k)).delete(url);
		} catch (e) { /* no Cache API */ }
		downloaded.delete(d);
		refreshUsage();
		if (x.added) {
			x.added = false;
			store(addKey, readList(addKey).filter(p => p !== x.path));
			[dictIds, order, stars].forEach(l => { const i = l.indexOf(d); if (i >= 0) l.splice(i, 1); });
			buildCats();
			setFilter(selected); // (a category gone)
		}
		renderLists();
	}
	// Moves a dictionary up (-1) or down (1) past the next one in its list,
	// or a category (its dictionaries, together) past the next one
	function move(b, dir){
		const {d, list, cat} = b.dataset, byOrder = ds => [...ds].sort((a, b) => order.indexOf(a) - order.indexOf(b));
		let ds;
		if (cat) {
			const tops = cats.filter(c => isTop(c) && shown(c, 'filter')), k = tops.indexOf(catById(cat));
			if (!tops[k + dir]) return;
			[tops[k], tops[k + dir]] = [tops[k + dir], tops[k]];
			ds = tops.flatMap(c => byOrder(c.members));
		} else {
			ds = listOf(list, 'filter');
			const k = ds.indexOf(+d);
			if (ds[k + dir] === undefined) return;
			[ds[k], ds[k + dir]] = [ds[k + dir], ds[k]];
		}
		// Their places in the order, now theirs in this order
		const at = byOrder(ds).map(x => order.indexOf(x));
		ds.forEach((x, i) => { order[at[i]] = x; });
		if (solo < 0) store(orderKey, order.map(d => dicts[d].path));
		buildCats();
		renderLists();
		searchAgain();
	}
	function openDrawer(view){
		if (drawerView === view) return closeDrawer();
		drawerView = view;
		drawerBody.scrollTop = 0;
		renderDrawer();
		drawer.classList.remove('hide');
		document.querySelectorAll('[data-drawer]').forEach(b => b.setAttribute('aria-expanded', b.dataset.drawer === view));
		drawer.querySelector('.drawer-close').focus();
	}
	function closeDrawer(){
		drawerView = null;
		drawer.classList.add('hide');
		document.querySelectorAll('[data-drawer]').forEach(b => b.setAttribute('aria-expanded', false));
	}
	document.querySelectorAll('[data-drawer]').forEach(b => b.addEventListener('click', () => openDrawer(b.dataset.drawer)));
	drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
	drawer.querySelector('.drawer-bg').addEventListener('click', closeDrawer);
	document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerView) closeDrawer(); });

	// The home page (nothing searched): recent searches and bookmarks
	const homeDiv = $('home');
	function renderHome(){
		const more = (n, view) => n > 5 ? `<button class="text-btn" data-open="${view}">All ${n}</button>` : '';
		homeDiv.innerHTML =
			`<section><h2>Recent</h2>${listHTML('history', 5)}${more(lists.history.items.length, 'history')}</section>` +
			`<section><h2>Bookmarks</h2>${listHTML('bookmarks', 5)}${more(lists.bookmarks.items.length, 'bookmarks')}</section>`;
		if (drawerView) renderDrawer();
	}
	// A category picked or not (its checkbox in the filter)
	const toggleCat = id => setFilter(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
	// The buttons in the drawer and on the home page
	function rowClick(e){
		const b = e.target.closest('button');
		if (!b) return;
		const {book, booksBack, read, all, q, rm, w, clear, open, act, par, ptext, on, del, add, exp, mv, library, pick, first} = b.dataset;
		if (pick) { // The first time's choices
			if (!firstPick.delete(+pick)) firstPick.add(+pick);
			renderDrawer();
		} else if (first) first === 'again' ? openDrawer('first') : firstAnswer(first);
		else if (exp) { // A group opened or closed
			if (!expandedCats.delete(exp)) expandedCats.add(exp);
			renderLists();
		} else if (del) deleteDict(+del);
		else if (add) addDict(add);
		else if (mv) move(b, +mv);
		else if (library) openLibrary();
		else if (par) {
			parallel = !parallel;
			store(parKey, parallel);
			renderDrawer();
			if (isChapter(query)) searchAgain(); // The chapter showing, again
		} else if (ptext || on) {
			const d = +(ptext || on);
			setOn([d], !libOn[d]);
		} else if (book || booksBack) {
			booksPick = book || null;
			renderDrawer();
		} else if (read) {
			closeDrawer();
			search(read);
		} else if (all) {
			setFilter([]);
		} else if (act) { // A category's
			const c = catById(b.dataset.cat);
			if (act === 'sel') return filtered() ? toggleCat(c.id) : setFilter(cats.filter(x => isTop(x) && x !== c).map(x => x.id)); // (All: all but it)
			if (act === 'only') return setFilter([c.id]);
			setOn(c.members, act === 'all' ? true : act === 'none' ? false : d => dicts[d].on); // All on, all off, the defaults
		} else if (q !== undefined) {
			closeDrawer();
			search(q);
		} else if (rm) {
			setList(rm, lists[rm].items.filter(x => x.w !== w));
		} else if (clear) {
			if (confirm(`Clear all the ${lists[clear].title.toLowerCase()}?`)) setList(clear, []);
		} else if (open) {
			openDrawer(open);
		}
	}
	drawerBody.addEventListener('click', rowClick);
	homeDiv.addEventListener('click', rowClick);
	const listDiv = $('listDiv');
	listDiv.addEventListener('click', rowClick);

	renderHome();
	updateFilterUI();

	ack = url => { // In the offline cache
		const d = dicts.findIndex(x => x.path === url);
		if (d >= 0 && !downloaded.has(d)) { downloaded.add(d); renderListsSoon(); }
	};

	// Loads the dictionaries searched (isOn), and the rest that are on too,
	// unsearched, for glossing and the popup (not media); the others go
	function applyOn(){
		dicts.forEach((x, d) => {
			if (isOn(d)) {
				extraLoaded.delete(d);
				loadDict(d);
			} else if (libOn[d] && !x.media) {
				extraLoaded.add(d);
				loadDict(d);
			} else if (!dict_master_code[d] && !extraLoaded.has(d)) unloadDict(d);
		});
		renderQuick();
	}

	// Turns these dictionaries on or off (on: true, false, or one for each),
	// and searches again if what's searched changed (one still loading
	// searches again once it's loaded)
	function setOn(ds, on){
		const was = dicts.map((_, d) => isOn(d));
		ds.forEach(d => {
			libOn[d] = typeof on === 'function' ? on(d) : on;
			if (!libOn[d]) extraLoaded.delete(d); // (not kept loaded)
		});
		saveState();
		applyOn();
		if (drawerView === 'books') renderDrawer();
		renderLists();
		if (ds.some(d => was[d] !== isOn(d) && (!isOn(d) || !dict_master_code[d]))) searchAgain();
	}

	// Changes what's picked: their dictionaries, and the search again
	function setFilter(ids){
		selected = ids.filter(catById);
		if (cats.filter(isTop).every(c => selected.includes(c.id))) selected = []; // Every one: All
		store(filterKey, selected);
		refilter();
	}
	function refilter(){
		applyOn();
		updateFilterUI();
		searchAgain();
	}
	function updateFilterUI(){
		renderLists();
		renderQuick();
		updateURL();
	}

	// Asked too if none of the page's dictionaries is downloaded (in the
	// offline cache); can't tell (no Cache API): not asked
	const anyDownloaded = async () => (await Promise.all(dicts.map(x => caches.match('/' + x.path)))).some(Boolean);
	if (asking || solo >= 0) {
		applyOn();
		if (asking) openDrawer('first');
	} else anyDownloaded().catch(() => true).then(any => {
		if (!any) {
			asking = true;
			libOn.fill(false);
			openDrawer('first');
		}
		applyOn();
	});

	function saveState() {
		if (solo < 0 && !asking) store(libKey, dicts.map((x, d) => ({file: x.path, enabled: libOn[d]}))); // (solo leaves them alone)
	}


	// The dictionary bytes are fetched HERE, on the page, and transferred
	// (zero-copy) to the worker, rather than letting the worker fetch them.
	// The page is always controlled by the service worker, but the worker is
	// a blob: URL worker in the built 404.html, and whether a blob worker's
	// fetch() goes through the service worker differs between browsers. When
	// it doesn't, every dictionary skips the SW cache and goes to the network
	// / HTTP cache: slow when online, while offline things looked fine.
	function loadDict(d) {
		if (!dict_master_code[d] || loading.has(d)) return;
		loading.add(d);
		renderListsSoon();
		++nload;
		updateStatus();
		// The worker reads it from the offline cache itself (off this
		// thread), or asks for it with 'needbytes' if there's no
		// current copy there.
		const {path, name, buflen, timestamp} = dicts[d];
		workerOf(d).postMessage({type: 'load', did: didOf(d), msg: [path, name, buflen], timestamp});
	}

	// For a worker whose cache has no current copy ('needbytes'): fetch()
	// goes through the service worker, which downloads and caches it.
	async function fetchDict(path) {
		const r = await fetch(path);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.arrayBuffer();
	}

	function unloadDict(d){
		extraLoaded.delete(d);
		workerOf(d).postMessage({type: 'destroy', did: didOf(d)});
		dict_master_code[d] = true;
	}

	// The star on a dictionary (in the filter or on one of its entries):
	// starred ones come first. Starring one turns it on.
	function toggleStar(i){
		stars = isStar(i) ? stars.filter(x => x !== i) : [...stars, i];
		if (solo < 0) store(starKey, stars.map(d => dicts[d].path));
		if (isStar(i) && !libOn[i]) setOn([i], true);
		updateStarUI();
		searchAgain();
	}
	window.toggleStar = toggleStar;

	// The address bar always holds a link to what's on screen.
	function updateURL(){
		const p = new URLSearchParams();
		if (solo >= 0) p.set('dict', dicts[solo].name);
		if (filtered()) p.set('mode', selected.join());
		if (queryText) p.set('text', queryText);
		const qs = p.toString();
		history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
	}

	// The line above the results: how many were found, loading, and Share
	function updateStatus(text){
		if (text !== undefined) statusText.textContent = text;
		statusDiv.querySelector('.st-loading').classList.toggle('hide', nload <= 0);
	}
	statusDiv.querySelector('.st-share').addEventListener('click', e => share(e.currentTarget));

	async function share(btn){
		updateURL();
		const url = window.location.href;
		try {
			if (navigator.share) {
				await navigator.share({title: document.title, url: url});
				return;
			}
			await navigator.clipboard.writeText(url);
			btn.textContent = 'Link copied';
			setTimeout(() => { btn.textContent = 'Share'; }, 1500);
		} catch (e) {
			if (e.name !== 'AbortError') window.prompt('Copy this link:', url);
		}
	}

	function updateStarUI(){
		document.querySelectorAll('.star-btn').forEach(b => {
			b.outerHTML = starBtnHTML(+b.dataset.d);
		});
		document.querySelectorAll('.dict-row').forEach(li => li.classList.toggle('starred', isStar(+li.querySelector('[data-on]').dataset.on)));
	}


	function openPopupSearch(text, entry){
		cleanup(popupResults);
		const q = updateQuery(text);
		if (entry) // The entry a translated word came from
			addResult({id: entry.d % workers.length + 1, did: didOf(entry.d), dict: dicts[entry.d].name,
				query: q, st: 1, header: entry.header, body: entry.body, dest: "popup"});
		forWorkers(trMask(), (w, code) => [1, 2].forEach(st => w.postMessage({type: "tempsearch", st, query: q, dest: "popup", dicts: code})));
	}
	function popupOpen(){
		popupOverlay.style.display = 'block';
		popupOverlay.scrollTop = 0;
		document.body.classList.add('no-scroll');
	}
	function closePopupClick(e){
		if (!e.target.closest('#popupContent, #controls')) { // (its buttons below are usable)
			document.removeEventListener('click', closePopupClick);
			closePopup();
		}
	}
	function closePopup(){
		cleanup(popupResults);
		popupOverlay.style.display = 'none';
		document.body.classList.remove('no-scroll');
	}
	$('popupClose').addEventListener('click', closePopup);

	function nextst(){
		if(!st || st == 2)
			return false;
		++st;
		if(st > 5)
			st = 0;
		return true;
	}

	// What's searched for: lower case, no zero width spaces, \t a tab
	const updateQuery = (text = queryText) => text ? text.toLowerCase().replaceAll("​", "").replaceAll("\\t", "\t") : null;

	function showSettings(){
		loader = null;
		updateStatus('');
		statusDiv.classList.add('hide');
		renderHome();
		settings.style.display = 'block';
		settings.classList.toggle('library', showLibrary);
		if (showLibrary) {
			listDiv.innerHTML = libraryHTML();
			refreshUsage();
		}
		resultsDiv.replaceChildren();
		translationDiv.replaceChildren();
	}

	// The worker's indexes for the starred dictionaries that worker i has,
	// which it searches first
	function starDids(i){
		return stars.filter(d => d % workers.length == i).map(didOf);
	}

	let searchGen = 0;
	// A search (stage st) in each worker with dictionaries searched in it;
	// worker_code[i]: worker i is done
	function initSearch(){
		num = 0;
		++searchGen;
		forWorkers(dict_code, (w, code, i) => {
			if (code.includes(true)) w.postMessage({type: "setquery", query});
			w.postMessage({type: "initsearch", st, dicts: code, focus: starDids(i), gen: searchGen});
			worker_code[i] = !code.includes(true);
		});
	}
	function continueSearch(){
		forWorkers(dict_code, (w, code, i) => {
			if (code.includes(true)) w.postMessage({type: "continuesearch", st, focus: starDids(i)});
			worker_code[i] = !code.includes(true);
		});
		getResults();
	}

	// More results when the end of them comes near (a chapter: all of it;
	// nothing searched: nothing)
	function loadmore(){
		if(query && (isChapter(query) || (loader && loader.getBoundingClientRect().top <= window.innerHeight + 400)) && worker_code.includes(false))
			getResults();
	}
	let lastCheck = 0;
	const throttledCheck = () => { if (Date.now() - lastCheck >= 80) { lastCheck = Date.now(); loadmore(); } };
	window.addEventListener('scroll', throttledCheck, { passive: true });
	window.addEventListener('resize', throttledCheck);

	const globreg = /[!+*^]/;

	// Glosses: pronunciation dictionaries (phonetics/dict/) say how words
	// sound; the ones in a dict folder (dict/, bible/dict/, ...) come first
	const isPhon = d => dicts[d].cat === 'phonetics/dict';
	const inDict = d => dicts[d].path.includes('/dict/');
	// A dict folder's first, then starred, then the filter's order;
	// pronunciation ones last
	const trOrder = ids => [...ids].sort((a, b) => isPhon(a) - isPhon(b) || inDict(b) - inDict(a) || sortId(a) - sortId(b));
	const names = ids => ids.map(d => escapeHTML(dicts[d].name)).join(' + ');
	// The pronunciation one: the first (by priority)
	const phonTranslator = () => dictIds.find(isPhon);

	// The query word by word, when the search found nothing: with every
	// dictionary that's on (a Bible text's headwords are its verses, so
	// "rom 8.1 gal 1.1" links to each) and a pronunciation one.
	function translate(){
		if (globreg.test(query)) return;
		const on = trOn(), q = query;
		const ids = trOrder([...new Set([...dictIds.filter(on), phonTranslator()])].filter(d => d !== undefined));
		if (ids.length) translateText(ids, q, pieces => showTranslation(pieces, q, ids));
	}

	function showTranslation(pieces, q, ids){
		if (q !== query || num || !pieces.some(p => p.entry)) return;
		const div = document.createElement('p-d');
		div.className = 'translation';
		div.innerHTML = `<h2>${names([...new Set(pieces.map(p => p.d).filter(d => d !== undefined))])}</h2>` + translationHTML(pieces);
		translationDiv.replaceChildren(div);
		addMedia(div, pieces, ids);
		updateStatus('No entry for all of it, glossed word by word.');
		queryInput.classList.remove('error');
	}

	// HTML as lines of text: one per line, list item, paragraph, heading, ...
	function textLines(html){
		const t = document.createElement('template');
		t.innerHTML = html.replace(/<br\s*\/?>|<\/?(li|p|div|ul|ol|h[1-6]|p-ipa)(?=[\s/>])[^>]*>|\t/gi, '\n');
		return t.content.textContent.split('\n').map(x => x.trim());
	}
	// An entry as one line, without lines that are only [pronunciations] or
	// [[see also]]s (h97's second column), or the headword's other spellings
	// first (one word each in its script: "ພະເຈົ້າ<tab>@ພຣະເຈົ້າ<tab>...")
	const isText = x => x && !/^(\[[^\]]*\]+\s*)+$/.test(x);
	function summary(html, header){
		const lines = textLines(html).filter(isText);
		while (lines.length > 1 && !/\s/.test(lines[0]) && script(lines[0]) === script(header)) lines.shift();
		return lines.join(' ');
	}
	// An entry's text, without its labels (p-n: parts of speech, a verse's
	// reference, ...)
	function entryText(pe){
		const c = pe.cloneNode(true);
		c.querySelectorAll('p-h, p-n, button, .vs-n, .tr-entry, .tr-pick').forEach(x => x.remove());
		return textLines(c.innerHTML).join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	// ---------------------------------------------------------------
	// Translating with several dictionaries at once: each gives every
	// headword at every place in the text (the worker's matchall, peak.c's
	// match_at), the best way to split the text into them wins (splitText),
	// and each dictionary renders the entries it gave (renderlines).
	// ---------------------------------------------------------------
	const workerReplies = new Map(); // tag -> what to do with the reply
	let replyTag = 0;
	function askDict(d, msg, then){
		workerReplies.set(++replyTag, then);
		workerOf(d).postMessage({...msg, did: didOf(d), tag: replyTag});
	}
	function gotReply(data){
		const then = workerReplies.get(data.tag);
		workerReplies.delete(data.tag);
		then?.(data);
	}

	// done gets the pieces: {text, d (the dictionary), entry ({d, header,
	// body, sec}), pron (pronunciations)}; text no dictionary has has no d
	// (A media dictionary's headwords are words too; its files are added to
	// the words found, addMedia)
	function translateText(ids, text, done){
		text = text.replace(/[​⁠­﻿]/g, ''); // Invisible formatting: the dictionaries say where words break
		const all = [];
		let left = ids.length;
		ids.forEach((d, k) => ensureLoaded(d, () => askDict(d, {type: 'matchall', query: text}, r => {
			all[k] = r.matches
				.filter(([a]) => !/\s/.test(text[a])) // A word doesn't start with the space before it (a second index word can)
				.map(([a, len, m, ix, sec]) => ({a, len, m, ix, sec, bib: isBibleDict(d), d, rank: k}));
			if (--left === 0) pickPieces(all.flat(), text, done);
		})));
	}

	// Bible dictionaries (not texts: their headwords are verse references)
	const isBibleDict = d => /^bible\//.test(dicts[d].cat) && !isBibleText(d);

	// The best way to split text[a, b) into matches: the fewest characters
	// none of them has (letters and digits: spaces and punctuation don't
	// count), then the fewest Bible dictionary words (the dictionaries come
	// first), then the fewest pieces, then the fewest second index words
	// (headwords come first), then the first dictionaries'. So a long match
	// that leaves a piece no dictionary has loses to shorter ones that cover
	// it all, and a second index word ("@ພຣະເຈົ້າ", an old spelling) wins
	// over headwords that split it (ພຣະ + ເຈົ້າ). Returns [{a, b, w (the
	// match, none for unmatched)}].
	function splitText(matches, text, a, b){
		const at = new Map();
		matches.forEach(x => { if (!at.has(x.a)) at.set(x.a, []); at.get(x.a).push(x); });
		const n = b - a;
		const cost = new Array(n + 1), pick = new Array(n + 1).fill(null);
		cost[n] = [0, 0, 0, 0, 0];
		const less = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || x[4] - y[4];
		for (let i = n - 1; i >= 0; --i) {
			const c = cost[i + 1];
			cost[i] = [c[0] + (/[\p{L}\p{M}\p{N}]/u.test(text[a + i]) ? 1 : 0), c[1], c[2] + (pick[i + 1] ? 1 : 0), c[3], c[4]]; // Unmatched, joined to unmatched text after it
			for (const x of at.get(a + i) || []) {
				if (i + x.len > n) continue;
				const e = cost[i + x.len];
				const t = [e[0], e[1] + x.bib, e[2] + 1, e[3] + x.sec, e[4] + x.rank];
				if (less(t, cost[i]) < 0) { cost[i] = t; pick[i] = x; }
			}
		}
		const out = [];
		for (let i = 0; i < n;) {
			const x = pick[i];
			let j = i + (x ? x.len : 1);
			if (!x) while (j < n && !pick[j]) ++j;
			out.push({a: a + i, b: a + j, w: x});
			i = j;
		}
		return out;
	}

	// Each word's entry is the best one for exactly it (headwords first,
	// then the first dictionaries'), and its pronunciation a pronunciation
	// dictionary's for exactly it, or else its parts', if they make it up
	function pickPieces(matches, text, done){
		const words = matches.filter(x => !isPhon(x.d)), phons = matches.filter(x => isPhon(x.d));
		const best = (xs, p) => xs.filter(x => x.a === p.a && x.len === p.b - p.a).sort((x, y) => x.sec - y.sec || x.bib - y.bib || x.rank - y.rank)[0];
		const pieces = splitText(matches, text, 0, text.length);
		const byDict = new Map(); // The matches each dictionary renders
		pieces.forEach(p => {
			p.prons = [];
			if (!p.w) return;
			p.entry = best(words, p);
			const pr = best(phons, p);
			const parts = pr ? [] : splitText(phons.filter(x => x.a >= p.a && x.a + x.len <= p.b), text, p.a, p.b);
			p.prons = pr ? [pr] : parts.every(q => q.w) ? parts.map(q => q.w) : [];
			[p.entry, ...p.prons].forEach(x => { if (x) { if (!byDict.has(x.d)) byDict.set(x.d, []); byDict.get(x.d).push(x); } });
		});
		const finish = () => done(pieces.map(p => ({
			text: text.slice(p.a, p.b),
			d: p.w?.d,
			entry: p.entry?.r,
			pron: p.prons.map(x => x.r && textLines(x.r.body).filter(Boolean).join(' ').replace(/[[\]]/g, '')).filter(Boolean),
		})));
		let left = byDict.size;
		if (!left) return finish();
		byDict.forEach((xs, d) => askDict(d, {type: 'renderlines', lines: xs.map(x => [x.m, x.ix])}, r => {
			xs.forEach((x, i) => { if (r.entries[i]) x.r = {...r.entries[i], d, sec: x.sec}; });
			if (--left === 0) finish();
		}));
	}

	// Each word in a box, with its pronunciation and its entry in a line
	// (a second index match is a word in an entry, so the entry's headword
	// says what it means, unless it's in the same script: then the word is
	// the entry's other spelling); tapping the word shows the entry, and what
	// the popup search finds. Plain Latin text gets no pronunciation.
	const latin = t => !/[^\u0000-ɏ]/.test(t);
	const script = t => (t.match(/\p{L}/u)?.[0] ?? ' ').codePointAt(0) >> 7; // (its Unicode block, roughly)
	const glossOf = (entry, word) => entry.sec && script(entry.header) !== script(word) ? entry.header : summary(entry.body, entry.header);
	const popupEntries = []; // The entries words came from, for p-a's data-e
	function translationHTML(pieces){
		return pieces.map(p => {
			if (p.d === undefined) // Text no dictionary has: its words dashed, the rest as is
				return p.text.split(/(\s+)/).map(t => /\p{L}/u.test(t) ? `<span class="tr-w tr-x">${escapeHTML(t)}</span>` : escapeHTML(t).replace(/\n/g, '<br>')).join('');
			const w = escapeHTML(p.text.trim());
			const pron = !latin(p.text) && p.pron.length ? `<span class="tr-p">${escapeHTML(p.pron.join(' '))}</span>` : '';
			const gloss = p.entry ? escapeHTML(glossOf(p.entry, p.text)) : '';
			return `<span class="tr-w${p.entry ? '' : ' tr-u'}" data-w="${w}" title="${names([p.entry ? p.entry.d : p.d])}">` +
				`<p-a${p.entry ? ` data-e="${popupEntries.push(p.entry) - 1}"` : ''}>${w}</p-a>${pron}` +
				(gloss ? `<span class="tr-g" title="${gloss}">${gloss}</span>` : '') + '</span>';
		}).join('');
	}

	// The media dictionaries' files for the words (loading them): a
	// recording, a 🔊 in the word's box that plays it (no player); a picture,
	// under it
	const AUDIO = /webm|ogg|opus|mp3|wav|m4a|codec2|c2/i;
	function addMedia(box, pieces, ids){
		const words = [...new Set(pieces.filter(p => p.d !== undefined).map(p => p.text.trim()))];
		if (!words.length) return;
		ids.filter(d => dicts[d].media).forEach(d =>
			ensureLoaded(d, () => askDict(d, {type: 'media', words}, r => r.files.forEach((f, k) => {
				if (!f || !f[1]) return;
				const ws = box.querySelectorAll(`.tr-w[data-w="${CSS.escape(words[k])}"]`);
				if (!AUDIO.test(f[0])) return ws.forEach(w => { if (!w.querySelector('.tr-img')) w.appendChild(mediaElement(f[0], f[1], words[k])).classList.add('tr-img'); });
				ws.forEach(w => {
					if (w.classList.contains('has-audio')) return;
					w.classList.add('has-audio');
					const b = w.appendChild(document.createElement('button'));
					b.className = 'tr-play';
					b.title = b.ariaLabel = 'Play';
					b.textContent = '🔊';
					const a = b.appendChild(document.createElement('audio'));
					audioSrc(f[0], f[1]).then(u => { a.src = u; });
					b.onclick = () => {
						a.currentTime = 0;
						a.play().catch(e => { b.firstChild.data = '⚠'; b.title = `Can't play ${f[0]} here: ${e.message}`; });
					};
				});
			}))));
	}
	// A recording's URL, ready before it's played: phones play sound only
	// right in the tap, not after something else finishes (like decoding)
	const audioSrc = async (type, bytes) => URL.createObjectURL(/codec2|c2/i.test(type) ? await media().then(m => m.codec2toWav(bytes)) : new Blob([bytes], {type: audioType(type)}));
	const audioType = t => /webm/i.test(t) ? 'audio/webm; codecs=opus' : 'audio/' + t.toLowerCase();

	function translateEntryWith(box, text, ids){
		const key = box.dataset.ids = ids.join();
		box.textContent = `Glossing with ${ids.map(d => dicts[d].name).join(' + ')}…`;
		translateText(ids, updateQuery(text), pieces => {
			if (!box.isConnected || box.dataset.ids !== key) return;
			box.innerHTML = `<div class="tr-head">${names(ids)}</div>` +
				(pieces.some(p => p.d !== undefined) ? translationHTML(pieces) : 'No words found.');
			addMedia(box, pieces, ids);
		});
	}

	// The ⇄ button on an entry (or verse) asks which dictionaries to gloss
	// its text with, every time, any number at once: the ones that are on,
	// pronunciation ones, and (loaded when used) the ones that are off. It
	// starts with the ones that are on and a pronunciation one, with the
	// changes made here before (added, dropped) kept. Tap ⇄ again to hide it.
	const glossDefault = () => [...new Set([...dictIds.filter(d => libOn[d] && !isPhon(d)), phonTranslator()])].filter(d => d !== undefined);
	const trWithKey = `peakslab-gloss-${appname}`;
	function lastTrWith(){
		const {add = [], drop = []} = stored(trWithKey) || {}, dropped = byPaths(drop);
		return trOrder([...new Set([...glossDefault().filter(d => !dropped.includes(d)), ...byPaths(add).filter(d => dictIds.includes(d))])]);
	}
	window.translateEntry = btn => {
		const pe = btn.closest('p-e, .vs');
		const open = pe.querySelectorAll('.tr-entry, .tr-pick');
		if (open.length) return open.forEach(x => x.remove());
		const text = entryText(pe);
		const chosen = new Set(lastTrWith());
		const phons = dictIds.filter(isPhon), on = dictIds.filter(d => libOn[d] && !isPhon(d));
		const off = dictIds.filter(d => !on.includes(d) && !isPhon(d));
		const opts = ids => ids.map(d => `<button class="check" data-idx="${d}" aria-pressed="${chosen.has(d)}">${isStar(d) ? '★ ' : ''}${escapeHTML(dicts[d].name)}</button>`).join('');
		const pick = document.createElement('div');
		pick.className = 'tr-pick';
		pick.innerHTML = '<div class="tr-q">Gloss with <button class="tr-go">Gloss</button></div>' +
			(on.length ? `<div class="tr-sub">On</div>${opts(on)}` : '') +
			(phons.length ? `<div class="tr-sub">Pronunciation</div>${opts(phons)}` : '') +
			(off.length ? `<details${off.some(d => chosen.has(d)) ? ' open' : ''}><summary class="tr-sub">Off (loads when used)</summary>${opts(off)}</details>` : '');
		btn.insertAdjacentElement('afterend', pick);
		pick.scrollIntoView({block: 'nearest'});
		const goBtn = pick.querySelector('.tr-go');
		const picked = () => [...pick.querySelectorAll('.check[aria-pressed="true"]')].map(x => +x.dataset.idx);
		const update = () => { goBtn.disabled = !picked().length; };
		update();
		goBtn.focus({preventScroll: true});
		pick.onclick = e => {
			const b = e.target.closest('button');
			if (!b) return;
			e.stopPropagation(); // A button going away would look like a click outside the popup
			if (b.dataset.idx) {
				b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
				return update();
			}
			const ids = trOrder(picked());
			if (!ids.length) return;
			const def = glossDefault(), paths = ds => ds.map(d => dicts[d].path);
			store(trWithKey, {add: paths(ids.filter(d => !def.includes(d))), drop: paths(def.filter(d => !ids.includes(d)))});
			pick.remove();
			glossInto(pe, text, ids);
		};
	};
	// The gloss of an entry's (or verse's) text, or some of it: above the
	// text (after the entry's name and buttons), so a long one doesn't push
	// it out of view
	function glossInto(pe, text, ids){
		pe.querySelectorAll(':scope > .tr-entry, :scope > .tr-pick').forEach(x => x.remove());
		const box = document.createElement('div');
		box.className = 'tr-entry';
		const text1 = [...pe.childNodes].find(n => n.nodeType === 1 ? !n.matches('p-h, button, .tr-pick') : n.textContent.trim());
		pe.insertBefore(box, text1 || null);
		box.scrollIntoView({block: 'nearest'});
		translateEntryWith(box, text, ids);
	}


	// Long text also gets a big text box above the results; it and the
	// search bar stay in sync.
	const BIG = 40;
	function fitBig(){
		bigQuery.style.height = 'auto';
		bigQuery.style.height = bigQuery.scrollHeight + 'px';
	}
	function updateBig(){
		const on = !bigQuery.classList.contains('hide');
		const len = queryText.length;
		if (!on && (len >= BIG || queryText.includes('\n'))) {
			bigQuery.classList.remove('hide');
		} else if (on && len < BIG / 2 && !queryText.includes('\n')) {
			bigQuery.classList.add('hide');
			if (document.activeElement === bigQuery) {
				queryInput.focus();
				queryInput.setSelectionRange(len, len);
			}
			return;
		} else if (!on) {
			return;
		}
		if (document.activeElement !== bigQuery) {
			bigQuery.value = queryText;
			fitBig();
		}
	}
	bigQuery.addEventListener('input', () => {
		setQueryText(bigQuery.value);
		fitBig();
		updateBig();
		debouncedSearch();
	});

	function startSearch() {
		const prevquery = query;
		updateBig();
		updateURL();
		query = updateQuery();
		renderQuick();
		if(!query){
			showSettings();
			return;
		}
		settings.style.display = 'none'; // (a translation doesn't clear it)
		showLibrary = false;
		statusDiv.classList.remove('hide');
		updateStatus();
		historyTimer();
		if(chapterOf(readHl) !== query)
			readHl = '';
		if(query == prevquery){
			return;
		}
		translationDiv.replaceChildren();
		window.scrollTo(0, 0);
		worker_code.fill(false);
		st = globreg.test(query) ? 0 : 3;
		dict_code = searchMask(); // worker-side null checks skip dicts that aren't loaded

		updateStatus("Searching...");

		loader = document.createElement('p-d');
		loader.id = 'loader';
		loader.textContent = "Loading more…";

		initSearch();
		getResults();
		updateStatus('No matches found.');
		queryInput.classList.add("error");
	}

	// The search again, even if it's what's showing
	function searchAgain(){
		query = '';
		startSearch();
	}
	function getResults() {
		workers.forEach((w, i) =>{
			if(!worker_code[i])
				w.postMessage({type: "getresults"});
		});
	}


	function debounce(fn, delay) {
		let timer;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), delay);
		};
	}

	const debouncedSearch = debounce(startSearch, 140);
	// An edit in the search bar keeps the newlines outside what changed.
	queryInput.addEventListener('input', () => {
		const v = queryInput.value;
		const same = (a, b) => a === b || (a === '\n' && b === ' ');
		let pre = 0;
		while (pre < v.length && pre < queryText.length && same(queryText[pre], v[pre])) ++pre;
		let suf = 0;
		while (suf < v.length - pre && suf < queryText.length - pre && same(queryText[queryText.length - 1 - suf], v[v.length - 1 - suf])) ++suf;
		queryText = queryText.slice(0, pre) + v.slice(pre, v.length - suf) + queryText.slice(queryText.length - suf);
		updateBig();
		debouncedSearch();
	});
	// Pasting into it would drop the newlines.
	queryInput.addEventListener('paste', e => {
		const text = e.clipboardData?.getData('text/plain');
		if (!text || !/[\r\n]/.test(text)) return;
		e.preventDefault();
		const a = queryInput.selectionStart, b = queryInput.selectionEnd;
		setQueryText(queryText.slice(0, a) + text.replace(/\r\n?/g, '\n') + queryText.slice(b));
		const end = a + text.replace(/\r\n?/g, '\n').length;
		queryInput.setSelectionRange(end, end);
		updateBig();
		debouncedSearch();
	});

	document.addEventListener('touchend', e => {
		const active = document.activeElement;
		if (['INPUT', 'TEXTAREA'].includes(active?.tagName) && !active.contains(e.target)) active.blur();
	});

	// Text size, dark mode and highlighting, remembered
	let fontSize = stored('fontSize') || 16;
	const setFont = n => {
		fontSize = Math.min(32, Math.max(12, n));
		document.documentElement.style.setProperty('--font-size', fontSize + 'px');
		store('fontSize', fontSize);
	};
	setFont(fontSize);
	$('fontIncrease').addEventListener('click', () => setFont(fontSize + 2));
	$('fontDecrease').addEventListener('click', () => setFont(fontSize - 2));
	document.body.classList.toggle('dark-mode', stored('darkMode') === true);
	$('darkT').addEventListener('click', () => store('darkMode', document.body.classList.toggle('dark-mode')));
	mark = stored('mark') !== false;
	$('markT').addEventListener('click', () => store('mark', mark = !mark));

	// Library button: the library and settings, instead of the home page
	// (what was searched is in the history)
	function openLibrary(){
		closeDrawer();
		showLibrary = true;
		setQueryText('');
		query = null; // (shows it even if nothing was searched)
		startSearch();
		window.scrollTo(0, 0);
	}
	$('settingsBtn').addEventListener('click', openLibrary);

	// Selected text: a menu to look it up (here or in the popup) or say it
	// (in the page's languages there are voices for). On iOS it's docked at
	// the bottom of the screen: iOS's own menu, always on top next to the
	// selection, covered ours.
	const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // (iPadOS says it's a Mac)
	const selMenu = document.body.appendChild(document.createElement('div'));
	selMenu.className = ios ? 'selection-menu docked' : 'selection-menu';
	let selText = '', selEntry = null; // (the entry or verse it's in, to gloss it there)
	const selButtons = () => {
		const voices = window.speechSynthesis?.getVoices() || [];
		selMenu.innerHTML = '<button data-act="gloss" class="sel-gloss">⇄ Gloss</button><button data-act="search">🔍Search</button><button data-act="popup">🔍Popup</button>' +
			lang.filter(x => voices.some(v => v.lang.toLowerCase().startsWith(x.val.split('_')[0]))).map(x => `<button data-lang="${x.val}">🔊 ${x.name}</button>`).join('');
	};
	selButtons();
	window.speechSynthesis?.addEventListener('voiceschanged', selButtons); // (they load later)
	selMenu.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		if (b.dataset.lang) {
			const u = new SpeechSynthesisUtterance(selText);
			u.lang = b.dataset.lang;
			speechSynthesis.speak(u);
		} else if (b.dataset.act === 'search') {
			setQueryText(selText);
			startSearch();
		} else if (b.dataset.act === 'gloss') {
			const ids = lastTrWith();
			if (selEntry?.isConnected && ids.length) glossInto(selEntry, selText, ids);
		} else {
			openPopupSearch(selText);
		}
		hideSelMenu();
		getSelection().removeAllRanges();
	});
	function hideSelMenu(){
		selMenu.style.display = 'none';
		document.body.classList.remove('selmenu-docked');
	}
	// Once the selection settles (iOS needs the delay)
	const handleSelEnd = debounce(() => {
		const sel = getSelection();
		selText = sel.toString().trim();
		if (!selText || !sel.rangeCount || sel.isCollapsed) return hideSelMenu();
		const at = sel.getRangeAt(0).commonAncestorContainer;
		selEntry = (at.nodeType === 1 ? at : at.parentElement)?.closest('.vs, p-e');
		if (selEntry?.closest('.tr-entry, .tr-pick')) selEntry = null; // Not a gloss's own words
		selMenu.querySelector('.sel-gloss').hidden = !selEntry;
		if (ios) document.body.classList.add('selmenu-docked'); // (hides the round buttons it would cover)
		else selMenu.style.top = `${sel.getRangeAt(0).getBoundingClientRect().bottom + 26 + scrollY}px`;
		selMenu.style.display = 'block';
	}, 120);
	document.addEventListener('selectionchange', handleSelEnd, {passive: true});
	document.addEventListener('touchend', handleSelEnd, {passive: true});
	document.addEventListener('mouseup', handleSelEnd, {passive: true});
	document.addEventListener('touchstart', e => { if (!selMenu.contains(e.target)) hideSelMenu(); }, {passive: true});

	// Install app: the browser's prompt, or on iOS (which has none) how to
	const installBtn = $('install-button');
	let installPrompt = null;
	const showInstall = on => { installBtn.style.display = on ? 'block' : 'none'; };
	showInstall(ios && !navigator.standalone);
	window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; showInstall(true); });
	window.addEventListener('appinstalled', () => showInstall(false));
	installBtn.addEventListener('click', () => installPrompt ? installPrompt.prompt() : alert('To install it, tap Share in Safari, then Add to Home Screen.'));

	// <p-as href="...">word</p-as>: a link to href + word.
	// <p-a>word</p-a>: tap to look it up in the popup.
	customElements.define('p-as', class extends HTMLElement {
		connectedCallback() {
			const a = document.createElement('a');
			a.href = this.getAttribute('href') + this.textContent;
			a.textContent = this.textContent;
			this.replaceWith(a);
		}
	});
	// In a translation, a tap anywhere on a word's box (but its 🔊) does too
	document.addEventListener('click', e => {
		const w = e.target.closest('.tr-w');
		if (w && !e.target.closest('p-a, .tr-play')) w.querySelector('p-a')?.click();
	});
	customElements.define('p-a', class extends HTMLElement {
		connectedCallback() {
			this.addEventListener('click', () => openPopupSearch(this.textContent, popupEntries[this.dataset.e]));
		}
	});
	// <p-w s="G976">word</p-w>: a word with its Strong's number, tap for its entry
	customElements.define('p-w', class extends HTMLElement {
		connectedCallback() {
			this.onclick = () => openPopupSearch(this.getAttribute('s'));
		}
	});
	// <p-il>word|transliteration|gloss|G976|grammar ¦ ...</p-il>: an
	// interlinear verse, each word over the rest (and a sixth field: a note,
	// for a word only some manuscripts have)
	customElements.define('p-il', class extends HTMLElement {
		connectedCallback() {
			if (this.firstElementChild) return; // Done already (moved)
			this.innerHTML = this.textContent.split('¦').map(w => {
				const [o, t = '', g = '', s, m = '', v] = w.trim().split('|').map(escapeHTML);
				return `<span class="il-w${v ? ' il-v' : ''}"${v ? ` title="${v}"` : ''}><span class="il-o">${o}</span>` +
					`<span class="il-t">${t}</span><span class="il-g">${g}</span><span class="il-s">${s ? `<p-a>${s}</p-a> ` : ''}${m}</span></span>`;
			}).join(' ');
		}
	});
}
