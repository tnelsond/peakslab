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
const bookmarkSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
// Chords (<p-m chord="...">) are hidden by default (CSS). The button toggles
// one class on <body>, remembered; CSS shows them and switches every
// button's label (see .chords-btn).
const chordsBtnHTML = '<button type="button" class="chords-btn" onclick="toggleChords()" title="Show or hide chords"></button>';
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
const collapseBtnHTML = '<button type="button" class="collapse-btn" onclick="toggleDict(this)" title="Collapse or expand this dictionary"></button>';
// Translates an entry word by word, see translateEntry
const translateBtnHTML = '<button type="button" class="translate-btn" onclick="translateEntry(this)" title="Translate word by word">⇄</button>';
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
const earlyWorkers = isDictPage ? [new Worker('/peakworker.js'), new Worker('/peakworker.js')] : [];
const filesJson = await fetch('/files.json').then(r => r.json());

// Ask the browser not to evict the cached dictionaries when disk space is low
if ('storage' in navigator && 'persist' in navigator.storage) {
	navigator.storage.persisted().then(async isPersisted => {
		if (!isPersisted) {
			const granted = await navigator.storage.persist();
			console.log(granted ? 'Storage will persist' : 'Storage may be cleared under pressure');
		}
	});
}

if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/sw.js')
		.then(reg => console.log('Root SW registered with scope:', reg.scope))
		.catch(err => console.error('Registration failed:', err));

	navigator.serviceWorker.addEventListener('message', event => {
		if(event.data){
			if(event.data.type === 'filesupdated'){
				// The service worker applied a new files.json. Refresh the
				// downloaded/version indicators; new or removed dictionaries
				// show up in the list on the next load.
				console.log('Dictionary list updated to', event.data.version);
				requestCacheVersion();
			}else if(event.data.type === 'status') {
				const version = event.data.version;
				console.log('Current cache version:', version);
				const el = document.getElementById('version');
				if (el) {
					el.textContent = version;
				}

				for (const url of Object.keys(event.data.files)) {
					ack?.(url.replace(/^\//, ''));
				}
			}
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
const langSym = l => (Array.isArray(abbr[l]) && abbr[l][1]) || cap(l).slice(0, 2);
const chevron = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
// The language panel's rows: the languages, biggest first
const langCounts = {};
filesJson.dicts.forEach(f => { const l = f[0].split('/')[0]; langCounts[l] = (langCounts[l] || 0) + 1; });
const langRow = (href, sym, name, n, cur) => `<li class="row"><a class="row-main lang-row" href="${href}"${cur ? ' aria-current="page"' : ''}><span class="ls-sym">${escapeHTML(sym)}</span><span class="row-w">${escapeHTML(name)}</span><span class="row-t">${n} ${n === 1 ? 'dictionary' : 'dictionaries'}</span></a></li>`;
const langRows = (skip, qs) => '<ul class="rows">' + Object.keys(langCounts).filter(l => l !== skip).sort((a, b) => langCounts[b] - langCounts[a])
	.map(l => langRow(`/${l}${qs}`, langSym(l), cap(l), langCounts[l], false)).join('') + '</ul>';

if(!isDictPage){
	// The root page: the app with nothing but the language button (typing
	// opens it too, and the text goes along), and what Peak Slab is
	const drawer = document.getElementById('drawer');
	const langBtn = document.getElementById('langBtn');
	const queryInput = document.getElementById('queryInput');
	['menuBtn', 'headMenu', 'quick', 'settings', 'controls'].forEach(id => document.getElementById(id).classList.add('hide'));
	document.querySelector('.sub-div').classList.add('hide');
	document.getElementById('about').classList.remove('hide');
	langBtn.innerHTML = `<span class="lang-sym">?</span><span class="lang-name">Choose a language</span>${chevron}`;
	const openLangs = () => {
		const qs = queryInput.value ? '?text=' + encodeURIComponent(queryInput.value) : '';
		drawer.querySelector('.drawer-title').textContent = 'Language';
		drawer.querySelector('.drawer-body').innerHTML = langRows('', qs);
		drawer.classList.remove('hide');
	};
	const closeLangs = () => drawer.classList.add('hide');
	langBtn.addEventListener('click', openLangs);
	document.getElementById('pickLang').addEventListener('click', openLangs);
	queryInput.addEventListener('input', openLangs);
	drawer.querySelector('.drawer-close').addEventListener('click', closeLangs);
	drawer.querySelector('.drawer-bg').addEventListener('click', closeLangs);
	document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLangs(); });
}else{
	let num = 0;
	let debug = false;
	let mark = true;
	let loader = null;
	let st = 3;
	let nload = 0;
	const timingDiv  = document.getElementById('timing');

	const getSharedWasmModule = (() => {
		let promise = null;
		return async () => {
				if (!promise) {
						// Only used when a worker has no current cached copy
						// ('needwasm'): fetch through the service worker.
						// ?v= and 'reload': past the CDN's and the browser's caches
						const ts = (filesJson.core.find(c => c[0] === 'peak.wasm') || [])[1] || 0;
						promise = fetch(`/peak.wasm?v=${ts}`, {cache: 'reload'})
								.then(resp => resp.arrayBuffer())
								.then(buffer => WebAssembly.compile(buffer));
				}
				return promise;
		};
	})();

	// When creating your workers:
	async function createPeakWorker(id){
			const w = earlyWorkers[id - 1] || new Worker('/peakworker.js');
			workers.push(w);
			const wasmTimestamp = (filesJson.core.find(c => c[0] === 'peak.wasm') || [])[1] || 0;
			w.postMessage({ type: "init", id, wasmTimestamp });
			w.onmessage = function(e){
				if(e.data.type == "needwasm"){
					getSharedWasmModule().then(wasm => w.postMessage({type: 'wasm', wasm}));
				}
				else if(e.data.type == "needbytes"){
					const d = e.data.did*workers.length + e.data.id - 1;
					fetchDict('/' + dicts[d][0])
						.then(buf => w.postMessage({type: 'bytes', did: e.data.did, buf}, [buf]))
						.catch(err => {
							console.warn(`Fetching ${dicts[d][0]} failed:`, err);
							w.postMessage({type: 'bytes', did: e.data.did, buf: null});
						});
				}
				else if(e.data.type == "loaded"){
					const d = e.data.did*workers.length + e.data.id - 1;
					dict_master_code[d] = false;
					loading.delete(d);
					if(!document.getElementById(`${d}`)?.checked && !extraLoaded.has(d)) // Turned off (or the filter changed) while it loaded
						unloadDict(d);
					(pendingLoad.get(d) || []).forEach(f => f());
					pendingLoad.delete(d);
					document.getElementById(`${d}`)?.classList.remove('down');
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
		let div = document.getElementById(`${idpre}-${nheader}`);
		const first = div === null;
		if(first){
			div = document.createElement('p-d');
			div.id = `${idpre}-${nheader}`;
			if(idpre == "mid" || data.st == 2){
				let temp_dict_code = searchMask();
				temp_dict_code[dicts.findIndex(file => file[1] === data.dict)] = false;
				workers.forEach((w, i) =>{
					let code = temp_dict_code.filter((_, index) => index % workers.length == i);
					w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: data.dest, dicts: code, gen: searchGen});
				});
			}
		}
		const d = data.did*workers.length + data.id - 1;
		if(isBibleText(d))
			div.classList.add('verse');
		const seen = div.seen ??= new Set(); // An entry found twice (e.g. a translated word's, then by the popup search) shows once
		if (typeof data.body === 'string' && seen.has(d + '\t' + data.body)) return;
		seen.add(d + '\t' + data.body);
		let el = document.createElement('p-e');
		const sortid = sortId(d); // Starred dictionaries first
		el.setAttribute('data-id', sortid);
		el.dataset.dict = data.dict;
		el.dataset.d = d;
		el.classList.toggle('starred', isStar(d));
		const name = debug ? `${data.dict} ${data.st} '${data.query}' #${sortid}` : data.dict;
		el.innerHTML += `<p-h title="${escapeHTML(typeLabel(d) || '')}">${starBtnHTML(d)}<span class="dn">${name}</span></p-h>`;
		if(first){
			const ctx = isBibleText(d) && chapterOf(nheader) && chapterOf(nheader) !== query ? '<button type="button" class="ctx-btn" onclick="readInContext(this)">Read in context</button>' : '';
			div.innerHTML += `<h2><span class="hw">${data.header}</span>${ctx}<button type="button" class="bm-btn" onclick="toggleBookmark(this)" title="Bookmark" aria-label="Bookmark" aria-pressed="false">${bookmarkSVG}</button></h2>`;
			markBookmark(div);
		}
		if(data.filetype){
			if(data.subheader){
				let sh = data.subheader;	
				el.innerHTML += `<p-n>${sh.join(",<br>")}<br></p-n>`;
			}
			if (data.filetype.toLowerCase().includes('webp')) {
				const blob = new Blob([data.body], { type: 'image/webp' });
				const url = URL.createObjectURL(blob);
				el.innerHTML += `<img src="${url}" alt="${data.header}" style="max-width:100%;">`;
			}else if (data.filetype.toLowerCase().includes('jbig2')) {
				jbig2to1bpng(data.body).then(blob => {
					const url = URL.createObjectURL(blob);
					el.innerHTML += `<img src="${url}" alt="${data.header}" style="max-width:100%;">`;
				});
			}else if (data.filetype.toLowerCase().includes('webm')) {
				const blob = new Blob([data.body], { type: 'audio/webm; codecs=opus'});
				const url = URL.createObjectURL(blob);
				el.innerHTML += `<audio controls><source src="${url}" type="audio/webm; codecs=opus" alt="${data.header}.${data.filetype}"></audio>`;
			}else if (data.filetype.toLowerCase().includes('codec2') || data.filetype.toLowerCase().includes('c2')) {
				const body = data.body;
				const btn = document.createElement('button');
				btn.textContent = '▶ Play';
				btn.addEventListener('click', function onClick() {
					btn.disabled = true;
					btn.textContent = 'Decoding…';
					codec2toWav(body).then(blob => {
						const audio = document.createElement('audio');
						audio.controls = true;
						audio.src = URL.createObjectURL(blob);
						btn.replaceWith(audio);
						audio.play();
					});
				}, { once: true });
				el.appendChild(btn);
			}else{
				el.innerHTML += `${data.filetype}<br> filetype not supported`;
			}
		}else{
			if(mark){
				el.innerHTML += highlightText(data.body, data.query);
			} else{
				el.innerHTML += `${data.body}`;
			}
			// Entries with chords get a show/hide button next to the dictionary name.
			if (data.body && data.body.includes('<p-m')) {
				el.querySelector('p-h')?.insertAdjacentHTML('afterend', chordsBtnHTML);
			}
		}
		if(!data.filetype)
			el.querySelector('p-h')?.insertAdjacentHTML('afterend', translateBtnHTML);
		el.querySelector('p-h')?.insertAdjacentHTML('afterend', collapseBtnHTML);
		
		const children = Array.from(div.children);
		const insertBeforeElement = children.find(child => {
			const childId = parseInt(child.dataset.id);
			return childId > sortid;
		});
		if (insertBeforeElement) {
			div.insertBefore(el, insertBeforeElement);
		} else {
			div.appendChild(el);
		}

		let place = popup ? popupResults : resultsDiv;
		if(!popup && isStar(d)){ // Its sections go above the other dictionaries'
			if(!focusEnd.isConnected)
				resultsDiv.prepend(focusEnd);
			if(first || focusEnd.compareDocumentPosition(div) & Node.DOCUMENT_POSITION_FOLLOWING)
				resultsDiv.insertBefore(div, focusEnd);
		}else if(first){
			if(place == resultsDiv && loader){
				place.insertBefore(div, loader); 
			}else{
				place.appendChild(div); 
			}
		}
		if(first && popup){
			popupOpen();
			setTimeout(() => document.addEventListener('click', closePopupClick)); // (after the click that opened it, if one did)
		}
		if(!popup){
			++num;
			queryInput.classList.remove("error");
			updateStatus(`Found ${num}+ matching lines.`);
			loadmore();
		}
	}

	// Above a chapter: ‹ the book (tap: its chapters) ›, going on to the
	// next or previous book at the ends
	function chapterNav(title){
		const [, code, c] = /^(.+) (\d+)\.$/.exec(query);
		const ch = +c;
		const nav = document.createElement('div');
		nav.id = 'chNav';
		nav.innerHTML = '<button type="button" class="ch-go" data-go="-1" aria-label="Previous chapter">‹</button>' +
			`<button type="button" class="ch-book">${escapeHTML(title)} ▾</button>` +
			'<button type="button" class="ch-go" data-go="1" aria-label="Next chapter">›</button>';
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
	// ("យ៉ូហាន ៣:១៦"); the ⇄ after a verse translates it word by word
	function addVerse(data, h){
		const d = data.did*workers.length + data.id - 1;
		const label = /<p-n>@?([^<]*)<\/p-n>/.exec(data.body);
		let card = document.getElementById(`ch-${d}`);
		if(!card){
			card = document.createElement('p-d');
			card.id = `ch-${d}`;
			card.className = 'chapter';
			card.dataset.id = sortId(d);
			if(!document.getElementById('chNav'))
				resultsDiv.prepend(chapterNav(label ? label[1].replace(/\s*[:.]\s*\p{Nd}+[^:.]*$/u, '') : query));
			card.innerHTML = `<p-e data-dict="${escapeHTML(data.dict)}" data-d="${d}"${isStar(d) ? ' class="starred"' : ''}><p-h title="${escapeHTML(typeLabel(d) || '')}">${starBtnHTML(d)}<span class="dn">${data.dict}</span></p-h>${collapseBtnHTML}</p-e>`;
			const after = [...resultsDiv.querySelectorAll(':scope > p-d.chapter')].find(c => +c.dataset.id > sortId(d));
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
			'<button type="button" class="vs-tr" onclick="translateEntry(this)" title="Translate word by word" aria-label="Translate this verse">⇄</button> ';
		card.querySelector('p-e').append(vs);
		if(h === readHl){ // Read in context: the verse in each card, the top one's in view
			vs.classList.add('hl');
			resultsDiv.querySelector('.vs.hl').scrollIntoView({block: 'center'});
		}
		++num;
		queryInput.classList.remove("error");
		updateStatus(`Found ${num}+ matching lines.`);
		loadmore();
	}

	// Current page path segments, e.g. ["khmer"] or ["khmer","bible"]
	let pagePath = window.location.pathname.replace(/^\/|\/$/g, ''); // strip leading/trailing slashes
	if(pagePath.match("khmermusic")){
		pagePath = "khmer/music";
	}
	const pParts = pagePath.split('/').filter(Boolean);

	// The language segment(s) of the current path (usually just one, e.g. ["khmer"]),
	// i.e. every path segment that isn't a category (used to build heading links).
	const pLangParts = pParts.filter(part => {
		for (const key in abbr) {
			if (key === part && abbr[key][2]) return true; // it's a language segment (has a locale code)
		}
		return false;
	});

	// A file belongs on this page if its path contains every current-page segment ("primary").
	// `category` is the path with the language folder stripped off, so e.g. a Khmer and an
	// English Bible/Text dictionary both group under category ["bible","text"].
	const allFiles = filesJson.dicts.map(f => {
		const dirParts = f[0].split('/').slice(0, -1);
		return { file: f, lang: dirParts[0], category: dirParts.slice(1), isPrimary: pParts.every(p => f[0].includes(p)) };
	});

	// Extras: low-priority (priority <= 0) files from other languages that share a category
	// with at least one primary file on this page — whatever page depth we're browsing at.
	const primaryCategories = new Set(allFiles.filter(x => x.isPrimary).map(x => x.category.join('/')));
	// A file's tuple is [path, timestamp, description, buflen, priority, lang, collapsed, size].
	const files = allFiles.filter(x =>
		x.isPrimary || (x.file[4] <= 0 && primaryCategories.has(x.category.join('/')))
	);

	// Order: categories with the most priority-1 dictionaries first, then within
	// a category this page's language first, then by priority (-1 "always
	// first", 1, 2, 3, ..., then cross-language extras <= 0), then name.
	// Search results list each word's entries in this same order.
	const rank = p => p === -1 ? 0 : (p === undefined || p === null) ? 1 : p > 0 ? p : 100;
	const catKey = f => f.category.join('/');
	const mainCount = {};
	files.forEach(f => { if (f.isPrimary && rank(f.file[4]) <= 1) mainCount[catKey(f)] = (mainCount[catKey(f)] || 0) + 1; });
	files.sort((a, b) =>
		(mainCount[catKey(b)] || 0) - (mainCount[catKey(a)] || 0) ||
		catKey(a).localeCompare(catKey(b)) ||
		(a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1) ||
		rank(a.file[4]) - rank(b.file[4]) ||
		a.lang.localeCompare(b.lang) ||
		a.file[0].localeCompare(b.file[0])
	);

	// Populate the speech-synthesis language list from the language(s) this
	// page is actually for (pLangParts) plus any cross-language "extra"
	// dictionaries shown alongside them, using the locale codes from
	// files.json's abbr table (abbr[key][2], e.g. "km_KH" for Khmer). This
	// replaces the permanently-English-only default declared above.
	const pageLangs = [...new Set([...pLangParts, ...files.map(f => f.lang)])];
	const derivedLang = pageLangs
		.filter(l => Array.isArray(abbr[l]) && abbr[l][2])
		.map(l => ({ name: l.charAt(0).toUpperCase() + l.slice(1), val: abbr[l][2] }));
	if (derivedLang.length) lang = derivedLang;

	// Build appname from symbolic abbreviations of path segments
	// e.g. khmer → ខ , khmer/music → ខ𝄞
	// Each abbr entry is [romanized, symbolic]; fall back to romanized then to the segment itself.
	(function setAppNameFromPath() {
		const parts = pParts.length ? pParts : ['?'];
		appname = parts.map(seg => {
			const entry = abbr[seg];
			if (Array.isArray(entry) && entry.length >= 2) return entry[1]; // symbolic
			if (Array.isArray(entry) && entry.length >= 1) return entry[0]; // romanized
			if (typeof entry === 'string') return entry;
			return seg;
		}).join('');
		const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
		if (meta) {
			const current = meta.getAttribute('content') || '';
			meta.setAttribute('content', current + appname);
		}
		document.title = (document.title || '') + appname;
	})();

	const sizeText = n => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

	// Strip extension from basename
	function fileBasename(filename) {
			return filename.split('/').pop().replace(/(\.(peak|slab)(\.zst)?$)/, '');
	}

	// Priority 1 (or -1, "always show first") dictionaries are enabled by default; everything else
	// (including cross-language extras) starts unchecked and the user can opt in.
	function defaultEnabled(priority) {
			return priority === undefined || priority === 1 || priority === -1;
	}

	// dict entry: [filename, basename, size (bytes, to download), description, enabled]
	let dicts = files.map(({file: [filename, , description, , priority, , , size]}) => [
			filename,
			fileBasename(filename),
			size || 0,
			description,
			defaultEnabled(priority)
	]);
	startCollapsed = new Set(dicts.filter((_, i) => files[i].file[6]).map(d => d[1]));
	applyCollapsed();

	// What kind of dictionary each one is (files.json's 6th field, #lang in
	// the source): mono (in the language), bi (the language to English), rbi
	// (English to the language), phon (pronunciation) or aux (audio, images,
	// word counts, ...)
	const TYPE_ORDER = ['mono', 'bi', 'rbi', 'phon', 'aux'];
	const typeOf = d => files[d].file[5] || '';
	const typeLabel = d => {
		const l = cap(files[d].lang);
		return {mono: l, bi: `${l} → English`, rbi: `English → ${l}`, phon: 'Pronunciation', aux: 'Auxiliary'}[typeOf(d)] || '';
	};

	// The filter: categories made from the files on the page, by kind (the
	// folders: Dictionaries, Bible, Bible texts, Music, Pronunciation, ...)
	// and by language (Khmer only, Khmer → English, English → Khmer). Pick
	// any number of them and searches use just their dictionaries; none
	// picked is Everything (the library's choices). Each category keeps its
	// own choice of which of its dictionaries it uses.
	const CAT_LABELS = {dict: 'Dictionaries', 'dict/tech': 'Technical terms', bible: 'Bible', 'bible/text': 'Bible texts',
		'bible/dict': 'Bible words', 'bible/commentary': 'Bible notes', 'bible/psalter': 'Psalters', music: 'Music',
		'music/chords': 'Chords', 'music/sheet': 'Sheet music', 'music/text': 'Song lyrics', phonetics: 'Pronunciation',
		media: 'Audio & images', ref: 'Reference'};
	const catLabel = c => CAT_LABELS[c] || cap(c.replace('/', ' / '));
	const cats = []; // {id, label, group, sub, members: [d, ...]}
	{
		const addCat = (id, label, group, test, sub) => {
			const members = files.map((_, d) => d).filter(test);
			// Not if it's empty or the same as another
			if (members.length && !cats.some(c => c.members.join() === members.join()))
				cats.push({id, label, group, sub, members});
		};
		const tops = [...new Set(files.map(f => f.category[0] || 'other'))];
		tops.forEach(c => {
			addCat(c, catLabel(c), 'kind', d => (files[d].category[0] || 'other') === c);
			const subs = [...new Set(files.filter(f => f.category[0] === c && f.category[1]).map(f => f.category[1]))];
			if (subs.length > 1)
				subs.forEach(sc => addCat(`${c}/${sc}`, catLabel(`${c}/${sc}`), 'kind', d => files[d].category[0] === c && files[d].category[1] === sc, true));
		});
		const curLang = pLangParts[0] || pParts[0];
		TYPE_ORDER.forEach(t => {
			const label = {mono: `${cap(curLang)} only`, bi: `${cap(curLang)} → English`, rbi: `English → ${cap(curLang)}`, phon: 'Pronunciation', aux: 'Other extras'}[t];
			addCat(`type-${t}`, label, 'language', d => typeOf(d) === t && (t === 'aux' || files[d].lang === curLang));
		});
	}
	const catById = id => cats.find(c => c.id === id);
	const filterKey = `peakslab-filter-${appname}`;
	let selected = (new URLSearchParams(window.location.search).get('mode') || '').split(',').filter(catById);
	if (!selected.length && !new URLSearchParams(window.location.search).has('mode')) {
		try { selected = (JSON.parse(localStorage.getItem(filterKey)) || []).filter(catById); } catch (e) { /* not remembered */ }
	}
	const filtered = () => selected.length > 0;
	const selCats = () => selected.map(catById);
	const inFilter = d => !filtered() || selCats().some(c => c.members.includes(d));
	// A category's choice of dictionaries: saved, or the ones on by default
	// (from the dict definition) in it, or all of it if none are
	const catStoreKey = id => `peakslab-cat-${appname}-${id}`;
	const defaultOn = d => dicts[d][4] === true || dicts[d][4] === undefined;
	function catChosen(c){
		try {
			const saved = JSON.parse(localStorage.getItem(catStoreKey(c.id)));
			if (Array.isArray(saved)) return new Set(c.members.filter(d => saved.includes(dicts[d][0])));
		} catch (e) { /* not remembered */ }
		const on = c.members.filter(defaultOn);
		return new Set(on.length ? on : c.members);
	}
	function setCatChosen(c, set){
		try { localStorage.setItem(catStoreKey(c.id), JSON.stringify(c.members.filter(d => set.has(d)).map(d => dicts[d][0]))); } catch (e) { /* not remembered */ }
	}

	// Stars: a starred dictionary's entries come first and stand out, in the
	// order they were starred, and its words are the ones searched first.
	// ?dict=h97 is a page with only that
	// dictionary loaded ("solo").
	const urlParams = new URLSearchParams(window.location.search);
	const dictIndex = name => name ? dicts.findIndex(d => d[1] === name) : -1;
	let solo = dictIndex(urlParams.get('dict'));
	const starKey = `peakslab-stars-${appname}`;
	let stars = [];
	try {
		stars = (JSON.parse(localStorage.getItem(starKey)) || []).map(f => dicts.findIndex(d => d[0] === f)).filter(i => i >= 0);
	} catch (e) { /* not remembered */ }
	const isStar = d => stars.includes(d);
	const sortId = d => isStar(d) ? stars.indexOf(d) - 1000 : d + 1;
	const starBtnHTML = d => `<button type="button" class="star-btn" data-d="${d}" onclick="toggleStar(${d})" aria-pressed="${isStar(d)}" title="${isStar(d) ? 'Unstar' : 'Star: show it first'}" aria-label="Star ${escapeHTML(dicts[d][1])}">${isStar(d) ? '★' : '☆'}</button>`;
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
	// Loaded just to translate with (pronunciation), not to search: they
	// stay loaded while the page is open, but out of the results
	const extraLoaded = new Set();
	const pendingLoad = new Map(); // dictionary -> what to do once it's loaded
	function ensureLoaded(d, then){
		if (!dict_master_code[d]) return then();
		if (!pendingLoad.has(d)) pendingLoad.set(d, []);
		pendingLoad.get(d).push(then);
		if (!document.getElementById(`${d}`)?.checked) extraLoaded.add(d);
		loadDict(d);
	}
	const searchMask = () => dicts.map((_, d) => !extraLoaded.has(d) || !!document.getElementById(`${d}`)?.checked);


	function escapeRegExp(string) {
		if(!string)
			return null;
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function cleanup(container){
		container.querySelectorAll('img[src^="blob:"], object[data^="blob:"], audio source[src^="blob:"]').forEach(el => {
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

	function highlightText(html, query) {
			if (!query || !html) return html;
			const escapedQuery = escapeRegExp(query);
			const regex = new RegExp(`(${escapedQuery})`, 'gi');
			return html.replace(/<[^>]+>|([^<]+)/g, (match, textContent) => {
					if (textContent) {
							return textContent.replace(regex, '<mark>$1</mark>');
					}
					return match; // It's a tag → leave unchanged
			});
	}

	let jbig2exports = null;
	let jbig2memory  = null;
	let jbig2LoadingPromise = null;

	function loadJbig2Module() {
		if (jbig2LoadingPromise) return jbig2LoadingPromise;
		jbig2LoadingPromise = WebAssembly.instantiateStreaming(fetch('/jbig2.wasm'), {
			wasi_snapshot_preview1: {
				fd_write:          () => 0,
				fd_seek:           () => 0,
				fd_close:          () => 0,
				proc_exit:         (code) => { throw new Error('wasm exit ' + code); },
				environ_get:       () => 0,
				environ_sizes_get: () => 0,
			},
			env: {
				abort: () => { throw new Error('wasm abort'); },
		__assert_fail:   (msg, file, line, func) => { throw new Error('wasm assert failed'); },
		_abort_js: () => { throw new Error('wasm abort'); },
		_setitimer_js: () => { throw new Error('wasm abort'); },
		_emscripten_runtime_keepalive_clear: () => { throw new Error('wasm abort'); },
		emscripten_resize_heap: () => {throw new Error('wasm abort');},
			},
		}).then(({ instance }) => {
			jbig2exports = instance.exports;
			jbig2memory  = instance.exports.memory;
		});
		return jbig2LoadingPromise;
	}

	async function jbig2to1bpng(binaryData) {
		await loadJbig2Module();

		const inputBytes = binaryData instanceof Uint8Array
			? binaryData
			: new Uint8Array(typeof binaryData === 'string'
					? binaryData.split('').map(c => c.charCodeAt(0))
					: binaryData);

		const { malloc, free,
						jbig2_decode_to_png,
						jbig2_get_result_ptr,
						jbig2_get_result_size,
						jbig2_free_result } = jbig2exports;

		const inputPtr = malloc(inputBytes.length);
		if (!inputPtr) throw new Error('jbig2: malloc failed');
		new Uint8Array(jbig2memory.buffer, inputPtr, inputBytes.length).set(inputBytes);

		jbig2_decode_to_png(inputPtr, inputBytes.length);
		free(inputPtr);

		const resultPtr  = jbig2_get_result_ptr();
		const resultSize = jbig2_get_result_size();
		const out = new Uint8Array(jbig2memory.buffer, resultPtr, resultSize).slice();
		jbig2_free_result();

		return new Blob([out], { type: 'image/png' });
	}

	let codec2exports = null;
	let codec2memory  = null;
	let codec2LoadingPromise = null;

	function loadCodec2Module() {
		if (codec2LoadingPromise) return codec2LoadingPromise;
		codec2LoadingPromise = WebAssembly.instantiateStreaming(fetch('/codec2.wasm'), {
			wasi_snapshot_preview1: {
				proc_exit: (code) => { throw new Error('wasm exit ' + code); },
			},
			env: {
				abort:                  () => { throw new Error('wasm abort'); },
				__assert_fail:          () => { throw new Error('wasm assert failed'); },
				emscripten_resize_heap: () => 0,
			},
		}).then(({ instance }) => {
			codec2exports = instance.exports;
			codec2memory  = instance.exports.memory;
		});
		return codec2LoadingPromise;
	}

	async function codec2toWav(binaryData) {
		await loadCodec2Module();

		const inputBytes = binaryData instanceof Uint8Array
			? binaryData
			: new Uint8Array(typeof binaryData === 'string'
					? binaryData.split('').map(c => c.charCodeAt(0))
					: binaryData);

		const { malloc, free, decode_to_wav } = codec2exports;

		// 700C: bpf=4, spf=320
		const BPF = 4, SPF = 320;
		const headerSize = (inputBytes[0] === 0xc0 && inputBytes[1] === 0xde && inputBytes[2] === 0xc2) ? 7 : 0;
		const numFrames  = Math.floor((inputBytes.length - headerSize) / BPF);
		const outMax     = 44 + numFrames * SPF * 2;

		const inputPtr = malloc(inputBytes.length);
		if (!inputPtr) throw new Error('codec2: malloc failed');
		new Uint8Array(codec2memory.buffer, inputPtr, inputBytes.length).set(inputBytes);

		const outPtr = malloc(outMax);
		if (!outPtr) { free(inputPtr); throw new Error('codec2: malloc failed'); }

		const written = decode_to_wav(inputPtr, inputBytes.length, outPtr, outMax);
		free(inputPtr);

		if (written < 0) {
			free(outPtr);
			throw new Error('codec2: decode_to_wav failed, code ' + written);
		}

		const out = new Uint8Array(codec2memory.buffer, outPtr, written).slice();
		free(outPtr);

		return new Blob([out], { type: 'audio/wav' });
	}

	const queryInput = document.getElementById('queryInput');

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

	const statusDiv  = document.getElementById('status');
	const statusText = statusDiv.querySelector('.st-text');
	const resultsDiv = document.getElementById('results');
	const popupOverlay = document.getElementById('popupOverlay');
	const popupResults = document.getElementById('popupResults');
	const popupClose = document.getElementById('popupClose');

	// Above the results: the big text box for long queries and the
	// starred dictionary's word by word translation.
	const topDiv = document.createElement('div');
	resultsDiv.insertAdjacentElement('beforebegin', topDiv);
	const bigQuery = topDiv.appendChild(document.createElement('textarea'));
	bigQuery.id = 'bigQuery';
	bigQuery.classList.add('hide');
	const translationDiv = topDiv.appendChild(document.createElement('div'));

	// Fullscreen: just the results, no search bar or buttons
	const f4 = document.getElementById('f4');
	f4.addEventListener('click', () => {
		const full = document.body.classList.toggle('fullscreen');
		f4.title = full ? 'Show the search bar' : 'Fullscreen';
	});

	// Small screens: the header's buttons are in a menu (☰)
	const menuBtn = document.getElementById('menuBtn');
	const headMenu = document.getElementById('headMenu');
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
	const isBibleText = d => files[d].category.join('/') === 'bible/text';
	const hasBible = files.some((_, d) => isBibleText(d));
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
		const d = dicts.map((_, i) => i).filter(isBibleText).sort((a, b) => mask[b] - mask[a] || sortId(a) - sortId(b))[0];
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
			return `<button type="button" class="text-btn" data-books-back="1">‹ All books</button><h3 class="drawer-h">${escapeHTML(b.name)}</h3>` +
				`<div class="bk-grid ch">${Array.from({length: b.n}, (_, i) => `<button type="button" data-read="${ref(i + 1)}"${at === ref(i + 1) ? ' aria-current="true"' : ''}>${num(i + 1)}</button>`).join('')}</div>`;
		}
		return `<div class="bk-grid">${books.map(x => `<button type="button" data-book="${escapeHTML(x.code)}"${at?.startsWith(x.code.toLowerCase() + ' ') ? ' aria-current="true"' : ''}>${escapeHTML(x.name)}</button>`).join('')}</div>`;
	}
	// Bible mode (a Bible category picked, or a Bible page): the Books button
	const bibleMode = () => hasBible && (pParts.includes('bible') || selected.some(id => id.startsWith('bible')));

	// ---------------------------------------------------------------
	// The header's second line: the language, and quick switches for what
	// a search uses (the filter's categories). It hides while scrolling
	// down, and comes back scrolling up.
	// ---------------------------------------------------------------
	const header = document.getElementById('header');
	const langBtn = document.getElementById('langBtn');
	const quick = document.getElementById('quick');
	const curLang = pLangParts[0] || pParts[0] || '';
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
		if (!filtered()) return dicts.filter((_, d) => document.getElementById(`${d}`)?.checked).length;
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(`peakslab-dicts-${appname}`)); } catch (e) { /* not remembered */ } // lsGet's
		const savedMap = new Map((Array.isArray(saved) ? saved : []).map(item => [item.file, !!item.enabled]));
		return dicts.filter((dict, d) => savedMap.has(dict[0]) ? savedMap.get(dict[0]) : defaultOn(d)).length;
	}
	// Everything, the top-level categories (and any picked sub-category),
	// then the whole filter
	function renderQuick(){
		const btn = (attrs, label, on, n) => `<button type="button" class="qk" ${attrs} aria-pressed="${on}">${escapeHTML(label)}${n !== undefined ? ` <span class="n">${n}</span>` : ''}</button>`;
		const html = (bibleMode() ? '<button type="button" class="qk qk-books" data-qbooks="1">Books ›</button>' : '') +
			btn('data-qall="1"', 'Everything', !filtered(), everythingCount()) +
			cats.filter(c => !c.sub || selected.includes(c.id)).map(c => btn(`data-qsel="${c.id}"`, c.label, selected.includes(c.id), selected.includes(c.id) ? catChosen(c).size : undefined)).join('') +
			'<button type="button" class="qk qk-more" data-qmore="1">Filter…</button>';
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
		else if (b.dataset.qsel) setFilter(selected.includes(b.dataset.qsel) ? selected.filter(x => x !== b.dataset.qsel) : [...selected, b.dataset.qsel]);
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
	const historyKey = `peakslab-history-${appname}`;
	const bookmarksKey = `peakslab-bookmarks-${appname}`;
	const readList = k => { try { const l = JSON.parse(localStorage.getItem(k)); return Array.isArray(l) ? l : []; } catch (e) { return []; } };
	const writeList = (k, l) => { try { localStorage.setItem(k, JSON.stringify(l)); } catch (e) { /* not remembered */ } };
	let searchHistory = readList(historyKey); // [{q, t}], newest first
	let bookmarks = readList(bookmarksKey);   // [{w, g, t}], newest first
	const HISTORY_MAX = 200;

	// A search goes in the history once typing stops on it with something
	// found. Typing on from the last one (kh, khm, khmer) replaces it.
	function addHistory(q){
		q = q.trim();
		if (!q) return;
		const now = Date.now();
		const last = searchHistory[0];
		if (last && now - last.t < 60000 && (q.startsWith(last.q) || last.q.startsWith(q))) searchHistory.shift();
		searchHistory = [{q, t: now}, ...searchHistory.filter(h => h.q !== q)].slice(0, HISTORY_MAX);
		writeList(historyKey, searchHistory);
	}
	const historyTimer = debounce(() => {
		if (queryText.trim() && (num > 0 || translationDiv.childElementCount)) addHistory(queryText);
	}, 1500);

	const headwordOf = pd => (pd.querySelector(':scope > h2 .hw')?.textContent || '').trim();
	const isBookmarked = w => bookmarks.some(b => b.w === w);
	function markBookmark(pd){
		const b = pd.querySelector(':scope > h2 .bm-btn');
		if (!b) return;
		const on = isBookmarked(headwordOf(pd));
		b.setAttribute('aria-pressed', on);
		b.title = on ? 'Remove bookmark' : 'Bookmark';
	}
	// The first line of a section's first entry, kept with the bookmark
	function glossOf(pd){
		const pe = pd.querySelector(':scope > p-e');
		const line = pe ? entryText(pe).split('\n').find(x => x && !/^(\[[^\]]*\]+\s*)+$/.test(x)) || '' : '';
		return line.length > 120 ? line.slice(0, 119) + '…' : line;
	}
	function setBookmark(w, on, g = ''){
		bookmarks = bookmarks.filter(b => b.w !== w);
		if (on) bookmarks.unshift({w, g, t: Date.now()});
		writeList(bookmarksKey, bookmarks);
		document.querySelectorAll('#results > p-d, #popupResults > p-d').forEach(markBookmark);
		renderHome();
	}
	window.toggleBookmark = btn => {
		const pd = btn.closest('p-d');
		const w = headwordOf(pd);
		if (!w) return;
		setBookmark(w, !isBookmarked(w), glossOf(pd));
		if (pd.closest('#results')) addHistory(queryText);
	};

	function timeAgo(t){
		const m = Math.round((Date.now() - t) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m} min ago`;
		const h = Math.round(m / 60);
		if (h < 24) return `${h} h ago`;
		const d = Math.round(h / 24);
		return d < 7 ? `${d} d ago` : new Date(t).toLocaleDateString();
	}
	const historyRow = h => `<li class="row"><button type="button" class="row-main" data-q="${escapeHTML(h.q)}"><span class="row-w">${escapeHTML(h.q.replace(/\n/g, ' '))}</span><span class="row-t">${timeAgo(h.t)}</span></button><button type="button" class="row-x" data-rmh="${escapeHTML(h.q)}" title="Remove" aria-label="Remove ${escapeHTML(h.q)} from history">✕</button></li>`;
	const bookmarkRow = b => `<li class="row"><button type="button" class="row-main" data-q="${escapeHTML(b.w)}"><span class="row-w">${escapeHTML(b.w)}</span>${b.g ? `<span class="row-g">${escapeHTML(b.g)}</span>` : ''}</button><button type="button" class="row-x" data-rmb="${escapeHTML(b.w)}" title="Remove" aria-label="Remove the bookmark for ${escapeHTML(b.w)}">✕</button></li>`;
	const historyHTML = list => list.length ? `<ul class="rows">${list.map(historyRow).join('')}</ul>` : '<p class="empty">Words you look up show up here.</p>';
	const bookmarksHTML = list => list.length ? `<ul class="rows">${list.map(bookmarkRow).join('')}</ul>` : '<p class="empty">Tap the bookmark next to a word to keep it here.</p>';

	// The side panel for the whole history or all the bookmarks
	const drawer = document.getElementById('drawer');
	const drawerBody = drawer.querySelector('.drawer-body');
	let drawerView = null;
	const expandedCats = new Set(); // Filter categories opened to show their dictionaries
	function renderDrawer(){
		if (drawerView === 'history') {
			drawer.querySelector('.drawer-title').textContent = 'History';
			drawerBody.innerHTML = historyHTML(searchHistory) +
				(searchHistory.length ? '<button type="button" class="text-btn" data-clear="history">Clear history</button>' : '');
		} else if (drawerView === 'bookmarks') {
			drawer.querySelector('.drawer-title').textContent = 'Bookmarks';
			drawerBody.innerHTML = bookmarksHTML(bookmarks);
		} else if (drawerView === 'books') {
			drawer.querySelector('.drawer-title').textContent = 'Books';
			drawerBody.innerHTML = booksHTML();
			drawerBody.scrollTop = 0;
		} else if (drawerView === 'lang') {
			drawer.querySelector('.drawer-title').textContent = 'Language';
			drawerBody.innerHTML = langHTML();
		} else if (drawerView === 'modes') {
			drawer.querySelector('.drawer-title').textContent = 'Filter';
			const scroll = drawerBody.scrollTop;
			const cat = c => {
				const chosen = catChosen(c);
				const open = expandedCats.has(c.id);
				return `<li class="cat${c.sub ? ' sub' : ''}"><div class="cat-row">` +
					`<button type="button" class="cat-sel check" data-sel="${c.id}" aria-pressed="${selected.includes(c.id)}"><span class="row-w">${escapeHTML(c.label)}</span><span class="row-t">${chosen.size} of ${c.members.length} on</span></button>` +
					`<button type="button" class="cat-exp" data-exp="${c.id}" aria-expanded="${open}" title="Choose its dictionaries" aria-label="Choose the dictionaries in ${escapeHTML(c.label)}">▸</button></div>` +
					(open ? `<div class="cat-body"><ul class="cat-dicts">${c.members.map(d =>
						`<li><button type="button" class="cat-dict check" data-cat="${c.id}" data-d="${d}" aria-pressed="${chosen.has(d)}">` +
						`<span class="cd-name">${escapeHTML(dicts[d][1])}</span>${typeOf(d) ? `<span class="lib-type type-${typeOf(d)}">${escapeHTML(typeLabel(d))}</span>` : ''}</button></li>`).join('')}</ul>` +
						`<div class="cat-acts"><button type="button" class="text-btn" data-cat-all="${c.id}">All</button><button type="button" class="text-btn" data-cat-none="${c.id}">None</button><button type="button" class="text-btn" data-cat-reset="${c.id}">Reset</button></div></div>` : '') +
					'</li>';
			};
			const group = (g, title) => {
				const cs = cats.filter(c => c.group === g);
				return cs.length ? `<h3 class="drawer-h">${title}</h3><ul class="rows cats">${cs.map(cat).join('')}</ul>` : '';
			};
			drawerBody.innerHTML =
				`<ul class="rows"><li class="row"><button type="button" class="row-main radio" data-everything="1" aria-pressed="${!filtered()}"><span class="row-w">Everything</span><span class="row-t">${everythingCount()} of ${dicts.length} on in the library</span></button></li></ul>` +
				group('kind', 'By kind') + group('language', 'By language') +
				'<p class="empty">Pick as many as you like. Open one (▸) to choose which of its dictionaries it uses.</p>';
			drawerBody.scrollTop = scroll;
		}
	}
	function openDrawer(view){
		if (drawerView === view) return closeDrawer();
		drawerView = view;
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
	const homeDiv = document.getElementById('home');
	function renderHome(){
		const more = (n, view) => n > 5 ? `<button type="button" class="text-btn" data-open="${view}">All ${n}</button>` : '';
		homeDiv.innerHTML =
			`<section><h2>Recent</h2>${historyHTML(searchHistory.slice(0, 5))}${more(searchHistory.length, 'history')}</section>` +
			`<section><h2>Bookmarks</h2>${bookmarksHTML(bookmarks.slice(0, 5))}${more(bookmarks.length, 'bookmarks')}</section>`;
		if (drawerView) renderDrawer();
	}
	// Rows in both: tap one to look it up, ✕ to remove it
	function rowClick(e){
		const b = e.target.closest('button');
		if (!b) return;
		const c = catById(b.dataset.sel || b.dataset.exp || b.dataset.cat || b.dataset.catAll || b.dataset.catNone || b.dataset.catReset);
		if (b.dataset.book) {
			booksPick = b.dataset.book;
			renderDrawer();
		} else if (b.dataset.booksBack) {
			booksPick = null;
			renderDrawer();
		} else if (b.dataset.read) {
			closeDrawer();
			search(b.dataset.read);
		} else if (b.dataset.everything) {
			setFilter([]);
		} else if (b.dataset.sel) {
			setFilter(selected.includes(c.id) ? selected.filter(x => x !== c.id) : [...selected, c.id]);
		} else if (b.dataset.exp) {
			if (expandedCats.has(c.id)) expandedCats.delete(c.id); else expandedCats.add(c.id);
			renderDrawer();
		} else if (c && (b.dataset.cat || b.dataset.catAll || b.dataset.catNone || b.dataset.catReset)) {
			// Changing a category's dictionaries
			if (b.dataset.catReset) {
				try { localStorage.removeItem(catStoreKey(c.id)); } catch (e) { /* not remembered */ }
			} else {
				const set = b.dataset.catAll ? new Set(c.members) : b.dataset.catNone ? new Set() : catChosen(c);
				if (b.dataset.cat) { const d = +b.dataset.d; if (set.has(d)) set.delete(d); else set.add(d); }
				setCatChosen(c, set);
			}
			if (selected.includes(c.id)) refilter();
			else renderDrawer();
		} else if (b.dataset.q !== undefined) {
			closeDrawer();
			setQueryText(b.dataset.q);
			startSearch();
			addHistory(b.dataset.q);
		} else if (b.dataset.rmh !== undefined) {
			searchHistory = searchHistory.filter(h => h.q !== b.dataset.rmh);
			writeList(historyKey, searchHistory);
			renderHome();
		} else if (b.dataset.rmb !== undefined) {
			setBookmark(b.dataset.rmb, false);
		} else if (b.dataset.clear) {
			if (!confirm('Clear the whole history?')) return;
			searchHistory = [];
			writeList(historyKey, searchHistory);
			renderHome();
		} else if (b.dataset.open) {
			openDrawer(b.dataset.open);
		}
	}
	drawerBody.addEventListener('click', rowClick);
	homeDiv.addEventListener('click', rowClick);

	// ---------------------------------------------------------------
	// Library: every dictionary on this page, grouped by full category path
	// (language folder + category, e.g. "khmer / music / chords"), each
	// segment of its heading a link. Extras from other languages get a small
	// heading within the group. Each one has its on/off switch, its star,
	// and what kind of dictionary it is (Khmer, Khmer → English, ...).
	// ---------------------------------------------------------------
	let temp = `<h2>Library<span id="libMode"></span></h2><p class="lib-help">Turn dictionaries on or off. Star the ones you use most: their entries come first.</p><ol class="dictlist">`;

	let prevGroupKey = null;
	let prevLang = null;
	dicts.forEach((dict, idx) => {
		const { category, isPrimary, lang } = files[idx];
		const fullPath = [...pLangParts, ...category];
		const groupKey = fullPath.join('/');

		if (groupKey !== prevGroupKey) {
			const crumbs = fullPath
				.map((seg, i) => `<a href="/${fullPath.slice(0, i + 1).join('/')}" class="dictlist-crumb">${seg}</a>`)
				.join('<span class="dictlist-crumb-sep"> / </span>');
			temp += `<li class="dictlist-item dictlist-head"><h3 class="dictlist-crumbs">${crumbs}</h3></li>`;
			prevGroupKey = groupKey;
			prevLang = null; // new group — restart language grouping for extras
		}

		if (!isPrimary && lang !== prevLang) {
			temp += `<li class="dictlist-extra-label">${cap(lang)}</li>`;
		}
		prevLang = isPrimary ? null : lang; // next extra language (or the primary again) gets its own header

		const type = typeOf(idx);
		temp += `<li class="dictlist-item dictlist-file" data-id="${dict[0]}" data-idx="${idx}">` +
			`<input type="checkbox" class="fcheckbox down" data-id="${idx}"${dict[4] ? " checked" : ""} onchange="updateDictList(this)" id="${idx}"><label for="${idx}" class="modern-toggle" title="On or off"><span class="toggle-switch"></span></label>` +
			starBtnHTML(idx) +
			`<span class="lib-main"><span class="lib-name"><strong>${dict[1]}</strong>` +
			(type ? ` <span class="lib-type type-${type}">${escapeHTML(typeLabel(idx))}</span>` : '') +
			(dict[2] ? ` <span class="lib-size">${sizeText(dict[2])}</span>` : '') +
			` <a href="?dict=${encodeURIComponent(dict[1])}" class="dictlist-solo" title="Open ${dict[1]} on its own">↗</a></span>` +
			`<span class="lib-desc">${dict[3]}</span></span></li>`;
	});
	temp += `</ol>`;
	let listDiv = document.getElementById('listDiv');
	listDiv.innerHTML += temp;
	renderHome();
	const filterBtn = document.getElementById('filterBtn');
	const libMode = document.getElementById('libMode');
	updateFilterUI();

	ack = function(url){
		const x = dicts.findIndex(y => y[0] == url);
		if(x >= 0){
			const y = document.getElementById(`${x}`)
			y.classList.remove('down');
			y.disabled = false;
		}
	}

	// Which dictionaries are enabled is remembered in localStorage. If that
	// doesn't work (some privacy modes, in-app webviews) the defaults load
	// and the page works normally; it just won't remember.
	// The library's choices (Everything); the filter's categories keep theirs
	// separately (catChosen)
	const lsKey = () => `peakslab-dicts-${appname}`;

	function lsGet() {
		try { return JSON.parse(localStorage.getItem(lsKey())); } catch (e) { return null; }
	}
	function lsSet(state) {
		try { localStorage.setItem(lsKey(), JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
	}

	// The saved choices (an array, or null for the defaults)
	function applyState(saved) {
		if (solo >= 0) { // Leaves the saved choices alone for the normal page
			dicts.forEach((_, index) => setCheckbox(index, index === solo));
			loadDict(solo);
			return;
		}
		if (filtered()) applyFilter();
		else enableSaved(saved);
	}

	// Turns these dictionaries on (loads them) and the rest off
	function enableSet(want){
		want.forEach((on, d) => {
			setCheckbox(d, on);
			if (on) loadDict(d);
			else if (!dict_master_code[d] && !extraLoaded.has(d)) unloadDict(d);
		});
		renderQuick();
	}

	// Loads the saved choices (or the defaults), and unloads the rest.
	function enableSaved(saved) {
		const savedMap = new Map((Array.isArray(saved) ? saved : []).map(item => [item.file, !!item.enabled]));
		enableSet(dicts.map((dict, d) => savedMap.has(dict[0]) ? savedMap.get(dict[0]) : defaultOn(d)));
	}

	// The picked categories' dictionaries, or the library's choices
	function applyFilter(){
		if (!filtered()) return enableSaved(lsGet());
		const on = new Set(selCats().flatMap(c => [...catChosen(c)]));
		enableSet(dicts.map((_, d) => on.has(d)));
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
		try { localStorage.setItem(filterKey, JSON.stringify(selected)); } catch (e) { /* not remembered */ }
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
		document.querySelectorAll('.dictlist-head, .dictlist-extra-label').forEach(h => {
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

	applyState(lsGet());

	function saveState() {
		if (solo >= 0 || filtered()) return; // A filter's choices are its categories'

		const state = dicts.map((dict, index) => ({
			file: dict[0],                    // filename as stable key
			enabled: !!document.getElementById(index)?.checked
		}));
		lsSet(state);
	}

	function setCheckbox(index, checked){
		const checkbox = document.getElementById(index);
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
					const w = workers[i % workers.length];
					const did = Math.floor(i / workers.length);
					++nload;
					updateStatus();
					// The worker reads it from the offline cache itself (off this
					// thread), or asks for it with 'needbytes' if there's no
					// current copy there.
					w.postMessage({type: 'load', did, msg: dicts[i], timestamp: files[i].file[1]});
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
		workers[d%workers.length].postMessage({type: 'destroy', did: Math.floor(d/workers.length)});
		dict_master_code[d] = true;
	}

	function updateDictList(checkbox){
		const d = parseInt(checkbox.dataset.id);
		if (filtered()) setInFilter(d, checkbox.checked);
		if(checkbox.checked){
			loadDict(d);
		}else{
			unloadDict(d);
			saveState();
		}
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
		if (solo < 0) writeList(starKey, stars.map(d => dicts[d][0]));
		updateStarUI();
		query = ""; // Search again
		startSearch();
	}
	window.toggleStar = toggleStar;

	// The address bar always holds a link to what's on screen.
	function updateURL(){
		const p = new URLSearchParams();
		if (solo >= 0) p.set('dict', dicts[solo][1]);
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
		let temp_dict_code = searchMask();
		if (entry) // The entry a translated word came from
			addResult({id: entry.d % workers.length + 1, did: Math.floor(entry.d / workers.length), dict: dicts[entry.d][1],
				query: updateQuery(text), st: 1, header: entry.header, body: entry.body, dest: "popup"});
		workers.forEach((w, i) =>{
			let code = temp_dict_code.filter((_, index) => index % workers.length == i);
			w.postMessage({type: "tempsearch", st: 1, query: updateQuery(text), dest: "popup", dicts: code});
			w.postMessage({type: "tempsearch", st: 2, query: updateQuery(text), dest: "popup", dicts: code});
		});
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

	function updateQuery(text = queryText){
		if (!text) {
				return null;
		}
		text = text.toLowerCase().replaceAll("​", "").replaceAll("\\t", "\t");
		return text;
	}

	function setQuery(){
		workers.forEach((w, i) =>{
			let code = dict_code.filter((_, index) => index % workers.length == i);
			if(code.includes(true)){
				w.postMessage({type: "setquery", query: query});
			}
		});
	}

	let showLibrary = false;
	function showSettings(){
		loader = null;
		updateStatus('');
		statusDiv.classList.add('hide');
		renderHome();
		settings.style.display = 'block';
		settings.classList.toggle('library', showLibrary);
		showLibrary = false;
		resultsDiv.replaceChildren();
		translationDiv.replaceChildren();
	}

	// The worker's indexes for the starred dictionaries that worker i has,
	// which it searches first
	function starDids(i){
		return stars.filter(d => d % workers.length == i).map(d => Math.floor(d / workers.length));
	}

	let searchGen = 0;
	function initSearch(){
		num = 0;
		++searchGen;
		workers.forEach((w, i) =>{
			let code = dict_code.filter((_, index) => index % workers.length == i);
			w.postMessage({type: "initsearch", st: st, dicts: code, focus: starDids(i), gen: searchGen});
			if(code.includes(true)){
				w.postMessage({type: "getresults"});
				worker_code[i] = false;
			}
			else{
				worker_code[i] = true;
			}
		});
	}

	function continueSearch(){
		workers.forEach((w, i) =>{
			let code = dict_code.filter((_, index) => index % workers.length == i);
			if(code.includes(true)){
				w.postMessage({type: "continuesearch", st: st, focus: starDids(i)});
				w.postMessage({type: "getresults"});
				worker_code[i] = false;
			}
			else{
				worker_code[i] = true;
			}
		});
	}


	function wantloadmore(el, offset=400){
		if(!el) return false;
		const rect = el.getBoundingClientRect();
		return rect.top <= window.innerHeight + offset;
	}

	function loadmore(){
		// (A chapter: all of it.) Nothing searched: nothing to load
		if(query && (chapterOf(query + '1') === query || wantloadmore(loader, 400)) && worker_code.includes(false))
			getResults();
	}

	function throttle(fn, delay=80){
		let lastCall = 0;
		return function(...args){
			const now = Date.now();
			if(now - lastCall >= delay){
				lastCall = now;
				fn.apply(this, args);
			}
		}
	}

	const throttledCheck = throttle(loadmore, 80);
	window.addEventListener('scroll', throttledCheck, { passive: true });
	window.addEventListener('resize', throttledCheck);

	const globreg = /[!+*^]/;

	// The query word by word, when the search found nothing: with every
	// dictionary searched (starred first; not media) and a pronunciation
	// one. A Bible text's headwords are its verses, so "rom 8.1 gal 1.1"
	// links to each.
	function translate(){
		if (globreg.test(query)) return;
		const mask = searchMask();
		const ids = dicts.map((_, i) => i).filter(i => mask[i] && canTranslate(i) && !isPhon(i)).sort((a, b) => sortId(a) - sortId(b));
		const p = phonTranslator();
		if (p >= 0) ids.push(p);
		const q = query;
		if (ids.length) translateText(ids, q, pieces => showTranslation(pieces, q));
	}

	// An entry as one line of plain text, without lines that are only
	// [pronunciations] or [[see also]]s (h97's second column)
	function summary(html){
		const t = document.createElement('template');
		t.innerHTML = html.replace(/<br\s*\/?>|<\/?(li|p|div|ul|ol)(?=[\s/>])[^>]*>|\t/gi, '\n');
		return t.content.textContent.split('\n').map(x => x.trim()).filter(x => x && !/^(\[[^\]]*\]+\s*)+$/.test(x)).join(' ');
	}

	function showTranslation(pieces, q){
		if (q !== query || num || !pieces.some(p => p.entry)) return;
		const used = [...new Set(pieces.map(p => p.d).filter(d => d !== undefined))]; // The ones it came from
		const div = document.createElement('p-d');
		div.className = 'translation';
		div.innerHTML = `<h2>${used.map(i => escapeHTML(dicts[i][1])).join(' + ')}</h2>` + translationHTML(pieces);
		translationDiv.replaceChildren(div);
		addAudio(div, pieces);
		updateStatus('No entry for all of it, translated word by word.');
		queryInput.classList.remove('error');
	}

	const canTranslate = i => !dict_master_code[i] && !dicts[i][0].includes('.slab');
	const isPhon = i => typeOf(i) === 'phon' && !dicts[i][0].includes('.slab');
	// The dictionary for the default choice: the first starred one that can
	// translate, else the first loaded one to English, else any loaded one
	function mainTranslator(){
		const ok = i => canTranslate(i) && !isPhon(i);
		const starred = stars.find(ok);
		if (starred !== undefined) return starred;
		const bi = dicts.findIndex((_, i) => ok(i) && typeOf(i) === 'bi');
		return bi >= 0 ? bi : dicts.findIndex((_, i) => ok(i));
	}
	// The pronunciation one: g2k if it's here
	const phonTranslator = () => { const ps = dicts.map((_, i) => i).filter(isPhon); return ps.find(i => dicts[i][1] === 'g2k') ?? ps[0] ?? -1; };

	// An entry's text, a line per line (or list item, paragraph, ...),
	// without its labels (p-n: parts of speech, a verse's reference, ...)
	function entryText(pe){
		const c = pe.cloneNode(true);
		c.querySelectorAll('p-h, p-n, button, .vs-n, .tr-entry, .tr-pick').forEach(x => x.remove());
		const t = document.createElement('template');
		t.innerHTML = c.innerHTML.replace(/<br\s*\/?>|<\/?(li|p|div|ul|ol|h[1-6]|p-ipa)(?=[\s/>])[^>]*>|\t/gi, '\n');
		return t.content.textContent.split('\n').map(x => x.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
		pieces.forEach(p => {
			p.prons = [];
			if (!p.w) return;
			p.entry = best(words, p);
			const pr = best(phons, p);
			const parts = pr ? [] : splitText(phons.filter(x => x.a >= p.a && x.a + x.len <= p.b), p.a, p.b);
			p.prons = pr ? [pr] : parts.every(q => q.w) ? parts.map(q => q.w) : [];
		});
		const byDict = new Map();
		pieces.forEach(p => [p.entry, ...p.prons].forEach(x => { if (x) byDict.set(x.d, [...(byDict.get(x.d) || []), x]); }));
		const finish = () => done(pieces.map(p => ({
			text: text.slice(p.a, p.b),
			d: p.w?.d,
			entry: p.entry?.r,
			pron: p.prons.map(x => x.r && summary(x.r.body)).filter(Boolean),
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
			const pron = !latin(p.text) && p.pron.length ? `<span class="tr-p">${escapeHTML(p.pron.join(' '))}</span>` : '';
			const gloss = p.entry ? escapeHTML(p.entry.sec ? p.entry.header : summary(p.entry.body)) : '';
			return `<span class="tr-w${p.entry ? '' : ' tr-u'}" data-w="${escapeHTML(p.text.trim())}" title="${escapeHTML(dicts[p.entry ? p.entry.d : p.d][1])}">` +
				`<p-a${p.entry ? ` data-e="${popupEntries.push(p.entry) - 1}"` : ''}>${escapeHTML(p.text.trim())}</p-a>${pron}` +
				(gloss ? `<span class="tr-g" title="${gloss}">${gloss}</span>` : '') + '</span>';
		}).join('');
	}

	// A word's recording, if a media dictionary that's loaded has one: a 🔊
	// in its box plays it (no player)
	const AUDIO = /webm|ogg|opus|mp3|wav|m4a|codec2|c2/i;
	function addAudio(box, pieces){
		const words = [...new Set(pieces.filter(p => p.d !== undefined).map(p => p.text.trim()))];
		if (!words.length) return;
		dicts.forEach((_, d) => {
			if (!dicts[d][0].includes('.slab') || dict_master_code[d] || typeOf(d) !== 'aux') return;
			askDict(d, {type: 'media', words}, r => r.files.forEach((f, k) => {
				if (!f || !f[1] || !AUDIO.test(f[0])) return;
				box.querySelectorAll(`.tr-w[data-w="${CSS.escape(words[k])}"]:not(.has-audio)`).forEach(w => {
					w.classList.add('has-audio');
					const b = w.appendChild(document.createElement('button'));
					b.type = 'button';
					b.className = 'tr-play';
					b.title = b.ariaLabel = 'Play';
					b.textContent = '🔊';
					b.onclick = e => { e.stopPropagation(); playAudio(f[0], f[1]); };
				});
			}));
		});
	}
	function playAudio(type, bytes){
		const blob = /codec2|c2/i.test(type) ? codec2toWav(bytes) : Promise.resolve(new Blob([bytes], {type: /webm/i.test(type) ? 'audio/webm' : 'audio/' + type.toLowerCase()}));
		blob.then(b => {
			const a = new Audio(URL.createObjectURL(b));
			a.onended = () => URL.revokeObjectURL(a.src);
			a.play();
		});
	}

	function translateEntryWith(box, text, ids){
		const key = ids.join();
		box.dataset.ids = key;
		box.textContent = `Translating with ${ids.map(i => dicts[i][1]).join(' + ')}…`;
		translateText(ids, updateQuery(text), pieces => {
			if (!box.isConnected || box.dataset.ids !== key) return;
			box.innerHTML = `<div class="tr-head">${ids.map(i => escapeHTML(dicts[i][1])).join(' + ')}</div>` +
				(pieces.some(p => p.d !== undefined) ? translationHTML(pieces) : 'No words found.');
			addAudio(box, pieces);
		});
	}

	// The ⇄ button on an entry (or verse) asks which dictionaries to
	// translate its text with, every time, any number at once: the ones that
	// are on, pronunciation ones, and (loaded when used) the ones that are
	// off. It starts with the last choice, or a dictionary and g2k. Tap ⇄
	// again to hide it.
	const trWithKey = `peakslab-translate-${appname}`;
	// Ties go to starred dictionaries, then the library's order;
	// pronunciation ones last
	const trOrder = ids => [...ids].sort((a, b) => isPhon(a) - isPhon(b) || (isStar(a) ? stars.indexOf(a) : 1e6 + a) - (isStar(b) ? stars.indexOf(b) : 1e6 + b));
	function lastTrWith(){
		try {
			const saved = JSON.parse(localStorage.getItem(trWithKey));
			const ids = (Array.isArray(saved) ? saved : []).map(f => dicts.findIndex(d => d[0] === f)).filter(i => i >= 0 && !dicts[i][0].includes('.slab'));
			if (ids.length) return ids;
		} catch (e) { /* not remembered */ }
		return [mainTranslator(), phonTranslator()].filter(i => i >= 0);
	}
	window.translateEntry = btn => {
		const pe = btn.closest('p-e, .vs');
		const open = pe.querySelectorAll('.tr-entry, .tr-pick');
		if (open.length) {
			open.forEach(x => x.remove());
			return;
		}
		const text = entryText(pe);
		const chosen = new Set(lastTrWith());
		// Not media or Bible texts (verse references aren't words)
		const usable = dicts.map((_, i) => i).filter(i => !dicts[i][0].includes('.slab') && files[i].category.join('/') !== 'bible/text');
		const on = usable.filter(i => canTranslate(i) && !isPhon(i));
		const phons = usable.filter(isPhon);
		const off = usable.filter(i => !on.includes(i) && !phons.includes(i));
		const opt = i => `<button type="button" class="check" data-idx="${i}" aria-pressed="${chosen.has(i)}">${isStar(i) ? '★ ' : ''}${escapeHTML(dicts[i][1])}</button>`;
		const pick = document.createElement('div');
		pick.className = 'tr-pick';
		pick.innerHTML = '<div class="tr-q">Translate with <button type="button" class="tr-go">Translate</button></div>' +
			(on.length ? `<div class="tr-sub">On</div>${on.map(opt).join('')}` : '') +
			(phons.length ? `<div class="tr-sub">Pronunciation</div>${phons.map(opt).join('')}` : '') +
			(off.length ? `<details${off.some(i => chosen.has(i)) ? ' open' : ''}><summary class="tr-sub">Off (loads when used)</summary>${off.map(opt).join('')}</details>` : '');
		btn.insertAdjacentElement('afterend', pick);
		pick.scrollIntoView({block: 'nearest'});
		const goBtn = pick.querySelector('.tr-go');
		const update = () => { goBtn.disabled = !pick.querySelector('.check[aria-pressed="true"]'); };
		update();
		goBtn.focus({preventScroll: true});
		pick.onclick = e => {
			const b = e.target.closest('button');
			if (!b) return;
			e.stopPropagation(); // A button going away would look like a click outside the popup
			if (b.dataset.idx) {
				b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
				update();
				return;
			}
			const ids = trOrder([...pick.querySelectorAll('.check[aria-pressed="true"]')].map(x => +x.dataset.idx));
			if (!ids.length) return;
			try { localStorage.setItem(trWithKey, JSON.stringify(ids.map(i => dicts[i][0]))); } catch (e) { /* not remembered */ }
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

		setQuery()
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

	window.addEventListener('load', requestCacheVersion);

	document.addEventListener('touchend', function(e) {
		const active = document.activeElement;

		if (!active || !['INPUT','TEXTAREA'].includes(active.tagName)) {
			return;
		}
		let touchedInside = false;
		let el = e.target;

		while (el && el !== document.body) {
			if (el === active) {
				touchedInside = true;
				break;
			}
			el = el.parentElement;
		}
		if (!touchedInside) {
			active.blur();
		}
	}, false);   // use capture=false so it runs after other handlers

	let fontSize = parseInt(localStorage.getItem('fontSize')) || 16;
	document.documentElement.style.setProperty('--font-size', fontSize + 'px');

	function updateFontSize() {
			document.documentElement.style.setProperty('--font-size', fontSize + 'px');
			localStorage.setItem('fontSize', fontSize);
	}

	document.getElementById('fontIncrease')?.addEventListener('click', () => {
			fontSize = Math.min(fontSize + 2, 32);
			updateFontSize();
	});

	document.getElementById('fontDecrease')?.addEventListener('click', () => {
			fontSize = Math.max(fontSize - 2, 12);
			updateFontSize();
	});

	// Dark mode
	document.getElementById('darkT')?.addEventListener('click', () => {
			document.body.classList.toggle('dark-mode');
			localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
	});
	if (localStorage.getItem('darkMode') === 'true') {
			document.body.classList.add('dark-mode');
	}
	document.getElementById('markT')?.addEventListener('click', () => {
			mark = !mark;
			localStorage.setItem('mark', mark);
	});
	if (localStorage.getItem('mark') === 'false') {
		mark = false;
	}

	document.getElementById('debugT')?.addEventListener('click', () => {
			debug = !debug;
	});

	// Library button: the library and settings, instead of the home page
	// (what was searched is in the history)
	document.getElementById('settingsBtn')?.addEventListener('click', () => {
		closeDrawer();
		showLibrary = true;
		setQueryText('');
		query = null; // (shows it even if nothing was searched)
		startSearch();
		window.scrollTo(0, 0);
	});

	let voicetries = 2;
	let voices = [];
	let selMenu = null;
	function createSelMenu(){
		if(selMenu)
			selMenu.remove();
		selMenu = document.createElement('div')
		document.body.appendChild(selMenu);
		// On iOS the native Copy/Look Up menu is always drawn on top of page
		// content, right next to the selection - exactly where our menu
		// went, so it was covered and unusable. Dock ours at the bottom of
		// the screen instead: iOS puts its menu above the selection whenever
		// there's room, so the bottom edge is the one place it doesn't go.
		selMenu.className = isIOS() ? 'selection-menu docked' : 'selection-menu';
		selMenu.innerHTML = `<button data-action="search-current">🔍Search</button><button data-action="search-popup">🔍Popup</button>`;
		voices = speechSynthesis.getVoices();
		if(voices.length > 0){
			if (typeof lang !== "undefined") {
				lang.forEach(x => {
					if(voices.some(voice => voice.lang.toLowerCase().startsWith(x.val.split('_')[0])))
						selMenu.innerHTML += `<button data-action="speak-${x.val}">🔊 ${x.name}</button>`;
				});
			}
		}
		selMenu.addEventListener('click', function(e) {
			const text = selText;
			if (e.target.tagName === 'BUTTON') {
				const action = event.target.dataset.action;
				if (action.startsWith('speak-')) {
					const u = new SpeechSynthesisUtterance(text);
					u.lang = action.replace('speak-', '');
					speechSynthesis.speak(u);
				}else if (action === 'search-current') {
					setQueryText(text);
					startSearch();
				} else if (action === 'search-popup') {
					openPopupSearch(text);
				}
				hideSelMenu();
				window.getSelection().removeAllRanges();
			}
		});
	}

	function getSelRect(){
		const sel = window.getSelection();
		if(sel.rangeCount === 0 || sel.isCollapsed) return null;
		return sel.getRangeAt(0).getBoundingClientRect();
	}
	let selText = "";
	function showSelMenu() {
		const rect = getSelRect();
		if(!rect) return;

		if(!selMenu || (voices.length < 2 && voicetries-- > 0)){
			createSelMenu();
		}

		selText = window.getSelection().toString().trim();

		if (selMenu.classList.contains('docked')) {
			document.body.classList.add('selmenu-docked'); // hides the round buttons it would cover
		} else {
			selMenu.style.top = `${rect.bottom + 26 + window.scrollY}px`;
		}
		selMenu.style.display = 'block';
	}
	function hideSelMenu(){
		if(selMenu)
			selMenu.style.display = 'none';
		document.body.classList.remove('selmenu-docked');
	}
	let selTimeout = null;
	function handleSelEnd() {
			// Clear any pending timeout
			if (selTimeout) clearTimeout(selTimeout);

			selTimeout = setTimeout(() => {
					const selection = window.getSelection();
					const text = selection.toString().trim();

					if (text.length > 0) {
							// Extra check for iOS: make sure we have a valid range
							if (selection.rangeCount > 0 && !selection.isCollapsed) {
									showSelMenu();
							}
					} else {
							hideSelMenu();
					}
			}, 120);   // Increased delay — very important for iOS
	}
	document.addEventListener('selectionchange', handleSelEnd, { passive: true });
	document.addEventListener('touchend', handleSelEnd, { passive: true });
	document.addEventListener('mouseup', handleSelEnd, { passive: true });
	document.addEventListener('touchstart', (e) => {
			if (!selMenu.contains(e.target)) {
					hideSelMenu();
			}
	}, { passive: true });

	let deferredPrompt;
	function isIOS() {
			// iPadOS 13+ reports itself as a Mac; tell it apart by touch support.
			return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
				(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	}
	document.getElementById('ios-close-btn').addEventListener('click', () => {
			iosInstructions.style.display = 'none';
	});
	const iosInstructions = document.getElementById('ios-instructions');
	if (isIOS() && window.navigator.standalone == false) {
			iosInstructions.style.display = 'none';
			document.getElementById('install-button').style.display = 'block';
	}
	window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			deferredPrompt = e;
			document.getElementById('install-button').style.display = 'block';
	});
	document.getElementById('install-button').addEventListener('click', async () => {
			if (deferredPrompt) {
					deferredPrompt.prompt();
					await deferredPrompt.userChoice;
					deferredPrompt = null;
			}
			if(isIOS()){
				iosInstructions.style.display = 'block';
			}
	});

	if(window.navigator.standalone){
			document.getElementById('install-button').style.display = 'none';
	}

	window.addEventListener('appinstalled', () => {
			document.getElementById('install-button').style.display = 'none';
	});

	class PAs extends HTMLElement {
		connectedCallback() {
			const href = this.getAttribute('href');
			const text = this.textContent;
			const newHref = href + text;
			const link = document.createElement('a');
			link.href = newHref;
			link.textContent = text;
			this.replaceWith(link);
		}
	}
	customElements.define('p-as', PAs);
	class PaElement extends HTMLElement {
			connectedCallback() {
					this.addEventListener('click', () => {
							openPopupSearch(this.textContent, popupEntries[this.dataset.e]);
					});
			}
	}
	customElements.define('p-a', PaElement);
	createSelMenu();
}
