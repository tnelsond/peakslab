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
let loader = null;
let isLoading = false;
let st = 2;
let nloaded = 0;
const timingDiv  = document.getElementById('timing');
const tabs  = document.getElementById('tabs');
const hidetabs = document.getElementById('hidetabs');

let dicts = tablayout.flatMap(table => table.dicts);
let workers = [new Worker('/peakworker.js'), new Worker('/peakworker.js')];
let worker_code = new Array(workers.length).fill(false);
let dict_code = new Array(dicts.length).fill(false);

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

function cleanup(container = out){
	container.querySelectorAll('img[src^="blob:"], audio source[src^="blob:"]').forEach(el => {
		URL.revokeObjectURL(el.src);
		el.src = '';
	});
	container.innerHTML = "";
}

let i = 0;
workers.forEach((w) => {
	w.postMessage({type: "setid", id: i});
	++i;
	w.onmessage = function(e){
		//console.log(e.data);
		if(e.data.type == "loaded"){
			++nloaded;
			timingDiv.innerHTML += `${e.data.msg}<br>`;
			loadProgress.textContent = `Loaded ${nloaded}/${dicts.length} dictionaries.`;
			if(nloaded == dicts.length){
				timingDiv.innerHTML += `All ${Math.round(performance.now() - tstart)}ms`;
				loadProgress.style.display = 'none';
				startSearch();
			}
		}
		else if(e.data.type == "nomore"){
			if(e.data.st == st){
				worker_code[e.data.id] = true;
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
				cleanup(out);
				out.append(loader)
			}
			let idpre = e.data.dest == "popup" ? "pid" : "mid";
			const nheader = updateQuery(e.data.header);
			let div = document.getElementById(`${idpre}-${nheader}`);
			if(div === null){
				div = document.createElement('p-d');
				div.id = `${idpre}-${nheader}`;
				if(idpre == "mid"){
					let temp_dict_code = new Array(dicts.length).fill(true);
					temp_dict_code[dicts.findIndex(file => file[1] === e.data.dict)] = false;
					workers.forEach((w, i) =>{
						let code = temp_dict_code.filter((_, index) => index % workers.length == i);
						w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: e.data.dest, dicts: code});
					});
				}
			}
			div.innerHTML += `<p-h>${e.data.dict} ${e.data.st} '${e.data.query}'</p-h><h2>${e.data.header}</h2>`;
			if(e.data.filename){
				if (e.data.filename.toLowerCase().endsWith('.webp')) {
					const blob = new Blob([e.data.body], { type: 'image/webp' });
					const url = URL.createObjectURL(blob);
					div.innerHTML += `<img src="${url}" alt="${e.data.filename}" style="max-width:100%;">`;
				}else if (e.data.filename.toLowerCase().endsWith('.webm')) {
					const blob = new Blob([e.data.body], { type: 'audio/webm; codecs=opus'});
					const url = URL.createObjectURL(blob);
					div.innerHTML += `<audio controls><source src="${url}" alt="${e.data.filename}"></audio>`;
				}else{
					div.innerHTML += `${e.data.filename}<br> filetype not supported`;
				}
			}else{
				div.innerHTML += `${e.data.body}`;
			}
			let place = e.data.dest == "popup" ? popupResults : resultsDiv;
			if(place == resultsDiv){
				place.insertBefore(div, loader); 
			}else{
				place.appendChild(div); 
			}
			if(e.data.dest == "popup"){
				popupOverlay.style.display = 'block';
			}
			++num;
			queryInput.classList.remove("error");
			statusDiv.textContent = `Found ${num}+ matching lines.`;
			loadmore();
		}
	}
});

const loadProgress = document.getElementById('loadProgress');
loadProgress.textContent = `Loaded 0/${dicts.length} dictionaries.`;
for(let i=0; i<dicts.length; ++i){
	workers[i%workers.length].postMessage({type: 'init', did: Math.floor(i/workers.length), msg: dicts[i]});
}

let last = null;
let tabBtns = [];
let ngroups = tablayout.length;
newTab("All", ngroups, true);
for(let gi = 0; gi < ngroups; gi++) {
	newTab(tablayout[gi].name, gi);
}
let ctab = ngroups;
let currentSub = -1;

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
      ctab = num;
      currentSub = -1;
      btn.textContent = name;
      query = null;
      startSearch();
    }
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
	currentSub = si;
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
const queryInput = document.getElementById('queryInput');
const statusDiv  = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const popupOverlay = document.getElementById('popupOverlay');
const popupQuery = document.getElementById('popupQuery');
const popupResults = document.getElementById('popupResults');
const popupClose = document.getElementById('popupClose');
let out = resultsDiv;
let mainQuery = null;

