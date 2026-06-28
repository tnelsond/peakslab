"use strict";

/* Khmer stuff we're gonna extract out later */
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

const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
if (meta) {
  const current = meta.getAttribute('content') || '';  // Get existing content or empty string
  meta.setAttribute('content', current + appname.toUpperCase());  // Append and set
}
document.getElementById("appname").textContent = appname;
document.title += appname.toUpperCase();


let tstart = performance.now();
let num = 0;
let debug = false;
let mark = true;
let loader = null;
let isLoading = false;
let st = 3;
let nload = 0;
const timingDiv  = document.getElementById('timing');
const tabs  = document.getElementById('tabs');
const hidetabs = document.getElementById('hidetabs');

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
			//console.log(e.data);
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
					div.innerHTML += `<h2>${e.data.header}</h2>`;
				if(e.data.filetype){
					if(e.data.subheader){
						let sh = e.data.subheader;	
						if (typeof subheader_trans !== 'undefined' 
								&& typeof subheader_trans[e.data.dict] === 'function') {
								sh = subheader_trans[e.data.dict](sh);
						}
						el.innerHTML += `<p-n>${sh.join(",<br>")}</p-n>`;
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

const filesData = await fetch('/files.json').then(r => r.json());
const pagePath = window.location.pathname.replace(/^\/|\/$/g, ''); // strip leading/trailing slashes

// Current page path segments, e.g. ["khmer"] or ["khmer","bible"]
const currentParts = pagePath.split('/').filter(Boolean);

// 1. Files whose path includes all current page segments (primary match)
const filteredFiles = filesData.filter(([filename]) => {
    const fileParts = filename.split('/');
    return currentParts.every(seg => fileParts.includes(seg));
});

// Collect which top-level groups (first segment after /db/) exist in primary files
const primaryGroups = new Set();
for (const [filename] of filteredFiles) {
    const m = filename.match(/\/db\/([^/]+)\//);
    if (m) primaryGroups.add(m[1]);
}

// Helper: extract the group (first segment after /db/)
function fileGroup(filename) {
    const m = filename.match(/\/db\/([^/]+)\//);
    return m ? m[1] : 'other';
}

// Helper: get sub-path segments after /db/GROUP/ and before filename
function fileSubPath(filename) {
    const parts = filename.split('/');
    const dbIdx = parts.indexOf('db');
    return dbIdx >= 0 ? parts.slice(dbIdx + 2, -1) : [];
}

// Helper: strip extension from basename
function fileBasename(filename) {
    return filename.split('/').pop().replace(/(\.(peak|slab)(\.zst)?$)/, '');
}

// Helper: determine default-enabled from priority + sub-path depth
//   priority 1 or -1 → always enabled
//   priority 2       → only enabled at top level (no sub-folders)
//   anything else    → disabled
function defaultEnabled(priority, subPathLength) {
    const p = priority ?? 1;
    if (p === 1 || p === -1) return true;
    if (p === 2) return subPathLength === 0;
    return false;
}

// Helper: get a human-readable origin label for a low-priority file,
// e.g. the top-level path part that differs from currentParts ("english", "french" …)
function originLabel(filename) {
    const parts = filename.split('/').filter(Boolean);
    return parts.find(p => p !== 'db' && !currentParts.includes(p)) ?? parts[0];
}

// 2. Low-priority files (priority <= 0) from OTHER paths, only if their group
//    already exists in the primary set.
const lowPriorityExtras = filesData.filter(([filename, , , priority]) => {
    if ((priority ?? 1) > 0) return false;
    if (filteredFiles.some(f => f[0] === filename)) return false;
    const m = filename.match(/\/db\/([^/]+)\//);
    return m && primaryGroups.has(m[1]);
});

// 3. Build tablayout.
// dict entry: [filename, basename, buflen, description, enabled, originLabel|null]
// originLabel is null for primary files, a string (e.g. "english") for low-priority extras.
// All dicts (primary + extras) live in tab.dicts so workers see them all.
const groupMap = new Map(); // group → dict[]

for (const [filename, description, buflen, priority] of filteredFiles) {
    const group = fileGroup(filename);
    if (!groupMap.has(group)) groupMap.set(group, []);
    const subPath = fileSubPath(filename);
    groupMap.get(group).push([
        filename,
        fileBasename(filename),
        buflen,
        description,
        defaultEnabled(priority, subPath.length),
        null   // no origin label — primary file
    ]);
}

for (const [filename, description, buflen, priority] of lowPriorityExtras) {
    const group = fileGroup(filename);
    if (!groupMap.has(group)) continue;
    const subPath = fileSubPath(filename);
    groupMap.get(group).push([
        filename,
        fileBasename(filename),
        buflen,
        description,
        defaultEnabled(priority, subPath.length),
        originLabel(filename)   // e.g. "english"
    ]);
}

// Convert to tablayout array
const tablayout = [];
for (const [groupName, dicts] of groupMap) {
    tablayout.push({
        name: groupName.charAt(0).toUpperCase() + groupName.slice(1),
        dicts
    });
}

tablayout.sort((a, b) => a.name.localeCompare(b.name));
tablayout.forEach(tab => {
    // Sort: primary files first (originLabel null), then extras grouped by label — both alphabetically
    tab.dicts.sort((a, b) => {
        const la = a[5] ?? '';
        const lb = b[5] ?? '';
        if (la !== lb) return la.localeCompare(lb); // nulls ('') sort before labels
        return a[1].localeCompare(b[1]);
    });
});

console.log("Generated tablayout:", tablayout);

let dicts = tablayout.flatMap(table => table.dicts);
let workers_num = dicts.length > 1 ? 2 : 1;
let workers = [];
for(let i=1; i<=workers_num; ++i){
	createPeakWorker(i);
}
let worker_code = new Array(workers.length).fill(false);
let dict_master_code = new Array(dicts.length).fill(true);
let dict_code = [...dict_master_code];


let tabDictIndices = [];
let allIndices = [];
let idx = 0;
tablayout.forEach(g => {
  let groupIndices = [];
  g.dicts.forEach(d => {
    groupIndices.push(idx);
    allIndices.push(idx);
    ++idx;
  });
  tabDictIndices.push(groupIndices);
});

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

const loadProgress = document.getElementById('loadProgress');
loadProgress.textContent = `Loading dictionaries.`;

// Insert a dict entry into a path-keyed tree node.
// Each node: { __primary: [], __extras: Map<label,[]>, <subfolder>: node }
function insertIntoTree(node, subPath, dict, idx) {
	if (subPath.length === 0) {
		const label = dict[5]; // originLabel or null
		if (label === null || label === undefined) {
			if (!node.__primary) node.__primary = [];
			node.__primary.push({ dict, idx });
		} else {
			if (!node.__extras) node.__extras = new Map();
			if (!node.__extras.has(label)) node.__extras.set(label, []);
			node.__extras.get(label).push({ dict, idx });
		}
	} else {
		const [head, ...rest] = subPath;
		if (!node[head]) node[head] = {};
		insertIntoTree(node[head], rest, dict, idx);
	}
}

// Walk the tree and collect flat list items (headings + file rows) in display order.
// depth is stored on each item so renderItems can apply the correct indent.
function collectListItems(node, depth, items) {
	// 1. Primary files at this level
	if (node.__primary) {
		for (const entry of node.__primary) items.push({ type: 'file', entry, depth });
	}
	// 2. Sub-folders — heading is shown at the child depth so it aligns with its contents
	for (const [seg, child] of Object.entries(node)) {
		if (seg === '__primary' || seg === '__extras') continue;
		const childDepth = depth + 1;
		const tag = `h${Math.min(childDepth + 1, 6)}`;
		items.push({ type: 'heading', tag, text: seg, depth: childDepth });
		collectListItems(child, childDepth, items);
	}
	// 3. Extras at this level, each under a compact origin label heading
	if (node.__extras) {
		for (const [label, entries] of node.__extras) {
			const tag = `h${Math.min(depth + 2, 6)}`;
			items.push({ type: 'heading', tag, text: label, cls: 'dictlist-extra-label', depth });
			for (const entry of entries) items.push({ type: 'file', entry, depth });
		}
	}
}

function renderItems(items) {
	let html = '';
	for (const item of items) {
		// depth 0 = top of group (no indent), each step adds 0.5em
		const indent = `padding-left:${item.depth * 0.5}em`;
		if (item.type === 'heading') {
			const cls = item.cls ? ` class="${item.cls}"` : '';
			html += `<li class="dictlist-heading" style="${indent}"><${item.tag}${cls}>${item.text}</${item.tag}></li>`;
		} else {
			const { dict, idx } = item.entry;
			html += `<li data-id="${dict[0]}" style="${indent}"><input type="checkbox" class="fcheckbox down" data-id="${idx}" ${dict[4] ? "checked" : ""} onchange="updateDictList(this)" id="${idx}"><label for="${idx}" class="modern-toggle"><span class="toggle-switch"></span></label><strong>${dict[1]}</strong> : ${dict[3]}</li>`;
		}
	}
	return html;
}

let dictIndex = 0;
let temp = `<p-d><h2>${appname.toUpperCase()} Dictionary List:</h2><ol class="dictlist">`;
tablayout.forEach((gdict) => {
	temp += `<li class="dictlist-heading"><h3>${gdict.name}</h3></li>`;
	const groupNode = {};
	gdict.dicts.forEach(dict => {
		const idx = dictIndex++;
		insertIntoTree(groupNode, fileSubPath(dict[0]), dict, idx);
	});
	const items = [];
	collectListItems(groupNode, 0, items);
	temp += renderItems(items);
});
temp += `</ol></p-d>`;
let listDiv = document.createElement('div');
listDiv.innerHTML = temp;
resultsDiv.append(listDiv);

/* Fix it later so it works on localhost */
/*if(navigator.online){
	dictlist.querySelectorAll('.fcheckbox').forEach((b) =>{
		if(b.classList.contains('down')){
			b.disabled = true;
		}
	});
}*/

function ack(url){
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

let last = null;
let tabBtns = [];
let ngroups = tablayout.length;
newTab("All", ngroups, true);
for(let gi = 0; gi < ngroups; gi++) {
	newTab(tablayout[gi].name, gi);
}
let ctab = ngroups;
let csub = -1;

function newTab(name, num, active=false){
	let btn = document.createElement('button');
	btn.dataset.index = num;
	btn.className = 'tab';
	btn.textContent = name;
	if(active)
		btn.classList.add('active');
  let hasSubs = name === "All" ? false : tablayout[num].dicts.length > 1;
  btn.addEventListener('click', () => {
    if (hasSubs) {
      showDropdown(num, btn);
    } else {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
			const index = parseInt(btn.dataset.index);
      ctab = index;
      csub = -1;
      btn.textContent = name;
      query = null;
      startSearch();
    }
		queryInput.focus();
	});
	tabBtns[num] = btn;
	tabs.appendChild(btn);
	last = btn;
}

function showDropdown(gi, anchor) {
	document.querySelectorAll('.context-menu').forEach(m => m.remove());
	let group = tablayout[gi];
	let menu = document.createElement('div');
	menu.className = 'context-menu';

  let allItem = document.createElement('button');
	allItem.textContent = "All";
	allItem.addEventListener('click', () => {
		selectSub(gi, -1);
		menu.remove();
	});
	menu.appendChild(allItem);

	group.dicts.forEach((d, si) => {
		let item = document.createElement('button');
		item.textContent = d[1];
		item.addEventListener('click', () => {
			if(dict_master_code[si]){
				setCheckbox(si, true);	
				loadDict(si);
			}
			selectSub(gi, si);
			menu.remove();
		});
		menu.appendChild(item);
	});
	document.body.appendChild(menu);
	let rect = anchor.getBoundingClientRect();
	menu.style.left = `${rect.left}px`;
	menu.style.top = `${rect.bottom}px`;

	let outsideClick = (e) => {
		if (!menu.contains(e.target) && !anchor.contains(e.target)) {
			menu.remove();
			document.removeEventListener('click', outsideClick);
		}
	};
	document.addEventListener('click', outsideClick);
}

function selectSub(gi, si) {
	if (ctab !== gi) {
		document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
		tabBtns[gi].classList.add('active');
		ctab = gi;
	}
	csub = si;
	let group = tablayout[gi];
  let tabText = group.name;
  if (si >= 0) {
    tabText += " - " + group.dicts[si][1];
  }
	tabBtns[gi].textContent = tabText;
	query = null;
	startSearch();
}

let query = null;
let tout = resultsDiv;
let mainQuery = null;

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
	if(csub >= 0 && dict_master_code[csub]){
		setCheckbox(csub, true);	
		loadDict(csub);
	}

	window.scrollTo(0, 0);
	worker_code.fill(false);
	st = globreg.test(query) ? 0 : 3;
	dict_code = [...dict_master_code];

	if(ctab === ngroups){
		allIndices.forEach(ind => dict_code[ind] = true);
	}else{
		let indices = tabDictIndices[ctab];
		if(csub === -1){
			indices.forEach(ind => dict_code[ind] = true);
		}else{
			dict_code[indices[csub]] = true;
		}
	}

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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(reg => {
			const rootUrl = new URL('/', location.origin).href;  // e.g., 'https://peakslab.org/'
      if (reg.scope !== rootUrl) {
        reg.unregister().then(() => console.log('Unregistered old SW:', reg.scope));
      }
    });
  }).then(() => {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Root SW registered with scope:', reg.scope))
      .catch(err => console.error('Registration failed:', err));
  })});
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

				for (const [url, ver] of Object.entries(event.data.files)) {
					ack(url.replace(/^\//, ''));
				}
			}
		}
	});
}
function requestCacheVersion() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'getstatus' });
  }
}
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


document.getElementById('showtabs')?.addEventListener('click', () => {
    document.getElementById('tabs').classList.toggle('hide');
    localStorage.setItem('hidetabs', tabs?.classList.contains('hide'));
});
if (localStorage.getItem('hidetabs') === 'false') {
    document.getElementById('tabs').classList.remove('hide');
}

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
				const { outcome } = await deferredPrompt.userChoice;
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
document.body.appendChild(document.createTextNode(" v10.9"));
