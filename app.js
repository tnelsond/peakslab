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
// Reused for every pin button (the fixed one and one per result) — defined
// once so we're not rebuilding this markup on every streamed result.
const pinIconSVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M16,12V4h1V2H7v2h1v8l-2,2v2h5.2v6h1.6v-6H18v-2L16,12z"/></svg>';
const pinCloseIconSVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
const pinCloseIconSVGSmall = pinCloseIconSVG.replace(/width="20" height="20"/, 'width="16" height="16"');
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
const collapseBtnHTML = '<button type="button" class="collapse-btn" onclick="toggleDict(this)" title="Collapse or expand this dictionary"></button>';
// Translates an entry word by word, see translateEntry
const translateBtnHTML = '<button type="button" class="translate-btn" onclick="translateEntry(this)" title="Translate word by word">⇄</button>';
const collapseStyle = document.head.appendChild(document.createElement('style'));
let collapsedDicts = [];
try { collapsedDicts = JSON.parse(localStorage.getItem('collapsedDicts')) || []; } catch (e) {}
const applyCollapsed = () => {
	const sel = collapsedDicts.map(d => `p-e[data-dict="${CSS.escape(d)}"]`);
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
	['searchContainer', 'content', 'about', 'controls'].forEach(id => {
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
						promise = fetch('/peak.wasm')
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
					document.getElementById(`${d}`)?.classList.remove('down');
					timingDiv.insertAdjacentHTML("beforeend", `${Math.round(performance.now())}ms ${e.data.msg}<br>`);
					--nload;
					loadProgress.textContent = `Loading ${nload} more dictionaries.`;
					newtiming.innerHTML = `${Math.round(performance.now())}ms `;
					if(nload == 0){
						loadProgress.style.display = 'none';
						saveState();
					}else{
						loadProgress.style.display = 'block';
					}
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
					const sortid = d === focus ? 0 : d + 1; // The focused dictionary first
					el.setAttribute('data-id', sortid);
					el.dataset.dict = e.data.dict;
					if(debug)
						el.innerHTML += `<p-h>${e.data.dict} ${e.data.st} '${e.data.query}' #${sortid}</p-h>`;
					else
						el.innerHTML += `<p-h>${e.data.dict}</p-h>`;
					if(first)
						div.innerHTML += `<h2>${e.data.header} <button type="button" class="pin-btn" onclick="togglePin(this)" title="Pin this section" style="background:var(--control-btn-bg);border:none;border-radius:50%;width:22px;height:22px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;vertical-align:middle;">${pinIconSVG}</button></h2>`;
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
							el.querySelector('p-h')?.insertAdjacentHTML('afterend', chordsBtnHTML);
						}
					}
					if(!e.data.filetype)
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
					if(first && popup){
						popupOpen();
						document.addEventListener('click', closePopupClick); 
					}
					if(!popup){
						++num;
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
		const el = document.getElementById("appname");
		if (el) el.textContent = appname;
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
	const focusChip = document.createElement('button');
	focusChip.type = 'button';
	focusChip.className = 'solo-chip hide';
	focusChip.addEventListener('click', () => solo >= 0 ? leaveSolo() : setFocus(focus));
	queryInput.insertAdjacentElement('afterend', focusChip);

	const statusDiv  = document.getElementById('status');
	const resultsDiv = document.getElementById('results');
	const popupOverlay = document.getElementById('popupOverlay');
	const popupQuery = document.getElementById('popupQuery');
	const popupResults = document.getElementById('popupResults');
	const popupClose = document.getElementById('popupClose');

	// Pinning: pinning clones a p-d section into its own (non-persistent) view.
	// The "Pinned" button matches the round control buttons and just shows an
	// icon, no text. It only appears once there's at least one pin. The
	// original section stays right where it was.
	let pinned = [];
	let showingPinned = false;
	// Above the results: the big text box for long queries and the
	// focused dictionary's word by word translation.
	const topDiv = document.createElement('div');
	resultsDiv.insertAdjacentElement('beforebegin', topDiv);
	const bigQuery = topDiv.appendChild(document.createElement('textarea'));
	bigQuery.id = 'bigQuery';
	bigQuery.classList.add('hide');
	// Share button and the enabled dictionaries (tap one to focus it)
	const searchBar = topDiv.appendChild(document.createElement('div'));
	searchBar.id = 'searchBar';
	searchBar.classList.add('hide');
	searchBar.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		if (b.dataset.idx) setFocus(+b.dataset.idx);
		else share(b);
	});
	const translationDiv = topDiv.appendChild(document.createElement('div'));

	const pinnedDiv = document.createElement('div');
	pinnedDiv.id = 'pinnedResults';
	pinnedDiv.classList.add('hide');
	resultsDiv.insertAdjacentElement('afterend', pinnedDiv);

	const pinTabBtn = document.getElementById('pinTab');
	pinTabBtn.addEventListener('click', () => {
		showingPinned = !showingPinned;
		// Swap to a red X so it's obvious this now closes the pinned view.
		pinTabBtn.innerHTML = showingPinned ? pinCloseIconSVG : pinIconSVG;
		pinTabBtn.style.background = showingPinned ? '#c0392b' : '';
		pinTabBtn.title = showingPinned ? 'Close pins' : 'Pins';
		resultsDiv.classList.toggle('hide', showingPinned);
		topDiv.classList.toggle('hide', showingPinned);
		pinnedDiv.classList.toggle('hide', !showingPinned);
		// Pinned view is just a scrapbook of saved sections — hide the search
		// bar and all the live-search diagnostics/status while looking at it.
		document.getElementById('searchContainer')?.classList.toggle('hide', showingPinned);
		document.getElementById('version')?.classList.toggle('hide', showingPinned);
		statusDiv.classList.toggle('hide', showingPinned);
		loadProgress.classList.toggle('hide', showingPinned);
		newtiming.classList.toggle('hide', showingPinned);
	});

	let isfull = false;
	const f4 = document.getElementById('f4');
	f4.addEventListener('click', () => {
		isfull = !isfull;
		document.getElementById('controls')?.classList.toggle('hidev', isfull);
		document.getElementById('searchContainer')?.classList.toggle('hide', isfull);
	});

	function updatePinnedTab(){
		pinTabBtn.classList.toggle('hide', pinned.length === 0);
		if(pinned.length === 0 && showingPinned){
			pinTabBtn.click(); // switch back to live results
		}
	}

	window.togglePin = function(btn){
		const pd = btn.closest('p-d');
		if(!pd) return;
		if(pd.parentElement === pinnedDiv){
			// This is a pinned clone — unpin just removes it.
			pinned = pinned.filter(p => p !== pd);
			pd.remove();
		}else{
			// Clone the section; the original stays put.
			const clone = pd.cloneNode(true);
			clone.removeAttribute('id'); // avoid duplicate ids in the document
			const cloneBtn = clone.querySelector('.pin-btn');
			if(cloneBtn){
				cloneBtn.innerHTML = pinCloseIconSVGSmall;
				cloneBtn.title = 'Unpin';
			}
			pinned.push(clone);
			pinnedDiv.appendChild(clone);
		}
		updatePinnedTab();
	};

	const loadProgress = document.getElementById('loadProgress');
	loadProgress.textContent = `Loading dictionaries.`;

	// Dictionary list, grouped by full category path (language folder + category,
	// e.g. "khmer / music / chords"). Each group gets a single flat heading with
	// every path segment as its own clickable link, followed by its files as a
	// plain list - no nesting or per-depth indentation. Extras from other
	// languages get a small microheader within the group.
	let temp = `<h2>${appname.toUpperCase()} Dictionary List:</h2><ol class="dictlist">`;

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
			temp += `<li class="dictlist-extra-label">${lang}</li>`;
		}
		prevLang = isPrimary ? null : lang; // next extra language (or the primary again) gets its own header

		temp += `<li class="dictlist-item dictlist-file" data-id="${dict[0]}" data-idx="${idx}">${idx+1}.<input type="checkbox" class="fcheckbox down" data-id="${idx}"${dict[4] ? "checked" : ""} onchange="updateDictList(this)" id="${idx}"><label for="${idx}" class="modern-toggle"><span class="toggle-switch"></span></label><button type="button" class="dictlist-focus" onclick="setFocus(${idx})" title="Focus: show ${dict[1]} first and translate with it"><strong>${dict[1]}</strong></button><a href="?dict=${encodeURIComponent(dict[1])}" class="dictlist-solo" title="Open ${dict[1]} on its own">↗</a> : ${dict[3]}</li>`;
	});
	temp += `</ol>`;
	let listDiv = document.getElementById('listDiv');
	listDiv.innerHTML += temp;
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
			if (dict_master_code[i]) {
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
		if (solo < 0) {
			try { focus >= 0 ? localStorage.setItem(focusKey, dicts[focus][0]) : localStorage.removeItem(focusKey); } catch (e) { /* not remembered */ }
		}
		updateFocusUI();
		query = ""; // Search again
		startSearch();
	}
	window.setFocus = setFocus;

	// From a solo page to the normal one, still focused, without reloading.
	function leaveSolo(){
		solo = -1;
		try { localStorage.setItem(focusKey, dicts[focus][0]); } catch (e) { /* not remembered */ }
		enableSaved(lsGet());
		updateFocusUI();
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

	function renderSearchBar(){
		const enabled = dicts.map((_, i) => i).filter(i => !dict_master_code[i] && i !== focus);
		if (focus >= 0 && !dict_master_code[focus]) enabled.unshift(focus);
		searchBar.innerHTML = '<button type="button" class="sb-share" title="Share this search">⤴ Share</button>' +
			enabled.map(i => `<button type="button" class="sb-dict${i === focus ? ' focused' : ''}" data-idx="${i}" title="${i === focus ? 'Unfocus' : 'Focus'} ${escapeHTML(dicts[i][1])}">${escapeHTML(dicts[i][1])}</button>`).join('');
		searchBar.classList.remove('hide');
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
		focusChip.classList.toggle('hide', focus < 0);
		focusChip.textContent = solo >= 0 ? `${name} only ✕` : `${name} ✕`;
		focusChip.title = solo >= 0 ? 'Load the other dictionaries too' : `Stop focusing on ${name}`;
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

	function showSettings(){
		loader = null;
		statusDiv.textContent = "";
		settings.style.display = 'block';
		resultsDiv.replaceChildren();
		translationDiv.replaceChildren();
		searchBar.classList.add('hide');
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

	function loadmore(){
		if(showingPinned) return;
		if(wantloadmore(loader, 400) && worker_code.includes(false))
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

	// The ⇄ button on an entry: translates its text with the focused
	// dictionary, or asks which one. Tap again to hide it.
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

	window.translateEntry = btn => {
		const pe = btn.closest('p-e');
		const open = pe.querySelector('.tr-entry');
		if (open) {
			open.remove();
			return;
		}
		const text = entryText(pe);
		const box = pe.appendChild(document.createElement('div'));
		box.className = 'tr-entry';
		if (focus >= 0 && canTranslate(focus)) {
			translateEntryWith(box, text, focus);
			return;
		}
		const options = dicts.map((_, i) => i).filter(canTranslate);
		box.innerHTML = 'Translate with: ' + options.map(i => `<button type="button" data-idx="${i}">${escapeHTML(dicts[i][1])}</button>`).join('');
		box.onclick = e => {
			const b = e.target.closest('button[data-idx]');
			if (!b) return;
			e.stopPropagation(); // The button goes away, which would look like a click outside the popup
			box.onclick = null;
			translateEntryWith(box, text, +b.dataset.idx);
		};
	};

	function showEntryTranslation(data){
		const box = entryTranslations.get(data.tag);
		entryTranslations.delete(data.tag);
		if (!box || !box.isConnected) return;
		box.innerHTML = `<div class="tr-head">${escapeHTML(data.dict)}</div>` +
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
		if(nload == 0){
			loadProgress.style.display = 'none';
		}
		if(!query){
			showSettings();
			return;
		}
		renderSearchBar();
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
	document.body.appendChild(newtiming);
}
document.body.appendChild(document.createTextNode(" v10.9"));
