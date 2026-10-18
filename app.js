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
// The bookmark button next to each headword (see togglePin)
const bookmarkSVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
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
// Done with one generated CSS rule per collapsed dictionary.
// Each entry's own buttons: ? learns it (word by word translation, see
// learnEntry) and ⋯ opens its menu (see entryMenu).
const learnBtnHTML = '<button type="button" class="learn-btn" onclick="learnEntry(this)" title="Learn: translate word by word" aria-label="Learn this entry">?</button>';
const menuBtnHTML = '<button type="button" class="menu-btn" onclick="entryMenu(this)" title="More" aria-label="Entry options">⋯</button>';
const collapseStyle = document.head.appendChild(document.createElement('style'));
let collapsedDicts = [];
try { collapsedDicts = JSON.parse(localStorage.getItem('collapsedDicts')) || []; } catch (e) {}
const applyCollapsed = () => {
	const sel = collapsedDicts.map(d => `p-e[data-dict="${CSS.escape(d)}"]`);
	collapseStyle.textContent = sel.length ? `${sel.join(',')}{max-height:1.8em;overflow:hidden;opacity:.6;font-size:.8em;margin-top:.4em;padding-top:.2em}` +
		`${sel.map(s => s + ' p-h').join(',')}{padding:0 3px}` : '';
};
applyCollapsed();
const toggleDictName = d => {
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

// Ask the browser not to auto-evict our cached dictionaries/app-shell under
// storage pressure. This is a request, not a guarantee - browsers grant it
// based on heuristics like install/engagement state - but it costs nothing
// to ask, and offline-first apps like this one are exactly the case it
// exists for. It only affects eviction under low-disk-space pressure; it
// doesn't help with cache entries that failed to download in the first
// place (that's handled in the service worker).
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

	navigator.serviceWorker.getRegistrations().then(registrations => {
		registrations.forEach(reg => {
			const rootUrl = new URL('/', location.origin).href;
			if (reg.scope !== rootUrl) {
				reg.unregister().then(() => console.log('Unregistered old SW:', reg.scope));
			}
		});
	});
	navigator.serviceWorker.addEventListener('message', event => {
		if(event.data){
			if(event.data.type === 'new'){
				console.log(`${event.data.url} is new!`);
			}else if(event.data.type === 'filesupdated'){
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

	// Ask right away rather than waiting for window's 'load' event: this
	// script has a top-level await above (fetching files.json), and once a
	// module script suspends on that it's a race whether 'load' fires before
	// or after it resumes and gets around to registering that listener - if
	// 'load' wins, requestCacheVersion() (and every ack() call downstream of
	// it) never happens at all, which is why already-downloaded files could
	// keep showing their "not downloaded" icon forever. A controller may
	// also not exist yet on the very first controlled load, so retry once
	// one shows up.
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

const root = window.location.pathname.length <= 1;
if(root){
	const tlangs = [...new Set(filesJson.dicts.map(arr => arr[0].split('/')[0]))];
	const links = '<ul class="dictlist-root">' + tlangs.map(dir => `<li><a class="dictlist-link" href="/${dir}">${dir}</a></li>`).join(' ') + '</ul>';
	document.getElementById("list").innerHTML = links;
}else{
	['searchContainer', 'content', 'about', 'controls', 'bottomNav'].forEach(id => {
		document.getElementById(id).classList.toggle('hide');
	});
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
					document.getElementById(`${d}`)?.classList.remove('down');
					timingDiv.insertAdjacentHTML("beforeend", `${Math.round(performance.now())}ms ${e.data.msg}<br>`);
					--nload;
					newtiming.innerHTML = `${Math.round(performance.now())}ms `;
					if(nload == 0)
						saveState();
					query = ""; // Triggers a search
					startSearch();
				}
				else if(e.data.type == "nomore"){
					if(e.data.st == st && e.data.gen === searchGen){
						worker_code[e.data.id-1] = true;
						if(!worker_code.includes(false)){
							if(nextst()){
								continueSearch();
							}else{
								if (loader) {
									loader.remove();
									loader = null;
								}
							}
						}
					}
				}else if(e.data.type == "translation"){
					if(e.data.tag)
						showEntryTranslation(e.data);
					else
						showTranslation(e.data);
				}else if(e.data.type == "result"){
					const popup = e.data.dest == "popup";
					if(!popup && e.data.gen !== searchGen)
						return; // Sent for an earlier search (it restarts as dictionaries load)
					if(!popup && num == 0){ // Popup results leave the main results alone
						cleanup(tout);
						if(loader)
							tout.append(loader)
					}
					let idpre = popup ? "pid" : "mid";
					const nheader = updateQuery(e.data.header);
					let div = document.getElementById(`${idpre}-${nheader}`);
					const first = div === null;
					if(first){
						div = document.createElement('p-d');
						div.id = `${idpre}-${nheader}`;
						if(idpre == "mid" || e.data.st == 2){
							let temp_dict_code = new Array(dicts.length).fill(true);
							temp_dict_code[dicts.findIndex(file => file[1] === e.data.dict)] = false;
							workers.forEach((w, i) =>{
								let code = temp_dict_code.filter((_, index) => index % workers.length == i);
								w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: e.data.dest, dicts: code, gen: searchGen});
							});
						}
					}
					let el = document.createElement('p-e');
					const d = e.data.did*workers.length + e.data.id - 1;
					const addon = isAddon(d);
					// Add-ons (audio, images, pronunciation) go first, then the
					// focused dictionary, then the rest in the user's order.
					const sortid = addon ? -1 : d === focus ? 0 : rankOf(d) + 1;
					el.setAttribute('data-id', sortid);
					el.dataset.dict = e.data.dict;
					el.dataset.d = d;
					el.dataset.cat = catOf(d);
					if(addon)
						el.classList.add('addon');
					const star = d === focus ? '<span class="star" title="Focused">★</span>' : '';
					if(debug)
						el.innerHTML += `<p-h>${star}<span class="dn">${e.data.dict} ${e.data.st} '${e.data.query}' #${sortid}</span></p-h>`;
					else
						el.innerHTML += `<p-h>${star}<span class="dn">${e.data.dict}</span></p-h>`;
					const verse = popup ? null : verseOf(nheader);
					if(verse)
						el.dataset.v = verse.v;
					if(first){
						div.innerHTML += `<h2><span class="hw">${verse ? `${escapeHTML(bookName(verse.i))} ${kmNum(verse.c)}:${kmNum(verse.v)}` : e.data.header}</span><button type="button" class="pin-btn bm-btn" onclick="togglePin(this)" title="Bookmark" aria-label="Bookmark" aria-pressed="false">${bookmarkSVG}</button></h2><div class="ptags"></div>`;
						if(verse){
							div.classList.add('verse');
							div.dataset.book = verse.b;
							div.dataset.v = verse.v;
							div.dataset.ch = verse.c;
							div.dataset.grp = bookGroups(verse.b);
						}else if(!popup && !expandAll && nheader !== query && resultsDiv.querySelector(':scope > p-d:not(.folded):not(.verse)')){
							// The first headword (and the exact one) stays open; the
							// others fold to a line with the dictionaries they're in.
							div.classList.add('folded');
						}
					}
					if(e.data.filetype){
						if(e.data.subheader){
							let sh = e.data.subheader;	
							el.innerHTML += `<p-n>${sh.join(",<br>")}<br></p-n>`;
						}
						if (e.data.filetype.toLowerCase().includes('webp')) {
							const blob = new Blob([e.data.body], { type: 'image/webp' });
							const url = URL.createObjectURL(blob);
							el.innerHTML += `<img src="${url}" alt="${e.data.header}" style="max-width:100%;">`;
						}else if (e.data.filetype.toLowerCase().includes('jbig2')) {
							jbig2to1bpng(e.data.body).then(blob => {
								const url = URL.createObjectURL(blob);
								el.innerHTML += `<img src="${url}" alt="${e.data.header}" style="max-width:100%;">`;
							});
						}else if (e.data.filetype.toLowerCase().includes('webm')) {
							const blob = new Blob([e.data.body], { type: 'audio/webm; codecs=opus'});
							const url = URL.createObjectURL(blob);
							el.innerHTML += `<audio controls><source src="${url}" type="audio/webm; codecs=opus" alt="${e.data.header}.${e.data.filetype}"></audio>`;
						}else if (e.data.filetype.toLowerCase().includes('codec2') || e.data.filetype.toLowerCase().includes('c2')) {
							const body = e.data.body;
							const btn = document.createElement('button');
							btn.textContent = '▶ Play';
							btn.className = 'c2-play';
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
							el.innerHTML += `${e.data.filetype}<br> filetype not supported`;
						}
					}else{
						if(mark){
							el.innerHTML += highlightText(e.data.body, e.data.query);
						} else{
							el.innerHTML += `${e.data.body}`;
						}
						// Entries with chords get a show/hide button next to the dictionary name.
						if (e.data.body && e.data.body.includes('<p-m')) {
							el.querySelector('p-h')?.insertAdjacentHTML('beforeend', chordsBtnHTML);
						}
					}
					if(verse && !e.data.filetype){ // Its number, shown when verses read as a page
						const p = el.querySelector('p');
						if(p) p.insertAdjacentHTML('afterbegin', `<span class="vn">${verse.v}</span>`);
						else el.querySelector('p-h')?.insertAdjacentHTML('afterend', `<span class="vn">${verse.v}</span>`);
					}
					el.querySelector('p-h')?.insertAdjacentHTML('beforeend', (e.data.filetype ? '' : learnBtnHTML) + menuBtnHTML);
					
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
					if(!popup && d === focus){ // Its sections go above the other dictionaries'
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
					if(!popup)
						sectionChanged(div);
					if(first && popup){
						popupOpen();
						document.addEventListener('click', closePopupClick); 
					}
					if(!popup){
						++num;
						--budget;
						queryInput.classList.remove("error");
						statusDiv.textContent = `Found ${num}+ matching lines.`;
						loadmore();
					}
				}
			}
	}

	const abbr = filesJson.abbr || {};

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
	// A file's tuple is now [path, timestamp, description, buflen, priority].
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

	// Strip extension from basename
	function fileBasename(filename) {
			return filename.split('/').pop().replace(/(\.(peak|slab)(\.zst)?$)/, '');
	}

	// Priority 1 (or -1, "always show first") dictionaries are enabled by default; everything else
	// (including cross-language extras) starts unchecked and the user can opt in.
	function defaultEnabled(priority) {
			return priority === undefined || priority === 1 || priority === -1;
	}

	// dict entry: [filename, basename, buflen, description, enabled]
	let dicts = files.map(({file: [filename, , description, buflen, priority]}) => [
			filename,
			fileBasename(filename),
			buflen,
			description,
			defaultEnabled(priority)
	]);

	// Focus: one dictionary's results come first, and text it has no entry
	// for is translated word by word with it. ?dict=h97 is a page with only
	// that dictionary loaded ("solo"), focused; ?focus=h97 just focuses it.
	const urlParams = new URLSearchParams(window.location.search);
	const dictIndex = name => name ? dicts.findIndex(d => d[1] === name) : -1;
	let solo = dictIndex(urlParams.get('dict'));
	const focusKey = `peakslab-focus-${appname}`;
	let focus = solo >= 0 ? solo : dictIndex(urlParams.get('focus'));
	if (focus < 0 && !urlParams.has('focus')) {
		try { const f = localStorage.getItem(focusKey); focus = f ? dicts.findIndex(d => d[0] === f) : -1; } catch (e) { /* not remembered */ }
	}
	const focusEnd = document.createElement('span'); // The focused dictionary's sections go above this

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


	function escapeRegExp(string) {
		if(!string)
			return null;
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function cleanup(container = tout){
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
	const defaultPlaceholder = queryInput.placeholder;

	const statusDiv  = document.getElementById('status');
	const resultsDiv = document.getElementById('results');
	const popupOverlay = document.getElementById('popupOverlay');
	const popupQuery = document.getElementById('popupQuery');
	const popupResults = document.getElementById('popupResults');
	const popupClose = document.getElementById('popupClose');

	// Above the results: the big text box for long queries and the
	// focused dictionary's word by word translation.
	const topDiv = document.createElement('div');
	topDiv.id = 'topDiv';
	resultsDiv.insertAdjacentElement('beforebegin', topDiv);
	const bigQuery = topDiv.appendChild(document.createElement('textarea'));
	bigQuery.id = 'bigQuery';
	bigQuery.classList.add('hide');
	const translationDiv = topDiv.appendChild(document.createElement('div'));

	let isfull = false;
	const f4 = document.getElementById('f4');
	f4.addEventListener('click', () => {
		isfull = !isfull;
		document.body.classList.toggle('reading', isfull);
		if (isfull) setView('search');
	});
	document.getElementById('exitReading').addEventListener('click', () => f4.click());

	// ---------------------------------------------------------------
	// Categories, add-ons and the user's dictionary order
	// ---------------------------------------------------------------
	const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
	const CAT_LABELS = {dict: 'Dictionaries', 'dict/tech': 'Technical terms', bible: 'Bible', 'bible/text': 'Bible texts',
		'bible/dict': 'Bible words', 'bible/commentary': 'Bible notes', 'bible/psalter': 'Psalters', music: 'Music',
		'music/chords': 'Chords', 'music/sheet': 'Sheet music', phonetics: 'Pronunciation', media: 'Audio & images', ref: 'Reference'};
	const catLabel = cat => CAT_LABELS[cat.join('/')] || CAT_LABELS[cat[0]] || cap(cat.join(' / ')) || 'Other';
	// Add-ons have no entries of their own worth reading alone (recordings,
	// pictures, pronunciations): they're shown inside the other entries.
	const ADDON_CATS = ['media', 'phonetics'];
	function catOf(d){ return (files[d] && files[d].category[0]) || 'dict'; }
	function isAddon(d){ return ADDON_CATS.includes(catOf(d)); }
	const plain = html => { const t = document.createElement('template'); t.innerHTML = html || ''; return t.content.textContent.replace(/\s+/g, ' ').trim(); };

	const orderKey = `peakslab-order-${appname}`;
	let userOrder = {};
	try { userOrder = JSON.parse(localStorage.getItem(orderKey)) || {}; } catch (e) { /* not remembered */ }
	function rankOf(d){ const r = userOrder[dicts[d][0]]; return typeof r === 'number' ? r : d; }
	function moveDict(d, dir){
		const list = dicts.map((_, i) => i).filter(i => !isAddon(i)).sort((a, b) => rankOf(a) - rankOf(b));
		const k = list.indexOf(d), j = k + dir;
		if (k < 0 || j < 0 || j >= list.length) return false;
		[list[k], list[j]] = [list[j], list[k]];
		userOrder = {};
		list.forEach((i, n) => { userOrder[dicts[i][0]] = n; });
		try { localStorage.setItem(orderKey, JSON.stringify(userOrder)); } catch (e) { /* not remembered */ }
		resortEntries();
		return true;
	}
	function entrySortId(d){ return isAddon(d) ? -1 : d === focus ? 0 : rankOf(d) + 1; }
	function resortEntries(){
		document.querySelectorAll('#results > p-d').forEach(pd => {
			const es = [...pd.querySelectorAll(':scope > p-e')];
			es.forEach(pe => { pe.dataset.id = entrySortId(+pe.dataset.d); });
			es.sort((a, b) => a.dataset.id - b.dataset.id).forEach(pe => pd.appendChild(pe));
		});
	}

	// ---------------------------------------------------------------
	// Bible books: verse headers look like "gen 1.1"
	// ---------------------------------------------------------------
	const BOOKS = 'gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sol isa jer lam eze dan hos joe amo oba jon mic nah hab zep hag zec mal mat mar luk joh act rom 1co 2co gal eph phi col 1th 2th 1ti 2ti tit phm heb jam 1pe 2pe 1jo 2jo 3jo jud rev'.split(' ');
	const CHAPTERS = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];
	const BOOKS_EN = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Songs','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];
	const BOOKS_KM = ['លោកុប្បត្តិ','និក្ខមនំ','លេវីវិន័យ','ជនគណនា','ទុតិយកថា','យ៉ូស្វេ','ចៅហ្វាយ','នាងរស់','១ សាំយូអែល','២ សាំយូអែល','១ ពង្សាវតារក្សត្រ','២ ពង្សាវតារក្សត្រ','១ របាក្សត្រ','២ របាក្សត្រ','អែសរ៉ា','នេហេមា','នាងអេសធើរ','យ៉ូប','ទំនុកតម្កើង','សុភាសិត','សាស្ដា','បទចំរៀង','អេសាយ','យេរេមា','បរិទេវ','អេសេគាល','ដានីយ៉ែល','ហូសេ','យ៉ូអែល','អេម៉ុស','អូបាឌា','យ៉ូណាស','មីកា','ណាហ៊ូម','ហាបាគូក','សេផានា','ហាកាយ','សាការី','ម៉ាឡាគី','ម៉ាថាយ','ម៉ាកុស','លូកា','យ៉ូហាន','កិច្ចការ','រ៉ូម','១ កូរិនថូស','២ កូរិនថូស','កាឡាទី','អេភេសូ','ភីលីព','កូឡូស','១ ថេស្សាឡូនិក','២ ថេស្សាឡូនិក','១ ធីម៉ូថេ','២ ធីម៉ូថេ','ទីតុស','ភីលេម៉ូន','ហេប្រឺ','យ៉ាកុប','១ ពេត្រុស','២ ពេត្រុស','១ យ៉ូហាន','២ យ៉ូហាន','៣ យ៉ូហាន','យូដាស','វិវរណៈ'];
	const BOOK_GROUPS = [['ot', 'Old Testament', 0, 38], ['nt', 'New Testament', 39, 65], ['pent', 'Pentateuch', 0, 4],
		['hist', 'History', 5, 16], ['wis', 'Wisdom', 17, 21], ['proph', 'Prophets', 22, 38], ['gosp', 'Gospels', 39, 42],
		['acts', 'Acts', 43, 43], ['epi', 'Epistles', 44, 64], ['rev', 'Revelation', 65, 65]];
	document.head.appendChild(document.createElement('style')).textContent = BOOK_GROUPS.map(g => `#results[data-scope="${g[0]}"]>p-d.verse:not([data-grp~="${g[0]}"])`).join(',') + '{display:none}';
	const khmerPage = pLangParts[0] === 'khmer';
	const kmNum = n => khmerPage ? String(n).replace(/\d/g, x => '០១២៣៤៥៦៧៨៩'[x]) : String(n);
	const bookName = i => (khmerPage ? BOOKS_KM : BOOKS_EN)[i];
	function verseOf(h){
		const m = /^([1-3]?[a-z]{2,3}) (\d+)\.(\d+)$/.exec(h || '');
		if (!m) return null;
		const i = BOOKS.indexOf(m[1]);
		return i < 0 ? null : {b: m[1], i, c: +m[2], v: +m[3]};
	}
	function bookGroups(b){
		const i = BOOKS.indexOf(b);
		return BOOK_GROUPS.filter(g => i >= g[2] && i <= g[3]).map(g => g[0]).join(' ');
	}
	// A typed reference ("John 3", "1 cor 13:4", "gen 1") as the search for it
	function bibleRef(q){
		if (!hasBible || !q) return null;
		const m = /^([1-3]?\s?[a-z][a-z ]*?)\s*(\d+)(?:[:.](\d+))?$/.exec(q.trim());
		if (!m) return null;
		const name = m[1].replace(/\s+/g, '');
		const i = BOOKS.indexOf(name) >= 0 ? BOOKS.indexOf(name)
			: name.length >= 3 ? BOOKS_EN.findIndex(b => b.toLowerCase().replace(/\s+/g, '').startsWith(name)) : -1;
		return i < 0 ? null : `${BOOKS[i]} ${m[2]}.${m[3] || ''}`;
	}
	const hasBible = files.some(f => f.category[0] === 'bible' && f.category[1] === 'text');

	// ---------------------------------------------------------------
	// Bottom sheet (menus, Learn, languages, books)
	// ---------------------------------------------------------------
	const sheet = document.getElementById('sheet');
	const sheetBody = sheet.querySelector('.sheet-body');
	const sheetTitle = sheet.querySelector('.sheet-title');
	let sheetClick = null;
	function openSheet(title, html, onClick){
		sheetTitle.innerHTML = title;
		sheetBody.innerHTML = html;
		sheetClick = onClick || null;
		sheet.classList.remove('hide');
		document.body.classList.add('no-scroll');
		sheetBody.scrollTop = 0;
	}
	function closeSheet(){
		sheet.classList.add('hide');
		document.body.classList.remove('no-scroll');
		sheetBody.replaceChildren();
		sheetClick = null;
	}
	sheet.querySelector('.sheet-bg').addEventListener('click', closeSheet);
	sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);
	sheetBody.addEventListener('click', e => sheetClick?.(e));
	document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.classList.contains('hide')) closeSheet(); });

	// ---------------------------------------------------------------
	// Header: language button, section chips, hide on scroll
	// ---------------------------------------------------------------
	const header = document.getElementById('header');
	const subbar = document.getElementById('subbar');
	const tabs = document.getElementById('tabs');
	const langBtn = document.getElementById('langBtn');
	const chevron = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
	const langSym = l => (Array.isArray(abbr[l]) && abbr[l][1]) || cap(l).slice(0, 2);
	const curLang = pLangParts[0] || pParts[0] || '';
	langBtn.innerHTML = `<span class="lang-sym">${escapeHTML(langSym(curLang))}</span><span class="lang-name">${escapeHTML(cap(curLang))}${pParts.length > 1 ? ' · ' + escapeHTML(pParts.slice(1).map(cap).join(' · ')) : ''}</span>${chevron}`;
	langBtn.setAttribute('aria-label', `Language: ${cap(curLang)}. Change language`);
	subbar.classList.remove('hide');
	langBtn.addEventListener('click', () => {
		const counts = {};
		filesJson.dicts.forEach(f => { const l = f[0].split('/')[0]; counts[l] = (counts[l] || 0) + 1; });
		const qs = queryText ? '?text=' + encodeURIComponent(queryText) : '';
		const sections = [...new Set(filesJson.dicts.filter(f => f[0].startsWith(curLang + '/')).map(f => f[0].split('/')[1]))]
			.filter(c => !ADDON_CATS.includes(c));
		const row = (l, cur) => `<a class="ls-row${cur ? ' cur' : ''}" href="/${l}${qs}"><span class="ls-sym">${escapeHTML(langSym(l))}</span><span class="ls-name">${escapeHTML(cap(l))}</span><span class="ls-c">${counts[l]}</span></a>`;
		openSheet('Language',
			row(curLang, true) +
			`<div class="ls-secs">${['', ...sections].map(c => `<a class="chip${(pParts[1] || '') === c ? ' on' : ''}" href="/${curLang}${c ? '/' + c : ''}${qs}">${c ? escapeHTML(catLabel([c])) : 'Everything'}</a>`).join('')}</div>` +
			`<h3 class="sheet-h">Other languages</h3>` +
			Object.keys(counts).filter(l => l !== curLang).sort((a, b) => counts[b] - counts[a]).map(l => row(l, false)).join(''));
	});

	// Section chips: All, then each kind of resource on this page (add-ons
	// excluded, they live inside the others); a tap shows only that kind.
	const chipCats = [...new Set(dicts.map((_, d) => d).filter(d => !isAddon(d)).map(catOf))];
	const filterStyle = document.head.appendChild(document.createElement('style'));
	filterStyle.textContent = chipCats.map(c => `#results[data-cat="${c}"]>p-d:not(:has(>p-e[data-cat="${c}"])),#results[data-cat="${c}"]>p-d>p-e:not([data-cat="${c}"]):not(.addon){display:none}`).join('');
	function setCat(c){
		if (c) resultsDiv.dataset.cat = c; else delete resultsDiv.dataset.cat;
		if (c !== 'bible') delete resultsDiv.dataset.scope;
		updateChips();
		scheduleViews();
		loadmore();
	}
	// Only touch the DOM when something changed (keeps buttons tappable
	// while results stream in)
	function setHTML(el, html){
		if (el._html !== html) { el._html = html; el.innerHTML = html; }
	}
	function updateChips(){
		const cur = resultsDiv.dataset.cat || '';
		const secs = resultsDiv.querySelectorAll(':scope > p-d:not(#loader)');
		const counts = {};
		secs.forEach(pd => new Set([...pd.querySelectorAll(':scope > p-e')].map(e => e.dataset.cat)).forEach(c => { counts[c] = (counts[c] || 0) + 1; }));
		const count = c => counts[c] || 0;
		const chip = (c, label, n) => `<button type="button" role="tab" class="chip${cur === c ? ' on' : ''}" aria-selected="${cur === c}" data-cat="${c}">${escapeHTML(label)}${n !== '' ? ` <span class="n">${n}</span>` : ''}</button>`;
		setHTML(tabs, (chipCats.length > 1 ? chip('', 'All', secs.length || '') + chipCats.map(c => chip(c, catLabel([c]), count(c) || '')).join('') : '') +
			(hasBible ? '<button type="button" class="chip books" data-books="1">Books ›</button>' : ''));
	}
	tabs.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		if (b.dataset.books) openBooks();
		else setCat(b.dataset.cat);
	});
	updateChips();

	let lastY = 0;
	window.addEventListener('scroll', throttle(() => {
		const y = window.scrollY;
		if (y > lastY + 6 && y > 80) header.classList.add('compact');
		else if (y < lastY - 6 || y < 40) header.classList.remove('compact');
		lastY = y;
	}, 60), {passive: true});
	new ResizeObserver(() => {
		if (!header.classList.contains('compact'))
			document.documentElement.style.setProperty('--hh', header.offsetHeight + 'px');
	}).observe(header);

	// ---------------------------------------------------------------
	// Results: folded headwords, dictionary tags, verse runs, views
	// ---------------------------------------------------------------
	let expandAll = false;
	let combined = true;
	const viewBar = document.createElement('div');
	viewBar.id = 'viewBar';
	viewBar.className = 'hide';
	bigQuery.insertAdjacentElement('afterend', viewBar);
	const byDictDiv = document.createElement('div');
	byDictDiv.id = 'byDict';
	byDictDiv.className = 'hide';
	resultsDiv.insertAdjacentElement('beforebegin', byDictDiv);
	const speakerSVG = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 010 6"/></svg>';

	const dirty = new Set();
	let viewsTimer = null;
	function sectionChanged(div){
		dirty.add(div);
		scheduleViews();
	}
	function scheduleViews(){
		if (viewsTimer) return;
		viewsTimer = setTimeout(() => {
			viewsTimer = null;
			let verses = false;
			dirty.forEach(d => { updateTags(d); verses = verses || d.classList.contains('verse'); });
			dirty.clear();
			if (verses) markRuns();
			updateChips();
			updateViewBar();
			if (!combined) renderByDict();
		}, 250);
	}
	function updateTags(div){
		markBookmark(div);
		const tags = div.querySelector(':scope > .ptags');
		if (!tags) return;
		const es = [...div.querySelectorAll(':scope > p-e')];
		const names = es.filter(e => !e.classList.contains('addon')).map(e => e.dataset.dict);
		const audio = es.some(e => e.classList.contains('addon') && e.querySelector('audio, .c2-play'));
		tags.innerHTML = (audio ? `<span class="tg-audio" title="Has a recording">${speakerSVG}</span>` : '') +
			names.slice(0, 3).map(n => `<span class="tg">${escapeHTML(n)}</span>`).join('') +
			(names.length > 3 ? `<span class="tg-more">+${names.length - 3}</span>` : '') +
			(names.length ? `<span class="tg-n">in ${names.length}</span>` : '');
	}
	// Verses next to each other read like a Bible page; scattered ones stay cards.
	function markRuns(){
		const ps = [...resultsDiv.querySelectorAll(':scope > p-d.verse')];
		const next = (a, b) => a && b && b.classList.contains('verse') && a.dataset.book === b.dataset.book &&
			a.dataset.ch === b.dataset.ch && +b.dataset.v === +a.dataset.v + 1;
		ps.forEach(p => {
			const prev = next(p.previousElementSibling, p);
			const nxt = next(p, p.nextElementSibling);
			p.classList.toggle('run', prev || nxt);
			p.classList.toggle('run-start', !prev && nxt);
			p.classList.toggle('run-end', prev && !nxt);
		});
	}
	// A chapter is open when the search is one ("gen 1" or "gen 1.")
	function chapterOfResults(){
		const m = /^([1-3]?[a-z]{2,3}) (\d+)\.?$/.exec(query || '');
		const i = m ? BOOKS.indexOf(m[1]) : -1;
		return i >= 0 && resultsDiv.querySelector(':scope > p-d.verse') ? {i, c: +m[2]} : null;
	}
	function updateViewBar(){
		const secs = [...resultsDiv.querySelectorAll(':scope > p-d')];
		const verses = secs.filter(p => p.classList.contains('verse'));
		const words = secs.length - verses.length;
		if (!secs.length) { viewBar.classList.add('hide'); return; }
		const chap = chapterOfResults();
		resultsDiv.classList.toggle('chapter', !!chap);
		let html = '';
		if (chap) {
			html += `<div class="vb-chap"><button type="button" data-a="prevch" aria-label="Previous chapter">‹</button>` +
				`<button type="button" class="vb-book" data-a="books">${escapeHTML(bookName(chap.i))} ${kmNum(chap.c)} ${chevron}</button>` +
				`<button type="button" data-a="nextch" aria-label="Next chapter">›</button></div>`;
		}
		if (verses.length && !chap) {
			const scope = resultsDiv.dataset.scope || '';
			const n = g => verses.filter(p => p.dataset.grp.split(' ').includes(g)).length;
			html += `<div class="vb-scope" role="radiogroup" aria-label="Search in">` +
				`<button type="button" role="radio" class="chip${scope ? '' : ' on'}" aria-checked="${!scope}" data-scope="">Whole Bible <span class="n">${verses.length}</span></button>` +
				BOOK_GROUPS.filter(g => n(g[0])).map(g => `<button type="button" role="radio" class="chip${scope === g[0] ? ' on' : ''}" aria-checked="${scope === g[0]}" data-scope="${g[0]}">${g[1]} <span class="n">${n(g[0])}</span></button>`).join('') +
				`</div>`;
		}
		html += `<div class="vb-row">${words > 1 ? `<button type="button" class="vb-exp" data-a="expand">${expandAll ? 'Fold all' : 'Open all'}</button>` : '<span></span>'}` +
			`<span class="vb-right"><button type="button" class="vb-share" data-a="share">⤴ Share</button>` +
			(words > 1 ? `<label class="vb-comb">Combined <button type="button" role="switch" class="sw${combined ? ' on' : ''}" aria-checked="${combined}" data-a="combined" aria-label="Combine dictionaries"><span></span></button></label>` : '') +
			`</span></div>`;
		setHTML(viewBar, html);
		viewBar.classList.toggle('hide', !html);
	}
	viewBar.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		if (b.dataset.scope !== undefined) {
			if (b.dataset.scope) resultsDiv.dataset.scope = b.dataset.scope; else delete resultsDiv.dataset.scope;
			updateViewBar();
			loadmore();
		} else if (b.dataset.a === 'expand') {
			expandAll = !expandAll;
			resultsDiv.querySelectorAll(':scope > p-d').forEach(p => p.classList.toggle('folded', !expandAll && p !== resultsDiv.querySelector(':scope > p-d')));
			updateViewBar();
		} else if (b.dataset.a === 'combined') {
			combined = !combined;
			resultsDiv.classList.toggle('bydict', !combined);
			byDictDiv.classList.toggle('hide', combined);
			if (!combined) renderByDict();
			updateViewBar();
		} else if (b.dataset.a === 'books') {
			openBooks();
		} else if (b.dataset.a === 'share') {
			share(b);
		} else if (b.dataset.a === 'prevch' || b.dataset.a === 'nextch') {
			const chap = chapterOfResults();
			if (!chap) return;
			let {i, c} = chap;
			c += b.dataset.a === 'nextch' ? 1 : -1;
			if (c < 1) { i = (i + 65) % 66; c = CHAPTERS[i]; }
			if (c > CHAPTERS[i]) { i = (i + 1) % 66; c = 1; }
			goChapter(i, c);
		}
	});
	// Tap a headword (or its tags) to open or fold it; tap a verse in a
	// Bible page to show its buttons.
	document.addEventListener('click', e => {
		if (e.target.closest('button, a, p-a, audio, input, textarea, .tr-entry, #sheet')) return;
		if (!window.getSelection().isCollapsed) return;
		const h = e.target.closest('#results > p-d > h2, #results > p-d > .ptags');
		if (h) {
			h.parentElement.classList.toggle('folded');
			return;
		}
		const pd = e.target.closest('#results > p-d.run');
		if (pd) {
			const was = pd.classList.contains('sel');
			resultsDiv.querySelectorAll(':scope > p-d.sel').forEach(p => p.classList.remove('sel'));
			pd.classList.toggle('sel', !was);
		}
	});

	// By dictionary: one row per dictionary with the headwords it has;
	// opening a row shows those entries.
	const byDictOpen = new Set();
	let byDictAt = 0, byDictTimer = null;
	function renderByDict(){
		const wait = byDictAt + 800 - Date.now();
		if (wait > 0) {
			if (!byDictTimer) byDictTimer = setTimeout(() => { byDictTimer = null; renderByDict(); }, wait);
			return;
		}
		byDictAt = Date.now();
		const cat = resultsDiv.dataset.cat;
		const groups = new Map();
		resultsDiv.querySelectorAll(':scope > p-d > p-e:not(.addon)').forEach(pe => {
			if (cat && pe.dataset.cat !== cat) return;
			const d = +pe.dataset.d;
			if (!groups.has(d)) groups.set(d, []);
			groups.get(d).push(pe);
		});
		const ds = [...groups.keys()].sort((a, b) => entrySortId(a) - entrySortId(b));
		setHTML(byDictDiv, ds.map(d => {
			const hws = groups.get(d).map(pe => pe.parentElement.querySelector('.hw')?.textContent || '');
			return `<details class="bd" data-d="${d}"${byDictOpen.has(d) ? ' open' : ''}><summary>` +
				`<span class="bd-main"><span class="bd-n">${d === focus ? '<span class="star">★</span>' : ''}${escapeHTML(dicts[d][1])}</span>` +
				`<span class="bd-w">${escapeHTML(hws.slice(0, 6).join(' · '))}${hws.length > 6 ? '…' : ''}</span></span>` +
				`<span class="bd-c">${hws.length}</span></summary><div class="bd-body"></div></details>`;
		}).join('') || '<p class="bd-none">No entries yet.</p>');
		byDictDiv.querySelectorAll('details[open]').forEach(det => { if (!det._filled) fillByDict(det); });
	}
	function fillByDict(det){
		det._filled = true;
		const d = +det.dataset.d;
		const body = det.querySelector('.bd-body');
		body.replaceChildren();
		resultsDiv.querySelectorAll(`:scope > p-d > p-e[data-d="${d}"]`).forEach(pe => {
			const hw = document.createElement('div');
			hw.className = 'bd-hw';
			hw.textContent = pe.parentElement.querySelector('.hw')?.textContent || '';
			body.append(hw, pe.cloneNode(true));
		});
	}
	byDictDiv.addEventListener('toggle', e => {
		const det = e.target;
		if (!det.classList?.contains('bd')) return;
		const d = +det.dataset.d;
		if (det.open) { byDictOpen.add(d); fillByDict(det); } else byDictOpen.delete(d);
	}, true);

	// ---------------------------------------------------------------
	// Bible books and chapters
	// ---------------------------------------------------------------
	function goChapter(i, c){
		setQueryText(`${BOOKS[i]} ${c}.`);
		if (chipCats.includes('bible')) resultsDiv.dataset.cat = 'bible';
		delete resultsDiv.dataset.scope;
		closeSheet();
		startSearch();
	}
	function openBooks(group = 'all', book = -1){
		const cur = chapterOfResults();
		const groupsHTML = `<div class="bk-groups">${[['all', 'All'], ...BOOK_GROUPS].map(g => `<button type="button" class="chip${g[0] === group ? ' on' : ''}" data-g="${g[0]}">${g[1]}</button>`).join('')}</div>`;
		const tile = i => `<button type="button" class="bk${cur && cur.i === i ? ' cur' : ''}" data-b="${i}"><span class="bk-n">${escapeHTML(bookName(i))}</span>${khmerPage ? `<span class="bk-e">${escapeHTML(BOOKS_EN[i])}</span>` : ''}</button>`;
		const range = g => { const r = BOOK_GROUPS.find(x => x[0] === g); return Array.from({length: r[3] - r[2] + 1}, (_, k) => r[2] + k); };
		let html;
		if (book >= 0) {
			html = `<div class="bk-top"><button type="button" class="bk-back" data-g="${group}">‹ Books</button><span class="bk-title">${escapeHTML(bookName(book))}</span></div>` +
				`<div class="ch-grid">${Array.from({length: CHAPTERS[book]}, (_, k) => `<button type="button" class="ch${cur && cur.i === book && cur.c === k + 1 ? ' cur' : ''}" data-b="${book}" data-c="${k + 1}">${kmNum(k + 1)}</button>`).join('')}</div>`;
		} else {
			const secs = group === 'all' ? [['Old Testament', range('ot')], ['New Testament', range('nt')]] : [[BOOK_GROUPS.find(g => g[0] === group)[1], range(group)]];
			html = groupsHTML + secs.map(([t, is]) => `<h3 class="sheet-h">${t} <span class="n">${is.length}</span></h3><div class="bk-grid">${is.map(tile).join('')}</div>`).join('');
		}
		openSheet('Go to', html, e => {
			const b = e.target.closest('button');
			if (!b) return;
			if (b.dataset.c) goChapter(+b.dataset.b, +b.dataset.c);
			else if (b.dataset.b) openBooks(group, +b.dataset.b);
			else if (b.dataset.g) openBooks(b.dataset.g, -1);
		});
	}

	// ---------------------------------------------------------------
	// Entry menu (⋯)
	// ---------------------------------------------------------------
	const speakLang = d => ((abbr[files[d].lang] || [])[2] || '').replace('_', '-');
	window.entryMenu = btn => {
		const pe = btn.closest('p-e');
		const d = +pe.dataset.d;
		const name = dicts[d][1];
		const slab = dicts[d][0].includes('.slab');
		const collapsed = collapsedDicts.includes(pe.dataset.dict);
		openSheet(`${d === focus ? '<span class="star">★</span> ' : ''}${escapeHTML(name)}`,
			`<p class="em-sub">${escapeHTML(catLabel(files[d].category))} · ${escapeHTML(cap(files[d].lang))}</p>` +
			`<div class="em-quick">` +
				`<button type="button" data-a="focus"><span class="em-i">★</span>${d === focus ? 'Unfocus' : 'Focus'}</button>` +
				(slab ? '' : `<button type="button" data-a="learn"><span class="em-i">?</span>Learn</button>`) +
				(slab ? '' : `<button type="button" data-a="copy"><span class="em-i">⧉</span>Copy</button>`) +
				(slab || !window.speechSynthesis ? '' : `<button type="button" data-a="speak"><span class="em-i">${speakerSVG}</span>Speak</button>`) +
			`</div>` +
			`<div class="em-list">` +
				(isAddon(d) ? '' : `<div class="em-row"><span>Order in results</span><button type="button" data-a="up" aria-label="Move up">↑</button><button type="button" data-a="down" aria-label="Move down">↓</button></div>`) +
				`<button type="button" class="em-row" data-a="collapse">${collapsed ? 'Expand' : 'Shrink'} ${escapeHTML(name)}'s entries</button>` +
				`<a class="em-row" href="?dict=${encodeURIComponent(name)}">Open ${escapeHTML(name)} on its own ↗</a>` +
				`<button type="button" class="em-row em-off" data-a="off">Turn off ${escapeHTML(name)}</button>` +
			`</div>` +
			`<details class="em-about"><summary>About &amp; source</summary><div>${dicts[d][3] || 'No description.'}</div></details>`,
			e => {
				const b = e.target.closest('button[data-a]');
				if (!b) return;
				const a = b.dataset.a;
				if (a === 'focus') { closeSheet(); setFocus(d); }
				else if (a === 'learn') { closeSheet(); learnEntry(pe.querySelector('.learn-btn') || btn); }
				else if (a === 'copy') {
					navigator.clipboard?.writeText(entryText(pe)).then(() => { b.lastChild.textContent = 'Copied'; }, () => {});
				} else if (a === 'speak') {
					const u = new SpeechSynthesisUtterance(entryText(pe));
					u.lang = speakLang(d);
					speechSynthesis.cancel();
					speechSynthesis.speak(u);
				} else if (a === 'up' || a === 'down') {
					moveDict(d, a === 'up' ? -1 : 1);
					pe.scrollIntoView({block: 'nearest'});
				} else if (a === 'collapse') { toggleDictName(pe.dataset.dict); closeSheet(); }
				else if (a === 'off') {
					closeSheet();
					const cb = document.getElementById(`${d}`);
					if (cb) { cb.checked = false; updateDictList(cb); }
					document.querySelectorAll(`#results p-e[data-d="${d}"]`).forEach(x => { const pd = x.parentElement; x.remove(); sectionChanged(pd); });
				}
			});
	};

	// ---------------------------------------------------------------
	// Learn (?): word by word translation in a style the user picks
	// ---------------------------------------------------------------
	const learnKey = `peakslab-learn-${appname}`;
	let learnPrefs = {};
	try { learnPrefs = JSON.parse(localStorage.getItem(learnKey)) || {}; } catch (e) { /* not remembered */ }
	const learnable = i => canTranslate(i) && !['bible/text', 'music/sheet', 'music/chords'].includes(files[i].category.join('/'));
	function runLearn(pe, i){
		pe.querySelector('.tr-entry')?.remove();
		const box = pe.appendChild(document.createElement('div'));
		box.className = 'tr-entry';
		translateEntryWith(box, entryText(pe), i);
	}
	window.learnEntry = btn => {
		const pe = btn.closest('p-e');
		const open = pe.querySelector('.tr-entry');
		if (open) { open.remove(); return; }
		const pref = dictIndex(learnPrefs[pe.dataset.dict]);
		if (pref >= 0 && learnable(pref)) runLearn(pe, pref);
		else learnPicker(pe);
	};
	window.learnChange = btn => learnPicker(btn.closest('p-e'));
	function learnPicker(pe){
		const opts = dicts.map((_, i) => i).filter(learnable);
		if (!opts.length) {
			openSheet('? Learn', '<p class="em-sub">Turn on a dictionary in the Library (⚙) to translate with it.</p>');
			return;
		}
		const pref = dictIndex(learnPrefs[pe.dataset.dict]);
		const sel = opts.includes(pref) ? pref : opts.includes(focus) ? focus : opts[0];
		const groups = new Map();
		opts.forEach(i => { const k = catLabel(files[i].category); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
		const preview = entryText(pe).split('\n').find(Boolean) || '';
		openSheet('<span class="learn-q">?</span> Learn this entry',
			`<p class="lr-prev">${escapeHTML(preview.slice(0, 160))}</p>` +
			`<form class="lr-form"><fieldset><legend>How should it be translated?</legend>` +
			[...groups].map(([label, is]) => `<div class="lr-g">${escapeHTML(label)}</div>` + is.map(i =>
				`<label class="lr-opt"><input type="radio" name="lrs" value="${i}"${i === sel ? ' checked' : ''}><span class="lr-t"><b>${escapeHTML(dicts[i][1])}</b><span>${escapeHTML(plain(dicts[i][3]).slice(0, 90))}</span></span></label>`).join('')).join('') +
			`</fieldset><label class="lr-rem"><input type="checkbox" name="rem"${pref >= 0 ? ' checked' : ''}> Remember for ${escapeHTML(pe.dataset.dict)} — skip this question</label>` +
			`<button type="submit" class="lr-go">Translate</button></form>`);
		sheetBody.querySelector('form').addEventListener('submit', ev => {
			ev.preventDefault();
			const f = ev.target;
			const i = +f.lrs.value;
			if (f.rem.checked) learnPrefs[pe.dataset.dict] = dicts[i][1];
			else delete learnPrefs[pe.dataset.dict];
			try { localStorage.setItem(learnKey, JSON.stringify(learnPrefs)); } catch (e) { /* not remembered */ }
			closeSheet();
			runLearn(pe, i);
		});
	}

	// ---------------------------------------------------------------
	// Library (⚙): the dictionaries, grouped, with a filter
	// ---------------------------------------------------------------
	function renderLibrary(){
		const groups = [];
		dicts.forEach((dict, idx) => {
			const {category, isPrimary, lang} = files[idx];
			const key = (isAddon(idx) ? 'zz' : '') + category.join('/');
			let g = groups.find(x => x.key === key);
			if (!g) groups.push(g = {key, label: catLabel(category), addon: isAddon(idx), items: []});
			g.items.push({idx, extra: !isPrimary, lang});
		});
		groups.sort((a, b) => a.addon - b.addon);
		let html = `<div class="lib-top"><h2>Library</h2><span class="lib-sub">${escapeHTML(cap(curLang))} · ${dicts.length} resources</span></div>` +
			`<input type="search" id="libFilter" placeholder="Filter by name or source" autocomplete="off">`;
		html += groups.map((g, gi) => `<details class="lib-g${g.addon ? ' addon' : ''}" data-g="${gi}"${g.addon ? '' : ' open'}><summary>` +
			`<span class="lib-gt"><span class="lib-gn">${escapeHTML(g.label)}</span><span class="lib-gc"></span></span>` +
			`<button type="button" class="lib-all" data-g="${gi}">All on</button></summary>` +
			(g.addon ? '<p class="lib-note">Shown inside the other entries, not on their own.</p>' : '') +
			`<ol class="dictlist">` + g.items.map(({idx, extra, lang}) => {
				const dict = dicts[idx];
				const desc = plain(dict[3]);
				return `<li class="dictlist-item dictlist-file" data-id="${dict[0]}" data-idx="${idx}" data-text="${escapeHTML((dict[1] + ' ' + desc + ' ' + lang).toLowerCase())}">` +
					`<button type="button" class="dictlist-focus" onclick="setFocus(${idx})" title="Focus: show ${escapeHTML(dict[1])} first and translate with it" aria-label="Focus ${escapeHTML(dict[1])}">★</button>` +
					`<span class="lib-main"><span class="lib-name">${escapeHTML(dict[1])}${extra ? ` <span class="lib-lang">${escapeHTML(lang)}</span>` : ''}</span><span class="lib-desc" title="${escapeHTML(desc)}">${escapeHTML(desc)}</span></span>` +
					`<a href="?dict=${encodeURIComponent(dict[1])}" class="dictlist-solo" title="Open ${escapeHTML(dict[1])} on its own" aria-label="Open ${escapeHTML(dict[1])} on its own">↗</a>` +
					`<input type="checkbox" class="fcheckbox down" data-id="${idx}"${dict[4] ? ' checked' : ''} onchange="updateDictList(this)" id="${idx}"><label for="${idx}" class="modern-toggle" aria-label="Use ${escapeHTML(dict[1])}"><span class="toggle-switch"></span></label></li>`;
			}).join('') + `</ol></details>`).join('');
		listDiv.innerHTML = html;
		listDiv.groups = groups;
		updateLibCounts();
	}
	let listDiv = document.getElementById('listDiv');
	function updateLibCounts(){
		(listDiv.groups || []).forEach((g, gi) => {
			const on = g.items.filter(({idx}) => document.getElementById(`${idx}`)?.checked).length;
			const det = listDiv.querySelector(`details[data-g="${gi}"]`);
			if (!det) return;
			det.querySelector('.lib-gc').textContent = `${on} of ${g.items.length} on`;
			det.querySelector('.lib-all').textContent = on === g.items.length ? 'All off' : 'All on';
		});
	}
	listDiv.addEventListener('click', e => {
		const b = e.target.closest('.lib-all');
		if (!b) return;
		e.preventDefault();
		const g = listDiv.groups[+b.dataset.g];
		const turnOn = !g.items.every(({idx}) => document.getElementById(`${idx}`)?.checked);
		g.items.forEach(({idx}) => {
			const cb = document.getElementById(`${idx}`);
			if (cb && cb.checked !== turnOn) { cb.checked = turnOn; updateDictList(cb); }
		});
		saveState();
		updateLibCounts();
	});
	listDiv.addEventListener('change', updateLibCounts);
	listDiv.addEventListener('input', e => {
		if (e.target.id !== 'libFilter') return;
		const q = e.target.value.trim().toLowerCase();
		listDiv.querySelectorAll('.lib-g').forEach(det => {
			let any = false;
			det.querySelectorAll('.dictlist-file').forEach(li => {
				const hit = !q || li.dataset.text.includes(q);
				li.classList.toggle('hide', !hit);
				any = any || hit;
			});
			det.classList.toggle('hide', !any);
			if (q && any) det.open = true;
		});
	});
	// ---------------------------------------------------------------
	// Bottom bar: Search · Library · History · Bookmarks
	// ---------------------------------------------------------------
	const bottomNav = document.getElementById('bottomNav');
	const panel = document.getElementById('panel');
	let view = 'search';
	function setView(v){
		view = v;
		document.body.dataset.view = v;
		bottomNav.querySelectorAll('button').forEach(b => b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
		if (v === 'history') renderSaved('history');
		else if (v === 'bookmarks') renderSaved('bookmarks');
		header.classList.remove('compact');
		window.scrollTo(0, 0);
	}
	bottomNav.addEventListener('click', e => {
		const b = e.target.closest('button[data-view]');
		if (!b) return;
		if (b.dataset.view === 'search' && view === 'search') { queryInput.focus(); queryInput.select(); return; }
		setView(b.dataset.view);
		if (b.dataset.view === 'search') loadmore();
	});
	document.body.dataset.view = 'search';
	const loadList = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } };
	const saveList = (k, l) => { try { localStorage.setItem(k, JSON.stringify(l)); } catch (e) { /* not remembered */ } };
	const here = location.pathname.replace(/\/+$/, '') || '/';
	const pathSym = p => langSym(p.split('/').filter(Boolean)[0] || '');
	function openSaved(item){
		if (item.p === here) { setView('search'); setQueryText(item.q); startSearch(); }
		else location.href = item.p + '?text=' + encodeURIComponent(item.q);
	}
	const dayLabel = t => {
		const d = new Date(t), n = new Date();
		const days = Math.round((new Date(n.toDateString()) - new Date(d.toDateString())) / 864e5);
		return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
	};
	const timeLabel = t => new Date(t).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});

	// History: each search that found something, once the typing settles
	const HKEY = 'peakslab-history';
	const BKEY = 'peakslab-bookmarks';
	let histTimer = null;
	function noteHistory(){
		clearTimeout(histTimer);
		const q = queryText.trim();
		if (!q) return;
		histTimer = setTimeout(() => {
			if (num === 0 || queryText.trim() !== q) return;
			const l = loadList(HKEY).filter(x => !(x.q === q && x.p === here));
			l.unshift({q, p: here, t: Date.now()});
			saveList(HKEY, l.slice(0, 200));
		}, 1500);
	}
	function renderSaved(kind){
		const key = kind === 'history' ? HKEY : BKEY;
		const list = loadList(key);
		let day = '';
		const rows = list.map((x, i) => {
			const d = dayLabel(x.t);
			const head = kind === 'history' && d !== day ? `<h3 class="sheet-h">${escapeHTML(d)}</h3>` : '';
			day = d;
			return head + `<div class="sv-row"><button type="button" class="sv-open" data-i="${i}">` +
				`<span class="sv-sym">${escapeHTML(pathSym(x.p))}</span>` +
				`<span class="sv-main"><span class="sv-q">${escapeHTML(x.h || x.q)}</span>${x.s ? `<span class="sv-s">${escapeHTML(x.s)}</span>` : ''}</span>` +
				`<span class="sv-t">${escapeHTML(kind === 'history' ? timeLabel(x.t) : dayLabel(x.t))}</span></button>` +
				`<button type="button" class="sv-del" data-del="${i}" aria-label="Remove ${escapeHTML(x.h || x.q)}">×</button></div>`;
		}).join('');
		panel.innerHTML = `<div class="sv-top"><h2>${kind === 'history' ? 'History' : 'Bookmarks'}</h2>` +
			(list.length && kind === 'history' ? '<button type="button" class="sv-clear">Clear all</button>' : '') + `</div>` +
			(list.length ? `<div class="sv-list">${rows}</div>` :
				`<p class="sv-empty">${kind === 'history' ? 'Words you look up show up here.' : 'Tap the bookmark next to a headword or verse to keep it here.'}</p>`);
		panel.onclick = e => {
			const del = e.target.closest('[data-del]');
			const open = e.target.closest('[data-i]');
			if (del) {
				list.splice(+del.dataset.del, 1);
				saveList(key, list);
				if (kind === 'bookmarks') bmChanged();
				renderSaved(kind);
			} else if (open) openSaved(list[+open.dataset.i]);
			else if (e.target.closest('.sv-clear')) { saveList(key, []); renderSaved(kind); }
		};
	}

	// Bookmarks: the button next to each headword (or a tapped verse)
	let bmSet = new Set();
	const sectionKey = pd => pd.id.replace(/^mid-/, '');
	function markBookmark(pd){
		const b = pd.querySelector(':scope > h2 .bm-btn');
		if (!b) return;
		const on = bmSet.has(sectionKey(pd));
		b.classList.toggle('on', on);
		b.setAttribute('aria-pressed', on);
		b.title = on ? 'Remove bookmark' : 'Bookmark';
	}
	function bmChanged(){
		bmSet = new Set(loadList(BKEY).filter(b => b.p === here).map(b => b.q));
		resultsDiv.querySelectorAll(':scope > p-d').forEach(markBookmark);
	}
	window.togglePin = btn => {
		const pd = btn.closest('p-d');
		const q = sectionKey(pd);
		const l = loadList(BKEY);
		const i = l.findIndex(b => b.q === q && b.p === here);
		if (i >= 0) l.splice(i, 1);
		else {
			const pe = pd.querySelector(':scope > p-e:not(.addon)');
			const s = pe ? (entryText(pe).split('\n').find(x => x.trim()) || '').slice(0, 120) : '';
			l.unshift({q, h: pd.querySelector('.hw')?.textContent || q, s, p: here, t: Date.now()});
		}
		saveList(BKEY, l);
		bmChanged();
	};
	bmChanged();
	renderLibrary();
	updateFocusUI();

	ack = function(url){
		const x = dicts.findIndex(y => y[0] == url);
		if(x >= 0){
			const y = document.getElementById(`${x}`)
			y.classList.remove('down');
			y.disabled = false;
		}
	}

	// Which dictionaries are enabled is remembered in IndexedDB, falling back
	// to localStorage. Storage is a convenience only: if neither works
	// (blocked in some privacy modes and in-app webviews, quota errors, ...)
	// the defaults load and the page works normally - it just won't remember
	// the user's choices. Previously a failed IndexedDB open left the page
	// stuck on "Loading dictionaries." with nothing ever loaded.
	let db = null;
	let stateApplied = false;
	const lsKey = `peakslab-dicts-${appname}`;

	function lsGet() {
		try { return JSON.parse(localStorage.getItem(lsKey)); } catch (e) { return null; }
	}
	function lsSet(state) {
		try { localStorage.setItem(lsKey, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
	}

	// Called exactly once, with the saved array or null for defaults.
	// With onlyIfSaved, does nothing unless there's a saved array.
	function applyState(saved, onlyIfSaved) {
		if (stateApplied || (onlyIfSaved && !Array.isArray(saved) && solo < 0)) return;
		stateApplied = true;
		if (solo >= 0) { // Leaves the saved choices alone for the normal page
			dicts.forEach((_, index) => setCheckbox(index, index === solo));
			loadDict(solo);
			return;
		}
		enableSaved(saved);
	}

	// Loads the saved choices (or the defaults), and the focused dictionary.
	function enableSaved(saved) {
		const savedMap = new Map((Array.isArray(saved) ? saved : []).map(item => [item.file, !!item.enabled]));
		dicts.forEach((dict, index) => {
			const shouldEnable = index === focus || (savedMap.has(dict[0])
				? savedMap.get(dict[0])
				: (dict[4] === true || dict[4] === undefined)); // default from dict definition
			setCheckbox(index, shouldEnable);
			if (shouldEnable) loadDict(index);
		});
	}

	function noIndexedDB(err) {
		if (err) console.warn('IndexedDB unavailable, using localStorage instead:', err);
		db = null;
		applyState(lsGet());
	}

	// Start loading right away from the copy in localStorage (synchronous)
	// instead of waiting for IndexedDB to open; IndexedDB is only needed
	// when there's no copy here yet (e.g. state saved by an older version).
	applyState(lsGet(), true);

	try {
		const dbRequest = indexedDB.open(appname, 1);
		dbRequest.onupgradeneeded = (event) => {
			const upgradeDb = event.target.result;
			if (!upgradeDb.objectStoreNames.contains(appname)) {
				upgradeDb.createObjectStore(appname, { keyPath: 'id' });
			}
		};
		dbRequest.onsuccess = () => {
			db = dbRequest.result;
			loadSavedState();
		};
		dbRequest.onerror = (event) => noIndexedDB(event.target.error);
		// Another tab holding an old version open: don't wait on it.
		dbRequest.onblocked = () => noIndexedDB('blocked by another tab');
	} catch (e) {
		noIndexedDB(e); // indexedDB missing, or open() threw (e.g. SecurityError)
	}
	// Last resort: if IndexedDB never answers at all, don't leave the page
	// without dictionaries.
	setTimeout(() => { if (!stateApplied) noIndexedDB('no response from IndexedDB'); }, 3000);

	function saveState() {
		if (solo >= 0) return;
		const state = dicts.map((dict, index) => ({
			file: dict[0],                    // filename as stable key
			enabled: !dict_master_code[index] // true = checkbox checked / dictionary loaded
		}));
		lsSet(state); // always kept as a backup copy
		if (!db) return;
		try {
			const request = db.transaction([appname], 'readwrite').objectStore(appname).put({ id: 1, array: state });
			request.onerror = (e) => console.warn('Error saving state to IndexedDB:', e.target.error);
		} catch (e) {
			console.warn('Error saving state to IndexedDB:', e);
		}
	}

	function setCheckbox(index, checked){
		const checkbox = document.getElementById(index);
		if (checkbox) {
				checkbox.checked = checked;
		}
		updateLibCounts();
	}

	function loadSavedState() {
		try {
			const request = db.transaction([appname], 'readonly').objectStore(appname).get(1);
			request.onsuccess = () => {
				const result = request.result;
				applyState(result && Array.isArray(result.array) ? result.array : lsGet());
			};
			request.onerror = (event) => noIndexedDB(event.target.error);
		} catch (e) {
			noIndexedDB(e);
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
	let tout = resultsDiv;

	function unloadDict(d){
		workers[d%workers.length].postMessage({type: 'destroy', did: Math.floor(d/workers.length)});
		dict_master_code[d] = true;
	}

	function updateDictList(checkbox){
		const d = parseInt(checkbox.dataset.id);
		if(checkbox.checked){
			loadDict(d);
		}else{
			unloadDict(d);
			if(d === focus && solo < 0)
				setFocus(d); // Unfocus it
			saveState();
		}
	}
	window.updateDictList = updateDictList;

	// Clicking a dictionary's name focuses it, or unfocuses it. On a solo
	// page it switches to that dictionary instead.
	function setFocus(i){
		if (solo >= 0) {
			if (i === solo) return;
			unloadDict(solo);
			setCheckbox(solo, false);
			solo = i;
		}
		focus = i === focus ? -1 : i;
		if (focus >= 0) {
			setCheckbox(focus, true);
			loadDict(focus); // Does nothing if it's loaded
			saveState();
		}
		rememberFocus();
		updateFocusUI();
		query = ""; // Search again
		startSearch();
	}
	window.setFocus = setFocus;

	function rememberFocus(){
		if (solo >= 0) return;
		try { focus >= 0 ? localStorage.setItem(focusKey, dicts[focus][0]) : localStorage.removeItem(focusKey); } catch (e) { /* not remembered */ }
	}

	// The address bar always holds a link to what's on screen.
	function updateURL(){
		const p = new URLSearchParams();
		if (solo >= 0) p.set('dict', dicts[solo][1]);
		else if (focus >= 0) p.set('focus', dicts[focus][1]);
		if (queryText) p.set('text', queryText);
		const qs = p.toString();
		history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
	}

	async function share(btn){
		updateURL();
		const url = window.location.href;
		try {
			if (navigator.share) {
				await navigator.share({title: document.title, url: url});
				return;
			}
			await navigator.clipboard.writeText(url);
			btn.textContent = '✓ Link copied';
			setTimeout(() => { btn.textContent = '⤴ Share'; }, 1500);
		} catch (e) {
			if (e.name !== 'AbortError') window.prompt('Copy this link:', url);
		}
	}

	function updateFocusUI(){
		const name = focus >= 0 ? dicts[focus][1] : '';
		queryInput.placeholder = focus >= 0 ? `Search or translate with ${name}…` : defaultPlaceholder;
		document.querySelectorAll('.dictlist-file').forEach(li => li.classList.toggle('focused', +li.dataset.idx === focus));
		updateURL();
	}


	function openPopupSearch(text){
		cleanup(popupResults);
		let temp_dict_code = new Array(dicts.length).fill(true);
		workers.forEach((w, i) =>{
			let code = temp_dict_code.filter((_, index) => index % workers.length == i);
			w.postMessage({type: "tempsearch", st: 1, query: updateQuery(text), dest: "popup", dicts: code});
			w.postMessage({type: "tempsearch", st: 2, query: updateQuery(text), dest: "popup", dicts: code});
		});
	}
	function popupOpen(){
		popupOverlay.style.display = 'block';
		document.getElementById('popupContent').scrollTop = 0;
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

	function showSettings(){
		loader = null;
		statusDiv.textContent = "";
		settings.style.display = 'block';
		resultsDiv.replaceChildren();
		translationDiv.replaceChildren();
		viewBar.classList.add('hide');
		byDictDiv.classList.add('hide');
	}

	// The worker's index for the focused dictionary, if worker i has it
	function focusDid(i){
		return focus >= 0 && focus % workers.length == i ? Math.floor(focus / workers.length) : -1;
	}

	let searchGen = 0;
	function initSearch(){
		num = 0;
		++searchGen;
		workers.forEach((w, i) =>{
			let code = dict_code.filter((_, index) => index % workers.length == i);
			w.postMessage({type: "initsearch", st: st, dicts: code, focus: focusDid(i), gen: searchGen});
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
				w.postMessage({type: "continuesearch", st: st, focus: focusDid(i)});
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

	// Results come a page at a time: a search gets PAGE of them, and only
	// scrolling near the end (or the Show more button) asks for the next
	// page. Folded headwords and filters keep the end of the list on
	// screen, which used to pull in every result at once.
	const PAGE = 20;
	let budget = PAGE;
	function loadmore(){
		if(view !== 'search' || !loader || !worker_code.includes(false) || !wantloadmore(loader, 400)) return;
		if(budget > 0){
			getResults();
		}else if(!loader.querySelector('button')){
			loader.innerHTML = '<button type="button" class="more-btn">Show more</button>';
			loader.firstChild.onclick = () => morePage();
		}
	}
	function morePage(){
		budget = PAGE;
		if(loader) loader.textContent = 'Loading more…';
		loadmore();
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

	// Scrolling down to the end asks for the next page
	let lastScroll = 0;
	window.addEventListener('scroll', throttle(() => {
		const down = window.scrollY > lastScroll;
		lastScroll = window.scrollY;
		if(down && budget <= 0 && wantloadmore(loader, 200)) morePage();
		else loadmore();
	}, 120), { passive: true });
	window.addEventListener('resize', throttle(loadmore, 120));

	const globreg = /[!+*^]/;

	// The worker translates only if the focused dictionary has no entry for
	// the query (check: true).
	function translate(){
		if (focus < 0 || dict_master_code[focus] || dicts[focus][0].includes('.slab') || globreg.test(query)) return;
		workers[focus % workers.length].postMessage({type: 'translate', did: Math.floor(focus / workers.length), query: query, check: true});
	}

	function escapeHTML(text){
		return text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
	}

	// The first line of an entry, as plain text, skipping lines that are only
	// [pronunciation] or [[see also]] brackets (like h97's second column)
	function firstLine(html){
		const t = document.createElement('template');
		t.innerHTML = html.replace(/<br\s*\/?>|<\/?(li|p|div|ul|ol)\b[^>]*>|\t/gi, '\n');
		const lines = t.content.textContent.split('\n').map(x => x.trim()).filter(Boolean);
		return lines.find(x => !/^(\[[^\]]*\]+\s*)+$/.test(x)) || lines[0] || '';
	}

	// Each word with the first line of its entry under it; tapping the
	// word (a p-a) opens the full entry in the popup.
	function translationHTML(pieces){
		return pieces.map(p => {
			if (p.body === undefined) { // Unmatched text, newlines kept
				return p.text.split('\n').map(line => line.trim() ? `<span class="tr-w tr-u">${escapeHTML(line.trim())}</span>` : '').join('<br>');
			}
			const gloss = escapeHTML(firstLine(p.body));
			return `<span class="tr-w"><p-a>${escapeHTML(p.text)}</p-a><span class="tr-g" title="${gloss}">${gloss}</span></span>`;
		}).join('');
	}

	function showTranslation(data){
		if (data.query !== query || !data.pieces.some(p => p.body !== undefined)) return;
		const div = document.createElement('p-d');
		div.className = 'translation';
		div.innerHTML = `<h2>${escapeHTML(data.dict)}</h2>` + translationHTML(data.pieces);
		translationDiv.replaceChildren(div);
		if (num == 0) {
			cleanup(tout); // The last query's results would look like this one's
			statusDiv.textContent = `No entry in ${data.dict}, translated word by word.`;
			queryInput.classList.remove('error');
		}
	}

	// Word by word translation of one entry (see learnEntry), shown in a box
	// under it once the worker answers.
	const entryTranslations = new Map(); // tag -> the box waiting for it
	let entryTag = 0;
	const canTranslate = i => !dict_master_code[i] && !dicts[i][0].includes('.slab');

	// An entry's text, a line per line (or list item, paragraph, ...)
	function entryText(pe){
		const c = pe.cloneNode(true);
		c.querySelectorAll('p-h, button, .tr-entry').forEach(x => x.remove());
		const t = document.createElement('template');
		t.innerHTML = c.innerHTML.replace(/<br\s*\/?>|<\/?(li|p|div|ul|ol|h[1-6]|p-n|p-ipa)\b[^>]*>|\t/gi, '\n');
		return t.content.textContent.split('\n').map(x => x.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}

	function translateEntryWith(box, text, i){
		box.textContent = `Translating with ${dicts[i][1]}…`;
		entryTranslations.set(++entryTag, box);
		workers[i % workers.length].postMessage({type: 'translate', did: Math.floor(i / workers.length), query: updateQuery(text), tag: entryTag});
	}

	function showEntryTranslation(data){
		const box = entryTranslations.get(data.tag);
		entryTranslations.delete(data.tag);
		if (!box || !box.isConnected) return;
		box.innerHTML = `<div class="tr-head"><span>Translated with <b>${escapeHTML(data.dict)}</b></span><button type="button" class="tr-change" onclick="learnChange(this)">Change style</button></div>` +
			(data.pieces.some(p => p.body !== undefined) ? translationHTML(data.pieces) : 'No words found.');
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
		query = bibleRef(query) || query; // "John 3" → "joh 3."
		if(!query){
			showSettings();
			return;
		}
		noteHistory();
		byDictDiv.classList.toggle('hide', combined);
		if(query == prevquery){
			return;
		}
		translationDiv.replaceChildren();
		window.scrollTo(0, 0);
		worker_code.fill(false);
		st = globreg.test(query) ? 0 : 3;
		dict_code = new Array(dicts.length).fill(true); // worker-side null checks skip dicts that aren't loaded

		statusDiv.textContent = "Searching...";

		loader = null;
		loader = document.createElement('p-d');
		loader.id = 'loader';
		loader.textContent = "Loading more…";
		budget = PAGE;

		setQuery()
		initSearch();
		getResults();
		statusDiv.innerHTML = 'No matches found.';
		queryInput.classList.add("error");
		translate();
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
		if (view !== 'search') setView('search');
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
			localStorage.setItem('mark', document.body.classList.contains('mark'));
	});
	if (localStorage.getItem('mark') === 'false') {
		mark = false;
	}

	document.getElementById('debugT')?.addEventListener('click', () => {
			debug = !debug;
	});

	// Settings button
	document.getElementById('settingsBtn')?.addEventListener('click', () => {
		showSettings();
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
							openPopupSearch(this.textContent);
					});
			}
	}
	customElements.define('p-a', PaElement);
	createSelMenu();

	let newtiming = document.createElement("div")
	newtiming.id = 'loadTiming';
	document.body.appendChild(newtiming);
}
document.body.appendChild(Object.assign(document.createElement("span"), {id: "appVer", textContent: " v11.3"}));
