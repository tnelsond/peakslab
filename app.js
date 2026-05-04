"use strict";
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

let dicts = tablayout.flatMap(table => table.dicts);
let workers = dicts.length > 1 ? [new Worker('/peakworker.js'), new Worker('/peakworker.js')] : [new Worker('/peakworker.js')];
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

let i = 1;
workers.forEach((w) => {
	w.postMessage({type: "setid", id: i});
	++i;
	w.onmessage = function(e){
		//console.log(e.data);
		if(e.data.type == "loaded"){
			const d = e.data.did*workers.length + e.data.id - 1;
			dict_master_code[d] = false;
			document.getElementById(`${d}`)?.classList.remove('down');
			timingDiv.innerHTML += `${e.data.msg}<br>`;
			--nload;
			loadProgress.textContent = `Loading ${nload} more dictionaries.`;
			timingDiv.innerHTML += `${Math.round(performance.now())}ms `;
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
});

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

i = 0;
let temp = `<p-d><h2>${appname.toUpperCase()} Dictionary List:</h2><ol class="dictlist">`;
tablayout.forEach((gdict, gval) =>{
	temp += `<h3>${gdict.name}</h3>`;
	gdict.dicts.forEach((dict, val) =>{
		temp += `<li data-id="${dict[0]}">
<input type="checkbox" class="fcheckbox down" data-id="${i}" ${dict[4] == true || dict[4] == undefined ? "checked" : ""} onchange="updateDictList(this)" id="${i}"><label for="${i}" class="modern-toggle"><span class="toggle-switch"></span></label><strong>${dict[1]}</strong> : ${dict[3]}</li>`;
	++i;
	});
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
            type: 'init',
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

const globreg = /[!+*]/;

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

document.body.appendChild(document.createTextNode(" v10.9"));