let temp = `<p-d><h3>${appname.toUpperCase()} Dictionary List:</h3><ol>`;
dicts.forEach((dict) =>{
	temp += `<li><strong>${dict[1]}</strong> : ${dict[3]}</li>`;
});
temp += `</ol></p-d>`;
resultsDiv.innerHTML = temp;

window.openPopupSearch = function(text){
	cleanup(popupResults);
	let temp_dict_code = new Array(dicts.length).fill(true);
	workers.forEach((w, i) =>{
		let code = temp_dict_code.filter((_, index) => index % workers.length == i);
		w.postMessage({type: "tempsearch", st: 1, query: updateQuery(text), dest: "popup", dicts: code});
	});
}

popupClose.addEventListener('click', () => {
	cleanup(popupResults);
	popupOverlay.style.display = 'none';
});

function nextst(){
	if(st < 2)
		return false;
	++st;
	if(st > 4)
		st = 0;
	return true;
}

function updateQuery(text = queryInput.value){
	if (!text) {
			return null;
	}
	text = text.toLowerCase().replace("", "");
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
		if(code.includes(true)){
			w.postMessage({type: "initsearch", st: st, dicts: code});
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

function startSearch() {
	if(query == (query = updateQuery())){
		return;
	}
	window.scrollTo(0, 0);
	worker_code.fill(false);
	st = 2;
	dict_code.fill(false);

	if(ctab === ngroups){
		allIndices.forEach(ind => dict_code[ind] = true);
	}else{
		let indices = tabDictIndices[ctab];
		if(currentSub === -1){
			indices.forEach(ind => dict_code[ind] = true);
		}else{
			dict_code[indices[currentSub]] = true;
		}
	}

	loader = null;

	statusDiv.textContent = "Searching...";

	if(!query){
		return;
	}
	if (!loader) {
		loader = document.createElement('p-d');
		loader.id = 'loader';
		loader.textContent = "Loading more…";
	}

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

// Service Worker
async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register(`${scope}sw.js`, { scope: scope });
        console.log("Service Worker:", reg.active ? "active" : reg.installing ? "installing" : "waiting");
    } catch (err) {
        console.error("Service Worker failed:", err);
    }
}
window.addEventListener('load', registerServiceWorker);

document.addEventListener('touchend', function(e) {
  const active = document.activeElement;

  // Only proceed if something is focused AND it's an input-like element
  if (!active || !['INPUT','TEXTAREA'].includes(active.tagName)) {
    return;
  }

  // Check if the touch landed inside the currently focused element
  let touchedInside = false;
  let el = e.target;

  while (el && el !== document.body) {
    if (el === active) {
      touchedInside = true;
      break;
    }
    el = el.parentElement;
  }

  // If touch was NOT inside the active input → blur it (hides keyboard)
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

document.getElementById('showtabs')?.addEventListener('click', () => {
		console.log("hide");
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

// Context menu (right-click)
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.style.display = 'none';
document.body.appendChild(contextMenu);

document.addEventListener('contextmenu', e => {
    const text = window.getSelection().toString().trim();
    if (!text) return;

    e.preventDefault();

    contextMenu.innerHTML = `
        <button data-action="search-current">🔍 Search</button>
        <button data-action="search-popup">🔍 Popup</button>`;
		lang.forEach((x) =>{
    contextMenu.innerHTML += `<button data-action="speak-${x.val}">🔊 ${x.name}</button>`
		});

    contextMenu.style.left = `${e.pageX + 5}px`;
    contextMenu.style.top = `${e.pageY + 5}px`;
    contextMenu.style.display = 'block';

    contextMenu.onclick = ev => {
        if (ev.target.tagName !== 'BUTTON') return;
        const action = ev.target.dataset.action;

        if (action.startsWith('speak')) {
            const lang = action.replace("speak-", "");
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            speechSynthesis.speak(utterance);
        } else if (action === 'search-current') {
            document.getElementById('queryInput').value = text;
            startSearch();
        } else if (action === 'search-popup') {
            window.openPopupSearch?.(text);
        }

        contextMenu.style.display = 'none';
    };
});

document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
});
