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
const filesJson = await fetch('/files.json').then(r => r.json());

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
	document.getElementById('tabs')?.classList.add('hide'); // leftover container from the old tab bar, unused now

	const getSharedWasmModule = (() => {
		let promise = null;
		return async () => {
				if (!promise) {
						promise = fetch('/peak.wasm')
								.then(resp => resp.arrayBuffer())
								.then(buffer => WebAssembly.compile(buffer));
				}
				return promise;
		};
	})();

	// When creating your workers:
	async function createPeakWorker(id){
			const w = new Worker('/peakworker.js');
			workers.push(w);
			w.postMessage({ type: "init", wasm: await getSharedWasmModule(), id: id});
			w.onmessage = function(e){
				if(e.data.type == "loaded"){
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
					if(e.data.st == st){
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
				}else if(e.data.type == "result"){
					if(num == 0){
						cleanup(tout);
						tout.append(loader)
					}
					let idpre = e.data.dest == "popup" ? "pid" : "mid";
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
								w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: e.data.dest, dicts: code});
							});
						}
					}
					let el = document.createElement('p-e');
					const sortid = e.data.did*workers.length+e.data.id;
					el.setAttribute('data-id', sortid);
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
					}
					
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

					let place = e.data.dest == "popup" ? popupResults : resultsDiv;
					if(first){
						if(place == resultsDiv && loader){
							place.insertBefore(div, loader); 
						}else{
							place.appendChild(div); 
						}
						if(e.data.dest == "popup"){
							popupOpen();
							document.addEventListener('click', closePopupClick); 
						}
					}
					++num;
					queryInput.classList.remove("error");
					statusDiv.textContent = `Found ${num}+ matching lines.`;
					loadmore();
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

	// Group by category, primary (current-page) language first, then extras grouped
	// alphabetically by their own language.
	files.sort((a, b) =>
		a.category.join('/').localeCompare(b.category.join('/')) ||
		(a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1) ||
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

	let workers_num = dicts.length > 1 ? 2 : 1;
	let workers = [];
	for(let i=1; i<=workers_num; ++i){
		createPeakWorker(i);
	}
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
			listDiv.style.display = 'none';
			resultsDiv.replaceChildren(listDiv);
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
	queryInput.value = params.get('text');

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
		pinnedDiv.classList.toggle('hide', !showingPinned);
		// Pinned view is just a scrapbook of saved sections — hide the search
		// bar and all the live-search diagnostics/status while looking at it.
		document.getElementById('searchContainer')?.classList.toggle('hide', showingPinned);
		document.getElementById('version')?.classList.toggle('hide', showingPinned);
		statusDiv.classList.toggle('hide', showingPinned);
		loadProgress.classList.toggle('hide', showingPinned);
		newtiming.classList.toggle('hide', showingPinned);
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
	let temp = `<p-d><h2>${appname.toUpperCase()} Dictionary List:</h2><ol class="dictlist">`;

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

		temp += `<li class="dictlist-item dictlist-file" data-id="${dict[0]}">${idx+1}.<input type="checkbox" class="fcheckbox down" data-id="${idx}"${dict[4] ? "checked" : ""} onchange="updateDictList(this)" id="${idx}"><label for="${idx}" class="modern-toggle"><span class="toggle-switch"></span></label><strong>${dict[1]}</strong> : ${dict[3]}</li>`;
	});
	temp += `</ol></p-d>`;
	let listDiv = document.createElement('div');
	listDiv.innerHTML = temp;
	resultsDiv.append(listDiv);

	ack = function(url){
		const x = dicts.findIndex(y => y[0] == url);
		if(x >= 0){
			const y = document.getElementById(`${x}`)
			y.classList.remove('down');
			y.disabled = false;
		}
	}

	let db = null;
	const dbRequest = indexedDB.open(appname, 1);

	dbRequest.onupgradeneeded = (event) => {
			const upgradeDb = event.target.result;
			if (!upgradeDb.objectStoreNames.contains(appname)) {
					upgradeDb.createObjectStore(appname, { keyPath: 'id' });
					console.log('Created new object store:', appname);
			}
	};

	dbRequest.onsuccess = () => {
			db = dbRequest.result;
			console.log('IndexedDB opened successfully');
			loadSavedState();           // Only call once here
	};

	dbRequest.onerror = (event) => {
			console.error('Failed to open IndexedDB:', event.target.error);
	};

	function saveState() {
			if (!db) {
					console.warn('DB not ready yet, cannot save state');
					return;
			}

			const state = dicts.map((dict, index) => ({
					file: dict[0],                    // filename as stable key
					enabled: !dict_master_code[index] // true = checkbox checked / dictionary loaded
			}));

			const transaction = db.transaction([appname], 'readwrite');
			const store = transaction.objectStore(appname);

			const data = { id: 1, array: state };

			const request = store.put(data);
			request.onsuccess = () => console.log('Dictionary state saved');
			request.onerror = (e) => console.error('Error saving state:', e.target.error);
	}

	function setCheckbox(index, checked){
		const checkbox = document.getElementById(index);
		if (checkbox) {
				checkbox.checked = checked;
		}
	}

	function loadSavedState() {
			if (!db) {
					console.warn('DB not ready, skipping loadSavedState');
					loadDicts(); // fallback
					return;
			}

			const transaction = db.transaction([appname], 'readonly');
			const store = transaction.objectStore(appname);
			const request = store.get(1);

			request.onsuccess = () => {
					const result = request.result;

					if (result && result.array && Array.isArray(result.array)) {
							console.log('Loaded saved dictionary state from IndexedDB');

							const savedMap = new Map(result.array.map(item => [item.file, !!item.enabled]));

							dicts.forEach((dict, index) => {
									const filename = dict[0];

									const shouldEnable = savedMap.has(filename) 
											? savedMap.get(filename) 
											: (dict[4] === true || dict[4] === undefined); // default from dict definition

									setCheckbox(index, shouldEnable);
									
									// Load the dictionary immediately if enabled
									if (shouldEnable) {
											loadDict(index);
									}
							});
					} 
					else {
							console.log('No saved state found → using defaults from dict[4]');
							loadDicts(); // load defaults
					}
			};

			request.onerror = (event) => {
					console.error('Error reading from IndexedDB:', event.target.error);
					loadDicts(); // fallback to defaults
			};
	}

	function loadDict(i) {
			if (dict_master_code[i]) {
					workers[i % workers.length].postMessage({
							type: 'load',
							did: Math.floor(i / workers.length),
							msg: dicts[i]
					});
					++nload;
			}
	}

	function loadDicts(){
		const checkboxes = document.querySelectorAll('.fcheckbox');
		checkboxes.forEach((box) =>{
			if(box.checked){
				const i = box.dataset.id;
				if(dict_master_code[i]){
					loadDict(i);
				}
			}
		});
	}

	let query = null;
	let tout = resultsDiv;

	function updateDictList(checkbox){
		const d = parseInt(checkbox.dataset.id);
		if(checkbox.checked){
			loadDict(d);
		}else{
			workers[d%workers.length].postMessage({type: 'destroy', did: Math.floor(d/workers.length)});
			dict_master_code[d] = true;
			saveState();
		}
	}
	window.updateDictList = updateDictList;


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

	function updateQuery(text = queryInput.value){
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

	function initSearch(){
		num = 0;
		workers.forEach((w, i) =>{
			let code = dict_code.filter((_, index) => index % workers.length == i);
			w.postMessage({type: "initsearch", st: st, dicts: code});
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
				w.postMessage({type: "continuesearch", st: st});
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

	function startSearch() {
		const prevquery = query;
		query = updateQuery();
		if(nload == 0){
			loadProgress.style.display = 'none';
		}
		if(!query){
			loader = null;
			statusDiv.textContent = "";
			listDiv.style.display = 'block';
			resultsDiv.replaceChildren(listDiv);
			return;
		}
		if(query == prevquery){
			return;
		}
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

	queryInput.addEventListener('input', debounce(startSearch, 140));

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
	document.getElementById('darkModeToggle')?.addEventListener('click', () => {
			document.body.classList.toggle('dark-mode');
			localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
	});
	if (localStorage.getItem('darkMode') === 'true') {
			document.body.classList.add('dark-mode');
	}
	document.getElementById('markToggle')?.addEventListener('click', () => {
			mark = !mark;
			localStorage.setItem('mark', document.body.classList.contains('mark'));
	});
	if (localStorage.getItem('mark') === 'false') {
		mark = false;
	}

	document.getElementById('debugToggle')?.addEventListener('click', () => {
			debug = !debug;
	});


	// Settings modal
	document.getElementById('settingsBtn')?.addEventListener('click', () => {
			document.getElementById('settingsModal').style.display = 'flex';
	});

	document.querySelector('#settingsModal .close-btn')?.addEventListener('click', () => {
			document.getElementById('settingsModal').style.display = 'none';
	});

	document.getElementById('settingsModal')?.addEventListener('click', e => {
			if (e.target.id === 'settingsModal') {
					e.target.style.display = 'none';
			}
	});

	let voicetries = 2;
	let voices = [];
	let selMenu = null;
	function createSelMenu(){
		if(selMenu)
			selMenu.remove();
		selMenu = document.createElement('div')
		document.body.appendChild(selMenu);
		selMenu.className = 'selection-menu';
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
					document.getElementById('queryInput').value = text;
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

		let top = rect.bottom + 26 + window.scrollY;

		selMenu.style.top = `${top}px`;
		selMenu.style.display = 'block';
	}
	function hideSelMenu(){
		if(selMenu)
			selMenu.style.display = 'none';
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
			return /iPhone|iPad|iPod/i.test(navigator.userAgent);
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
