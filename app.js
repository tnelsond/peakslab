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
const chordsBtnHTML = '<button class="chords-btn" onclick="toggleChords()" title="Show or hide chords"></button>';
window.toggleChords = () => {
	const shown = document.body.classList.toggle('show-chords');
	try { localStorage.setItem('showChords', shown); } catch (e) { /* not remembered */ }
};
try { if (localStorage.getItem('showChords') === 'true') document.body.classList.add('show-chords'); } catch (e) {}
// Collapse a dictionary: every one of its entries (data-dict) shrinks to its
// first line, everywhere in the results, and stays collapsed (remembered).
// Some start collapsed (files.json's 7th field, #collapsed in the source:
// Bible notes, ...); what's remembered is the ones flipped from that.
// Done with one generated CSS rule per collapsed dictionary.
const collapseBtnHTML = '<button class="collapse-btn" onclick="toggleDict(this)" title="Collapse or expand this dictionary"></button>';
// Translates an entry word by word, see translateEntry
const translateBtnHTML = '<button class="translate-btn" onclick="translateEntry(this)" title="Translate word by word">⇄</button>';
const collapseStyle = document.head.appendChild(document.createElement('style'));
let collapsedDicts = []; // Flipped from their default
try { collapsedDicts = JSON.parse(localStorage.getItem('collapsedDicts')) || []; } catch (e) {}
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
	try { localStorage.setItem('collapsedDicts', JSON.stringify(collapsedDicts)); } catch (e) {}
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
					if(!$(`${d}`)?.checked && !extraLoaded.has(d)) // Turned off (or the filter changed) while it loaded
						unloadDict(d);
					(pendingLoad.get(d) || []).forEach(f => f());
					pendingLoad.delete(d);
					$(`${d}`)?.classList.remove('down');
					timingDiv.insertAdjacentHTML("beforeend", `${Math.round(performance.now())}ms ${e.data.msg}<br>`);
					--nload;
					updateStatus();
					if(nload == 0)
						saveState();
					if(!extraLoaded.has(d)){ // Ones just to translate with aren't searched
						query = ""; // Triggers a search
						startSearch();
					}
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
								if (num == 0)
									translate(); // Nothing has all of it: word by word
							}
						}
					}
				}else if(e.data.type == "matches" || e.data.type == "rendered"){
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
	const entryHeadHTML = d => `<p-h title="${escapeHTML(typeLabel(d))}">${starBtnHTML(d)}<span class="dn">${escapeHTML(dicts[d].name)}</span></p-h>`;
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

	// Above a chapter: ‹ the book (tap: its chapters) ›, going on to the
	// next or previous book at the ends
	function chapterNav(title){
		const [, code, c] = /^(.+) (\d+)\.$/.exec(query);
		const ch = +c;
		const nav = document.createElement('div');
		nav.id = 'chNav';
		nav.innerHTML = '<button class="ch-go" data-go="-1" aria-label="Previous chapter">‹</button>' +
			`<button class="ch-book">${escapeHTML(title)} ▾</button>` +
			'<button class="ch-go" data-go="1" aria-label="Next chapter">›</button>';
		nav.onclick = e => {
			const b = e.target.closest('button');
			if (!b) return;
			if (!b.dataset.go) {
				booksPick = code;
				return openDrawer('books');
			}
			loadBooks(() => {
				const i = books.findIndex(x => x.code === code);
				const to = ch + +b.dataset.go;
				const bk = to < 1 ? books[i - 1] : to > books[i]?.n ? books[i + 1] : books[i];
				if (bk) search(`${bk.code} ${to < 1 ? bk.n : bk === books[i] ? to : 1}.`);
			});
		};
		loadBooks(() => { // The book's name in the Bible, and the ends
			const i = books.findIndex(x => x.code === code);
			if (i < 0) return;
			nav.querySelector('.ch-book').textContent = `${books[i].name} ${String(ch).replace(/\d/g, d => String.fromCodePoint(books[i].zero + +d))} ▾`;
			nav.firstChild.disabled = !i && ch === 1;
			nav.lastChild.disabled = i === books.length - 1 && ch === books[i].n;
		});
		return nav;
	}

	// A verse of the chapter searched ("rom 8."): each dictionary's verses
	// run together in one card, numbered as its references have them
	// ("យ៉ូហាន ៣:១៦"); the ⇄ after a verse translates it word by word.
	// Parallel: the Bible texts share one card, verse by verse.
	function addVerse(data, h){
		const d = dictOf(data);
		const label = /<p-n>@?([^<]*)<\/p-n>/.exec(data.body);
		const par = parallel && isBibleText(d);
		const cardId = par ? 'ch-par' : `ch-${d}`, cardSort = par ? -1e6 : sortId(d);
		let card = $(cardId);
		if(!card){
			card = document.createElement('p-d');
			card.id = cardId;
			card.className = par ? 'chapter parallel' : 'chapter';
			card.dataset.id = cardSort;
			if(!$('chNav'))
				resultsDiv.prepend(chapterNav(label ? label[1].replace(/\s*[:.]\s*\p{Nd}+[^:.]*$/u, '') : query));
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
		vs.innerHTML = `${heads}<span class="vs-start"><span class="vs-n">${escapeHTML(n)}</span>${word}</span>${rest.slice(word.length)}` +
			'<button class="vs-tr" onclick="translateEntry(this)" title="Translate word by word" aria-label="Translate this verse">⇄</button> ';
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
		if(h === readHl){ // Read in context: the verse in each card, the top one's in view
			vs.classList.add('hl');
			resultsDiv.querySelector('.vs.hl').scrollIntoView({block: 'center'});
		}
		found();
	}

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
	const dicts = allDicts.filter(x => x.primary || (x.priority <= 0 && primaryCats.has(x.cat)));
	const dictIds = dicts.map((_, d) => d);

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

	// Remembered things (null if there's nothing, or no storage)
	const stored = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
	const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not remembered */ } };
	const readList = k => { const l = stored(k); return Array.isArray(l) ? l : []; };
	const byPaths = paths => paths.map(p => dicts.findIndex(x => x.path === p)).filter(d => d >= 0);

	const sizeText = n => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
	startCollapsed = new Set(dicts.filter(x => x.collapsed).map(x => x.name));
	applyCollapsed();

	const typeHTML = d => dicts[d].type ? `<span class="lib-type type-${dicts[d].type}">${escapeHTML(typeLabel(d))}</span>` : '';
	const typeLabel = d => {
		const {type, lang} = dicts[d], l = cap(lang);
		return {mono: l, bi: `${l} → English`, rbi: `English → ${l}`, phon: 'Pronunciation', aux: 'Auxiliary'}[type] || '';
	};

	// The filter: categories made from the dictionaries on the page, by kind
	// (the folders: Bible, Dictionaries, Bible texts, Music, Pronunciation,
	// ...), Bible first. Pick any number of them and searches use just their
	// dictionaries; none picked is Everything (the library's choices). Each
	// category keeps its own choice of which of its dictionaries it uses.
	const CAT_LABELS = {dict: 'Dictionaries', 'dict/tech': 'Technical terms', bible: 'Bible', 'bible/text': 'Bible texts',
		'bible/dict': 'Bible words', 'bible/commentary': 'Bible notes', 'bible/psalter': 'Psalters', music: 'Music',
		'music/chords': 'Chords', 'music/sheet': 'Sheet music', 'music/text': 'Song lyrics', phonetics: 'Pronunciation',
		media: 'Audio & images', ref: 'Reference'};
	const catLabel = c => CAT_LABELS[c] || cap(c.replace('/', ' / '));
	const cats = []; // {id, label, sub, members: [d, ...]}
	{
		const addCat = (id, label, test, sub) => {
			const members = dictIds.filter(d => test(dicts[d]));
			// Not if it's empty, everything (Greek's Bible) or the same as another
			if (members.length && members.length < dictIds.length && !cats.some(c => c.members.join() === members.join()))
				cats.push({id, label, sub, members});
		};
		const top = x => x.cat.split('/')[0] || 'other', two = x => x.cat.split('/').slice(0, 2).join('/');
		[...new Set(dicts.map(top))].sort((a, b) => (b === 'bible') - (a === 'bible')).forEach(c => {
			addCat(c, catLabel(c), x => top(x) === c);
			const subs = new Set(dicts.filter(x => top(x) === c && x.cat.includes('/')).map(two));
			if (subs.size > 1) subs.forEach(s => addCat(s, catLabel(s), x => two(x) === s, true));
		});
	}
	// Choosing is worth it only with two or more: one category is everything.
	// The bar has the top-level ones, so it needs two of those.
	const choice = cats.length > 1, barChoice = cats.filter(c => !c.sub).length > 1;
	const catById = id => cats.find(c => c.id === id);
	const urlParams = new URLSearchParams(window.location.search);
	const filterKey = `peakslab-filter-${appname}`;
	let selected = (urlParams.has('mode') ? urlParams.get('mode').split(',') : readList(filterKey)).filter(id => choice && catById(id));
	const filtered = () => selected.length > 0;
	const selCats = () => selected.map(catById);
	const inFilter = d => !filtered() || selCats().some(c => c.members.includes(d));
	// A category's choice of dictionaries: saved, or the ones on by default
	// in it, or all of it if none are
	const catStoreKey = id => `peakslab-cat-${appname}-${id}`;
	function catChosen(c){
		const saved = stored(catStoreKey(c.id));
		if (Array.isArray(saved)) return new Set(c.members.filter(d => saved.includes(dicts[d].path)));
		const on = c.members.filter(d => dicts[d].on);
		return new Set(on.length ? on : c.members);
	}
	const setCatChosen = (c, set) => store(catStoreKey(c.id), c.members.filter(d => set.has(d)).map(d => dicts[d].path));

	// Stars: a starred dictionary's entries come first and stand out, in the
	// order they were starred, and its words are the ones searched first.
	// ?dict=h97 is a page with only that dictionary loaded ("solo").
	let solo = dicts.findIndex(x => x.name === urlParams.get('dict'));
	const starKey = `peakslab-stars-${appname}`;
	let stars = byPaths(readList(starKey));
	const isStar = d => stars.includes(d);
	const sortId = d => isStar(d) ? stars.indexOf(d) - 1000 : d + 1;
	const starBtnHTML = d => `<button class="star-btn" data-d="${d}" onclick="toggleStar(${d})" aria-pressed="${isStar(d)}" title="${isStar(d) ? 'Unstar' : 'Star: show it first'}" aria-label="Star ${escapeHTML(dicts[d].name)}">${isStar(d) ? '★' : '☆'}</button>`;
	const focusEnd = document.createElement('span'); // The starred dictionaries' sections go above this

	let workers_num = dicts.length > 1 ? 2 : 1;
	let workers = [];
	for(let i=1; i<=workers_num; ++i){
		createPeakWorker(i);
	}
	earlyWorkers.slice(workers_num).forEach(w => w.terminate()); // started early but not needed
	let worker_code = new Array(workers.length).fill(false);
	let dict_master_code = new Array(dicts.length).fill(true);
	let dict_code = [...dict_master_code];
	const loading = new Set(); // Dictionaries asked for and not loaded yet (loadDict)
	// Loaded just to translate with (pronunciation), or Everything's while
	// filtering, not to search: they stay loaded, but out of the results
	const extraLoaded = new Set();
	const pendingLoad = new Map(); // dictionary -> what to do once it's loaded
	function ensureLoaded(d, then){
		if (!dict_master_code[d]) return then();
		if (!pendingLoad.has(d)) pendingLoad.set(d, []);
		pendingLoad.get(d).push(then);
		if (!$(`${d}`)?.checked) extraLoaded.add(d);
		loadDict(d);
	}
	const searchMask = () => dicts.map((_, d) => !extraLoaded.has(d) || !!$(`${d}`)?.checked);
	// What translating and the popup use: the ones on (searched), and the
	// ones Everything has on (priority 1, or as the library has them), so a
	// filter like Bible still has them
	function trOn(){
		const lib = libraryOn();
		return d => !!$(`${d}`)?.checked || lib[d];
	}
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

	const params = new URLSearchParams(window.location.search);
	// The query, newlines and all. The one line search bar can't hold
	// newlines, so it shows them as spaces (same length, so the positions
	// match) and the big text box shows the real thing.
	let queryText = '';
	function setQueryText(text){
		queryText = (text || '').replace(/\r\n?/g, '\n');
		queryInput.value = queryText.replace(/\n/g, ' ');
	}
	setQueryText(params.get('text'));

	const statusDiv  = $('status');
	const statusText = statusDiv.querySelector('.st-text');
	const resultsDiv = $('results');
	const popupOverlay = $('popupOverlay');
	const popupResults = $('popupResults');
	const popupClose = $('popupClose');

	// Above the results: the big text box for long queries and the
	// starred dictionary's word by word translation.
	const topDiv = document.createElement('div');
	resultsDiv.insertAdjacentElement('beforebegin', topDiv);
	const bigQuery = topDiv.appendChild(document.createElement('textarea'));
	bigQuery.id = 'bigQuery';
	bigQuery.classList.add('hide');
	const translationDiv = topDiv.appendChild(document.createElement('div'));

	// Fullscreen: just the results, no search bar or buttons
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
	// "លោកុប្បត្តិ ១:១") its name and digits. From the first Bible that's on.
	let books = null; // [{code, n (chapters), name, zero (where its digits' 0 is)}]
	function loadBooks(then){
		if (books) return then();
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
				then();
			});
		}));
	}
	// Parallel reading: a chapter verse by verse, each verse in every Bible
	// text that's on, one after the other (else each text's chapter in its
	// own card). Above the books: it, and the texts to read.
	const parKey = `peakslab-parallel-${appname}`;
	let parallel = !!stored(parKey);
	const bibleTexts = dictIds.filter(isBibleText);
	function parHTML(){
		if (bibleTexts.length < 2) return '';
		return `<ul class="rows"><li class="row"><button class="row-main check" data-par="1" aria-pressed="${parallel}"><span class="row-w">Parallel reading</span><span class="row-t">Verse by verse in each text</span></button></li></ul>` +
			`<h3 class="drawer-h">Texts</h3><ul class="cat-dicts">${bibleTexts.map(d =>
				`<li><button class="cat-dict check" data-ptext="${d}" aria-pressed="${!!$(`${d}`)?.checked}"><span class="cd-name">${escapeHTML(dicts[d].name)}</span>${typeHTML(d)}</button></li>`).join('')}</ul>` +
			'<h3 class="drawer-h">Books</h3>';
	}
	let booksPick = null; // The book whose chapters are showing
	function booksHTML(){
		if (!books) {
			loadBooks(() => { if (drawerView === 'books') renderDrawer(); });
			return '<p class="empty">Loading…</p>';
		}
		const at = chapterOf(query + '1');
		const b = books.find(x => x.code === booksPick);
		if (b) {
			const num = n => String(n).replace(/\d/g, c => String.fromCodePoint(b.zero + +c));
			const ref = ch => `${b.code.toLowerCase()} ${ch}.`;
			return parHTML() + `<button class="text-btn" data-books-back="1">‹ All books</button><h3 class="drawer-h">${escapeHTML(b.name)}</h3>` +
				`<div class="bk-grid ch">${Array.from({length: b.n}, (_, i) => `<button data-read="${ref(i + 1)}"${at === ref(i + 1) ? ' aria-current="true"' : ''}>${num(i + 1)}</button>`).join('')}</div>`;
		}
		return parHTML() + `<div class="bk-grid">${books.map(x => `<button data-book="${escapeHTML(x.code)}"${at?.startsWith(x.code.toLowerCase() + ' ') ? ' aria-current="true"' : ''}>${escapeHTML(x.name)}</button>`).join('')}</div>`;
	}
	// Bible mode (a Bible category picked, or a Bible page): the Books button
	const bibleMode = () => hasBible && (pParts.includes('bible') || selected.some(id => id.startsWith('bible')));

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
		const qs = queryText ? '?text=' + encodeURIComponent(queryText) : '';
		const row = langRow;
		const mine = filesJson.dicts.filter(f => f[0].startsWith(curLang + '/'));
		const secs = [...new Set(mine.map(f => f[0].split('/')[1]))].filter(c => !['media', 'phonetics'].includes(c));
		return `<ul class="rows">${row(`/${curLang}${qs}`, langSym(curLang), cap(curLang), langCounts[curLang], pParts.length < 2)}` +
			(secs.length > 1 ? secs.map(c => row(`/${curLang}/${c}${qs}`, langSym(c), `${cap(curLang)}: ${catLabel(c)}`, mine.filter(f => f[0].split('/')[1] === c).length, pParts[1] === c)).join('') : '') + '</ul>' +
			'<h3 class="drawer-h">Other languages</h3>' + langRows(curLang, qs);
	}
	// How many dictionaries Everything uses: what's on now, or (while
	// filtering) the library's saved choices
	function everythingCount(){
		return (filtered() ? libraryOn() : dictIds.map(d => $(d)?.checked)).filter(Boolean).length;
	}
	// The library's choices (Everything), whatever is picked: saved
	// ([{file, enabled}]), or the defaults. If storage doesn't work (some
	// privacy modes, in-app webviews) the defaults load and the page works
	// normally; it just won't remember.
	const libKey = `peakslab-dicts-${appname}`;
	function libraryOn(){
		const saved = new Map(readList(libKey).map(x => [x.file, !!x.enabled]));
		return dicts.map(x => saved.get(x.path) ?? x.on);
	}
	// Everything, the top-level categories (and any picked sub-category),
	// then the whole filter
	function renderQuick(){
		const btn = (attrs, label, on, n) => `<button class="qk" ${attrs} aria-pressed="${on}">${escapeHTML(label)}${n !== undefined ? ` <span class="n">${n}</span>` : ''}</button>`;
		const html = (bibleMode() ? '<button class="qk qk-books" data-qbooks="1">Books ›</button>' : '') +
			(barChoice || filtered() ? btn('data-qall="1"', 'Everything', !filtered(), everythingCount()) : '') +
			cats.filter(c => (barChoice && !c.sub) || selected.includes(c.id)).map(c => btn(`data-qsel="${c.id}"`, c.label, selected.includes(c.id), selected.includes(c.id) ? catChosen(c).size : undefined)).join('') +
			'<button class="qk qk-more" data-qmore="1">Filter…</button>';
		if (quick._html !== html) { quick._html = html; quick.innerHTML = html; } // Only when changed: keeps it tappable
	}
	quick.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		if (b.dataset.qbooks) {
			booksPick = null;
			openDrawer('books');
		}
		else if (b.dataset.qall) setFilter([]);
		else if (b.dataset.qsel) toggleCat(b.dataset.qsel);
		else openDrawer('modes');
	});
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
		const g = (pe && entryText(pe).split('\n').find(x => x && !/^(\[[^\]]*\]+\s*)+$/.test(x))) || '';
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
	let drawerView = null;
	const expandedCats = new Set(); // Filter categories opened to show their dictionaries
	const drawerTitles = {history: 'History', bookmarks: 'Bookmarks', books: 'Books', lang: 'Language', modes: 'Filter'};
	function renderDrawer(){
		const v = drawerView, scroll = drawerBody.scrollTop;
		drawer.querySelector('.drawer-title').textContent = drawerTitles[v];
		drawerBody.innerHTML = lists[v] ? listHTML(v) + (lists[v].items.length ? `<button class="text-btn" data-clear="${v}">Clear all</button>` : '') :
			v === 'books' ? booksHTML() : v === 'lang' ? langHTML() : filterHTML();
		drawerBody.scrollTop = scroll;
	}
	// The filter: Everything, then the categories (Everything only with two
	// or more); each opens (▸) to choose its dictionaries
	function filterHTML(){
		const btn = (c, act, attrs, html) => `<button data-cat="${c.id}" data-act="${act}" ${attrs}>${html}</button>`;
		const cat = c => {
			const chosen = catChosen(c), open = expandedCats.has(c.id);
			return `<li class="cat${c.sub ? ' sub' : ''}"><div class="cat-row">` +
				btn(c, 'sel', `class="cat-sel check" aria-pressed="${selected.includes(c.id)}"`, `<span class="row-w">${escapeHTML(c.label)}</span><span class="row-t">${chosen.size} of ${c.members.length} on</span>`) +
				btn(c, 'exp', `class="cat-exp" aria-expanded="${open}" title="Choose its dictionaries" aria-label="Choose the dictionaries in ${escapeHTML(c.label)}"`, '▸') + '</div>' +
				(open ? `<div class="cat-body"><ul class="cat-dicts">${c.members.map(d =>
					`<li>${btn(c, 'dict', `data-d="${d}" class="cat-dict check" aria-pressed="${chosen.has(d)}"`, `<span class="cd-name">${escapeHTML(dicts[d].name)}</span>${typeHTML(d)}`)}</li>`).join('')}</ul>` +
					`<div class="cat-acts">${btn(c, 'all', 'class="text-btn"', 'All')}${btn(c, 'none', 'class="text-btn"', 'None')}${btn(c, 'reset', 'class="text-btn"', 'Reset')}</div></div>` : '') +
				'</li>';
		};
		return (choice ? `<ul class="rows"><li class="row"><button class="row-main radio" data-everything="1" aria-pressed="${!filtered()}"><span class="row-w">Everything</span><span class="row-t">${everythingCount()} of ${dicts.length} on in the library</span></button></li></ul>` : '') +
			`<ul class="rows cats">${cats.map(cat).join('')}</ul>` +
			'<p class="empty">Pick as many as you like. Open one (▸) to choose which of its dictionaries it uses.</p>';
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
	// A category picked or not (the filter's and the quick bar's buttons)
	const toggleCat = id => setFilter(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
	// The buttons in the drawer and on the home page
	function rowClick(e){
		const b = e.target.closest('button');
		if (!b) return;
		const {book, booksBack, read, everything, q, rm, w, clear, open, act, par, ptext} = b.dataset;
		if (par) {
			parallel = !parallel;
			store(parKey, parallel);
			renderDrawer();
			if (chapterOf(query + '1') === query) { query = ''; startSearch(); } // The chapter showing, again
		} else if (ptext) {
			const cb = $(ptext);
			if (!cb) return;
			cb.checked = !cb.checked;
			updateDictList(cb);
			renderDrawer();
		} else if (book || booksBack) {
			booksPick = book || null;
			renderDrawer();
		} else if (read) {
			closeDrawer();
			search(read);
		} else if (everything) {
			setFilter([]);
		} else if (act) { // A category's
			const c = catById(b.dataset.cat);
			if (act === 'sel') return toggleCat(c.id);
			if (act === 'exp') {
				if (!expandedCats.delete(c.id)) expandedCats.add(c.id);
				return renderDrawer();
			}
			if (act === 'reset') try { localStorage.removeItem(catStoreKey(c.id)); } catch (e) { /* not remembered */ }
			else {
				const set = act === 'all' ? new Set(c.members) : act === 'none' ? new Set() : catChosen(c);
				if (act === 'dict' && !set.delete(+b.dataset.d)) set.add(+b.dataset.d);
				setCatChosen(c, set);
			}
			if (selected.includes(c.id)) refilter();
			else renderDrawer();
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

	// ---------------------------------------------------------------
	// Library: every dictionary on this page, under its category ("Bible
	// words", "Bible words in English" for another language's), like the
	// filter's rows: on or off, what kind it is, its size, and its star.
	// ---------------------------------------------------------------
	let temp = `<h2>Library<span id="libMode"></span></h2><p class="lib-help">Turn dictionaries on or off. Star the ones you use most: their entries come first.</p><ol class="rows dictlist">`;

	let prevGroup = null;
	dicts.forEach((x, d) => {
		const group = catLabel(x.cat) + (x.primary ? '' : ` in ${cap(x.lang)}`);
		if (group !== prevGroup)
			temp += `<li class="lib-h drawer-h">${escapeHTML(group)}</li>`;
		prevGroup = group;
		temp += `<li class="row dictlist-file" data-idx="${d}">` +
			`<input type="checkbox" class="down" id="${d}"${x.on ? " checked" : ""} onchange="updateDictList(this)">` +
			`<label for="${d}" class="row-main check lib-check"><span class="lib-name"><span class="row-w">${escapeHTML(x.name)}</span>` +
			typeHTML(d) + (x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') +
			`</span><span class="lib-desc">${x.desc}</span></label>` +
			starBtnHTML(d) + '</li>';
	});
	temp += `</ol>`;
	let listDiv = $('listDiv');
	listDiv.innerHTML += temp;
	renderHome();
	const filterBtn = $('filterBtn');
	const libMode = $('libMode');
	updateFilterUI();

	ack = function(url){
		const x = dicts.findIndex(y => y.path === url);
		if(x >= 0){
			const y = $(`${x}`)
			y.classList.remove('down');
			y.disabled = false;
		}
	}

	// The library's choices (libraryOn), or the filter's (its categories',
	// catChosen), or the solo dictionary
	function applyState() {
		if (solo >= 0) { // Leaves the saved choices alone for the normal page
			dicts.forEach((_, index) => setCheckbox(index, index === solo));
			loadDict(solo);
			return;
		}
		applyFilter();
	}

	// Turns these dictionaries on (loads them) and the rest off
	function enableSet(want){
		want.forEach((on, d) => {
			setCheckbox(d, on);
			if (on) {
				extraLoaded.delete(d); // Searched now
				loadDict(d);
			}
			else if (!dict_master_code[d] && !extraLoaded.has(d)) unloadDict(d);
		});
		renderQuick();
	}

	// The picked categories' dictionaries, or the library's choices. While
	// filtering, Everything's (not media) load too, unsearched, for
	// translating and the popup.
	function applyFilter(){
		if (!filtered()) return enableSet(libraryOn());
		const on = new Set(selCats().flatMap(c => [...catChosen(c)])), lib = libraryOn();
		dicts.forEach((x, d) => { if (lib[d] && !on.has(d) && !x.media) extraLoaded.add(d); });
		enableSet(dicts.map((_, d) => on.has(d)));
		extraLoaded.forEach(loadDict);
	}

	// A dictionary turned on or off (in the library, or by starring it)
	// while filtering: it's in or out of each picked category it belongs to
	function setInFilter(d, on){
		selCats().filter(c => c.members.includes(d)).forEach(c => {
			const set = catChosen(c);
			if (on) set.add(d); else set.delete(d);
			setCatChosen(c, set);
		});
	}

	// Changes what's picked: their dictionaries, the library showing just
	// them, and the search again
	function setFilter(ids){
		selected = ids.filter(catById);
		store(filterKey, selected);
		refilter();
	}
	function refilter(){
		if (solo < 0) applyFilter();
		updateFilterUI();
		query = ""; // Search again
		startSearch();
	}
	function updateFilterUI(){
		document.querySelectorAll('.dictlist-file').forEach(li => li.classList.toggle('out', !inFilter(+li.dataset.idx)));
		document.querySelectorAll('.lib-h').forEach(h => {
			let n = h.nextElementSibling, any = false;
			while (n && n.classList.contains('dictlist-file')) { any ||= !n.classList.contains('out'); n = n.nextElementSibling; }
			h.classList.toggle('out', !any);
		});
		const on = filtered();
		const label = on ? selCats().map(c => c.label).join(' + ') : 'Everything';
		filterBtn.classList.toggle('on', on);
		menuBtn.classList.toggle('on', on);
		filterBtn.title = filterBtn.ariaLabel = `Filter: ${label}`;
		libMode.textContent = on ? ` · ${label}` : '';
		if (drawerView === 'modes') renderDrawer();
		renderQuick();
		updateURL();
	}

	applyState();

	function saveState() {
		if (solo >= 0 || filtered()) return; // A filter's choices are its categories'

		store(libKey, dicts.map((x, d) => ({file: x.path, enabled: !!$(d)?.checked})));
	}

	function setCheckbox(index, checked){
		const checkbox = $(index);
		if (checkbox) {
				checkbox.checked = checked;
		}
	}


	// The dictionary bytes are fetched HERE, on the page, and transferred
	// (zero-copy) to the worker, rather than letting the worker fetch them.
	// The page is always controlled by the service worker, but the worker is
	// a blob: URL worker in the built 404.html, and whether a blob worker's
	// fetch() goes through the service worker differs between browsers. When
	// it doesn't, every dictionary skips the SW cache and goes to the network
	// / HTTP cache: slow when online, while offline things looked fine.
	function loadDict(i) {
			if (dict_master_code[i] && !loading.has(i)) {
					loading.add(i);
					++nload;
					updateStatus();
					// The worker reads it from the offline cache itself (off this
					// thread), or asks for it with 'needbytes' if there's no
					// current copy there.
					workerOf(i).postMessage({type: 'load', did: didOf(i), msg: [dicts[i].path, dicts[i].name, dicts[i].buflen], timestamp: dicts[i].timestamp});
			}
	}

	// For a worker whose cache has no current copy ('needbytes'): fetch()
	// goes through the service worker, which downloads and caches it.
	async function fetchDict(path) {
		const r = await fetch(path);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.arrayBuffer();
	}

	let query = null;

	function unloadDict(d){
		extraLoaded.delete(d);
		workerOf(d).postMessage({type: 'destroy', did: didOf(d)});
		dict_master_code[d] = true;
	}

	function updateDictList(checkbox){
		const d = +checkbox.id;
		if (filtered()) setInFilter(d, checkbox.checked);
		if(checkbox.checked){
			if (extraLoaded.delete(d)) { // Already loaded (to translate with): searched now
				query = "";
				startSearch();
			}
			loadDict(d);
		}else if (filtered() && libraryOn()[d] && !dicts[d].media){ // Still Everything's: kept, unsearched
			extraLoaded.add(d);
			query = "";
			startSearch();
		}else{
			unloadDict(d);
		}
		saveState();
		if (drawerView === 'modes') renderDrawer();
		renderQuick();
	}
	window.updateDictList = updateDictList;

	// The star on a dictionary (in the library or on one of its entries):
	// starred ones come first. Starring one turns it on.
	function toggleStar(i){
		stars = isStar(i) ? stars.filter(x => x !== i) : [...stars, i];
		if (isStar(i)) {
			if (filtered()) setInFilter(i, true);
			setCheckbox(i, true);
			loadDict(i); // Does nothing if it's loaded
			saveState();
		}
		if (solo < 0) store(starKey, stars.map(d => dicts[d].path));
		updateStarUI();
		query = ""; // Search again
		startSearch();
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
		document.querySelectorAll('.dictlist-file').forEach(li => li.classList.toggle('starred', isStar(+li.dataset.idx)));
	}


	function openPopupSearch(text, entry){
		cleanup(popupResults);
		const q = updateQuery(text);
		if (entry) // The entry a translated word came from
			addResult({id: entry.d % workers.length + 1, did: didOf(entry.d), dict: dicts[entry.d].name,
				query: q, st: 1, header: entry.header, body: entry.body, dest: "popup"});
		// A Strong's number ("g976"): its language's lexicons too, on or not
		const lex = /^([gh])\d+$/.exec(q) ? dictIds.filter(d => dicts[d].cat === 'bible/dict' && dicts[d].lang === (q[0] === 'g' ? 'greek' : 'hebrew')) : [];
		let left = lex.length + 1;
		const go = () => {
			if (--left) return;
			const on = trMask();
			lex.forEach(d => { on[d] = true; });
			forWorkers(on, (w, code) => [1, 2].forEach(st => w.postMessage({type: "tempsearch", st, query: q, dest: "popup", dicts: code})));
		};
		lex.forEach(d => ensureLoaded(d, go));
		go();
	}
	function popupOpen(){
		popupOverlay.style.display = 'block';
		popupOverlay.scrollTop = 0;
		document.body.classList.add('no-scroll');
	}
	function closePopupClick(e){
		if (!e.target.closest('#popupContent')) { 
			document.removeEventListener('click', closePopupClick);
			closePopup();
		}
	}
	function closePopup(){
		cleanup(popupResults);
		popupOverlay.style.display = 'none';
		document.body.classList.remove('no-scroll');
	}
	popupClose.addEventListener('click', closePopup);

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

	let showLibrary = false; // The menu's Library, until something is searched
	function showSettings(){
		loader = null;
		updateStatus('');
		statusDiv.classList.add('hide');
		renderHome();
		settings.style.display = 'block';
		settings.classList.toggle('library', showLibrary);
		resultsDiv.replaceChildren();
		translationDiv.replaceChildren();
	}

	// The worker's indexes for the starred dictionaries that worker i has,
	// which it searches first
	function starDids(i){
		return stars.filter(d => d % workers.length == i).map(d => Math.floor(d / workers.length));
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
		if(query && (chapterOf(query + '1') === query || (loader && loader.getBoundingClientRect().top <= window.innerHeight + 400)) && worker_code.includes(false))
			getResults();
	}
	let lastCheck = 0;
	const throttledCheck = () => { if (Date.now() - lastCheck >= 80) { lastCheck = Date.now(); loadmore(); } };
	window.addEventListener('scroll', throttledCheck, { passive: true });
	window.addEventListener('resize', throttledCheck);

	const globreg = /[!+*^]/;

	// Dictionaries of words (not media, not pronunciation) and pronunciation ones
	const isPhon = d => dicts[d].type === 'phon' && !dicts[d].media;
	const isWords = d => !dicts[d].media && !isPhon(d);
	const loaded = d => !dict_master_code[d];
	// Starred first, then the library's order; pronunciation ones last
	const trOrder = ids => [...ids].sort((a, b) => isPhon(a) - isPhon(b) || sortId(a) - sortId(b));
	const names = ids => ids.map(d => escapeHTML(dicts[d].name)).join(' + ');
	// The default dictionary to translate with: the first starred one that's
	// loaded, else the first loaded one to English, else any loaded one
	function mainTranslator(){
		const ok = dictIds.filter(d => loaded(d) && isWords(d));
		return stars.find(d => ok.includes(d)) ?? ok.find(d => dicts[d].type === 'bi') ?? ok[0];
	}
	// The pronunciation one: the first (by priority)
	const phonTranslator = () => dictIds.find(isPhon);

	// The query word by word, when the search found nothing: with every
	// dictionary trOn (not media) and a pronunciation one, loading any that
	// aren't. A Bible text's headwords are its verses, so "rom 8.1 gal 1.1"
	// links to each.
	function translate(){
		if (globreg.test(query)) return;
		const on = trOn(), q = query;
		const ids = trOrder([...dictIds.filter(d => on(d) && isWords(d)), phonTranslator()].filter(d => d !== undefined));
		if (ids.length) translateText(ids, q, pieces => showTranslation(pieces, q));
	}

	function showTranslation(pieces, q){
		if (q !== query || num || !pieces.some(p => p.entry)) return;
		const div = document.createElement('p-d');
		div.className = 'translation';
		div.innerHTML = `<h2>${names([...new Set(pieces.map(p => p.d).filter(d => d !== undefined))])}</h2>` + translationHTML(pieces);
		translationDiv.replaceChildren(div);
		addAudio(div, pieces);
		updateStatus('No entry for all of it, translated word by word.');
		queryInput.classList.remove('error');
	}

	// HTML as lines of text: one per line, list item, paragraph, heading, ...
	function textLines(html){
		const t = document.createElement('template');
		t.innerHTML = html.replace(/<br\s*\/?>|<\/?(li|p|div|ul|ol|h[1-6]|p-ipa)(?=[\s/>])[^>]*>|\t/gi, '\n');
		return t.content.textContent.split('\n').map(x => x.trim());
	}
	// An entry as one line, without lines that are only [pronunciations] or
	// [[see also]]s (h97's second column)
	const summary = html => textLines(html).filter(x => x && !/^(\[[^\]]*\]+\s*)+$/.test(x)).join(' ');
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
		workers[d % workers.length].postMessage({...msg, did: Math.floor(d / workers.length), tag: replyTag});
	}
	function gotReply(data){
		const then = workerReplies.get(data.tag);
		workerReplies.delete(data.tag);
		then?.(data);
	}

	// done gets the pieces: {text, d (the dictionary), entry ({d, header,
	// body, sec}), pron (pronunciations)}; text no dictionary has has no d
	function translateText(ids, text, done){
		text = text.replace(/[​⁠­﻿]/g, ''); // Invisible formatting: the dictionaries say where words break
		const all = [];
		let left = ids.length;
		ids.forEach((d, k) => ensureLoaded(d, () => askDict(d, {type: 'matchall', query: text}, r => {
			all[k] = r.matches.map(([a, len, m, ix, sec]) => ({a, len, m, ix, sec, d, rank: k}));
			if (--left === 0) pickPieces(all.flat(), text, done);
		})));
	}

	// The best way to split text[a, b) into matches: the fewest characters
	// none of them has, then the fewest second index words (headwords come
	// first), then the fewest pieces, then the first dictionaries'. So a
	// long match that leaves a piece no dictionary has loses to shorter ones
	// that cover it all. Returns [{a, b, w (the match, none for unmatched)}].
	function splitText(matches, a, b){
		const at = new Map();
		matches.forEach(x => { if (!at.has(x.a)) at.set(x.a, []); at.get(x.a).push(x); });
		const n = b - a;
		const cost = new Array(n + 1), pick = new Array(n + 1).fill(null);
		cost[n] = [0, 0, 0, 0];
		const less = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
		for (let i = n - 1; i >= 0; --i) {
			const c = cost[i + 1];
			cost[i] = [c[0] + 1, c[1], c[2] + (pick[i + 1] ? 1 : 0), c[3]]; // Unmatched, joined to unmatched text after it
			for (const x of at.get(a + i) || []) {
				if (i + x.len > n) continue;
				const e = cost[i + x.len];
				const t = [e[0], e[1] + x.sec, e[2] + 1, e[3] + x.rank];
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
		const best = (xs, p) => xs.filter(x => x.a === p.a && x.len === p.b - p.a).sort((x, y) => x.sec - y.sec || x.rank - y.rank)[0];
		const pieces = splitText(matches, 0, text.length);
		const byDict = new Map(); // The matches each dictionary renders
		pieces.forEach(p => {
			p.prons = [];
			if (!p.w) return;
			p.entry = best(words, p);
			const pr = best(phons, p);
			const parts = pr ? [] : splitText(phons.filter(x => x.a >= p.a && x.a + x.len <= p.b), p.a, p.b);
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
	// says what it means); tapping the word shows the entry, and what the
	// popup search finds. Plain Latin text gets no pronunciation.
	const latin = t => !/[^\u0000-ɏ]/.test(t);
	const popupEntries = []; // The entries words came from, for p-a's data-e
	function translationHTML(pieces){
		return pieces.map(p => {
			if (p.d === undefined) // Text no dictionary has: its words dashed, the rest as is
				return p.text.split(/(\s+)/).map(t => /\p{L}/u.test(t) ? `<span class="tr-w tr-x">${escapeHTML(t)}</span>` : escapeHTML(t).replace(/\n/g, '<br>')).join('');
			const w = escapeHTML(p.text.trim());
			const pron = !latin(p.text) && p.pron.length ? `<span class="tr-p">${escapeHTML(p.pron.join(' '))}</span>` : '';
			const gloss = p.entry ? escapeHTML(p.entry.sec ? p.entry.header : summary(p.entry.body)) : '';
			return `<span class="tr-w${p.entry ? '' : ' tr-u'}" data-w="${w}" title="${names([p.entry ? p.entry.d : p.d])}">` +
				`<p-a${p.entry ? ` data-e="${popupEntries.push(p.entry) - 1}"` : ''}>${w}</p-a>${pron}` +
				(gloss ? `<span class="tr-g" title="${gloss}">${gloss}</span>` : '') + '</span>';
		}).join('');
	}

	// A word's recording, if an audio dictionary trOn has one (loading it): a 🔊 in its box plays it (no player)
	const AUDIO = /webm|ogg|opus|mp3|wav|m4a|codec2|c2/i;
	function addAudio(box, pieces){
		const words = [...new Set(pieces.filter(p => p.d !== undefined).map(p => p.text.trim()))];
		if (!words.length) return;
		const on = trOn();
		dictIds.filter(d => dicts[d].media && dicts[d].type === 'aux' && on(d)).forEach(d =>
			ensureLoaded(d, () => askDict(d, {type: 'media', words}, r => r.files.forEach((f, k) => {
				if (!f || !f[1] || !AUDIO.test(f[0])) return;
				box.querySelectorAll(`.tr-w[data-w="${CSS.escape(words[k])}"]:not(.has-audio)`).forEach(w => {
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
		box.textContent = `Translating with ${ids.map(d => dicts[d].name).join(' + ')}…`;
		translateText(ids, updateQuery(text), pieces => {
			if (!box.isConnected || box.dataset.ids !== key) return;
			box.innerHTML = `<div class="tr-head">${names(ids)}</div>` +
				(pieces.some(p => p.d !== undefined) ? translationHTML(pieces) : 'No words found.');
			addAudio(box, pieces);
		});
	}

	// The ⇄ button on an entry (or verse) asks which dictionaries to
	// translate its text with, every time, any number at once: the ones that
	// are on, pronunciation ones, and (loaded when used) the ones that are
	// off. It starts with the last choice, or a dictionary and a pronunciation one. Tap ⇄
	// again to hide it.
	const trWithKey = `peakslab-translate-${appname}`;
	function lastTrWith(){
		const ids = byPaths(readList(trWithKey)).filter(d => !dicts[d].media);
		return ids.length ? ids : [mainTranslator(), phonTranslator()].filter(d => d !== undefined);
	}
	window.translateEntry = btn => {
		const pe = btn.closest('p-e, .vs');
		const open = pe.querySelectorAll('.tr-entry, .tr-pick');
		if (open.length) return open.forEach(x => x.remove());
		const text = entryText(pe);
		const chosen = new Set(lastTrWith());
		// Not media or Bible texts (verse references aren't words)
		const usable = dictIds.filter(d => !dicts[d].media && !isBibleText(d));
		const on = usable.filter(d => loaded(d) && isWords(d)), phons = usable.filter(isPhon);
		const off = usable.filter(d => !on.includes(d) && !phons.includes(d));
		const opts = ids => ids.map(d => `<button class="check" data-idx="${d}" aria-pressed="${chosen.has(d)}">${isStar(d) ? '★ ' : ''}${escapeHTML(dicts[d].name)}</button>`).join('');
		const pick = document.createElement('div');
		pick.className = 'tr-pick';
		pick.innerHTML = '<div class="tr-q">Translate with <button class="tr-go">Translate</button></div>' +
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
			store(trWithKey, ids.map(d => dicts[d].path));
			pick.remove();
			// Above the text (after the entry's name and buttons), so a long
			// one doesn't push it out of view
			const box = document.createElement('div');
			box.className = 'tr-entry';
			const text1 = [...pe.childNodes].find(n => n.nodeType === 1 ? !n.matches('p-h, button, .tr-pick') : n.textContent.trim());
			pe.insertBefore(box, text1 || null);
			box.scrollIntoView({block: 'nearest'});
			translateEntryWith(box, text, ids);
		};
	};


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

		loader = null;
		loader = document.createElement('p-d');
		loader.id = 'loader';
		loader.textContent = "Loading more…";

		initSearch();
		getResults();
		updateStatus('No matches found.');
		queryInput.classList.add("error");
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
	$('settingsBtn').addEventListener('click', () => {
		closeDrawer();
		showLibrary = true;
		setQueryText('');
		query = null; // (shows it even if nothing was searched)
		startSearch();
		window.scrollTo(0, 0);
	});

	// Selected text: a menu to look it up (here or in the popup) or say it
	// (in the page's languages there are voices for). On iOS it's docked at
	// the bottom of the screen: iOS's own menu, always on top next to the
	// selection, covered ours.
	const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // (iPadOS says it's a Mac)
	const selMenu = document.body.appendChild(document.createElement('div'));
	selMenu.className = ios ? 'selection-menu docked' : 'selection-menu';
	let selText = '';
	const selButtons = () => {
		const voices = window.speechSynthesis?.getVoices() || [];
		selMenu.innerHTML = '<button data-act="search">🔍Search</button><button data-act="popup">🔍Popup</button>' +
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
