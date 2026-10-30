"use strict";

// A file the service worker has (its 'status'): set on a dictionary page,
// once its dictionaries are known
let ack = null;
// The context menu's Bookmark (CSS fills it in when it's bookmarked)
const bookmarkSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
const compareSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M12 6C10 4.5 7 4 3 4v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v14"/></svg>'; // (a verse's compare)
// A Bible card's Read in context (an open book, + over it) and Popup (the
// book in a popup's two squares)
const contextSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M12 11.5c-2-1.3-5-1.8-9-1.8v10.5c4 0 7 .5 9 1.8 2-1.3 5-1.8 9-1.8V9.7c-4 0-7 .5-9 1.8zM12 11.5v10.5M12 1.5v6M9 4.5h6"/></svg>';
const popupSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M8 7V3.5A1.5 1.5 0 0 1 9.5 2h11A1.5 1.5 0 0 1 22 3.5v11a1.5 1.5 0 0 1-1.5 1.5H17"/><rect x="2" y="7.5" width="14.5" height="14.5" rx="1.5"/><path d="M9.25 13.2c-1.2-.8-2.7-1.1-4.5-1.1v6.4c1.8 0 3.3.3 4.5 1.1 1.2-.8 2.7-1.1 4.5-1.1v-6.4c-1.8 0-3.3.3-4.5 1.1zM9.25 13.2v6.4" stroke-width="1.6"/></svg>';
// Remembered things (null if there's nothing, or no storage)
const stored = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not remembered */ } };
// x onto map's list for key
const push = (map, key, x) => (map.get(key) || map.set(key, []).get(key)).push(x);
const readList = k => { const l = stored(k); return Array.isArray(l) ? l : []; };
// Chords (<p-m chord="...">) are hidden by default (CSS). The button toggles
// one class on <body>, remembered; CSS shows them and switches every
// button's label (see .chords-btn).
const chordsBtnHTML = '<button class="chords-btn" onclick="toggleChords()" title="Show or hide chords"></button>';
window.toggleChords = () => store('showChords', document.body.classList.toggle('show-chords'));
document.body.classList.toggle('show-chords', stored('showChords') === true);
// Hide a dictionary (its name's menu): its entries (data-dict) are hidden
// everywhere in the results, and a word's card with any has See more at
// the bottom, to show them there. Some start hidden (files.json's 7th
// field, #collapsed in the source: Bible notes, ...); what's remembered is
// the ones flipped from that. Done with generated CSS rules.
const hideStyle = document.head.appendChild(document.createElement('style'));
let hiddenFlipped = readList('hiddenDicts'); // Flipped from their default
let startHidden = new Set(); // (set once files.json is read)
const isHidden = name => startHidden.has(name) !== hiddenFlipped.includes(name);
const applyHidden = () => {
	const names = [...new Set([...startHidden, ...hiddenFlipped])].filter(isHidden).map(n => `p-e[data-dict="${CSS.escape(n)}"]`).join(',');
	hideStyle.textContent = names ? `p-d:not(.show-hidden,.chapter)>:is(${names}){display:none}p-d:not(.show-hidden,.chapter):has(>:is(${names}))>.see-more{display:block}` : '';
};
const toggleHidden = name => {
	hiddenFlipped = hiddenFlipped.includes(name) ? hiddenFlipped.filter(x => x !== name) : [...hiddenFlipped, name];
	store('hiddenDicts', hiddenFlipped);
	applyHidden();
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

	let touched = false, reloading = false;
	['pointerdown', 'keydown'].forEach(t => addEventListener(t, () => { touched = true; }, {once: true, capture: true}));
	navigator.serviceWorker.addEventListener('message', ({data}) => {
		// A new files.json applied: the downloaded/version indicators again
		// (new or removed dictionaries show up on the next load)
		if (data?.type === 'filesupdated') requestCacheVersion();
		else if (data?.type === 'status') {
			// This page is the old app (it changed since this started
			// loading): the new one now if it's not been touched yet, else
			// the next time it's left (not while it's being used)
			if (data.appUpdated > performance.timeOrigin && !reloading) {
				reloading = true;
				touched ? document.addEventListener('visibilitychange', () => document.hidden && location.reload()) : location.reload();
			}
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
const chevron = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
// A list's row: its button (class and attributes), its words and what's
// under them
const wordsHTML = (w, t) => `<span class="row-w">${w}</span><span class="row-t">${t}</span>`;
const rowHTML = (cls, attrs, w, t, after = '') => `<li class="row"><button class="row-main ${cls}" ${attrs}>${wordsHTML(w, t)}</button>${after}</li>`;
// The language panel's rows: the languages, biggest first
const langCounts = {};
filesJson.dicts.forEach(f => { const l = f[0].split('/')[0]; langCounts[l] = (langCounts[l] || 0) + 1; });
// A language's row in the language panel: its flag (abbreviations.json's
// fourth), name and how many dictionaries
const langRow = (href, name, n, cur, lang) => `<li class="row"><a class="row-main lang-row" href="${href}"${cur ? ' aria-current="page"' : ''}>${abbr[lang]?.[3] ? `<span class="lang-flag" aria-hidden="true">${abbr[lang][3]}</span>` : ''}<span class="row-w">${escapeHTML(name)}</span><span class="row-t">${n} ${n === 1 ? 'dictionary' : 'dictionaries'}</span></a></li>`;
const langRows = (skip, qs) => '<ul class="rows">' + Object.keys(langCounts).filter(l => l !== skip).sort((a, b) => langCounts[b] - langCounts[a])
	.map(l => langRow(`/${l}${qs}`, cap(l), langCounts[l], false, l)).join('') + '</ul>';

const langBtn = $('langBtn');
const queryInput = $('queryInput');
// The side panel: what it shows (drawerView, null when it's closed), closed
// by ×, a tap beside it or Escape
const drawer = $('drawer');
const drawerBody = drawer.querySelector('.drawer-body');
let drawerView = null;
function closeDrawer(){
	drawerView = null;
	drawer.classList.add('hide');
	document.querySelectorAll('[data-drawer], .cb-text').forEach(b => b.setAttribute('aria-expanded', false));
}
drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
drawer.querySelector('.drawer-bg').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerView) closeDrawer(); });

if(!isDictPage){
	// The root page: the app with nothing but the language button (typing
	// opens it too, and the text goes along), and what Peak Slab is (the
	// About drawer elsewhere)
	['menuBtn', 'headMenu', 'quick', 'settings', 'controls'].forEach(id => $(id).classList.add('hide'));
	document.querySelector('.sub-div').classList.add('hide');
	$('about').classList.remove('hide');
	langBtn.innerHTML = `<span class="lang-name">Choose a language</span>${chevron}`;
	const openLangs = () => {
		drawerView = 'lang';
		drawer.querySelector('.drawer-title').textContent = 'Language';
		drawerBody.innerHTML = langRows('', queryInput.value ? '?text=' + encodeURIComponent(queryInput.value) : '');
		drawer.classList.remove('hide');
	};
	langBtn.addEventListener('click', openLangs);
	$('about').querySelector('[data-open]').addEventListener('click', openLangs);
	queryInput.addEventListener('input', openLangs);
}else{
	let num = 0;
	let mark = true;
	let loader = null;
	let st = 3;
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
		w.onmessage = ({data: m}) => {
			const d = dictOf(m);
			switch (m.type) {
			case 'needwasm':
				sharedWasm().then(wasm => w.postMessage({type: 'wasm', wasm}));
				break;
			case 'needbytes':
				(self.caches ? caches.match('/' + dicts[d].path).catch(() => null) : Promise.resolve(null))
					.then(hit => { if (!hit) fetched.add(d); }) // (the service worker has it: not a download)
					.then(() => fetchDict('/' + dicts[d].path, d))
					.then(buf => w.postMessage({type: 'bytes', did: m.did, buf}, [buf]))
					.catch(err => {
						console.warn(`Fetching ${dicts[d].path} failed:`, err);
						w.postMessage({type: 'bytes', did: m.did, buf: null});
					});
				break;
			case 'loaded':
				loaded.add(d);
				if (loading.delete(d)) loadDone += dicts[d].size || 1;
				showLoad();
				if(!libOn[d] && !asked.has(d)) // Turned off while it loaded
					unloadDict(d);
				(pendingLoad.get(d) || []).forEach(f => f());
				pendingLoad.delete(d);
				downloaded.add(d);
				renderListsSoon();
				timingDiv.insertAdjacentHTML("beforeend", `${Math.round(performance.now())}ms ${m.msg}<br>`);
				if(searched(d))
					moreResults(d);
				if(!loading.size){
					saveState();
					askRefresh();
				}
				break;
			case 'nomore':
				if (m.st != st || m.gen !== searchGen) break;
				worker_code[m.id - 1] = true;
				if (worker_code.includes(false)) break;
				if (nextst()) searchStage();
				else { // The search is done
					loader?.remove();
					loader = null;
					if (num == 0) { // Nothing has all of it: none of the last search's, and word by word
						if (query) cleanup(resultsDiv);
						translate();
					}
				}
				break;
			case 'rendered': // A reply (askDict)
				gotReply(m);
				break;
			case 'result':
				addResult(m);
			}
		};
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
		if(!popup && isChapter(query)) // Reading a chapter: just it (and the rest of it)
			return loadmore();
		let div = $(`${idpre}-${nheader}`);
		const d = dictOf(data);
		// A verse found by its reference ("joh 3.16", "joh 3"): the
		// translations its card has (its own, picked in its bar, or the Bible
		// bar's: in parallel, every one on; else the first)
		if (isBibleText(d) && (div?.dataset.own || (!popup && !parallel && d !== readText() && nheader.startsWith(query))))
			return loadmore();
		if (typeof data.body === 'string' && div?.seen.has(d + '\t' + data.body)) return popup || loadmore(); // An entry found twice (by two of the searches) shows once (and more come)
		// Nothing goes in above the bottom of the screen (what's read, or
		// being read): an entry that would starts its word again at the end
		const more = !popup && div && fixed([...div.children].find(c => +c.dataset.id > sortId(d)));
		const first = !div || more;
		if(first){
			const seen = div?.seen;
			div?.removeAttribute('id');
			div = document.createElement('p-d');
			div.id = `${idpre}-${nheader}`;
			div.seen = seen || new Set();
			if(!more && (idpre == "mid" || data.st == 2)){ // The other dictionaries' entries for it
				const mask = popup ? glossMask() : searchMask();
				mask[dicts.findIndex(x => x.name === data.dict)] = false;
				forWorkers(mask, (w, code) => w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: data.dest, dicts: code, gen: searchGen}));
			}
		}
		if(isBibleText(d))
			div.classList.add('verse');
		div.seen.add(d + '\t' + data.body);
		if(first){
			const ctx = isBibleText(d) && chapterOf(nheader) && chapterOf(nheader) !== query ? '<button class="ctx-btn" onclick="readInContext(this)">Read in context</button>' : '';
			div.innerHTML = `<h2><span class="hw">${data.header}</span>${ctx}</h2>` +
				'<button class="text-btn see-more" data-id="1e9" onclick="this.parentNode.classList.add(\'show-hidden\')">See more</button>'; // (entries go above it)
		}
		if(isBibleText(d) && !div.querySelector(':scope > .card-bar')) { // A verse's card (the popup's too): its bar, for its reference
			if (popup) div.dataset.pop = 1;
			addCardBar(div, verseRef(nheader), nheader);
		}
		// A media file's: its details and the file; text: Gloss, the chords'
		// show/hide button if it has any, and the text
		const t = document.createElement('template');
		t.innerHTML = entryHTML(d, data.filetype ? (data.subheader ? `<p-n>${data.subheader.join(",<br>")}<br></p-n>` : '') :
			(data.body?.includes('<p-m') ? chordsBtnHTML : '') + (mark ? highlightText(data.body, data.query) : data.body));
		const el = t.content.firstChild;
		if(data.filetype)
			el.append(mediaElement(data.filetype, data.body, data.header));
		insertSorted(div, el, sortId(d));

		if(!popup && isStar(d) && !fixed(focusEnd.isConnected ? focusEnd : resultsDiv) && !(div.isConnected && fixed(div))){ // Its sections go above the other dictionaries' (off the screen)
			if(!focusEnd.isConnected)
				resultsDiv.prepend(focusEnd);
			if(first || focusEnd.compareDocumentPosition(div) & Node.DOCUMENT_POSITION_FOLLOWING)
				resultsDiv.insertBefore(div, focusEnd);
		}else if(first){
			(popup ? popupResults : resultsDiv).insertBefore(div, popup ? null : loader);
		}
		if(first && popup)
			popupOpen();
		if(!popup) found();
	}
	// Not to move: on the screen or above it (and showing), once the
	// search's first results are in (its first 300 ms: in order)
	const fixed = el => performance.now() - searchAt > 300 && el?.getClientRects().length > 0 && el.getBoundingClientRect().top < innerHeight;
	// el into parent before the first child with a bigger data-id (or data-[key])
	const insertSorted = (parent, el, n, key = 'id') => parent.insertBefore(el, [...parent.children].find(c => +c.dataset[key] > n) || null);
	// An entry of dictionary d (starred: they come first, and stand out),
	// its name first, then html
	const entryHTML = (d, html = '') => `<p-e data-id="${sortId(d)}" data-dict="${escapeHTML(dicts[d].name)}" data-d="${d}"${isStar(d) ? ' class="starred"' : ''}>${entryHeadHTML(d)}${html}</p-e>`;
	// A dictionary's name above its entry (★ if starred): tap it for its menu
	const entryHeadHTML = d => `<p-h role="button" tabindex="0" title="${escapeHTML(typeLabel(dicts[d]))}" onclick="dictMenu(this)">${isStar(d) ? '★ ' : ''}<span class="dn">${escapeHTML(dicts[d].name)}</span></p-h>`;
	// The little menus (a dictionary's, Share's): one at a time, right
	// after what opened it, under it and lined up with its nearer side;
	// tapping that again, or anywhere else, closes it. Its buttons' data-a
	// go to act. (A click in one isn't a click outside it, or outside the
	// popup.)
	const closeMenus = () => document.querySelectorAll('.menu').forEach(m => m.remove());
	function popMenu(at, html, act){
		const open = at.nextElementSibling?.classList.contains('menu');
		closeMenus();
		if (open) return;
		const m = document.createElement('div');
		m.className = 'menu';
		m.innerHTML = html;
		m.addEventListener('click', e => {
			e.stopPropagation();
			const a = e.target.closest('button')?.dataset.a;
			if (!a) return;
			m.remove();
			act(a);
		});
		at.after(m);
		const p = m.offsetParent.getBoundingClientRect(), a = at.getBoundingClientRect();
		m.style.top = `${a.bottom - p.top}px`;
		if (a.left - p.left < p.width / 2) m.style.left = `${a.left - p.left}px`;
		else m.style.right = `${p.right - a.right}px`;
	}
	document.addEventListener('click', e => { if (!document.querySelector('.menu')?.previousElementSibling.contains(e.target)) closeMenus(); });
	// A dictionary's: turn it off, hide (or show) its entries, star (or unstar) it
	window.dictMenu = h => {
		const d = +h.parentNode.dataset.d, name = dicts[d].name;
		popMenu(h, `<button data-a="off">Turn off ${escapeHTML(name)}</button>` +
			`<button data-a="hide">${isHidden(name) ? 'Show' : 'Hide'} its entries</button>` +
			`<button data-a="star">${isStar(d) ? '☆ Unstar' : '★ Star: show it first'}</button>`,
			a => a === 'off' ? setOn([d], false) : a === 'hide' ? toggleHidden(name) : toggleStar(d));
	};
	// One more result: the count, and maybe more of them
	function found(){
		++num;
		queryInput.classList.remove("error");
		updateStatus(`Found ${num}+ matching lines.`, `${num}+ found`);
		loadmore();
	}

	// A media entry: a player for a recording (audioSrc), else a picture
	// (jbig2 decoded)
	function mediaElement(type, bytes, name){
		const audio = AUDIO.test(type), el = document.createElement(audio ? 'audio' : 'img');
		if (audio) el.controls = true;
		else {
			el.alt = name;
			el.style.maxWidth = '100%';
		}
		(audio ? audioSrc(type, bytes) : (/jbig2/i.test(type) ? media().then(m => m.jbig2toPng(bytes)) : Promise.resolve(new Blob([bytes], {type: 'image/' + type.toLowerCase()})))
			.then(b => URL.createObjectURL(b))).then(u => { el.src = u; });
		return el;
	}

	// A verse of the chapter searched ("rom 8."): each dictionary's verses
	// run together in one card, numbered as its references have them
	// ("យ៉ូហាន ៣:១៦"); the ⇄ after a verse glosses it word by word, and
	// its compare shows it in every translation in the popup.
	// Parallel: the Bible texts share one card, verse by verse. Bible notes,
	// with a Bible text showing, are little links on its verses (addNote).
	// A verse's reference as the dictionary has it (its p-n: "យ៉ូហាន ៣:១៦")
	const refOf = body => /<p-n>@?([^<]*)<\/p-n>/.exec(body)?.[1];
	// (A range's, from rangeMore or popupRange: its dictionary d, in the
	// results or the popup, root; its chapters' first verses say their
	// chapter: "2:1"). A card's own translations (fillCard): own, {card,
	// par, range}, the card it goes in.
	function addVerse(data, h, d = dictOf(data), root = resultsDiv, own = null){
		const [c, cv] = h.split(' ').pop().split('.').map(Number), v = c * 1000 + cv; // (by chapter, then verse)
		const main = root === resultsDiv && !own;
		if (main && !parallel && isBibleText(d) && d !== readText()) return loadmore(); // (the others on are for glosses and compare)
		if (!own && dicts[d].cat === 'bible/commentary' && dictIds.some(t => isBibleText(t) && searched(t)))
			return addNote(d, data, v);
		const label = refOf(data.body);
		const par = own ? own.par : (parallel || root === popupResults) && isBibleText(d); // (the popup compares: in parallel)
		const cardId = (main ? 'ch-' : 'pch-') + (par ? 'par' : d), cardSort = par ? -1e6 : sortId(d);
		let card = own ? own.card : $(cardId);
		if (main && card?.dataset.own) return loadmore(); // (it has its own translations)
		if(!card){
			card = document.createElement('p-d');
			card.id = cardId;
			card.className = par ? 'chapter parallel' : 'chapter';
			card.dataset.id = cardSort;
			card.innerHTML = par ? '<p-e></p-e>' : entryHTML(d);
			const after = [...root.querySelectorAll(':scope > p-d.chapter')].find(c => +c.dataset.id > cardSort);
			root.insertBefore(card, after || (main && loader && loader.parentNode === resultsDiv ? loader : null));
			if (main && (par || isBibleText(d))) addCardBar(card, searchRef(), query);
			else if (root === popupResults && !own && (par || isBibleText(d))) { // (the popup's chapter)
				card.dataset.pop = 1;
				addCardBar(card, popupRef(), popupQuery);
			}
		}
		const ref = label && /(\p{Nd}+\s*[:.]\s*)(\p{Nd}+)/u.exec(label);
		const full = ref && (own ? own.range : rangeOf(main ? query : updateQuery(popupQuery))) && (cv === 1 || !card.querySelector('.vs'));
		const n = ref ? (full ? ref[1] + ref[2] : ref[2]) : String(cv);
		let body = data.body.replace(/<p-n>[\s\S]*?<\/p-n>/, '');
		const text = isBibleText(d);
		if(text) // Verses run on
			body = body.replace(/<\/?p(?=[\s>])[^>]*>/gi, ' ');
		// Its headings go above its number, which stays on the line with its
		// first word
		const heads = (/^\s*(?:<h\d[^>]*>[\s\S]*?<\/h\d>\s*)+/i.exec(body) || [''])[0];
		let rest = body.slice(heads.length).trimStart();
		const para = /^((?:<[^>]+>\s*)*)¶\s*/.exec(rest); // A paragraph starts with it: no ¶, a new line (CSS)
		if(para)
			rest = para[1] + rest.slice(para[0].length);
		const word = /^[^\s\u200B<]*/.exec(rest)[0];
		const tag = text ? 'span' : 'div', t = document.createElement('template');
		// In parallel, in the verse's group, by verse, each text as the
		// dictionaries go: like an entry, with its name and Gloss
		t.innerHTML = (par ? `<div class="pv-t" data-id="${sortId(d)}" data-d="${d}">${entryHeadHTML(d)}` : '') +
			`<${tag} class="vs${para ? ' para' : ''}" data-v="${v}" data-h="${escapeHTML(h)}">${heads}<span class="vs-start"><span class="vs-n">${escapeHTML(n)}</span>${word}</span>${rest.slice(word.length)}` +
			(par ? `</${tag}></div>` : ` </${tag}>`);
		const el = t.content.firstChild, vs = par ? el.lastChild : el, pe = card.querySelector('p-e');
		if(par){
			let group = pe.querySelector(`:scope > .pv[data-v="${v}"]`);
			if(!group){
				group = document.createElement('div');
				group.className = 'pv';
				group.dataset.v = v;
				insertSorted(pe, group, v, 'v');
			}
			insertSorted(group, el, sortId(d));
		}else{
			pe.append(vs);
		}
		if(text)
			noteLinks(vs);
		if(root === popupResults && h === popupHl && card.dataset.kind === 'chapter') vs.classList.add('ctx'); // (the popup's: the verse its chapter's for)
		if(root === resultsDiv && h === readHl){ // Read in context: the verse in each card (not marked), the top one's in view
			vs.classList.add('ctx');
			if (main) resultsDiv.querySelector('.vs.ctx').scrollIntoView({block: 'center'});
		}
		if(main)
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
		if (list.some(n => n.d === d)) return loadmore();
		list.push({d, data});
		notes.set(v, list);
		resultsDiv.querySelectorAll(`.vs[data-v="${v}"]`).forEach(noteLinks);
		found();
	}
	function noteLinks(vs){
		const v = +vs.dataset.v, group = vs.closest('.pv');
		if (notesGen !== searchGen || !notes.has(v) || (group && group.querySelector('.vs-note') && !vs.querySelector('.vs-note'))) return;
		notes.get(v).forEach(({d, data}) => {
			if (vs.querySelector(`.vs-note[data-d="${d}"]`)) return;
			const label = refOf(data.body);
			vs.insertAdjacentHTML('beforeend', `<button class="vs-note" data-d="${d}" data-v="${v}" onclick="showNote(this)" title="${escapeHTML(dicts[d].name + (label ? ': ' + label : ''))}" aria-label="Note on this verse (${escapeHTML(dicts[d].name)})">note</button>`);
		});
	}
	window.showNote = b => {
		const n = notes.get(+b.dataset.v)?.find(n => n.d === +b.dataset.d);
		if (!n) return;
		cleanup(popupResults);
		popupQuery = n.data.header;
		addResult({...n.data, dest: 'popup'});
	};

	// Current page path segments, e.g. ["khmer"] or ["khmer","bible"]
	const pagePath = window.location.pathname.replace(/^\/|\/$/g, '').replace(/^khmermusic$/, 'khmer/music'); // strip leading/trailing slashes; /khmermusic is the old address of /khmer/music
	const pParts = pagePath.split('/').filter(Boolean);
	// The path's language segment(s) (usually one, e.g. ["khmer"]): the ones
	// abbr has a locale code for
	const pLangParts = pParts.filter(p => abbr[p]?.[2]);
	// The language's fonts (its folder's .woff2s, e.g. khmer/battambang.woff2,
	// just its script's characters): first, so the rest of the text keeps the
	// page's font
	const fonts = filesJson.core.map(([f]) => f).filter(f => f.startsWith(pParts[0] + '/') && f.endsWith('.woff2'));
	fonts.forEach(f => document.fonts.add(new FontFace(f, `url(/${f})`)));
	if (fonts.length) document.body.style.fontFamily = `${fonts.map(f => `"${f}"`).join()}, ${getComputedStyle(document.body).fontFamily}`;
	const curLang = pLangParts[0] || pParts[0] || '';

	// Every dictionary on the page, from files.json's [path, timestamp,
	// description, buflen, priority, type, collapsed, size]. Its category is
	// its folders after the language's (a Khmer and an English Bible text
	// are both "bible/text"). It's on the page if its path has every one of
	// the page's segments ("primary"), or it's another language's with
	// priority <= 0 in a category that's on the page. Priority: 1, the
	// language's main ones; 0, the best of the other languages' (on, like
	// 1's); 2, 3, ... the language's others, and -1, -2, ... the other
	// languages' (the slider in the download prompt: Extra has 2 and -1,
	// Max 3 and -2).
	const allDicts = filesJson.dicts.map(([path, timestamp, desc, buflen, priority, type, collapsed, size]) => {
		const [lang, ...folders] = path.split('/').slice(0, -1);
		return {path, timestamp, desc, buflen, priority, collapsed, lang,
			type: type || '', // mono (in the language), bi (to English), rbi (English to it), phon (pronunciation), aux (audio, images, ...)
			size: size || 0, // To download
			name: path.split('/').pop().replace(/\.(peak|slab)(\.zst)?$/, ''),
			cat: folders.join('/'),
			primary: pParts.every(p => path.includes(p)),
			media: path.includes('.slab'),
			on: [undefined, 1, 0].includes(priority)}; // On by default: priority 1 and 0 (and see ownLevel)
	});
	const primaryCats = new Set(allDicts.filter(x => x.primary).map(x => x.cat));
	// Other languages' dictionaries added in the library (their paths)
	const addKey = `peakslab-added-${pagePath}`, addedPaths = new Set(readList(addKey));
	allDicts.forEach(x => { x.added = !x.primary && addedPaths.has(x.path); });
	const dicts = allDicts.filter(x => x.primary || x.added || (x.priority <= 0 && primaryCats.has(x.cat)));
	const dictIds = dicts.map((_, d) => d);
	// The download prompt's levels (firstHTML): which dictionaries each has
	// (9: none, never suggested). On by default: Recommended's, and if none
	// of the page's own is, its own of the first level that has any (a page
	// of one Bible text, like /khmer/bible/text/gkb, has that one)
	const LEVELS = ['Bare', 'Recommended', 'Extra', 'Max'];
	const levelOf = ({priority: p}) => p == null || p === 1 ? 0 : p === 0 ? 1 : [2, -1].includes(p) ? 2 : [3, -2].includes(p) ? 3 : 9;
	const ownLevel = Math.min(9, ...dicts.filter(x => x.primary).map(levelOf));
	dicts.forEach(x => { x.on = levelOf(x) <= 1 || (x.primary && levelOf(x) <= ownLevel); });
	// Used by a search (view 'filter') or a gloss ('gloss'): on (a gloss's:
	// on for glosses, glossOn), and in what that view has picked (all of it:
	// none picked; a link's: just its)
	const isOn = (d, view = 'filter') => onIn(view)(d) && (solo.length > 0 || inFilter(d, view));

	// Order: categories with the most priority-1 dictionaries first, then within
	// a category this page's language first, then by priority (0, 1, 2, 3,
	// ..., then -1, -2, ...), then name.
	// Search results list each word's entries in this same order.
	const rank = p => p == null ? 1 : p >= 0 ? p : 100 - p;
	const mainCount = {};
	dicts.forEach(x => { if (x.primary && rank(x.priority) <= 1) mainCount[x.cat] = (mainCount[x.cat] || 0) + 1; });
	dicts.sort((a, b) =>
		(mainCount[b.cat] || 0) - (mainCount[a.cat] || 0) || a.cat.localeCompare(b.cat) || b.primary - a.primary ||
		rank(a.priority) - rank(b.priority) || a.lang.localeCompare(b.lang) || a.path.localeCompare(b.path));

	// Speech synthesis (the selection menu's 🔊): the page's languages, with
	// their locale codes, or English
	const derivedLang = [...new Set([...pLangParts, ...dicts.map(x => x.lang)])]
		.filter(l => abbr[l]?.[2]).map(l => ({name: cap(l), val: abbr[l][2]}));
	const lang = derivedLang.length ? derivedLang : [{name: 'English', val: 'en_US'}];

	// The app's name: the path's symbols (khmer → ខ, khmer/music → ខ𝄞)
	const appname = (pParts.length ? pParts : ['?']).map(p => abbr[p]?.[1] || abbr[p]?.[0] || p).join('');
	const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
	if (appTitle) appTitle.content += appname;
	document.title += appname;

	const byPaths = paths => paths.map(p => dicts.findIndex(x => x.path === p)).filter(d => d >= 0);

	const sizeText = n => n < 1e6 ? `${n && Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
	startHidden = new Set(dicts.filter(x => x.collapsed).map(x => x.name));
	applyHidden();

	const typeOf = x => x.type ? `<span class="lib-type type-${x.type}">${escapeHTML(typeLabel(x))}</span>` : '';
	const typeLabel = ({type, lang}) => {
		const l = cap(lang);
		return {mono: l, bi: `${l} → English`, rbi: `English → ${l}`, phon: 'Pronunciation', aux: 'Auxiliary'}[type] || '';
	};

	// The filter: categories made from the dictionaries on the page, by kind
	// (their folders, named as they are: Bible, Dict, Bible / text, Music,
	// Phonetics, ...), Bible first. Pick any number of them and searches use
	// just their dictionaries; none picked is All. Each dictionary is on or
	// off, the same in every category.
	const catLabel = c => cap(c.replaceAll('/', ' / '));
	// The categories, in the order their entries come (their first
	// dictionary's). Again when a dictionary's added or taken off. Choosing
	// is worth it only with two or more: one category is everything.
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
		const xs = dictIds.map(d => dicts[d]), top = x => x.cat.split('/')[0] || 'other', two = x => x.cat.split('/').slice(0, 2).join('/');
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
	// The filter (what searches use) and the gloss (what glosses use) work
	// the same way, with the same drawer (filterHTML): each picks categories
	// (none: All), remembered (the filter's can come in the link's ?mode=).
	// The gloss's is for the popup too; the filter's searches again.
	const VIEWS = {
		filter: {title: 'Filter', uses: 'searches', key: `peakslab-filter-${appname}`, changed: () => searchAgain()},
		gloss: {title: 'Gloss with', uses: 'glosses and popups', key: `peakslab-glosscats-${appname}`},
	};
	const picks = {filter: urlParams.has('mode') ? urlParams.get('mode').split(',') : readList(VIEWS.filter.key), gloss: readList(VIEWS.gloss.key)};
	const keepPicks = () => Object.keys(picks).forEach(v => { picks[v] = picks[v].filter(id => choice && catById(id)); });
	keepPicks();
	const filtered = (view = 'filter') => picks[view].length > 0;
	const selCats = (view = 'filter') => picks[view].map(catById);
	const inFilter = (d, view = 'filter') => !filtered(view) || selCats(view).some(c => c.members.includes(d));
	// The row of a gloss's word boxes each category's dictionaries go in
	// (1, 2 or 3; the filter and the gloss pick it): pronunciation 1, the
	// rest 2. A dictionary's is its top category's (or its own folder's).
	const GLOSS_ROWS = [1, 2, 3];
	const rowsKey = `peakslab-glossrows-${appname}`, rowSet = {...stored(rowsKey)};
	const catRow = id => rowSet[id] || (id.startsWith('phonetics') ? 1 : 2);
	const glossRow = d => catRow(cats.find(c => isTop(c) && c.members.includes(d))?.id || dicts[d].cat);

	// Stars: a starred dictionary's entries come first and stand out, in the
	// order they were starred, and its words are the ones searched first.
	// ?dict=h97,g2k is a page with only those dictionaries loaded ("solo"):
	// downloaded without asking, and nothing remembered (a shared card's link)
	const solo = (urlParams.get('dict') || '').split(',').map(n => dicts.findIndex(x => x.name === n)).filter(d => d >= 0);
	// Each dictionary on or off: saved ([{file, enabled}]), or the defaults.
	// If storage doesn't work (some privacy modes, in-app webviews) the
	// defaults load and the page works normally; it just won't remember.
	const libKey = `peakslab-dicts-${appname}`;
	// The first time (nothing saved), none until asked (firstHTML)
	let asking = !solo.length && stored(libKey) === null;
	const libOn = solo.length || asking ? dicts.map((_, d) => solo.includes(d)) : (saved => dicts.map(x => saved.get(x.path) ?? x.on))(new Map(readList(libKey).map(x => [x.file, !!x.enabled])));
	const downloaded = new Set(); // In the offline cache (the service worker says), or loaded
	// The gloss's own on or off for each (its drawer's: it changes nothing
	// else), saved {path: on}; one not in it is as it's on for the rest. One
	// that's off is on for glosses only while it's downloaded.
	const glossKey = `peakslab-glossdicts-${appname}`, glossSet = solo.length ? {} : {...stored(glossKey)};
	const glossOn = d => glossSet[dicts[d].path] ?? libOn[d] ? libOn[d] || downloaded.has(d) : false;
	const onIn = view => view === 'gloss' ? glossOn : d => libOn[d];
	const starKey = `peakslab-stars-${appname}`;
	let stars = byPaths(readList(starKey));
	const isStar = d => stars.includes(d);
	const sortId = d => isStar(d) ? stars.indexOf(d) - 1000 : d + 1; // (starred first, then the dictionaries' order)
	const starBtnHTML = d => `<button class="star-btn" data-d="${d}" onclick="toggleStar(${d})" aria-pressed="${isStar(d)}" title="${isStar(d) ? 'Unstar' : 'Star: show it first'}" aria-label="Star ${escapeHTML(dicts[d].name)}">${isStar(d) ? '★' : '☆'}</button>`;
	const focusEnd = document.createElement('span'); // The starred dictionaries' sections go above this

	const workers = [];
	const workers_num = dicts.length > 1 ? 2 : 1;
	for (let i = 1; i <= workers_num; ++i) createPeakWorker(i);
	earlyWorkers.slice(workers_num).forEach(w => w.terminate()); // started early but not needed
	let worker_code = new Array(workers.length).fill(false);
	// The dictionaries that are on are loaded, and any used while off (asked:
	// glossing with one); searches use the ones on that the filter has
	// (isOn), glosses and the popup the ones the gloss has
	const loaded = new Set(), loading = new Set(), asked = new Set();
	// Behind the search bar while dictionaries load: how much of what's
	// loading (by size, and the bytes of the ones downloading) has, since
	// none were; gone once they all have
	let loadAll = 0, loadDone = 0;
	const loadPart = new Map(); // dictionary -> bytes of it downloaded so far
	function showLoad(){
		if (!loading.size) { loadAll = loadDone = 0; loadPart.clear(); }
		const part = [...loadPart].reduce((n, [d, b]) => n + (loading.has(d) ? b : 0), 0);
		queryInput.classList.toggle('loading', !!loading.size);
		queryInput.style.setProperty('--load', loading.size ? `${100 * (loadDone + part + .03 * loadAll) / (1.03 * loadAll || 1)}%` : '');
	}
	// A dictionary the search uses has loaded. One just downloaded (fetched)
	// doesn't change the results showing: once they've all loaded, a prompt
	// asks to search again (askRefresh). One from the offline cache, or
	// nothing showing yet: the search again now. So does a download that
	// was over quickly (they all loaded within a second or so).
	const fetched = new Set(); // Downloading (not in the offline cache)
	let stale = false; // The results showing are missing ones just downloaded
	let loadStart = 0; // When the dictionaries loading started loading
	function moreResults(d){
		if (fetched.delete(d) && query && (num || translationDiv.childElementCount)) stale = true;
		else searchAgain();
	}
	const refreshBar = $('refreshBar');
	function askRefresh(){
		if (!stale) return;
		if (performance.now() - loadStart < 1500) searchAgain(); // (it hides it)
		else refreshBar.classList.remove('hide');
	}
	function hideRefresh(){
		stale = false;
		refreshBar.classList.add('hide');
	}
	refreshBar.querySelector('.rb-go').addEventListener('click', searchAgain); // (startSearch hides it)
	refreshBar.querySelector('.close-btn').addEventListener('click', hideRefresh);
	const pendingLoad = new Map(); // dictionary -> what to do once it's loaded
	function ensureLoaded(d, then){
		if (loaded.has(d)) return then();
		push(pendingLoad, d, then);
		if (!libOn[d]) asked.add(d);
		loadDict(d);
	}
	// What a search uses: the ones on that the filter has; reading a chapter,
	// every Bible text that's on too (the filter doesn't change them)
	const searched = d => isOn(d) || (libOn[d] && isBibleText(d) && (isChapter(query) || !!rangeOf(query)));
	const searchMask = () => dicts.map((_, d) => searched(d));
	let searching = []; // What the search showing uses (startSearch)


	function cleanup(container){
		container.querySelectorAll('img[src^="blob:"], audio[src^="blob:"]').forEach(el => {
			URL.revokeObjectURL(el.src);
			el.src = '';
		});
		if(container == resultsDiv)
			settings.style.display = 'none';
		container.replaceChildren();
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

	const countSpan = $('count'); // How many were found: in the header's second line
	const resultsDiv = $('results');
	const popupOverlay = $('popupOverlay');
	const popupResults = $('popupResults');

	// Above the results: the big text box for long queries and the
	// search's word by word gloss.
	const bigQuery = $('bigQuery');
	const translationDiv = $('translation');

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
	// A range of verses ("rom 1.4-20", "rom 1:4-2:3") or of chapters ("rom
	// 1-5", "rom1-5"): its book as typed (a code, or a book's name; "Rom.")
	// and its first and last verses as chapter * 1000 + verse (addVerse's)
	function rangeOf(q){
		const m = /^(.*?\D)\.? ?(\d+)(?:[.:](\d+))? ?[-–] ?(?:(\d+)[.:])?(\d+)\.?$/.exec(q || '');
		if (!m) return null;
		const [, book, c1, v1, c2, n] = m;
		const from = c1 * 1000 + (+v1 || 1), to = v1 || c2 ? (+c2 || +c1) * 1000 + +n : n * 1000 + 999;
		return to < from ? null : {book: book.trim(), from, to};
	}
	// Bible d's lines in range r ({d, at (the first), last}, in its order:
	// the Bible's), or null. Its book: its code, or the name a Bible gives it.
	const bookCode = book => (b => books?.find(x => x.code.toLowerCase() === b || x.name.toLowerCase() === b)?.code || book)(book.toLowerCase());
	const headsCache = {};
	const headsOf = d => headsCache[d] ??= askDict(d, {type: 'heads'}).then(r => r.heads.map(h => h.toLowerCase()));
	const rangeLines = (d, r) => new Promise(then => books ? then() : loadBooks(then)).then(() => headsOf(d)).then(heads => {
		const code = bookCode(r.book).toLowerCase();
		let at = -1, last = -1;
		heads.forEach((h, i) => {
			const m = /^(.+) (\d+)\.(\d+)$/.exec(h), v = m && m[2] * 1000 + +m[3];
			if (!m || m[1] !== code) return;
			if (at < 0 && v >= r.from) at = i;
			if (v <= r.to) last = i;
		});
		return at >= 0 && last >= at ? {d, at, last} : null;
	});
	const lineMsg = (from, n) => ({type: 'renderlines', lines: Array.from({length: n}, (_, i) => [from + i, 3])}); // (3: by line)
	// n of Bible d's lines from at, as a chapter's verses, in the results or
	// the popup (root)
	const showLines = (d, at, n, root) => askDict(d, lineMsg(at, n)).then(r => r.entries.forEach(e => e && addVerse(e, updateQuery(e.header), d, root)));
	// A range searched: each Bible text's lines in it, 30 at a time as the
	// end of them comes near (rangeMore); in no Bible, searched
	let ranged = null; // {q, gen, parts (rangeLines'), busy}
	function rangeSearch(r, otherwise){
		const gen = ++searchGen;
		worker_code.fill(true); // (nothing for the workers to go on with)
		num = 0;
		ranged = null;
		Promise.all(dictIds.filter(d => isBibleText(d) && searched(d) && (parallel || d === readText())).map(d => rangeLines(d, r))).then(parts => {
			if (gen !== searchGen) return;
			parts = parts.filter(Boolean);
			if (!parts.length) return otherwise();
			cleanup(resultsDiv);
			resultsDiv.append(newLoader());
			ranged = {q: query, gen, parts, busy: false};
			lastRead = `${bookCode(r.book)} ${Math.floor(r.from / 1000)}.`; // (the Bible bar's)
			renderBibleBar();
			rangeMore();
		});
	}
	function rangeMore(){
		const g = ranged;
		if (!g || g.busy || g.gen !== searchGen) return;
		g.busy = true;
		Promise.all(g.parts.filter(p => p.at <= p.last).map(p => {
			const n = Math.min(30, p.last - p.at + 1);
			p.at += n;
			return showLines(p.d, p.at - n, n);
		})).then(() => {
			g.busy = false;
			if (g.gen !== searchGen) return;
			if (g.parts.some(p => p.at <= p.last)) return loadmore();
			loader?.remove();
			loader = null;
		});
	}
	// In the popup: the whole range (its first 500 verses), in each Bible text the gloss has (as a popup's search)
	const popupRange = (r, text) => dictIds.filter(d => isBibleText(d) && isOn(d, 'gloss')).forEach(d => rangeLines(d, r).then(p =>
		p && popupQuery === text && showLines(d, p.at, Math.min(500, p.last - p.at + 1), popupResults).then(() => {
			if (popupQuery !== text) return;
			popupOpen();
			popupResults.querySelector('.vs.ctx')?.scrollIntoView({block: 'center'}); // (a card's chapter: at its verse)
		})));
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
	let books = null; // [{code, n (chapters), name, zero (where its digits' 0 is), s (section)}]
	// The sections' first books (the Law, History, Poetry, the Major and Minor
	// Prophets, the Gospels, Acts, Paul's letters, the General letters,
	// Revelation) and their colors, each unlike the ones next to it
	const sections = 'gen jos job isa hos mat act rom heb rev'.split(' ');
	const secColors = 'f59 39e fc2 a6e 3c9 e33 2cc f90 75f c4a'.split(' ');
	let booksLoad = null;
	function loadBooks(then){
		const mask = searchMask();
		const d = dictIds.filter(isBibleText).sort((a, b) => mask[b] - mask[a] || sortId(a) - sortId(b))[0];
		(booksLoad ??= askDict(d, {type: 'heads'}).then(r => {
			const list = [], firsts = [];
			let s = 0;
			r.heads.forEach((h, i) => {
				const m = /^(.+) (\d+)\.\d+$/.exec(h);
				if (!m) return;
				if (list.at(-1)?.code !== m[1]) {
					s = Math.max(s, sections.indexOf(m[1].toLowerCase()));
					list.push({code: m[1], n: 0, name: m[1], zero: 48, s}); firsts.push(i);
				}
				list.at(-1).n = Math.max(list.at(-1).n, +m[2]);
			});
			return askDict(d, {type: 'renderlines', lines: firsts.map(i => [i, 3])}).then(r => {
				r.entries.forEach((e, i) => {
					const ref = e && /<p-n>@?([^<]*?)\s*(\p{Nd})\s*[:.]\s*\p{Nd}+\s*<\/p-n>/u.exec(e.body);
					if (!ref) return;
					list[i].name = ref[1] || list[i].name;
					list[i].zero = ref[2].codePointAt(0) - 1; // (chapter 1)
				});
				abbrevBooks(list);
				books = list;
			});
		})).then(then);
	}
	// Each book's short name for the Books grid (ab): its first 3 letters
	// if no other book's start with them, else its first 2, … and as much
	// of its end as tells it from the others that start like it ("Ju…s",
	// "Ju…e"; Khmer's "សាំយូ…១", "សាំយូ…២"); letters as they're written
	// (a Khmer letter with its vowels is one), spaces left out
	const letters = t => [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(t)].map(x => x.segment);
	function abbrevBooks(list){
		const ls = list.map(x => letters(x.name.replace(/[\s\u200B]+/g, ''))), part = (l, a, b) => l.slice(a, b).join('');
		list.forEach((x, i) => {
			const l = ls[i], p3 = part(l, 0, 3), p2 = part(l, 0, 2);
			if (l.length <= 3 || !ls.some((m, j) => j !== i && part(m, 0, 3) === p3)) return x.ab = p3;
			for (let k = 1; k <= l.length - 2; ++k) {
				const end = part(l, -k);
				if (!ls.some((m, j) => j !== i && part(m, 0, 2) === p2 && part(m, -k) === end)) return x.ab = `${p2}…${end}`;
			}
			x.ab = l.join('');
		});
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
	// each verse in every Bible text that's on, one after the other. Off,
	// one translation: the first on (the others on, from the library, are
	// for glosses and compare). The translations drawer (from the Bible bar)
	// has both: Parallel, and the translations (off: pick one; on: any).
	const moreHTML = '<p class="empty">Want more? <button class="text-btn" data-library="1">Go to the library</button></p>';
	const parKey = `peakslab-parallel-${appname}`;
	let parallel = stored(parKey) ?? true;
	const readText = () => dictIds.find(d => isBibleText(d) && libOn[d]);
	function textsHTML(){
		const texts = dictIds.filter(d => isBibleText(d) && downloaded.has(d)); // (downloaded: the library has the rest)
		return `<ul class="rows">${rowHTML('check', `data-par="1" aria-pressed="${parallel}"`, 'Parallel', 'Verse by verse in each translation ticked')}</ul>` +
			`<h3 class="drawer-h">Translations</h3>` + (texts.length ? '' : '<p class="empty">None downloaded.</p>') +
			moreHTML + `<ul class="rows">${texts.map(d =>
				rowHTML(parallel ? 'check' : 'radio', `data-text="${d}" aria-pressed="${parallel ? libOn[d] : d === readText()}"`, escapeHTML(dicts[d].name), escapeHTML(typeLabel(dicts[d])))).join('')}</ul>`;
	}
	function pickText(t){
		setOn(dictIds.filter(isBibleText), parallel ? d => d === t ? !libOn[d] : libOn[d] : d => d === t);
		if (!parallel) closeDrawer();
	}

	// Bible mode (a Bible category picked, or a Bible page), and reading a
	// chapter, have the Bible bar at the top of the results: ‹ book and
	// chapter ▾, translation ▾ ›. The book opens the Books drawer (the books,
	// a book's chapters), the translation the translations drawer. The
	// search bar's there to type in too.
	const bibleMode = () => hasBible && (pParts.includes('bible') || picks.filter.some(id => id.startsWith('bible')));
	let lastRead = ''; // The chapter read last ("joh 3.")
	let booksPick = null; // The book whose chapters the drawer shows
	let booksInPopup = false; // (opened from a popup's card: a chapter picked opens there)
	const bibleBar = $('chNav');
	function renderBibleBar(){
		renderCardBars(); // (their translations, if they're the Bible bar's)
		if (isChapter(query)) lastRead = query;
		bibleBar.hidden = !bibleMode() && !isChapter(query) && ranged?.q !== query;
		if (bibleBar.hidden) return;
		if (!books) return loadBooks(renderBibleBar);
		const {b, ch} = chapterAt(lastRead);
		const go = (dir, label) => `<button class="ch-go" data-go="${dir}" aria-label="${label} chapter"${nextChapter(lastRead, dir) ? '' : ' disabled'}>${dir < 0 ? '‹' : '›'}</button>`;
		const texts = barTexts();
		bibleBar.innerHTML = `<span class="cb-sel">${go(-1, 'Previous')}<button class="cb-book">${b ? `${escapeHTML(b.name)} ${bookNum(b, ch)}` : 'Books'} ▾</button>` +
			`<button class="cb-text" data-texts="1">${parallel && texts.length > 1 ? 'Parallel' : texts.length ? names(texts) : 'Translation'} ▾</button>${go(1, 'Next')}</span>`;
	}
	bibleBar.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (b?.dataset.go) search(nextChapter(lastRead, +b.dataset.go));
		else if (b?.dataset.texts) openDrawer('texts');
		else if (b) openBooks();
	});
	// The Books drawer, at the chapters of the book read
	function openBooks(){
		booksPick = lastRead.split(' ')[0] || null;
		booksInPopup = false;
		openDrawer('books');
	}
	function booksHTML(){
		if (!books) {
			loadBooks(() => drawerView === 'books' && renderDrawer());
			return '<p class="empty">Loading…</p>';
		}
		const b = books.find(x => x.code === booksPick), cur = on => on ? ' aria-current="true"' : '';
		return (b ? `<button class="text-btn" data-books-back="1">‹ All books</button><h3 class="drawer-h bk-name">${bookName(b)}</h3>` +
				`<div class="bk-grid ch">${Array.from({length: b.n}, (_, i) => `${b.code} ${i + 1}.`).map((ref, i) => `<button data-q="${ref}"${cur(ref === lastRead)}>${bookNum(b, i + 1)}</button>`).join('')}</div>` :
			`<div class="bk-grid">${books.map(x => `<button style="--sec:#${secColors[x.s]}" data-book="${escapeHTML(x.code)}" title="${escapeHTML(x.name)}" aria-label="${escapeHTML(x.name)}"${cur(lastRead.startsWith(x.code + ' '))}>${escapeHTML(x.ab || x.name)}</button>`).join('')}</div>`);
	}

	// ---------------------------------------------------------------
	// Each Bible card (a verse's, a chapter's, a range's) has its own bar:
	// its book and reference ▾ (the Books drawer, at its book), its
	// translation ▾ (its translations menu), and a chapter's ‹ ›. A card
	// shows the Bible bar's translations (barTexts) until some are picked in
	// its menu: then it's its own (data-own, data-texts, data-par) and its
	// verses are read again from the ones picked (fillCard); the others stay
	// as they are. The menu's Apply to all makes its translations the Bible
	// bar's, and every card's.
	// ---------------------------------------------------------------
	const barTexts = () => dictIds.filter(d => isBibleText(d) && libOn[d] && (parallel || d === readText()));
	// A popup's card: the gloss's Bible texts (a chapter's card, not in
	// parallel: its one)
	const inPopup = card => card.dataset.pop === '1' || !!card.closest('#popupResults'); // (pop: made for it, before it's in it)
	// (The popup compares: every Bible text the gloss has, in parallel;
	// its translations ▾ changes the gloss's, not the search's)
	const glossTexts = () => dictIds.filter(d => isBibleText(d) && isOn(d, 'gloss'));
	const cardPar = card => inPopup(card) || (card.dataset.own ? card.dataset.par === '1' : parallel);
	const cardTexts = card => inPopup(card) ? glossTexts() : card.dataset.own ? card.dataset.texts.split(',').filter(Boolean).map(Number) : barTexts();
	// A card's reference: {bk (its book as typed or found: "joh", "Romans"),
	// from, to (chapter * 1000 + verse), kind (verse, chapter or range)}
	function verseRef(h){
		const m = /^(.+) (\d+)\.(\d+)$/.exec(h);
		return m && {bk: m[1], from: m[2] * 1000 + +m[3], to: m[2] * 1000 + +m[3], kind: 'verse'};
	}
	// The chapter or range searched
	function searchRef(){
		if (isChapter(query)) {
			const [, bk, c] = /^(.+) (\d+)\.$/.exec(query);
			return {bk, from: c * 1000 + 1, to: c * 1000 + 999, kind: 'chapter'};
		}
		const r = rangeOf(query);
		return r && {bk: r.book, from: r.from, to: r.to, kind: 'range'};
	}
	// The popup's chapter or range: a whole chapter is a chapter
	function popupRef(){
		const r = rangeOf(updateQuery(popupQuery));
		return r && {bk: r.book, from: r.from, to: r.to, kind: r.from % 1000 === 1 && r.to % 1000 === 999 && r.to - r.from < 1000 ? 'chapter' : 'range'};
	}
	const cardRef = card => ({bk: card.dataset.bk, from: +card.dataset.from, to: +card.dataset.to, kind: card.dataset.kind});
	const bookOf = bk => books?.find(x => x.code.toLowerCase() === bookCode(bk).toLowerCase());
	// The bar at the top of a card, in place of its heading (a verse's
	// stays, hidden: its headword is its bookmark's and Share's); q, what
	// it's for
	function addCardBar(card, ref, q){
		if (!ref) return;
		Object.assign(card.dataset, {bk: ref.bk, from: ref.from, to: ref.to, kind: ref.kind, q});
		const bar = document.createElement('div');
		bar.className = 'card-bar';
		card.prepend(bar);
		renderCardBar(card);
	}
	// A reference in the book's own name and digits: "John 3:16", "Romans
	// 1:4–20", "Romans 1–5"
	function refLabel({bk, from, to, kind}){
		const b = bookOf(bk), n = x => b ? bookNum(b, x) : x;
		const [c1, v1, c2, v2] = [Math.floor(from / 1000), from % 1000, Math.floor(to / 1000), to % 1000];
		const name = b ? escapeHTML(b.name) : escapeHTML(bk.toUpperCase());
		if (kind === 'verse') return `${name} ${n(c1)}:${n(v1)}`;
		if (kind === 'chapter' || (v1 === 1 && v2 === 999 && c1 === c2)) return `${name} ${n(c1)}`;
		if (v1 === 1 && v2 === 999) return `${name} ${n(c1)}–${n(c2)}`;
		return c1 === c2 ? `${name} ${n(c1)}:${n(v1)}–${n(v2)}` : `${name} ${n(c1)}:${n(v1)}–${n(c2)}:${n(v2)}`;
	}
	// Its buttons: ‹ (a chapter's), its reference ▾ (the Books drawer; in
	// the popup, its chapters open there), its translation ▾, › ; then Read
	// in context (a verse's or a range's) and Popup (its chapter in the
	// popup). If they don't all fit on its line, those two are in a ⋮ menu.
	// A popup's are always in its ⋮: Read in context (a verse's) and Show
	// in the results (what the popup has: a chapter's, at its verse).
	const fullSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>';
	const moreSVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M12 5.5v.01M12 12v.01M12 18.5v.01" stroke-width="3.2"/></svg>';
	function cardActs(card){
		const ref = cardRef(card), pop = inPopup(card);
		if (pop) return [ref.kind === 'verse' && ['ctx', contextSVG, 'Read in context'], ['full', fullSVG, 'Show in the results']].filter(Boolean);
		return ref.kind === 'chapter' ? [] : [['ctx', contextSVG, 'Read in context'], ['popup', popupSVG, 'Chapter in the popup']];
	}
	function renderCardBar(card){
		const bar = card.querySelector(':scope > .card-bar');
		if (!bar) return;
		if (!books) loadBooks(() => renderCardBar(card)); // (its book's name in the meantime: its code)
		const ref = cardRef(card), b = bookOf(ref.bk), texts = cardTexts(card), par = cardPar(card), pop = inPopup(card);
		const chapter = ref.kind === 'chapter' && b ? `${b.code} ${Math.floor(ref.from / 1000)}.` : '';
		const go = (dir, label) => chapter ? `<button class="ch-go" data-go="${dir}" aria-label="${label} chapter"${nextChapter(chapter, dir) ? '' : ' disabled'}>${dir < 0 ? '‹' : '›'}</button>` : '';
		const label = pop && texts.length > 1 ? 'Compare' : par && texts.length > 1 ? 'Parallel' : texts.length ? names(texts) : 'Translation';
		const acts = cardActs(card);
		bar.innerHTML = `<span class="cb-sel">${go(-1, 'Previous')}<button class="cb-book" data-cb="book" title="Books">${refLabel(ref)} ▾</button>` +
			`<button class="cb-text" data-cb="texts" aria-haspopup="dialog" aria-expanded="${drawerView === 'cardtexts' && textsCard === card}" title="Translations: ${par && texts.length > 1 ? names(texts) : label}">${label} ▾</button>${go(1, 'Next')}</span>` +
			(acts.length ? `<span class="cb-acts">${acts.map(([a, ic, t]) => `<button class="cb-act" data-cb="${a}" title="${t}" aria-label="${t}">${ic}</button>`).join('')}` +
				`<button class="cb-act cb-more" data-cb="more" title="More" aria-label="More" aria-haspopup="true">${moreSVG}</button></span>` : '');
		requestAnimationFrame(() => fitBar(bar));
	}
	// Folded (⋮) if its buttons, at their full width, don't fit its line
	function fitBar(bar){
		if (!bar.isConnected || !bar.querySelector('.cb-acts')) return;
		if (inPopup(bar)) return bar.classList.add('folded'); // (always)
		bar.classList.remove('folded');
		bar.classList.add('measure');
		const over = bar.scrollWidth > bar.clientWidth + 1;
		bar.classList.remove('measure');
		bar.classList.toggle('folded', over);
	}
	const cardBars = () => document.querySelectorAll('#results > p-d > .card-bar, #popupResults > p-d > .card-bar');
	const renderCardBars = () => cardBars().forEach(bar => renderCardBar(bar.parentNode));
	window.addEventListener('resize', debounce(() => cardBars().forEach(fitBar), 100));
	function cardBarClick(e){
		const b = e.target.closest('.card-bar button');
		if (!b) return;
		const card = b.closest('p-d');
		if (b.dataset.cb === 'texts') return openCardTexts(card);
		if (b.dataset.cb === 'more') return popMenu(b, cardActs(card).map(([a, ic, t]) => `<button data-a="${a}">${ic}<span>${t}</span></button>`).join(''), a => cardAct(card, a));
		closeMenus();
		cardAct(card, b.dataset.cb, b.dataset.go);
	}
	resultsDiv.addEventListener('click', cardBarClick);
	popupResults.addEventListener('click', cardBarClick);
	function cardAct(card, act, go){
		const ref = cardRef(card), b0 = bookOf(ref.bk), pop = inPopup(card);
		const code = (b0?.code || ref.bk).toLowerCase(), c = Math.floor(ref.from / 1000);
		if (go) { // The chapter before or after (the popup's, in it)
			const next = b0 && nextChapter(`${b0.code} ${c}.`, +go);
			if (!next) return;
			const [, bk, n] = /^(.+) (\d+)\.$/.exec(next);
			return pop ? openPopupSearch(`${bk} ${n}-${n}`) : search(next);
		}
		if (act === 'book') {
			booksPick = b0?.code || null;
			booksInPopup = pop;
			openDrawer('books');
		} else if (act === 'ctx' || (act === 'full' && ref.kind === 'chapter')) { // Its chapter in the results, at its verse (the popup's chapter: the one it's for)
			readHl = pop && popupHl && ref.kind === 'chapter' ? popupHl : `${code} ${c}.${ref.from % 1000}`;
			if (pop) closePopup();
			query = ''; // (searches again even if it's the chapter showing)
			search(`${code} ${c}.`);
		} else if (act === 'full') { // What the popup has, in the results
			const q = popupQuery;
			closePopup();
			search(q);
		} else if (act === 'popup') { // Its whole chapter, in the popup, at its (first) verse
			openPopupSearch(`${code} ${c}-${c}`, `${code} ${c}.${ref.from % 1000}`);
		}
	}
	// A card's translations, in the side panel (the translations drawer's,
	// for just that card: textsCard): Parallel, and the downloaded
	// translations (off: pick one; on: any), then Apply to all
	let textsCard = null, comparing = false; // (comparing: the popup's, the gloss's translations)
	function openCardTexts(card){
		if (drawerView === 'cardtexts' && textsCard === card) return closeDrawer();
		textsCard = card;
		comparing = inPopup(card);
		drawerView = null; // (opens it, even from another card's)
		openDrawer('cardtexts');
		renderCardBars();
	}
	function cardTextsHTML(){
		const card = textsCard, all = dictIds.filter(d => isBibleText(d) && downloaded.has(d));
		if (comparing) {
			const texts = glossTexts();
			return '<p class="empty">Comparing uses the translations the gloss has (⇄ in the header): ticking them here changes those, not the search\'s.</p>' +
			(all.length ? '' : '<p class="empty">None downloaded.</p>') + moreHTML +
			`<ul class="rows">${all.map(d => rowHTML('check', `data-tx="${d}" aria-pressed="${texts.includes(d)}"`, escapeHTML(dicts[d].name), escapeHTML(typeLabel(dicts[d])))).join('')}</ul>`;
		}
		if (!card?.isConnected) return '<p class="empty">That card is gone: search again.</p>';
		const texts = cardTexts(card), par = cardPar(card);
		return `<p class="empty">For ${refLabel(cardRef(card))} only. Apply to all for every card.</p>` +
			`<ul class="rows">${rowHTML('check', `data-tx-par="1" aria-pressed="${par}"`, 'Parallel', 'Verse by verse in each translation ticked')}</ul>` +
			`<h3 class="drawer-h">Translations</h3>` + (all.length ? '' : '<p class="empty">None downloaded.</p>') +
			moreHTML + `<ul class="rows">${all.map(d => rowHTML(par ? 'check' : 'radio', `data-tx="${d}" aria-pressed="${texts.includes(d)}"`, escapeHTML(dicts[d].name), escapeHTML(typeLabel(dicts[d])))).join('')}</ul>` +
			`<button class="tx-all" data-tx-all="1"${texts.length ? '' : ' disabled'}>Apply to all</button>`;
	}
	// A choice in it changes just the card (picking one, not in parallel,
	// closes it, as the translations drawer does)
	function cardTextsClick({tx, txPar, txAll}){
		const card = textsCard;
		if (comparing) { // The gloss's, and the popup again
			const d = +tx, on = !isOn(d, 'gloss');
			setGlossOn([d], on);
			if (on && !inFilter(d, 'gloss')) setFilter('gloss', [...picks.gloss, cats.find(c => isTop(c) && c.members.includes(d))?.id].filter(Boolean)); // (its category picked too)
			if (popupOverlay.style.display === 'block') openPopupSearch(popupQuery, popupHl);
			return renderDrawer();
		}
		if (!card?.isConnected) return;
		if (txAll) {
			closeDrawer();
			return applyToAll(card);
		}
		let texts = cardTexts(card), par = cardPar(card);
		if (txPar) {
			par = !par;
			if (!par) texts = [texts[0] ?? barTexts()[0] ?? dictIds.find(d => isBibleText(d) && downloaded.has(d))].filter(x => x !== undefined);
		} else {
			const d = +tx;
			texts = !par ? [d] : texts.includes(d) ? texts.filter(x => x !== d) : dictIds.filter(x => x === d || texts.includes(x));
		}
		setCardTexts(card, texts, par);
		if (!par && tx !== undefined) closeDrawer();
		else renderDrawer();
		renderCardBars();
	}
	function setCardTexts(card, texts, par){
		Object.assign(card.dataset, {own: 1, texts: texts.join(), par: par ? 1 : 0});
		renderCardBar(card);
		fillCard(card);
	}
	// The card's verses again, from its translations: a verse's card, their
	// entries for it (its other dictionaries' stay); a chapter's or a
	// range's, all their verses in it (as many as it has)
	function fillCard(card){
		const gen = card._gen = (card._gen || 0) + 1, ref = cardRef(card), par = cardPar(card), texts = cardTexts(card);
		const r = {book: ref.bk, from: ref.from, to: ref.to}, live = () => card._gen === gen && card.isConnected;
		if (ref.kind === 'verse') {
			card.querySelectorAll(':scope > p-e').forEach(pe => isBibleText(+pe.dataset.d) && pe.remove());
			return texts.forEach(d => rangeLines(d, r).then(p => p && askDict(d, lineMsg(p.at, 1))).then(res => {
				const e = res?.entries[0];
				if (!e || !live()) return;
				const t = document.createElement('template');
				t.innerHTML = entryHTML(d, e.body);
				insertSorted(card, t.content.firstChild, sortId(d));
			}));
		}
		card.querySelector(':scope > p-e')?.remove();
		card.classList.toggle('parallel', par);
		card.insertAdjacentHTML('beforeend', par || !texts.length ? '<p-e></p-e>' : entryHTML(texts[0]));
		if (!texts.length) return card.lastChild.insertAdjacentHTML('beforeend', '<p class="empty">No translation ticked.</p>');
		const own = {card, par, range: ref.kind !== 'verse'};
		// Each translation's lines, 100 at a time, in order
		const more = (d, p) => {
			if (p.at > p.last || !live()) return null;
			const n = Math.min(100, p.last - p.at + 1);
			p.at += n;
			return askDict(d, lineMsg(p.at - n, n)).then(res => {
				if (!live()) return;
				res.entries.forEach(e => e && addVerse(e, updateQuery(e.header), d, card.parentNode, own));
				return more(d, p);
			});
		};
		texts.forEach(d => rangeLines(d, r).then(p => p && more(d, p)));
	}
	// The card's translations, every card's (the Bible bar's): in parallel,
	// the ones ticked are on and the others off; else just the one picked
	// (as the translations drawer does). Searched again, each card is.
	function applyToAll(card){
		const texts = cardTexts(card), par = cardPar(card);
		if (!texts.length) return;
		parallel = par;
		store(parKey, parallel);
		resultsDiv.querySelectorAll('p-d[data-own]').forEach(c => { delete c.dataset.own; });
		setOn(dictIds.filter(isBibleText), d => texts.includes(d));
		if (drawerView === 'texts') renderDrawer();
		searchAgain();
	}

	// ---------------------------------------------------------------
	// The header's second line: the language, and quick switches for what
	// a search uses (the filter's categories). It hides while scrolling
	// down, and comes back scrolling up.
	// ---------------------------------------------------------------
	const header = $('header');
	const quick = $('quick');
	langBtn.innerHTML = `<span class="lang-name">${escapeHTML(cap(curLang))}${pParts.length > 1 ? ' · ' + escapeHTML(pParts.slice(1).map(cap).join(' · ')) : ''}</span>` +
		chevron;
	langBtn.title = langBtn.ariaLabel = `Language: ${cap(curLang)}. Change language`;
	langBtn.addEventListener('click', () => openDrawer('lang'));
	// The language panel: this language and its sections, then the others,
	// biggest first
	function langHTML(){
		const qs = queryText ? '?text=' + encodeURIComponent(queryText) : '';
		const mine = filesJson.dicts.filter(f => f[0].startsWith(curLang + '/'));
		const secs = [...new Set(mine.map(f => f[0].split('/')[1]))].filter(c => !['media', 'phonetics'].includes(c));
		return `<ul class="rows">${langRow(`/${curLang}${qs}`, cap(curLang), langCounts[curLang], pParts.length < 2, curLang)}` +
			(secs.length > 1 ? secs.map(c => langRow(`/${curLang}/${c}${qs}`, `${cap(curLang)}: ${catLabel(c)}`, mine.filter(f => f[0].split('/')[1] === c).length, pParts[1] === c, curLang)).join('') : '') + '</ul>' +
			'<h3 class="drawer-h">Other languages</h3>' + langRows(curLang, qs);
	}
	// What the filter searches, as HTML and as text: All; All but the
	// categories left out (struck through), when most are picked; or the
	// ones picked
	function filterLabel(view){
		if (!filtered(view)) return ['All', 'All'];
		const left = cats.filter(c => isTop(c) && !picks[view].includes(c.id)), names = cs => cs.map(c => c.label);
		if (selCats(view).every(isTop) && left.length < picks[view].length)
			return [`All ${names(left).map(l => `<s>${escapeHTML(l)}</s>`).join(' ')}`, `All but ${names(left).join(', ')}`];
		const t = names(cats.filter(c => picks[view].includes(c.id))).join(' + '); // (in the filter's order)
		return [escapeHTML(t), t];
	}
	// The bar: the filter's button, with what it searches and how many
	// dictionaries that is (on, in what it has picked), and the gloss's
	const quickIcons = {filter: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>', gloss: '<span aria-hidden="true">⇄</span>'};
	function renderQuick(){
		renderBibleBar();
		const b = Object.keys(VIEWS).map(v => { const [html, text] = filterLabel(v), n = dictIds.filter(d => isOn(d, v)).length;
			return `<button class="qk" data-view="${v}" aria-pressed="${filtered(v)}" aria-label="${VIEWS[v].title}: ${escapeHTML(text)}, ${n} ${n === 1 ? 'dictionary' : 'dictionaries'}">${quickIcons[v]}${html}<span class="qk-n" aria-hidden="true">${n}</span></button>`; }).join('');
		if (quick._html !== b) { quick._html = b; quick.innerHTML = b; } // Only when changed: keeps it tappable
	}
	quick.addEventListener('click', e => { const b = e.target.closest('button'); if (b) openDrawer(b.dataset.view); });
	// The whole header slides away while scrolling down, and comes back
	// scrolling up. The card being read has its
	// heading (or Bible bar) at the top of the screen (CSS: sticky), under
	// the header when it's there (--stick).
	let lastY = 0;
	const setHeader = hide => {
		header.classList.toggle('compact', hide);
		document.documentElement.style.setProperty('--stick', hide ? '0px' : header.offsetHeight + 'px');
	};
	window.addEventListener('scroll', () => {
		const y = window.scrollY;
		if (y > lastY + 6 && y > 80) setHeader(true);
		else if (y < lastY - 6 || y < 40) setHeader(false);
		lastY = y;
	}, {passive: true});
	// The results start below the whole header
	new ResizeObserver(() => {
		document.documentElement.style.setProperty('--hh', header.offsetHeight + 'px');
		setHeader(header.classList.contains('compact'));
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
		renderHome();
	}
	const listHTML = (k, n) => {
		const items = lists[k].items.slice(0, n);
		return items.length ? `<ul class="rows">${items.map(x => { const w = escapeHTML(x.w); return rowHTML('', `data-q="${w}"`, escapeHTML(x.w.replace(/\n/g, ' ')), k === 'history' ? timeAgo(x.t) : escapeHTML(x.g || ''),
			`<button class="row-x" data-rm="${k}" data-w="${w}" title="Remove" aria-label="Remove ${w}">✕</button>`); }).join('')}</ul>` :
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
	// A bookmark for w (the context menu's) on or off: it keeps the first
	// line of its entry (pe; a verse's: its text)
	function toggleBookmark(w, pe){
		const g = (pe && entryText(pe).split('\n').find(isText)) || '';
		const items = lists.bookmarks.items.filter(b => b.w !== w);
		setList('bookmarks', isBookmarked(w) ? items : [{w, g: g.length > 120 ? g.slice(0, 119) + '…' : g, t: Date.now()}, ...items]);
		if (pe?.closest('#results')) addHistory(queryText);
	}

	function timeAgo(t){
		const m = Math.round((Date.now() - t) / 60000), h = Math.round(m / 60), d = Math.round(h / 24);
		return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : h < 24 ? `${h} h ago` : d < 7 ? `${d} d ago` : new Date(t).toLocaleDateString();
	}

	// The side panel for the whole history or all the bookmarks
	// Each view's title and what's in it (the filter's and the gloss's: VIEWS, filterHTML)
	const listView = v => listHTML(v) + (lists[v].items.length ? `<button class="text-btn" data-clear="${v}">Clear all</button>` : '');
	const drawers = {history: ['History', listView], bookmarks: ['Bookmarks', listView], books: ['Books', booksHTML], texts: ['Bible translations', textsHTML], cardtexts: ['Bible translations', cardTextsHTML],
		library: ['Library and settings', libraryHTML],
		lang: ['Language', langHTML], first: ['Download dictionaries', firstHTML], about: ['About', () => $('about').innerHTML]};
	function renderDrawer(){
		let v = drawerView, scroll = drawerBody.scrollTop, [title, html] = drawers[v] || [VIEWS[v].title, filterHTML];
		if (v === 'cardtexts' && comparing) title = 'Compare translations';
		drawer.querySelector('.drawer-title').textContent = title;
		drawerBody.innerHTML = html(v);
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
	const groupHead = (key, label, text) => `<button class="cat-sel" data-exp="${escapeHTML(key)}">${wordsHTML(escapeHTML(label), text)}</button>`;
	// What a view has: the library, every dictionary; the filter and the
	// gloss, the downloaded ones
	const inView = view => d => view === 'library' || downloaded.has(d);
	// How many are on (the library: downloaded), of the ones the view has
	function catCount(c, view){
		const ds = c.members.filter(inView(view));
		return view === 'library' ? `${ds.filter(d => downloaded.has(d)).length} of ${ds.length} downloaded` : `${ds.filter(onIn(view)).length} of ${ds.length} on`;
	}
	// A category's subcategories (Bible's Bible texts, ...)
	const subsOf = c => c.sub ? [] : cats.filter(s => s.sub && s.id.split('/')[0] === c.id);
	// A list's dictionaries, in their order: a category's own (its id; not
	// the ones in its subcategories), or the ones in none (''). The filter
	// has just the downloaded ones.
	function listOf(id, view){
		const c = id && catById(id);
		const ds = c ? c.members.filter(d => !subsOf(c).some(s => s.members.includes(d))) : dictIds.filter(d => !cats.some(c => c.members.includes(d)));
		return ds.filter(inView(view));
	}
	// A category the view has any of (the filter: any downloaded)
	const shown = (c, view) => c.members.some(inView(view));
	// A dictionary's name, kind, size (with its state, if any) and description
	const infoHTML = (x, size = x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') =>
		`<span class="lib-name"><span class="row-w">${escapeHTML(x.name)}</span>${typeOf(x)}${size}</span><span class="lib-desc">${x.desc}</span>`;
	// A dictionary: on or off, what kind it is, its size, what it is, and
	// its star (deleting is the library's). In the library, not on or off:
	// ⬇ (a circle while it downloads, then 🗑), its size under it. One added
	// from another language has ✕ for 🗑 (and beside ⬇): it comes off the
	// page, its download stays (its own language's page can delete it)
	const stateOf = d => loading.has(d) ? 'loading' : downloaded.has(d) ? 'got' : 'down';
	// (The gloss's: on or off for glosses, no star: they're everything's)
	function dictRowHTML(d, view){
		const x = dicts[d], state = stateOf(d), own = view === 'gloss', lib = view === 'library';
		if (lib) return `<li class="row dict-row${isStar(d) ? ' starred' : ''}"><div class="row-main">${infoHTML(x, '')}</div>` +
			`<div class="dict-acts"><button class="dict-act ${state}" data-${state !== 'got' ? 'get' : x.added ? 'unlink' : 'del'}="${d}"${state === 'loading' ? ' disabled' : ''} ` +
			`aria-label="${{down: 'Download', loading: 'Downloading', got: x.added ? 'Take off this page:' : 'Delete the download of'}[state]} ${escapeHTML(x.name)}" title="${{down: 'Download', loading: 'Downloading…', got: x.added ? 'Take it off this page (its download stays)' : 'Delete its download'}[state]}">${{down: '⬇', loading: '', got: x.added ? '✕' : '🗑'}[state]}</button>` +
			(x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') + '</div>' +
			(x.added && state !== 'got' ? `<button class="dict-del" data-unlink="${d}" title="Take it off this page" aria-label="Remove ${escapeHTML(x.name)}">✕</button>` : '') +
			`${starBtnHTML(d)}</li>`;
		return `<li class="row dict-row${isStar(d) ? ' starred' : ''}"><button class="row-main check dict-on" data-on="${d}" aria-pressed="${onIn(view)(d)}">` +
			infoHTML(x) + '</button>' + (own ? '' : starBtnHTML(d)) + '</li>';
	}
	function rowsHTML(id, view){
		const ds = listOf(id, view);
		return ds.length ? `<ul class="rows dict-rows">${ds.map(d => dictRowHTML(d, view)).join('')}</ul>` : '<p class="empty">None downloaded.</p>';
	}
	// The categories; opened, their own dictionaries, then each
	// subcategory's under its heading. Then Other: the ones in none. In the
	// filter and the gloss a category's name picks it, and 1 2 3 its row in
	// a gloss; in the library it opens it.
	function catsHTML(view){
		if (!choice) return rowsHTML('', view);
		const tops = cats.filter(c => isTop(c) && shown(c, view));
		const btn = (c, act, attrs, html) => `<button data-cat="${c.id}" data-act="${act}" ${attrs}>${html}</button>`;
		const cat = c => groupHTML(`${view}:${c.id}`,
			view !== 'library' ? btn(c, 'sel', `class="cat-chk check" aria-pressed="${!filtered(view) || picks[view].includes(c.id)}" aria-label="${VIEWS[view].title}: ${escapeHTML(c.label)}"`, '') +
				btn(c, 'only', 'class="cat-sel" title="Just this"', wordsHTML(escapeHTML(c.label), catCount(c, view))) +
				`<span class="gloss-rows">${GLOSS_ROWS.map(n => btn(c, 'row', `data-row="${n}" aria-pressed="${catRow(c.id) === n}" title="Its words in row ${n} of a gloss"`, n)).join('')}</span>` :
				groupHead(`${view}:${c.id}`, c.label, catCount(c, view)),
			() => {
				const subs = subsOf(c).filter(s => shown(s, view));
				return (listOf(c.id, view).length || !subs.length ? rowsHTML(c.id, view) : '') +
					subs.map(s => `<h4 class="cat-subh">${escapeHTML(s.label)}</h4>${rowsHTML(s.id, view)}`).join('');
			});
		const other = listOf('', view);
		return `<ul class="rows cats">${tops.map(cat).join('')}` +
			(other.length ? groupHTML(`${view}:`, groupHead(`${view}:`, 'Other', catCount({members: other}, view)), () => rowsHTML('', view)) : '') + '</ul>';
	}
	// The filter (view 'filter') and the gloss's (view 'gloss'): All (every category ticked), then the categories, with
	// their downloaded dictionaries; untick any to search (or gloss) with
	// just the rest, or tap one's name for just it
	function filterHTML(view){
		return levelHTML(onLevel(view)) +
			(choice ? `<ul class="rows">${rowHTML('radio', `data-all="1" aria-pressed="${!filtered(view)}"`, 'All', catCount({members: dictIds}, view))}</ul>` : '') +
			catsHTML(view) +
			`<p class="empty">Tick as many as you like, or tap a name for just it: ${VIEWS[view].uses} use their dictionaries that are on${view === 'gloss' ? ' here (just for glosses and popups: searches don\'t change)' : ''}. 1, 2, 3: the row of a gloss's word boxes their words go in.${view === 'gloss' ? '' : ' Star a dictionary (☆) for its entries to come first.'}</p>` + moreHTML;
	}
	const renderLibrary = () => { if (drawerView === 'library') renderDrawer(); };
	// Library and settings (the menu's, a drawer): every dictionary on the
	// page, by category; then other languages' to add; then the settings
	// (dark mode, highlighting, text size) and the version
	function libraryHTML(){
		const byLang = new Map();
		allDicts.filter(x => !dictIds.some(d => dicts[d] === x)).forEach(x => push(byLang, x.lang, x));
		const lang = ([l, xs]) => groupHTML(`lang:${l}`, groupHead(`lang:${l}`, cap(l), `${xs.length} ${xs.length === 1 ? 'dictionary' : 'dictionaries'}`),
			() => `<ul class="rows dict-rows">${xs.map(x => (got => `<li class="row dict-row"><div class="row-main">${got ? infoHTML(x, '') : infoHTML(x)}</div>` +
				`<button class="text-btn" data-add="${escapeHTML(x.path)}">Add</button>` +
				(got ? `<div class="dict-acts"><button class="dict-act got" data-delpath="${escapeHTML(x.path)}" aria-label="Delete the download of ${escapeHTML(x.name)}" title="Delete its download">🗑</button>` +
					(x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') + '</div>' : '') + '</li>')(cachedPaths.has(x.path))).join('')}</ul>`);
		const here = sizeOf(dictIds.filter(d => downloaded.has(d) && dicts[d].lang === curLang)); // (not other languages')
		return '<p class="lib-help"><button class="text-btn" data-first="again">Download the suggested dictionaries…</button></p>' +
			`<p class="lib-space">Space used: ${sizeText(here)} for ${escapeHTML(cap(curLang) || 'this page')}${usage ? ` · ${sizeText(usage)} for all of PeakSlab` : ''} <button class="text-btn" data-first="delete">Delete everything…</button></p>` +
			catsHTML('library') +
			(byLang.size ? `<ul class="rows cats">${groupHTML('library:langs', groupHead('library:langs', 'Other languages', `${byLang.size} languages: add their dictionaries`),
				() => `<ul class="rows cats">${[...byLang].sort(([a], [b]) => a.localeCompare(b)).map(lang).join('')}</ul>`)}</ul>` : '') +
			'<h3 class="drawer-h">Settings</h3>' + prefsHTML() +
			`<details class="lib-ver"><summary>Version ${escapeHTML($('version').textContent)} and loading times</summary><div>${$('timing').innerHTML}</div></details>`;
	}
	// Dark mode, highlighting and text size (the context menu's Appearance has them too)
	const prefsHTML = () => `<ul class="rows">${rowHTML('check', `data-pref="dark" aria-pressed="${document.body.classList.contains('dark-mode')}"`, 'Dark mode', 'Light text on dark')}` +
		rowHTML('check', `data-pref="mark" aria-pressed="${mark}"`, 'Highlight matches', 'What was searched, marked in the results') + '</ul>' +
		`<div class="pref-size"><span>Text size</span><button data-pref="smaller" aria-label="Smaller text">A−</button><b>${fontSize}</b><button data-pref="bigger" aria-label="Bigger text">A+</button></div>`;
	// The first time (nothing saved): which to download. A slider picks how
	// many: Bare (priority 1), Recommended (and 0), Extra (and 2, -1), Max
	// (and 3, -2); its dictionaries are listed, ticked, by category (the
	// media folder's each under its own: Audio, Images), to untick any, and
	// the next level's, unticked, to tick. Or choose in the library (all off). Not
	// answered, it asks again next time. The library opens it again too.
	// It lists just the ones not downloaded: Download turns the ticked ones
	// on (the first time, the level's downloaded ones too), the rest stay as
	// they are.
	// (LEVELS and levelOf are with the dictionaries.) A level has the ones
	// on by default too, whatever theirs.
	const suggested = (d, n) => levelOf(dicts[d]) <= n || dicts[d].on;
	const firstIds = dictIds.filter(d => suggested(d, LEVELS.length - 1));
	let firstLevel = 1, firstPick;
	const have = d => downloaded.has(d);
	const notGot = (more = 1) => firstIds.filter(d => !have(d) && suggested(d, firstLevel + more)); // (and the next level's)
	const setLevel = n => { firstLevel = n; firstPick = new Set(notGot(0)); };
	setLevel(1);
	const sizeOf = ds => ds.reduce((n, d) => n + dicts[d].size, 0);
	function firstHTML(){
		if (!firstIds.some(d => !have(d))) return '<p class="empty">The suggested dictionaries are all downloaded.</p>';
		return '<p class="empty">Which dictionaries? They download once, then work offline.</p>' +
			levelHTML(firstLevel) +
			`<div class="first-list">${firstListHTML()}</div>` +
			'<p class="empty">Or <button class="text-btn" data-first="custom">choose my own in the library</button></p>';
	}
	// The level's dictionaries and Download: redrawn as the slider moves
	function firstListHTML(){
		let prev = null, html = '';
		const ids = notGot();
		ids.forEach(d => {
			const x = dicts[d], label = x.cat === 'media' ? cap(x.name) : catLabel(x.cat);
			if (label !== prev) html += `${prev === null ? '' : '</ul>'}<h4 class="cat-subh">${escapeHTML(label)}</h4><ul class="rows dict-rows">`;
			prev = label;
			html += `<li class="row dict-row"><button class="row-main check" data-pick="${d}" aria-pressed="${firstPick.has(d)}">${infoHTML(x)}</button></li>`;
		});
		if (prev !== null) html += '</ul>';
		if (!ids.length) html = '<p class="empty">These are all downloaded: slide for more.</p>';
		const picks = ids.filter(d => firstPick.has(d)), size = sizeOf(picks);
		return html + `<button class="first-default" data-first="go"${picks.length ? '' : ' disabled'}>Download${size ? ` (${sizeText(size)})` : ''}</button>`;
	}
	// The level slider, in the download prompt and the filter: at level n
	// (-1: none, the ones on are someone's own pick)
	const levelHTML = n => `<div class="first-level"><input type="range" min="0" max="${LEVELS.length - 1}" value="${Math.max(n, 0)}" aria-label="How many dictionaries" aria-valuetext="${LEVELS[n] || 'Custom'}">` +
		`<div class="first-marks">${LEVELS.map((l, i) => `<button data-level="${i}" aria-pressed="${i === n}">${l}</button>`).join('')}</div></div>`;
	function markLevel(n){
		const range = drawerBody.querySelector('.first-level input');
		range.value = n;
		range.setAttribute('aria-valuetext', LEVELS[n]);
		drawerBody.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.level === n));
	}
	// The prompt: the level's dictionaries, as it moves
	function showLevel(n){
		setLevel(n);
		markLevel(n);
		drawerBody.querySelector('.first-list').innerHTML = firstListHTML();
	}
	// The filter: of the downloaded dictionaries (it downloads none), the
	// level's on, the rest off, once it's let go; its level now (the one
	// picked, if it still is: two can be, with none of one's own
	// downloaded), or -1
	const got = () => dictIds.filter(d => downloaded.has(d));
	// (The gloss's: on for glosses)
	const picked = {filter: -1, gloss: -1};
	const isLevel = (n, view) => got().every(d => onIn(view)(d) === levelOf(dicts[d]) <= n);
	const onLevel = view => isLevel(picked[view], view) ? picked[view] : LEVELS.findIndex((_, n) => isLevel(n, view));
	function pickLevel(n){
		if (drawerView === 'first') return showLevel(n);
		const view = drawerView === 'gloss' ? 'gloss' : 'filter';
		picked[view] = n;
		(view === 'gloss' ? setGlossOn : setOn)(got(), d => levelOf(dicts[d]) <= n);
	}
	drawerBody.addEventListener('input', e => { if (e.target.matches('.first-level input')) drawerView === 'first' ? showLevel(+e.target.value) : markLevel(+e.target.value); });
	drawerBody.addEventListener('change', e => { if (e.target.matches('.first-level input') && VIEWS[drawerView]) pickLevel(+e.target.value); });
	function firstAnswer(v){
		const first = asking;
		asking = false;
		closeDrawer();
		if (v === 'go') setOn([...notGot().filter(d => firstPick.has(d)), ...(first ? firstIds.filter(d => have(d) && suggested(d, firstLevel)) : [])], true);
		else {
			saveState();
			openLibrary();
		}
	}

	// The filter, the translations and the library, where they're showing
	function renderLists(){
		if (VIEWS[drawerView] || drawerView === 'texts' || drawerView === 'cardtexts') renderDrawer();
		renderLibrary();
	}
	// Again, once (the service worker says which files it has all at once)
	const renderListsSoon = debounce(() => {
		renderLists();
		renderQuick(); // (the gloss's count: a downloaded one glosses)
		refreshUsage();
	}, 50);
	// The space all of PeakSlab takes (the browser's estimate: every
	// language's downloads, and the app), and every language's downloaded
	// dictionaries (paths: other languages' get 🗑); the library shows them
	let usage = 0, cachedPaths = new Set();
	function refreshUsage(){
		navigator.storage?.estimate?.().then(e => {
			if (e.usage === usage) return;
			usage = e.usage;
			renderLibrary();
		}).catch(() => {});
		cachedDicts().then(files => {
			const paths = new Set(files.map(f => f[2]));
			if (paths.size === cachedPaths.size && [...paths].every(p => cachedPaths.has(p))) return;
			cachedPaths = paths;
			renderLibrary();
		});
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
		}
		dictIds.push(d);
		buildCats();
		cats.filter(c => c.members.includes(d)).forEach(c => expandedCats.add(`library:${c.id}`));
		setOn([d], true);
	}
	// Every language's dictionary files in the offline cache: [cache, request, path]
	async function cachedDicts(){
		const files = [];
		try {
			for (const k of await caches.keys()) {
				const c = await caches.open(k);
				for (const r of await c.keys()) if (/\.(peak|slab)/.test(r.url)) files.push([c, r, new URL(r.url).pathname.slice(1)]);
			}
		} catch (e) { /* no Cache API */ }
		return files;
	}
	// A download deleted (it's turned off: it downloads again when it's on)
	async function deleteDict(d){
		const x = dicts[d];
		if (libOn[d]) setOn([d], false);
		else if (loaded.has(d)) unloadDict(d);
		for (const [c, r, path] of await cachedDicts()) if (path === x.path) await c.delete(r);
		downloaded.delete(d);
		refreshUsage();
		renderLists();
	}
	// An added one taken off the page, turned off; its download stays (its
	// number stays, unused)
	function unlinkDict(d){
		const x = dicts[d];
		if (libOn[d]) setOn([d], false);
		else if (loaded.has(d)) unloadDict(d);
		x.added = false;
		store(addKey, readList(addKey).filter(p => p !== x.path));
		[dictIds, stars].forEach(l => { const i = l.indexOf(d); if (i >= 0) l.splice(i, 1); });
		buildCats();
		keepPicks(); // (a category gone)
		setFilter('filter', picks.filter);
		renderLists();
	}
	// Another language's download deleted (the library's Other languages)
	async function deletePath(path){
		for (const [c, r, p] of await cachedDicts()) if (p === path) await c.delete(r);
		refreshUsage();
	}
	// Every language's downloaded dictionaries deleted (asked first, with
	// their size), all turned off; the app and the settings stay. Each page
	// asks which to download again.
	async function deleteAll(){
		const files = await cachedDicts(), paths = new Set(files.map(f => f[2]));
		const size = allDicts.filter(x => paths.has(x.path)).reduce((n, x) => n + x.size, 0);
		if (!confirm(`Delete every downloaded dictionary, in every language${size ? ` (${sizeText(size)})` : ''}? You can download them again.`)) return;
		setOn(dictIds, false);
		for (const [c, r] of files) await c.delete(r);
		downloaded.clear();
		refreshUsage();
		renderLists();
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
	document.querySelectorAll('[data-drawer]').forEach(b => b.addEventListener('click', () => openDrawer(b.dataset.drawer)));

	// The home page (nothing searched): empty (the history and bookmarks
	// are the menu's)
	const homeDiv = $('home');
	function renderHome(){
		if (drawerView) renderDrawer();
	}
	// The buttons in the drawer and on the home page
	function rowClick(e){
		const b = e.target.closest('button');
		if (!b) return;
		const {book, booksBack, all, q, rm, w, clear, open, act, par, text, on, get, del, delpath, unlink, add, exp, library, pick, level, first, tx, txPar, txAll, pref} = b.dataset;
		if (pref) { // Settings
			setPref(pref);
			return renderDrawer();
		}
		const drawerBooks = drawerView === 'books';
		if (tx !== undefined || txPar || txAll) return cardTextsClick(b.dataset); // (a card's translations)
		const view = VIEWS[drawerView] ? drawerView : 'filter'; // (whose categories)
		if (pick) { // The first time's choices
			if (!firstPick.delete(+pick)) firstPick.add(+pick);
			drawerBody.querySelector('.first-list').innerHTML = firstListHTML();
		} else if (level) pickLevel(+level);
		else if (first === 'again') {
			setLevel(firstLevel); // (what's downloaded now)
			openDrawer('first');
		} else if (first === 'delete') deleteAll();
		else if (first) firstAnswer(first);
		else if (exp) { // A group opened or closed
			if (!expandedCats.delete(exp)) expandedCats.add(exp);
			renderLists();
		} else if (del) deleteDict(+del);
		else if (unlink) unlinkDict(+unlink);
		else if (delpath) deletePath(delpath);
		else if (add) addDict(add);
		else if (get) setOn([+get], true); // (on, it downloads)
		else if (library) openLibrary();
		else if (par) {
			parallel = !parallel;
			store(parKey, parallel);
			renderDrawer();
			renderBibleBar();
			if (isChapter(query) || resultsDiv.querySelector('.card-bar')) searchAgain(); // The chapter (or verses) showing, again
		} else if (text) {
			pickText(+text);
		} else if (on) {
			if (drawerView === 'gloss') setGlossOn([+on], !glossOn(+on));
			else setOn([+on], !libOn[+on]);
		} else if (book || booksBack) {
			booksPick = book || null;
			renderDrawer();
		} else if (all) {
			setFilter(view, []);
		} else if (act) { // A category's
			const c = catById(b.dataset.cat), s = picks[view];
			if (act === 'sel') return setFilter(view, !filtered(view) ? cats.filter(x => isTop(x) && x !== c).map(x => x.id) : s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id]); // (All: all but it)
			if (act === 'only') return setFilter(view, [c.id]);
			if (act === 'row') {
				rowSet[c.id] = +b.dataset.row;
				store(rowsKey, rowSet);
				return renderDrawer();
			}
		} else if (q !== undefined) {
			closeDrawer();
			const ch = drawerBooks && booksInPopup && popupOverlay.style.display === 'block' && /^(.+) (\d+)\.$/.exec(q);
			if (ch) openPopupSearch(`${ch[1]} ${ch[2]}-${ch[2]}`);
			else search(q);
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

	renderHome();
	updateFilterUI();

	ack = url => { // In the offline cache
		const d = dicts.findIndex(x => x.path === url);
		if (d >= 0 && !downloaded.has(d)) { downloaded.add(d); renderListsSoon(); }
	};

	// Loads the dictionaries that are on (and any asked for); the others go
	function applyOn(){
		dicts.forEach((_, d) => libOn[d] || asked.has(d) ? loadDict(d) : loaded.has(d) && unloadDict(d));
		renderQuick();
	}

	// Turns these dictionaries on or off (on: true, false, or one for each),
	// and searches again if what's searched changed (one still loading
	// searches again once it's loaded)
	function setOn(ds, on){
		const was = searchMask();
		ds.forEach(d => {
			libOn[d] = typeof on === 'function' ? on(d) : on;
			if (!libOn[d]) asked.delete(d); // (not kept loaded)
		});
		saveState();
		applyOn();
		renderLists();
		renderBibleBar();
		if (ds.some(d => was[d] !== searched(d) && (!searched(d) || loaded.has(d)))) searchAgain();
	}

	// Turns these on or off for glosses only (the gloss's drawer)
	function setGlossOn(ds, on){
		ds.forEach(d => { glossSet[dicts[d].path] = typeof on === 'function' ? on(d) : on; });
		if (!solo.length) store(glossKey, glossSet);
		renderLists();
		renderQuick();
	}

	// Changes what the filter (or the gloss) has picked
	function setFilter(view, ids){
		let s = ids.filter(catById);
		if (cats.filter(isTop).every(c => s.includes(c.id))) s = []; // Every one: All
		picks[view] = s;
		store(VIEWS[view].key, s);
		updateFilterUI();
		VIEWS[view].changed?.();
	}
	function updateFilterUI(){
		renderLists();
		renderQuick();
		updateURL();
	}

	// Which of the page's dictionaries are in the offline cache, before
	// asking: nothing saved (a new page, like /khmer/h97) but the suggested
	// ones all downloaded already, those are just turned on; saved but none
	// downloaded, asked too. Can't tell (no Cache API): as saved, or asked.
	const markCached = async () => {
		const hits = await Promise.all(dicts.map(x => caches.match('/' + x.path)));
		hits.forEach((hit, d) => hit && downloaded.add(d));
		return hits.some(Boolean);
	};
	if (solo.length) applyOn();
	else markCached().catch(() => !asking).then(any => {
		if (asking && any && !notGot(0).some(d => !downloaded.has(d))) {
			asking = false;
			firstIds.filter(d => downloaded.has(d) && suggested(d, firstLevel)).forEach(d => { libOn[d] = true; });
			saveState();
		} else if (asking || !any) {
			asking = true;
			libOn.fill(false);
			setLevel(firstLevel); // (with what's downloaded)
			openDrawer('first');
		}
		applyOn();
	});

	function saveState() {
		if (!solo.length && !asking) store(libKey, dicts.map((x, d) => ({file: x.path, enabled: libOn[d]}))); // (solo leaves them alone)
	}


	// The dictionary bytes are fetched HERE, on the page, and transferred
	// (zero-copy) to the worker, rather than letting the worker fetch them.
	// The page is always controlled by the service worker, but the worker is
	// a blob: URL worker in the built 404.html, and whether a blob worker's
	// fetch() goes through the service worker differs between browsers. When
	// it doesn't, every dictionary skips the SW cache and goes to the network
	// / HTTP cache: slow when online, while offline things looked fine.
	function loadDict(d) {
		if (loaded.has(d) || loading.has(d)) return;
		if (!loading.size) { loadAll = loadDone = 0; loadStart = performance.now(); }
		loadAll +=dicts[d].size || 1;
		loading.add(d);
		showLoad();
		renderListsSoon();
		// The worker reads it from the offline cache itself (off this
		// thread), or asks for it with 'needbytes' if there's no
		// current copy there.
		const {path, name, buflen, timestamp} = dicts[d];
		workerOf(d).postMessage({type: 'load', did: didOf(d), msg: [path, name, buflen], timestamp});
	}

	// For a worker whose cache has no current copy ('needbytes'): fetch()
	// goes through the service worker, which downloads and caches it.
	// Its bytes as they come show in the search bar (showLoad).
	async function fetchDict(path, d) {
		const r = await fetch(path);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		if (!r.body) return r.arrayBuffer();
		const reader = r.body.getReader(), chunks = [];
		let n = 0;
		for (let c; !(c = await reader.read()).done; ) {
			chunks.push(c.value);
			n += c.value.length;
			loadPart.set(d, Math.min(n, dicts[d].size || n));
			showLoad();
		}
		const buf = new Uint8Array(n);
		n = 0;
		for (const c of chunks) { buf.set(c, n); n += c.length; }
		return buf.buffer;
	}

	function unloadDict(d){
		asked.delete(d);
		workerOf(d).postMessage({type: 'destroy', did: didOf(d)});
		loaded.delete(d);
	}

	// The star on a dictionary (in the filter or on one of its entries):
	// starred ones come first. Starring one turns it on.
	function toggleStar(i){
		stars = isStar(i) ? stars.filter(x => x !== i) : [...stars, i];
		if (!solo.length) store(starKey, stars.map(d => dicts[d].path));
		if (isStar(i) && !libOn[i]) setOn([i], true);
		updateStarUI();
		searchAgain();
	}
	window.toggleStar = toggleStar;

	// The address bar always holds a link to what's on screen.
	function updateURL(){
		const p = new URLSearchParams();
		if (solo.length) p.set('dict', solo.map(d => dicts[d].name).join());
		if (filtered()) p.set('mode', picks.filter.join());
		if (queryText) p.set('text', queryText);
		const qs = p.toString();
		history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
	}

	// How many were found (short, in the header's second line; all of it, its title)
	function updateStatus(text, short = text){
		countSpan.textContent = short;
		countSpan.title = text;
	}

	// A link (this page's, or a card's): the phone's share menu, or copied
	async function share(btn, url){
		if (!url) {
			updateURL();
			url = window.location.href;
		}
		try {
			if (navigator.share) {
				await navigator.share({title: document.title, url: url});
				return;
			}
			await copy(btn, url, 'Link copied');
		} catch (e) {
			if (e.name !== 'AbortError') window.prompt('Copy this link:', url);
		}
	}
	// Text copied, the button saying so for a moment
	async function copy(btn, text, said = 'Copied'){
		try {
			await navigator.clipboard.writeText(text);
		} catch (e) {
			return window.prompt('Copy this:', text);
		}
		const was = btn.innerHTML;
		btn.textContent = said;
		setTimeout(() => { btn.innerHTML = was; }, 1500);
	}

	function updateStarUI(){
		document.querySelectorAll('[data-d] > p-h').forEach(h => { h.outerHTML = entryHeadHTML(+h.parentNode.dataset.d); });
		renderLists();
	}


	// What the popup shows (its ⤢ searches it in the results)
	let popupQuery = '';
	let popupHl = ''; // The verse a chapter in it is for (a Bible card's Popup)
	function openPopupSearch(text, hl = ''){
		popupHl = hl;
		popupQuery = text;
		cleanup(popupResults);
		const q = updateQuery(text), mask = glossMask();
		if (hasBible && rangeOf(q)) return popupRange(rangeOf(q), text);
		const go = m => forWorkers(m, (w, code) => [1, 2].forEach(st => w.postMessage({type: "tempsearch", st, query: q, dest: "popup", dicts: code})));
		go(mask);
		// The gloss's that aren't loaded (off on the page): once they are
		mask.forEach((on, d) => on && !loaded.has(d) && ensureLoaded(d, () => popupQuery === text && go(dicts.map((_, i) => i === d))));
	}
	function popupOpen(){
		popupOverlay.style.display = 'block';
		popupOverlay.scrollTop = 0;
		document.body.classList.add('no-scroll');
		setTimeout(() => document.addEventListener('click', closePopupClick)); // A click outside closes it (after the click that opened it, if one did)
	}
	function closePopupClick(e){
		if (!e.composedPath().some(n => n.matches?.('#popupContent, #controls, #drawer, #ctxMenu'))) { // (its buttons below, and the drawer it opens, are usable; by where it was tapped: what's tapped can be redrawn by then)
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
	$('popupFull').addEventListener('click', () => {
		closePopup();
		search(popupQuery);
	});

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
		renderHome();
		settings.style.display = 'block';
		resultsDiv.replaceChildren();
		translationDiv.replaceChildren();
	}

	// The worker's indexes for the starred dictionaries that worker i has,
	// which it searches first
	function starDids(i){
		return stars.filter(d => d % workers.length == i).map(didOf);
	}

	let searchGen = 0, searchAt = 0;
	// The search's stage st (a new search's first) in each worker with
	// dictionaries searched in it, and its first results; worker_code[i]:
	// worker i is done
	function searchStage(start){
		if (start) {
			num = 0;
			++searchGen;
			searchAt = performance.now();
		}
		forWorkers(searching, (w, code, i) => {
			const any = code.includes(true);
			if (any && start) w.postMessage({type: "setquery", query});
			if (any || start) w.postMessage({type: start ? "initsearch" : "continuesearch", st, dicts: code, focus: starDids(i), gen: searchGen});
			worker_code[i] = !any;
		});
		getResults();
	}

	// More results when the end of them comes near (a chapter's verses too;
	// Read in context: till its verse is there; nothing searched: nothing)
	function loadmore(){
		if (ranged && loader && loader.getBoundingClientRect().top <= window.innerHeight + 400) rangeMore();
		if(query && ((readHl && !resultsDiv.querySelector('.vs.ctx')) || (loader && loader.getBoundingClientRect().top <= window.innerHeight + 400)) && worker_code.includes(false))
			getResults();
	}
	let lastCheck = 0;
	const throttledCheck = () => { if (Date.now() - lastCheck >= 80) { lastCheck = Date.now(); loadmore(); } };
	window.addEventListener('scroll', throttledCheck, { passive: true });
	window.addEventListener('resize', throttledCheck);

	const globreg = /[!+*^@]/;

	// Glosses use the dictionaries that are on (a link's: just its) in the
	// categories the gloss has picked, each word's box with a row for each
	// row's (glossRow). The ones first win a word: starred (in the order
	// starred), then by priority (0, 1, 2, 3, ..., then -1, -2, ...: rank),
	// then the dictionaries' order
	const glossIds = () => dictIds.filter(d => isOn(d, 'gloss'))
		.sort((a, b) => isStar(b) - isStar(a) || (isStar(a) ? sortId(a) - sortId(b) : rank(dicts[a].priority) - rank(dicts[b].priority) || a - b));
	const glossMask = () => dicts.map((_, d) => isOn(d, 'gloss'));
	const names = ids => ids.map(d => escapeHTML(dicts[d].name)).join(' + ');

	// The query word by word, when the search found nothing (a Bible text's
	// headwords are its verses, so "rom 8.1 gal 1.1" links to each)
	function translate(){
		if (globreg.test(query)) return;
		const q = query;
		const ids = glossIds();
		if (ids.length) translateText(ids, q, pieces => showTranslation(pieces, q, ids));
	}

	function showTranslation(pieces, q, ids){
		if (q !== query || num || !pieces.some(p => p.ds.length)) return;
		const div = document.createElement('p-d');
		div.className = 'translation';
		fillGloss(div, pieces, ids, queryText, n => `<h2>${n}</h2>`);
		translationDiv.replaceChildren(div);
		updateStatus('No entry for all of it, glossed word by word.', 'Word by word');
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
	// first (one word each in its script: "ພະເຈົ້າ<tab>@ພຣະເຈົ້າ<tab>...");
	// one that's only [pronunciations] is them, without the brackets
	const isText = x => x && !/^(\[[^\]]*\]+\s*)+$/.test(x);
	function summary(html, header){
		const all = textLines(html).filter(Boolean), lines = all.filter(isText);
		if (!lines.length) return all.join(' ').replace(/[[\]]/g, '');
		while (lines.length > 1 && !/\s/.test(lines[0]) && script(lines[0]) === script(header)) lines.shift();
		return lines.join(' ');
	}
	// An entry's text, without its labels (p-n: parts of speech, a verse's
	// reference, ...)
	function entryText(pe){
		const c = pe.cloneNode(true);
		c.querySelectorAll('p-h, p-n, button, .vs-n, .tr-entry, .menu').forEach(x => x.remove());
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
	// Dictionary d's reply to msg (loaded first)
	function askDict(d, msg){
		return new Promise(then => ensureLoaded(d, () => {
			workerReplies.set(++replyTag, then);
			workerOf(d).postMessage({...msg, did: didOf(d), tag: replyTag});
		}));
	}
	function gotReply(data){
		const then = workerReplies.get(data.tag);
		workerReplies.delete(data.tag);
		then?.(data);
	}

	// done gets the pieces: {text, d (the dictionary), entry ({d, header,
	// body, sec}), pron (pronunciations)}; text no dictionary has has no d
	// (A media dictionary's headwords are words too: its entries' text is
	// their details; its files are added to the words found, addMedia)
	function translateText(ids, text, done){
		text = text.replace(/[​⁠­﻿]/g, ''); // Invisible formatting: the dictionaries say where words break
		Promise.all([...ids.map((d, k) => askDict(d, {type: 'matchall', query: text}).then(r => {
			const row = glossRow(d);
			return r.matches
				.filter(([a]) => !/\s/.test(text[a])) // A word doesn't start with the space before it (a second index word can)
				.map(([a, len, m, ix, sec]) => ({a, len, m, ix, sec, d, rank: k, row}));
		})), rangeMatches(ids, text)]).then(all => pickPieces(all.flat(), text, done));
	}
	// The Bible ranges in a text ("rom 1.4-20", "Romans 8:28-30"): a word
	// each (first: before its parts), its gloss the start of its verses, in a
	// Bible text that glosses; tapped, the popup has
	// them all (popupRange)
	const RANGES = /(^|[^\p{L}\p{N}])((?:\d ?)?\p{L}[\p{L}\p{M}]*\.? ?\d+(?:[.:]\d+)? ?[-–] ?(?:\d+[.:])?\d+)(?!\p{N})/gu;
	function rangeMatches(ids, text){
		const d = ids.find(isBibleText);
		const found = d === undefined ? [] : [...text.matchAll(RANGES)].map(m => ({a: m.index + m[1].length, s: m[2], r: rangeOf(m[2])})).filter(x => x.r);
		if (!found.length) return [];
		return Promise.all(found.map(x => rangeLines(d, x.r).then(p => p && askDict(d, lineMsg(p.at, Math.min(20, p.last - p.at + 1))).then(res => ({
			a: x.a, len: x.s.length, d, rank: -1, sec: 0, row: glossRow(d),
			r: {header: x.s, body: res.entries.filter(Boolean).map(e => e.body.replace(/<p-n>[\s\S]*?<\/p-n>/, '')).join(' '), d, sec: 0}, // (rendered already)
		}))))).then(xs => xs.filter(Boolean));
	}


	// The best way to split text[a, b) into matches: the fewest characters
	// none of them has (letters and digits: spaces and punctuation don't
	// count), then the fewest pieces, then the fewest second index words
	// (headwords come first), then the first dictionaries'. So a long match
	// that leaves a piece no dictionary has loses to shorter ones that cover
	// it all, and a second index word ("@ພຣະເຈົ້າ", an old spelling) wins
	// over headwords that split it (ພຣະ + ເຈົ້າ). Returns [{a, b, w (the
	// match, none for unmatched)}].
	function splitText(matches, text, a, b){
		const at = new Map();
		matches.forEach(x => push(at, x.a, x));
		const n = b - a;
		const cost = new Array(n + 1), pick = new Array(n + 1).fill(null);
		cost[n] = [0, 0, 0, 0];
		const less = (x, y) => x.reduce((r, v, i) => r || v - y[i], 0);
		for (let i = n - 1; i >= 0; --i) {
			const c = cost[i + 1];
			cost[i] = [c[0] + (/[\p{L}\p{M}\p{N}]/u.test(text[a + i]) ? 1 : 0), c[1] + (pick[i + 1] ? 1 : 0), c[2], c[3]]; // Unmatched, joined to unmatched text after it
			for (const x of at.get(a + i) || []) {
				if (i + x.len > n) continue;
				const e = cost[i + x.len];
				const t = [e[0], e[1] + 1, e[2] + x.sec, e[3] + x.rank];
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

	// Each word's rows: in each, of the row's dictionaries, the best entry
	// for exactly it (the first dictionary's: glossIds' order; its headword
	// over a second index word), or else its parts', if they make it up
	function pickPieces(matches, text, done){
		const best = (xs, p) => xs.filter(x => x.a === p.a && x.len === p.b - p.a).sort((x, y) => x.rank - y.rank || x.sec - y.sec)[0];
		const word = x => text.slice(x.a, x.a + x.len);
		const rows = GLOSS_ROWS.map(r => matches.filter(x => x.row === r));
		const pieces = splitText(matches, text, 0, text.length);
		const byDict = new Map(); // The matches each dictionary renders
		pieces.forEach(p => {
			p.rows = rows.map(xs => {
				if (!p.w) return [];
				const x = best(xs, p);
				const parts = x ? [] : splitText(xs.filter(y => y.a >= p.a && y.a + y.len <= p.b), text, p.a, p.b);
				return x ? [x] : parts.every(q => q.w) ? parts.map(q => q.w) : [];
			});
			p.rows.flat().forEach(x => x.r || push(byDict, x.d, x)); // (a range's is rendered)
		});
		Promise.all([...byDict].map(([d, xs]) => askDict(d, {type: 'renderlines', lines: xs.map(x => [x.m, x.ix])}).then(r => {
			xs.forEach((x, i) => { if (r.entries[i]) x.r = {...r.entries[i], d, sec: x.sec}; });
		}))).then(() => done(pieces.map(p => {
			const xs = p.rows.map(r => r.filter(x => x.r && (x.g = glossOf(x.r, word(x))))); // (a media file with no details has no text)
			return {
				text: text.slice(p.a, p.b),
				d: p.w?.d,
				rows: xs.map(r => r.map(x => x.g).join(' ')),
				ds: [...new Set(xs.flat().map(x => x.d))], // (the dictionaries in its rows)
			};
		})));
	}

	// Each word in a box, with its rows under it, each an entry in a line
	// (a second index match is a word in an entry, so the entry's headword
	// says what it means, unless it's in the same script: then the word is
	// the entry's other spelling); tapping the word shows what the popup
	// search finds for it
	const script = t => (t.match(/\p{L}/u)?.[0] ?? ' ').codePointAt(0) >> 7; // (its Unicode block, roughly)
	const glossOf = (entry, word) => entry.sec && script(entry.header) !== script(word) ? entry.header : summary(entry.body, entry.header);
	function translationHTML(pieces){
		return pieces.map(p => {
			if (p.d === undefined) // Text no dictionary has: its words dashed, the rest as is
				return p.text.split(/(\s+)/).map(t => /\p{L}/u.test(t) ? `<span class="tr-w tr-x">${escapeHTML(t)}</span>` : escapeHTML(t).replace(/\n/g, '<br>')).join('');
			const w = escapeHTML(p.text.trim());
			return `<span class="tr-w${p.ds.length ? '' : ' tr-u'}" data-w="${w}" title="${names(p.ds.length ? p.ds : [p.d])}"><p-a>${w}</p-a>` +
				p.rows.map((t, i) => t ? `<span class="tr-r tr-r${i + 1}" title="${escapeHTML(t)}">${escapeHTML(t)}</span>` : '').join('') + '</span>';
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
			askDict(d, {type: 'media', words}).then(r => r.files.forEach((f, k) => {
				if (!f || !f[1]) return;
				if (!box.dataset.ds.split(',').includes(String(d))) box.dataset.ds += `,${d}`;
				const ws = box.querySelectorAll(`.tr-w[data-w="${CSS.escape(words[k])}"]`);
				if (!AUDIO.test(f[0])) return ws.forEach(w => { if (!w.querySelector('.tr-img')) w.appendChild(mediaElement(f[0], f[1], words[k])).classList.add('tr-img'); });
				const src = audioSrc(f[0], f[1]); // (one for every box with the word)
				ws.forEach(w => {
					if (w.querySelector('.tr-play')) return;
					w.insertAdjacentHTML('beforeend', '<button class="tr-play" onclick="playWord(this)" title="Play" aria-label="Play">🔊<audio></audio></button>');
					const a = w.lastChild.lastChild;
					src.then(u => { a.src = u; });
				});
			})));
	}
	window.playWord = b => {
		const a = b.lastChild;
		a.currentTime = 0;
		a.play().catch(e => { b.firstChild.data = '⚠'; b.title = `Can't play it here: ${e.message}`; });
	};
	// A recording's URL, ready before it's played: phones play sound only
	// right in the tap, not after something else finishes (like decoding)
	const audioSrc = async (type, bytes) => URL.createObjectURL(/codec2|c2/i.test(type) ? await media().then(m => m.codec2toWav(bytes)) : new Blob([bytes], {type: audioType(type)}));
	const audioType = t => /webm/i.test(t) ? 'audio/webm; codecs=opus' : 'audio/' + t.toLowerCase();

	// The gloss of an entry's (or verse's) text, or some of it: above the
	// text (after the entry's name and buttons), so a long one doesn't push
	// it out of view
	function glossInto(pe, text, ids){
		if (!ids.length) return;
		pe.querySelector(':scope > .tr-entry')?.remove();
		const box = document.createElement('div');
		box.className = 'tr-entry';
		const text1 = [...pe.childNodes].find(n => n.nodeType === 1 ? !n.matches('p-h, button, .menu') : n.textContent.trim());
		pe.insertBefore(box, text1 || null);
		box.scrollIntoView({block: 'nearest'});
		box.textContent = `Glossing with ${ids.map(d => dicts[d].name).join(' + ')}…`;
		translateText(ids, updateQuery(text), pieces => {
			if (box.isConnected) fillGloss(box, pieces, ids, text, n => `<div class="tr-head">${n}</div>`);
		});
	}
	// A gloss (the search's, or an entry's) into box: head(the names of the
	// dictionaries in its words' rows), then its words. Its text and those
	// dictionaries are kept for sharing it (addMedia adds the media ones
	// with any of its words).
	function fillGloss(box, pieces, ids, text, head){
		const ds = [...new Set(pieces.flatMap(p => p.ds))];
		box.dataset.text = text;
		box.dataset.ds = ds.join();
		box.innerHTML = head(names(ds)) + (pieces.some(p => p.d !== undefined) ? translationHTML(pieces) : 'No words found.');
		addMedia(box, pieces, ids);
	}

	// ---------------------------------------------------------------
	// Sharing a card (a word's, a chapter's, a gloss; the context menu's
	// Share): its text copied, or a link to it that has just the
	// dictionaries in it (?dict=, see solo: they download without asking)
	// ---------------------------------------------------------------
	const visible = el => el.checkVisibility?.() ?? true; // (not a hidden dictionary's)
	const glossText = box => [...box.querySelectorAll('.tr-w')].map(w => [w.querySelector('p-a') || w, ...w.querySelectorAll('.tr-r')].map(x => x.textContent.trim()).join(' · ')).join('\n');
	function cardText(card){
		if (card.dataset.ds !== undefined) return `${card.dataset.text}\n\n${glossText(card)}`;
		const pes = [...card.querySelectorAll(':scope > p-e')].filter(visible);
		return card.matches('.chapter') ? pes.map(entryText).join('\n\n') :
			[headwordOf(card), ...pes.map(pe => `${dicts[pe.dataset.d].name}\n${entryText(pe)}`)].join('\n\n');
	}
	function cardLink(card){
		const gloss = card.dataset.ds !== undefined;
		const ds = gloss ? card.dataset.ds.split(',').filter(Boolean) : [...card.querySelectorAll('p-e[data-d], .pv-t[data-d], .vs-note[data-d]')].filter(visible).map(x => x.dataset.d);
		const p = new URLSearchParams({text: gloss ? card.dataset.text : card.matches('.chapter') ? query : headwordOf(card)});
		p.set('dict', [...new Set(ds)].map(d => dicts[d].name).join());
		return location.origin + location.pathname + '?' + p;
	}

	// Long text also gets a big text box above the results; it and the
	// search bar stay in sync.
	const BIG = 40;
	function fitBig(){
		bigQuery.style.height = 'auto';
		bigQuery.style.height = bigQuery.scrollHeight + 'px';
	}
	// (Shown from BIG characters, or a newline; hidden again below half that)
	function updateBig(){
		const len = queryText.length, typing = document.activeElement === bigQuery;
		const on = queryText.includes('\n') || len >= (bigQuery.classList.contains('hide') ? BIG : BIG / 2);
		bigQuery.classList.toggle('hide', !on);
		if (!on && typing) {
			queryInput.focus();
			queryInput.setSelectionRange(len, len);
		} else if (on && !typing) {
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
			hideRefresh();
			showSettings();
			return;
		}
		settings.style.display = 'none'; // (a translation doesn't clear it)
		historyTimer();
		if(chapterOf(readHl) !== query)
			readHl = '';
		if(query == prevquery){
			return;
		}
		hideRefresh(); // (this search has every dictionary that's loaded)
		closeCtx();
		translationDiv.replaceChildren();
		window.scrollTo(0, 0);
		updateStatus('No matches found.', 'None found');
		queryInput.classList.add("error");
		const range = hasBible && rangeOf(query);
		if (range) rangeSearch(range, runSearch);
		else runSearch();
	}
	function runSearch(){
		worker_code.fill(false);
		st = globreg.test(query) ? 0 : 3;
		searching = searchMask(); // (the workers skip the ones not loaded)
		newLoader();
		searchStage(true);
	}
	function newLoader(){
		loader = document.createElement('p-d');
		loader.id = 'loader';
		loader.textContent = "Loading more…";
		return loader;
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
		const a = queryInput.selectionStart, t = queryText.slice(0, a) + text.replace(/\r\n?/g, '\n');
		setQueryText(t + queryText.slice(queryInput.selectionEnd));
		queryInput.setSelectionRange(t.length, t.length);
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
	document.body.classList.toggle('dark-mode', stored('darkMode') === true);
	mark = stored('mark') !== false;
	// A setting changed (Library and settings, the context menu's Appearance)
	function setPref(p){
		if (p === 'smaller' || p === 'bigger') setFont(fontSize + (p === 'bigger' ? 2 : -2));
		else if (p === 'dark') store('darkMode', document.body.classList.toggle('dark-mode'));
		else if (p === 'mark') store('mark', mark = !mark);
	}

	// Library and settings: a drawer
	function openLibrary(){
		if (drawerView !== 'library') openDrawer('library');
		refreshUsage();
	}
	$('settingsBtn').addEventListener('click', () => { setMenu(false); openLibrary(); });

	// ---------------------------------------------------------------
	// The context menu, docked at the bottom of the screen: for a tap on
	// an entry's text (or a verse's, a gloss's), or for selected text. Its
	// icons: Gloss (the entry, or what's selected in it, word by word;
	// glossed, or a gloss itself: Hide gloss), Search and Popup (what's
	// selected), Compare (a Bible verse tapped: the popup has it in every
	// translation the gloss has), Bookmark (the word, the verse, what's
	// selected), Appearance (text size, dark mode), Speak (a menu
	// of the page's languages there are voices for: speaking English text in
	// a Khmer voice is fun) and Share (a menu: copy it, or a link to it; a
	// verse's, or all of its card's). A tap anywhere else (or on the entry
	// again), or Escape, closes it; one for a selection goes when it does.
	// ---------------------------------------------------------------
	const ctxMenu = $('ctxMenu');
	const svg = d => `<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="${d}"/></svg>`;
	const ICONS = {
		gloss: svg('M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4'),
		search: svg('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21'),
		popup: popupSVG,
		speak: svg('M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
		share: svg('M12 15V3M7 8l5-5 5 5M5 12v8h14v-8'),
		copy: svg('M9 9h11v11H9zM5 15H4V4h11v1'),
		link: svg('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'),
		back: svg('M15 18l-6-6 6-6'),
		hide: svg('M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a14 14 0 0 1-3 4.2M6.5 6.6A14 14 0 0 0 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 5.3-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'),
		bookmark: bookmarkSVG.replace('width="18" height="18"', 'width="22" height="22"'),
		compare: compareSVG.replace('width="18" height="18"', 'width="22" height="22"'),
		look: svg('M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5zM7.5 12.5v.01M10 8v.01M14.5 8v.01M17 11.5v.01'),
		smaller: '<span class="ctx-glyph" aria-hidden="true">A−</span>',
		bigger: '<span class="ctx-glyph" aria-hidden="true">A+</span>',
		dark: svg('M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'),
	};
	const ctxBtn = (act, label, attrs = '', ic = ICONS[act]) => `<button data-c="${act}" ${attrs}>${ic || ''}<span>${escapeHTML(label)}</span></button>`;
	// The page's languages there are voices for (speechSynthesis), with their flags
	const voiceLangs = () => {
		const voices = window.speechSynthesis?.getVoices() || [];
		return lang.filter(x => voices.some(v => v.lang.toLowerCase().replace('-', '_').startsWith(x.val.split('_')[0].toLowerCase())));
	};
	window.speechSynthesis?.addEventListener('voiceschanged', () => ctx && !ctx.sub && renderCtx()); // (they load later)
	let ctx = null; // {el (the entry, verse or gloss), sel (the text selected), sub (a menu in it: speak, share)}
	let ctxTimer = 0;
	function openCtx(c){
		closeCtx();
		ctx = c;
		if (!c.sel) c.el.classList.add('ctx-on');
		renderCtx();
		ctxMenu.hidden = false;
		document.body.classList.add('ctx-open'); // (hides the round buttons it would cover)
	}
	function closeCtx(){
		clearTimeout(ctxTimer);
		ctx?.el?.classList.remove('ctx-on');
		ctx = null;
		ctxMenu.hidden = true;
		document.body.classList.remove('ctx-open');
	}
	// Its text: what's selected, a gloss's text, or the entry's
	const ctxText = () => ctx.sel || ctx.el.dataset.text || entryText(ctx.el);
	const isGloss = el => el.matches('.tr-entry, p-d.translation');
	// A verse's reference ("joh 3.16")
	const verseOf = vs => vs.dataset.h;
	// A Bible verse's reference, to Compare it (the popup: every Bible text the gloss has)
	const compareOf = () => !ctx.sel && (ctx.el.matches('.vs') ? verseOf(ctx.el) : ctx.el.closest('p-d.verse[data-q]')?.dataset.q);
	// What Bookmark is for: what's selected, a verse, or a word's card (not a gloss, or a chapter)
	const bmTarget = () => ctx.sel || (ctx.el.matches('.vs') ? verseOf(ctx.el) : !isGloss(ctx.el) && headwordOf(ctx.el.closest('p-d')));
	const linkTo = (text, ds = []) => location.origin + location.pathname + '?' + new URLSearchParams(ds.length ? {text, dict: ds.map(d => dicts[d].name).join()} : {text});
	// What Share has: [label, copy or link, its text or link]
	function shares(){
		const {el, sel} = ctx;
		if (sel) return [['Copy', 'copy', sel], ['Link', 'link', linkTo(sel)]];
		const card = el.closest('.tr-entry, p-d'), all = [['Copy', 'copy', cardText(card)], ['Link', 'link', cardLink(card)]];
		const h = el.matches('.vs') && verseOf(el);
		if (!h) return all;
		const d = +el.closest('[data-d]').dataset.d, t = document.createElement('template');
		t.innerHTML = refLabel(verseRef(h));
		return [['Copy verse', 'copy', `${t.content.textContent} (${dicts[d].name})\n${entryText(el)}`], ['Verse link', 'link', linkTo(h, [d])],
			['Copy all', 'copy', all[0][2]], ['Link to all', 'link', all[1][2]]];
	}
	function renderCtx(){
		const {el, sel, sub} = ctx;
		let html;
		if (sub === 'speak') html = ctxBtn('back', 'Back') + voiceLangs().map(x => ctxBtn('say', x.name, `data-lang="${x.val}"`,
			abbr[x.name.toLowerCase()]?.[3] ? `<span class="ctx-flag" aria-hidden="true">${abbr[x.name.toLowerCase()][3]}</span>` : ICONS.speak)).join('');
		else if (sub === 'look') html = ctxBtn('back', 'Back') + ctxBtn('smaller', 'Smaller') + ctxBtn('bigger', 'Bigger') +
			ctxBtn('dark', document.body.classList.contains('dark-mode') ? 'Light mode' : 'Dark mode');
		else if (sub === 'share') html = ctxBtn('back', 'Back') + (ctx.shares ??= shares()).map(([label, kind], i) => ctxBtn(kind, label, `data-i="${i}"`)).join('');
		else {
			const gloss = el && !isGloss(el), glossed = gloss && !sel && el.querySelector(':scope > .tr-entry'), w = bmTarget();
			html = (el?.matches('.tr-entry') || glossed ? ctxBtn('hide', 'Hide gloss') : gloss ? ctxBtn('gloss', 'Gloss') : '') +
				(sel ? ctxBtn('search', 'Search') + ctxBtn('popup', 'Popup') : '') +
				(compareOf() ? ctxBtn('compare', 'Compare') : '') +
				(w ? ctxBtn('bookmark', isBookmarked(w) ? 'Bookmarked' : 'Bookmark', `aria-pressed="${isBookmarked(w)}"`) : '') +
				(voiceLangs().length ? ctxBtn('speak', 'Speak') : '') + ctxBtn('share', 'Share') + ctxBtn('look', 'Appearance');
		}
		ctxMenu.innerHTML = `<div class="ctx-row">${html}</div>`;
	}
	// Done (copied, ...): said for a moment, then it closes
	function ctxDone(msg){
		ctxMenu.innerHTML = `<div class="ctx-row ctx-said" role="status">${escapeHTML(msg)}</div>`;
		ctxTimer = setTimeout(closeCtx, 1200);
	}
	ctxMenu.addEventListener('click', async e => {
		e.stopPropagation(); // (a popup's entry: keeps the popup open)
		const b = e.target.closest('button');
		if (!b || !ctx) return;
		const {el, sel} = ctx, act = b.dataset.c;
		if (act === 'compare') compareOf.h = compareOf(); // (before it closes)
		if (act === 'speak' || act === 'share' || act === 'look') { ctx.sub = act; return renderCtx(); }
		if (act === 'smaller' || act === 'bigger' || act === 'dark') { // (it stays open: tap again for more)
			setPref(act);
			if (drawerView === 'library') renderDrawer();
			return renderCtx();
		}
		if (act === 'back') { ctx.sub = null; return renderCtx(); }
		if (act === 'bookmark') { // (it stays open: tap again to undo)
			toggleBookmark(bmTarget(), sel ? null : el.closest('.vs, p-d.verse > p-e') || el.closest('p-d')?.querySelector(':scope > p-e'));
			return renderCtx();
		}
		if (act === 'say') {
			speechSynthesis.cancel();
			const u = new SpeechSynthesisUtterance(ctxText());
			u.lang = b.dataset.lang;
			speechSynthesis.speak(u);
			return;
		}
		if (act === 'copy' || act === 'link') {
			const v = ctx.shares[+b.dataset.i][2];
			try {
				if (act === 'link' && navigator.share) { await navigator.share({title: document.title, url: v}); return closeCtx(); }
				await navigator.clipboard.writeText(v);
				ctxDone(act === 'link' ? 'Link copied' : 'Copied');
			} catch (err) {
				if (err.name !== 'AbortError') window.prompt(act === 'link' ? 'Copy this link:' : 'Copy this:', v);
				closeCtx();
			}
			return;
		}
		closeCtx();
		getSelection().removeAllRanges();
		if (act === 'hide' && el?.isConnected) (el.matches('.tr-entry') ? el : el.querySelector(':scope > .tr-entry'))?.remove();
		else if (act === 'gloss' && el?.isConnected) glossInto(el, sel || entryText(el), glossIds());
		else if (act === 'search') {
			setQueryText(sel);
			startSearch();
		} else if (act === 'popup') openPopupSearch(sel);
		else if (act === 'compare') openPopupSearch(compareOf.h);
	});
	document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctx) closeCtx(); });
	// A tap on an entry's text (not on a word that looks itself up, a
	// button, a link, ...): its menu; anywhere else, closed
	document.addEventListener('click', e => {
		if (getSelection().toString().trim()) return; // (the selection's)
		const t = e.target;
		const el = !t.closest('a, button, input, textarea, select, audio, video, [role="button"], p-a, p-w, .tr-w, .menu, .card-bar') &&
			t.closest('#results, #popupResults, #translation') && t.closest('.tr-entry, p-d.translation, .vs, p-e');
		if (el && el !== ctx?.el) openCtx({el});
		else if (ctx) closeCtx();
	});
	// Selected text: its menu, once the selection settles (iOS needs the
	// delay); gone when it is
	const handleSelEnd = debounce(() => {
		const sel = getSelection(), text = sel.toString().trim();
		if (!text || !sel.rangeCount || sel.isCollapsed) return ctx?.sel && closeCtx();
		if (ctx?.sel === text) return;
		const at = sel.getRangeAt(0).commonAncestorContainer;
		const from = (at.nodeType === 1 ? at : at.parentElement);
		const el = from?.closest('.tr-entry') || from?.closest('.vs, p-e'); // (a gloss's own words: it, to hide)
		openCtx({sel: text, el});
	}, 120);
	document.addEventListener('selectionchange', handleSelEnd, {passive: true});

	// Install app: the browser's prompt, or on iOS (which has none) how to
	const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // (iPadOS says it's a Mac)
	const installBtn = $('install-button');
	let installPrompt = null;
	const showInstall = on => { installBtn.style.display = on ? 'flex' : 'none'; };
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
	// <p-w s="G976">word</p-w>: a word with its Strong's number, tap for
	// its entry. In a translation, a tap anywhere on a word's box (but its
	// 🔊) is a tap on its p-a.
	document.addEventListener('click', e => {
		const w = e.target.closest('p-a, p-w, .tr-w'), a = w?.matches('.tr-w') ? w.querySelector('p-a') : w;
		if (a && !e.target.closest('.tr-play')) openPopupSearch(a.getAttribute('s') || a.textContent);
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
