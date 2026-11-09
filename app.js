"use strict";

// A file the service worker has (its 'status'): set on a dictionary page,
// once its dictionaries are known
let ack = null;
// An icon: 24 × 24 paths (d, or [d, attributes]), drawn with currentColor (CSS)
const icon = (...ps) => `<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">${ps.map(p => Array.isArray(p) ? `<path d="${p[0]}" ${p[1]}/>` : `<path d="${p}"/>`).join('')}</svg>`;
// The context menu's Popup (a book in a popup's two squares)
const popupSVG = icon('M8 7V3.5A1.5 1.5 0 0 1 9.5 2h11A1.5 1.5 0 0 1 22 3.5v11a1.5 1.5 0 0 1-1.5 1.5H17M3.5 7.5h11.5a1.5 1.5 0 0 1 1.5 1.5v11.5a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 20.5V9a1.5 1.5 0 0 1 1.5-1.5z',
	['M9.25 13.2c-1.2-.8-2.7-1.1-4.5-1.1v6.4c1.8 0 3.3.3 4.5 1.1 1.2-.8 2.7-1.1 4.5-1.1v-6.4c-1.8 0-3.3.3-4.5 1.1zM9.25 13.2v6.4', 'stroke-width="1.6"']);
const bareName = n => n.replace(/^[^-]*-/, ''); // A dictionary's name without its language's code (km-h97: h97)
// Remembered things (null if there's nothing, or no storage)
const stored = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not remembered */ } };
// x onto map's list for key
const push = (map, key, x) => (map.get(key) || map.set(key, []).get(key)).push(x);
const readList = k => { const l = stored(k); return Array.isArray(l) ? l : []; };
// A button's name: its tooltip and what a screen reader says
const named = (b, t) => { b.title = t; b.setAttribute('aria-label', t); return b; };
// on: the same for each of them, or one for each (a function)
const each = (on, d) => typeof on === 'function' ? on(d) : on;
// Chords (<p-m chord="...">) are hidden by default (CSS). The button toggles
// one class on <body>, remembered; CSS shows them and switches every
// button's label (see .chords-btn).
const chordsBtnHTML = '<button class="chords-btn" onclick="toggleChords()" title="Show or hide chords"></button>';
window.toggleChords = () => store('showChords', document.body.classList.toggle('show-chords'));
document.body.classList.toggle('show-chords', stored('showChords') === true);
// Some dictionaries' entries start hidden (files.json's 7th field,
// #collapsed in the source: Bible notes, ...): a word's card with any has
// See more at the bottom, to show them there. Done with a generated CSS rule.
const hideStyle = document.head.appendChild(document.createElement('style'));
const applyHidden = names => {
	const sel = names.map(n => `p-e[data-dict="${CSS.escape(n)}"]`).join(',');
	hideStyle.textContent = sel ? `p-d:not(.show-hidden,.chapter) :is(${sel}){display:none}p-d:not(.show-hidden,.chapter):has(:is(${sel}))>.see-more{display:block}` : ''; // (a recording's is in .sounds)
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
// A dictionary's languages, when its type (#lang) is theirs, by their
// abbreviations: "zh,km" Chinese to Khmer, "th,en,zh" Thai to English and
// Chinese, "zh" just Chinese (the headword's first); else null (mono, bi, ...).
// "km,aligned": aligned with the other aligned ones in its category, their
// headwords the same keys (Wiktionary's English senses, "god (deity)"), so
// any two are a dictionary between them
const langByAbbr = Object.fromEntries(Object.entries(abbr).filter(([, a]) => a[2]).map(([l, a]) => [a[0], l]));
const isAligned = x => x.type.split(',').includes('aligned');
const typeLangs = ({type}, ls = type.split(',').filter(a => a !== 'aligned')) => type && ls.every(a => langByAbbr[a]) ? ls.map(a => langByAbbr[a]) : null;
const cap = t => t && t.replace(/(^|-)(.)/g, (_, h, c) => (h && ' ') + c.toUpperCase()); // (ancient-greek: Ancient Greek)
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
	document.querySelectorAll('[data-drawer]').forEach(b => b.setAttribute('aria-expanded', false));
}
drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
drawer.querySelector('.drawer-bg').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerView) closeDrawer(); });

if(!isDictPage){
	// The root page: the app with nothing but the language button (typing
	// opens it too, and the text goes along), and what Peak Slab is (the
	// About drawer elsewhere)
	['menuBtn', 'headMenu', 'quick', 'controls'].forEach(id => $(id).classList.add('hide'));
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
	let loader = null;
	// A search's stages, as peak.c's searchtype: the exact words (headwords,
	// then second index words: "ran", run's form), then the words that start
	// with it, then anywhere in the text; with search symbols, just the last
	const STAGES = [1, 2, 3, 4, 5, 0];
	let st = 1;
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
			case 'loadfailed': // (what waits for it goes on without it: no words from it)
			case 'loaded':
				if (m.type === 'loaded') loaded.add(d);
				if (loading.delete(d)) loadDone += dicts[d].size || 1;
				showLoad();
				if(loaded.has(d) && !libOn[d] && !asked.has(d)) // Turned off while it loaded
					unloadDict(d);
				(pendingLoad.get(d) || []).forEach(f => f());
				pendingLoad.delete(d);
				if (!loaded.has(d)) break;
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
			translationDiv.replaceChildren(); // (a gloss is for no results: an earlier search's, before every dictionary had loaded)
			if(loader)
				resultsDiv.append(loader)
		}
		let idpre = popup ? "pid" : "mid";
		const nheader = updateQuery(data.header);
		let div = $(`${idpre}-${nheader}`);
		const d = dictOf(data);
		// An entry found twice (by two of the searches) shows once (and more
		// come); a verse's card has it in all its translations, and its notes (fillCard)
		if (div && (div.dataset.bk && (isBibleText(d) || isNote(d)) || typeof data.body === 'string' && div.seen.has(d + '\t' + data.body))) return popup || scrollCheck();
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
				mask[d] = false;
				forWorkers(mask, (w, code) => w.postMessage({type: "tempsearch", st: 1, query: nheader, dest: data.dest, dicts: code, gen: searchGen}));
			}
		}
		div.seen.add(d + '\t' + data.body);
		if(first){
			div.innerHTML = headHTML(data.header) +
				'<button class="text-btn see-more" data-id="1e9" onclick="this.parentNode.classList.add(\'show-hidden\')">See more</button>'; // (entries go above it)
		}
		if (isBibleText(d)) { // A verse: a Bible card, for its reference
			if (popup) div.dataset.pop = 1;
			div.classList.add('chapter');
			addCardBar(div, verseRef(nheader), nheader);
			fillCard(div);
		} else {
			// A media file's: its details and the file; text: the chords'
			// show/hide button if it has any, and the text
			const t = document.createElement('template');
			t.innerHTML = entryHTML(d, data.filetype ? (data.subheader ? `<p-n>${data.subheader.join(",<br>")}<br></p-n>` : '') :
				(data.body?.includes('<p-m') ? chordsBtnHTML : '') + highlightText(data.body, data.query));
			const el = t.content.firstChild;
			if(data.filetype) {
				el.append(mediaElement(data.filetype, data.body, data.header, d, data.subheader.join()));
				if (AUDIO.test(data.filetype) && data.subheader?.join()) el.querySelector('p-h .dn')?.append(` ${data.subheader.join()}`); // (a speaker's number, a dictionary with several)
			}
			// (recordings: their 🔊s together on the card's first line, their dictionaries under them)
			if (AUDIO.test(data.filetype)) {
				const box = div.querySelector(':scope > .sounds') ?? Object.assign(div.querySelector(':scope > h2').insertAdjacentElement('afterend', document.createElement('div')), {className: 'sounds'});
				insertSorted(box, el, sortId(d));
				if (TNEFAR.test(data.filetype) && !box.querySelector('.speed')) box.append(speedButton());
			} else insertSorted(div, el, sortId(d));
		}

		if(first){
			(popup ? popupResults : resultsDiv).insertBefore(div, popup ? null : loader);
			if (popup) popupOpen();
		}
		if(popup) popupScroll();
		else found();
	}
	// Not to move: on the screen or above it (and showing), once the
	// search's first results are in (its first 300 ms: in order)
	const fixed = el => performance.now() - searchAt > 300 && el?.getClientRects().length > 0 && el.getBoundingClientRect().top < innerHeight;
	// el into parent before the first child with a bigger data-id (or data-[key])
	const insertSorted = (parent, el, n, key = 'id') => parent.insertBefore(el, [...parent.children].find(c => +c.dataset[key] > n) || null);
	// An entry of dictionary d (starred: they come first, and stand out),
	// its name first, then html
	const entryHTML = (d, html = '') => `<p-e data-id="${sortId(d)}" data-dict="${escapeHTML(dicts[d].name)}" data-d="${d}"${isAligned(dicts[d]) ? ' data-aligned' : ''}${isStar(d) ? ' class="starred"' : ''}>${entryHeadHTML(d)}${html}</p-e>`;
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
	// A dictionary's: turn it off, star (or unstar) it
	// (words by sense: its senses only with another language's for them, or all)
	window.dictMenu = h => {
		const d = +h.parentNode.dataset.d, name = dicts[d].name, pairs = document.body.classList.contains('wikt-pairs');
		popMenu(h, `<button data-a="off">Turn off ${escapeHTML(name)}</button>` +
			`<button data-a="star">${isStar(d) ? '☆ Unstar' : '★ Star: show it first'}</button>` +
			(isAligned(dicts[d]) ? `<button data-a="pairs">${pairs ? 'Every sense' : 'Only senses another language has too'}</button>` : ''),
			a => a === 'off' ? turnOff(d) : a === 'star' ? toggleStar(d) : setWiktPairs(!pairs));
	};
	// Off from its name: glosses and the popup too (they use it if it's ticked for them and downloaded)
	function turnOff(d){
		delete glossSet[dicts[d].path];
		if (!solo.length) store(glossKey, glossSet);
		setOn([d], false);
	}
	// Aligned ones only with another language's for the same key (style.css
	// hides the rest: a card's lone one, and a card of nothing
	// else): with two or more of them searched in a category, unless its menu said
	// otherwise (remembered while it's not what they'd have)
	const wiktAuto = () => (cs => cs.length > new Set(cs).size)(dicts.filter((x, d) => isAligned(x) && searched(d)).map(catId)); // (two in a category)
	const applyWiktPairs = () => document.body.classList.toggle('wikt-pairs', stored('wiktPairs') ?? wiktAuto());
	const setWiktPairs = on => { store('wiktPairs', on === wiktAuto() ? null : on); applyWiktPairs(); };
	// One more result: the count, and maybe more of them
	function found(){
		++num;
		queryInput.classList.remove("error");
		updateStatus(num, 'results loaded');
		scrollCheck(); // (the end of the results looked at once a frame, not after each one: each look is a layout)
	}

	// A media entry: a 🔊 for a recording, else a picture (jbig2 decoded)
	function mediaElement(type, bytes, name, d, details){
		if (AUDIO.test(type)) return soundButton([[type, bytes, details]], d);
		const el = document.createElement('img');
		el.alt = name;
		el.onerror = () => el.remove(); // (a file that isn't a picture: nothing)
		el.style.maxWidth = '100%';
		(/jbig2/i.test(type) ? jbig2toPng(bytes) : Promise.resolve(new Blob([bytes], {type: 'image/' + type.toLowerCase()})))
			.then(b => { el.src = URL.createObjectURL(b); });
		return el;
	}

	// A Bible card's verses (fillCard): each translation's run together,
	// numbered as its references have them ("យ៉ូហាន ៣:១៦"); in parallel
	// (more than one), verse by verse. Bible notes are little links on its
	// verses (addNote).
	// A verse's (or a note's) reference as the dictionary has it, its first
	// column ("យ៉ូហាន ៣:១៦"), and its text, the rest
	const refOf = body => body.slice(0, body.indexOf('\t')), textOf = body => body.slice(body.indexOf('\t') + 1);
	const verseNum = h => (([c, cv]) => c * 1000 + cv)(h.split(' ').pop().split('.').map(Number)); // (by chapter, then verse)
	// (its chapters' first verses say their chapter: "2:1")
	function addVerse(data, h, d, card){
		const v = verseNum(h), par = card.matches('.parallel');
		const [cv, , n] = /(\p{Nd}+)[:.](\p{Nd}+)$/u.exec(refOf(data.body)), full = v % 1000 === 1 || !card.querySelector('.vs');
		const body = highlightText(textOf(data.body).replace(/<\/?p(?=[\s>])[^>]*>/gi, ' '), card.parentNode === resultsDiv && !card.dataset.hl && query); // (verses run on; the search's words marked)
		// Its headings go above its number, which stays on the line with its
		// first letter (CSS)
		const heads = (/^\s*(?:<h\d[^>]*>[\s\S]*?<\/h\d>\s*)+/i.exec(body) || [''])[0];
		let rest = body.slice(heads.length).trimStart();
		const para = /^((?:<[^>]+>\s*)*)¶\s*/.exec(rest); // A paragraph starts with it: no ¶, a new line (CSS)
		if(para)
			rest = para[1] + rest.slice(para[0].length);
		// (a verse that starts with a quote, a poem's line: its number at
		// the start of the line, not on one of its own above it)
		const lead = /^(?:<p-q\d*>\s*)?/.exec(rest)[0];
		const t = document.createElement('template');
		// In parallel, in the verse's group, by verse, each text as the
		// dictionaries go: like an entry, with its name and Gloss
		t.innerHTML = (par ? `<div class="pv-t" data-id="${sortId(d)}" data-d="${d}">${entryHeadHTML(d)}` : '') +
			`<span class="vs${para ? ' para' : ''}" data-v="${v}" data-h="${escapeHTML(h)}">${heads}${lead}<span class="vs-n">${full ? cv : n}</span>${rest.slice(lead.length)}` +
			(par ? '</span></div>' : ' </span>');
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
		noteLinks(vs);
		wordSpans(vs, d);
		if (h === card.dataset.hl) vs.classList.add('ctx'); // (the verse it's for)
		if (card.parentNode === resultsDiv) found();
	}

	// A card's notes, by verse (card._notes: [{d, e}, ...]); a link on the
	// verse (one for each, on one of a parallel verse's texts) shows it in
	// the popup
	function addNote(card, d, e){
		const v = verseNum(e.header);
		push(card._notes, v, {d, e});
		card.querySelectorAll(`.vs[data-v="${v}"]`).forEach(noteLinks);
	}
	// Each set of notes has its own footnote mark on a verse (k: the Khmer
	// Study Bible's), so two on one verse can be told apart: the one picked
	// here, else the first letter of its name (after its language's code) no other notes have
	const NOTE_MARKS = {'km-khovstudy': 'k', 'km-tn': 't', 'en-tn': 'n', 'en-bc': 'c', 'lo-biblecommentary': 'l'}, noteMarks = {};
	function noteMark(d){
		const name = dicts[d].name;
		if (!noteMarks[name]){
			const used = new Set([...Object.values(noteMarks), ...Object.values(NOTE_MARKS)]);
			noteMarks[name] = NOTE_MARKS[name] || [...bareName(name).toLowerCase().replace(/[^a-z]/g, '')].find(c => !used.has(c)) || '*';
		}
		return noteMarks[name];
	}
	function noteLinks(vs){
		const v = +vs.dataset.v, group = vs.closest('.pv'), ns = vs.closest('p-d')._notes?.get(v);
		if (!ns || (group && group.querySelector('.vs-note') && !vs.querySelector('.vs-note'))) return;
		ns.forEach(({d, e}) => {
			if (vs.querySelector(`.vs-note[data-d="${d}"]`)) return;
			const label = refOf(e.body);
			vs.insertAdjacentHTML('beforeend', `<button class="vs-note" data-d="${d}" data-v="${v}" onclick="showNote(this)" title="${escapeHTML(dicts[d].name + (label ? ': ' + label : ''))}" aria-label="Note on this verse (${escapeHTML(dicts[d].name)})">${noteMark(d)}</button>`);
		});
	}
	window.showNote = b => {
		const n = b.closest('p-d')._notes.get(+b.dataset.v).find(n => n.d === +b.dataset.d);
		popupGo(() => {
			cleanup(popupResults);
			popupQuery = n.e.header;
			popupResults.innerHTML = `<p-d class="show-hidden">${headHTML(escapeHTML(refOf(n.e.body)))}${entryHTML(n.d, textOf(n.e.body))}</p-d>`; // (shown: a note's dictionary's entries start hidden)
			popupOpen();
		});
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
	// are both "bible/text"). It's on the page if it's the page's language's
	// and in every one of the page's folders (/khmer/bible: khmer/bible/text/x;
	// not khmer/chinese/x on /chinese) ("primary"), or it's another language's with
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
			primary: pParts.every((p, i) => i ? folders.includes(p) : p === lang),
			media: path.includes('.slab'),
			on: [undefined, 1, 0].includes(priority)}; // On by default: priority 1 and 0 (and see ownLevel)
	});
	const primaryCats = new Set(allDicts.filter(x => x.primary).map(x => x.cat));
	// Its folder here: its category's; another language's dictionaries for
	// this one, a dictionary (khmer/dict/chinese/x on /chinese: dict)
	allDicts.forEach(x => { x.folder = x.primary || !x.cat.split('/').some(f => abbr[f]?.[2]) ? x.cat : 'dict'; });
	// Other languages' dictionaries added in the library (their paths)
	const addKey = `peakslab-added-${pagePath}`, addedPaths = new Set(readList(addKey));
	allDicts.forEach(x => { x.added = !x.primary && addedPaths.has(x.path); });
	// (and another language's for this one with priority <= 0: khmer/dict/chinese/x on /chinese)
	const dicts = allDicts.filter(x => x.primary || x.added || (x.priority <= 0 && (primaryCats.has(x.cat) || x.cat.split('/').includes(curLang))));
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
	dicts.forEach(x => { if (x.primary && rank(x.priority) <= 1) mainCount[x.folder] = (mainCount[x.folder] || 0) + 1; });
	dicts.sort((a, b) =>
		(mainCount[b.folder] || 0) - (mainCount[a.folder] || 0) || a.folder.localeCompare(b.folder) || b.primary - a.primary ||
		rank(a.priority) - rank(b.priority) || a.lang.localeCompare(b.lang) || a.path.localeCompare(b.path));

	// Speech synthesis (the selection menu's 🔊): the page's languages, with
	// their locale codes, or English
	const derivedLang = [...new Set([...pLangParts, ...dicts.flatMap(x => [x.lang, ...typeLangs(x) || []])])]
		.filter(l => abbr[l]?.[2]).map(l => ({name: cap(l), val: abbr[l][2]}));
	const lang = derivedLang.length ? derivedLang : [{name: 'English', val: 'en_US'}];

	// The app's name: the path's symbols (khmer → ខ, khmer/music → ខ𝄞)
	const appname = (pParts.length ? pParts : ['?']).map(p => abbr[p]?.[1] || abbr[p]?.[0] || p).join('');
	const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
	if (appTitle) appTitle.content += appname;
	document.title += appname;

	const byPaths = paths => paths.map(p => dicts.findIndex(x => x.path === p)).filter(d => d >= 0);

	const sizeText = n => n < 1e6 ? `${n && Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
	applyHidden(dicts.filter(x => x.collapsed).map(x => x.name));

	// (its colour: one language's, mono; from English, rbi; else bi)
	const typeOf = x => { const ls = typeLangs(x), kind = ls ? ls.length < 2 ? 'mono' : ls[0] === 'english' ? 'rbi' : 'bi' : x.type;
		return x.type ? `<span class="lib-type type-${kind}">${escapeHTML(typeLabel(x))}</span>` : ''; };
	const typeLabel = ({type, lang}) => {
		const l = cap(lang), ls = typeLangs({type});
		if (ls) return cap(ls[0]) + (ls.length > 1 ? ' → ' + ls.slice(1).map(cap).join(', ') : '');
		return {mono: l, bi: `${l} → English`, rbi: `English → ${l}`, phon: 'Pronunciation', aux: 'Auxiliary'}[type] || '';
	};

	// The filter: categories made from the dictionaries on the page, by kind:
	// their first folder, named as it is (Bible, Bible extra, Dict, Ref, ...),
	// other languages' in theirs after the page's own (on /chinese, the
	// English Bibles at the bottom of Bible); a category of only theirs
	// after the page's. Pick
	// any number of them and searches use just their dictionaries; none
	// picked is All. Each dictionary is on or off, the same in every category.
	const catLabel = c => c.split('/').map(cap).join(' / '); // ("bible-extra": Bible Extra)
	// The categories, in the order their entries come (their first
	// dictionary's). Again when a dictionary's added or taken off. Choosing
	// is worth it only with two or more: one category is everything.
	// A category is a dictionary's first two folders (bible/text, dict/lexicon;
	// dict for one just in dict), grouped by the first (Bible: Text, Audio,
	// Notes, ...). Picked: categories (their ids); a group's id ("bible", or
	// "dict/" for all of Dict when there's a dict too) is all of its.
	const cats = []; // {id, label, short (its name in its group), group, members: [d, ...]}
	const groups = []; // {id, label, cats}
	let choice;
	const catById = id => cats.find(c => c.id === id);
	const catId = x => x.folder.split('/').slice(0, 2).join('/') || 'other';
	const under = id => catById(id) ? [catById(id)] : cats.filter(c => (c.id + '/').startsWith(id.replace(/\/?$/, '/')));
	function buildCats(){
		cats.length = groups.length = 0;
		dictIds.forEach(d => {
			const x = dicts[d], id = catId(x), c = catById(id) || cats[cats.push({id, label: catLabel(id), own: false, members: []}) - 1];
			c.members.push(d);
			c.own ||= x.primary;
		});
		cats.forEach(c => c.members.sort((a, b) => dicts[b].primary - dicts[a].primary || a - b));
		cats.sort((a, b) => b.own - a.own);
		cats.forEach(c => {
			const id = c.id.split('/')[0], g = groups.find(g => g.id === id) || groups[groups.push({id, label: cap(id), cats: []}) - 1];
			g.cats.push(c);
			c.group = g;
			c.short = c.id === id ? 'General' : cap(c.id.split('/')[1]);
		});
		// (in a group, the one with the most main ones first, then the most of the page's: Bible's Text, Dict, Audio, ...)
		const weight = c => [c.members.filter(d => dicts[d].primary && rank(dicts[d].priority) <= 1).length, c.members.filter(d => dicts[d].primary).length];
		groups.forEach(g => g.cats.sort((a, b) => (([a1, a2], [b1, b2]) => b1 - a1 || b2 - a2)(weight(a), weight(b))));
		choice = cats.length > 1;
	}
	buildCats();
	const urlParams = new URLSearchParams(window.location.search);
	// The filter (what searches use) and the gloss (what glosses use) work
	// the same way, with the same drawer (filterHTML): each picks categories
	// (none: All), remembered (the filter's can come in the link's ?mode=).
	// The gloss's is for the popup too; the filter's searches again.
	const VIEWS = {
		filter: {title: 'Filter', uses: 'searches', key: `peakslab-filter-${appname}`, changed: () => { applyOn(); searchAgain(); }},
		gloss: {title: 'Gloss with', uses: 'glosses and popups', key: `peakslab-glosscats-${appname}`, changed: () => regloss()},
	};
	const picks = {filter: urlParams.has('mode') ? urlParams.get('mode').split(',') : readList(VIEWS.filter.key), gloss: readList(VIEWS.gloss.key)};
	const keepPicks = () => Object.keys(picks).forEach(v => { picks[v] = choice ? [...new Set(picks[v].flatMap(id => under(id).map(c => c.id)))] : []; });
	keepPicks();
	const filtered = (view = 'filter') => picks[view].length > 0;
	const selCats = (view = 'filter') => picks[view].map(catById);
	const inFilter = (d, view = 'filter') => !filtered(view) || selCats(view).some(c => c.members.includes(d));
	// A gloss's word boxes have three rows, each for a category's words, a
	// language's, or both ({cat, lang}, '' any; null: off; the gloss's
	// drawer picks): pronunciation, then the rest. A word goes in the
	// first row it fits.
	const rowsKey = `peakslab-glossrows-${appname}`;
	const glossRows = (r => Array.isArray(r) && r.length === 3 ? r : [under('dict/phonetics').length && {cat: 'dict/phonetics'}, {}, null])(stored(rowsKey));
	const catOf = d => catId(dicts[d]);
	// What a dictionary's word glosses it with is in: a second index
	// word's, its headword's language (that's its gloss); a headword's, its
	// text's (an aligned one's headwords are keys, in no language).
	const langsOf = x => { const [head, body = head] = typeLangs(x) || {mono: [x.lang], bi: [x.lang, 'english'], rbi: ['english', x.lang]}[x.type] || []; return [head, body]; };
	const outLang = ({d, sec}) => sec && isAligned(dicts[d]) ? null : langsOf(dicts[d])[sec ? 0 : 1];
	// A word fits a row in its category and language (it goes in the first
	// it fits); an aligned one's is in every row of another language too
	// that has words for its key (via: [them, their dictionary])
	const catFits = (row, x) => !row.cat || under(row.cat).some(c => c.members.includes(x.d));
	const fits = (row, x) => row && catFits(row, x) && (!row.lang || outLang(x) === row.lang);
	const viaOf = (row, x) => row?.lang && catFits(row, x) && outLang(x) !== row.lang && x.via?.[row.lang];

	// Stars: a starred dictionary's entries come first and stand out, in the
	// order they were starred, and its words are the ones searched first.
	// ?dict=km-h97,km-g2k is a page with only those dictionaries loaded ("solo"):
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
		if (isBibleText(d) && bibleCards().length) { // The Bible cards showing get it (in place)
			bibleCards().forEach(c => cardTexts(c).includes(d) && fillCard(c));
			if (searchRef()) return fetched.delete(d);
		}
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
	const searched = d => isOn(d);
	const searchMask = () => dicts.map((_, d) => searched(d));
	let searching = []; // What the search showing uses (startSearch)


	function cleanup(container){
		container.querySelectorAll('img[src^="blob:"], audio[src^="blob:"]').forEach(el => {
			URL.revokeObjectURL(el.src);
			el.src = '';
		});
		container.replaceChildren();
	}

	// The query marked in an entry's text (not in its tags)
	function highlightText(html, query) {
		if (!query || !html) return html;
		const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return html.replace(/<[^>]+>|([^<]+)/g, (m, text) => text ? text.replace(re, '<mark>$1</mark>') : m);
	}

	// The media decoders: JBIG2 images (sheet music) to PNG, Codec2 audio to
	// WAV; each one's wasm loaded when first used
	// A decoder's wasm; whatever it imports does nothing (or fails, for an
	// exit or abort)
	const decoders = {};
	const decoder = name => decoders[name] ??= WebAssembly.compileStreaming(fetch(`/${name}.wasm`)).then(m => {
		const imports = {};
		for (const {module, name: f} of WebAssembly.Module.imports(m))
			(imports[module] ??= {})[f] = /exit|abort|assert/.test(f) ? () => { throw new Error(`${name}.wasm: ${f}`); } : () => 0;
		return WebAssembly.instantiate(m, imports);
	}).then(i => i.exports);
	// Bytes into a decoder's memory (freed by the caller)
	function toWasm(x, bytes){
		const p = x.malloc(bytes.length);
		if (!p) throw new Error('malloc failed');
		new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
		return p;
	}

	async function jbig2toPng(data) {
		const x = await decoder('jbig2'), bytes = new Uint8Array(data);
		const p = toWasm(x, bytes);
		x.jbig2_decode_to_png(p, bytes.length);
		x.free(p);
		const out = new Uint8Array(x.memory.buffer, x.jbig2_get_result_ptr(), x.jbig2_get_result_size()).slice();
		x.jbig2_free_result();
		return new Blob([out], {type: 'image/png'});
	}

	async function codec2toWav(data) {
		const x = await decoder('codec2'), bytes = new Uint8Array(data);
		// 700C: 4 bytes a frame, 320 samples; a 7 byte header (c0 de c2 ...) or none
		const header = bytes[0] === 0xc0 && bytes[1] === 0xde && bytes[2] === 0xc2 ? 7 : 0;
		const outMax = 44 + Math.floor((bytes.length - header) / 4) * 320 * 2;
		const p = toWasm(x, bytes), out = x.malloc(outMax);
		const written = out ? x.decode_to_wav(p, bytes.length, out, outMax) : -1;
		x.free(p);
		const wav = written >= 0 && new Uint8Array(x.memory.buffer, out, written).slice();
		if (out) x.free(out);
		if (!wav) throw new Error('codec2: decoding failed, ' + written);
		return new Blob([wav], {type: 'audio/wav'});
	}

	// tnefar speech (utils/tnefar: FARGAN, and the speaker's voice, a
	// codebook and a postfilter: the dictionary's "tnefar" file, its
	// tnefar.voice). Under 1 kbps. It's made a few frames at a time and each piece
	// played (Web Audio) as soon as it's made, so it starts before it's all
	// decoded. Once it's all there it's kept, to play again straight away.
	const TNEFAR = /tnefar/i;
	const tnefarDone = new WeakMap(); // a recording's bytes -> its sound ([samples, rate]: 16 kHz, tnefar's)
	let tnefarCtx, tnefarX, tnefarHeld, tnefarJob = 0, tnefarOn = null; // (tnefarOn: what's playing, {button, live, stop, frame})
	const tnefarWasm = () => tnefarX ??= decoder('tnefar').then(x => (x._initialize?.(), x));
	// A dictionary's voice, in the wasm's memory: [where, length]. With
	// several speakers in a slab, a recording's details are its voice's number:
	// "word<tab>2.tnefar" is in the voice tnefar2.voice. Its file is the codebook
	// and the name of its postfilter, in the language's postfilters slab: with
	// it, if that's on in the library (it's optional: without it, it's the
	// codebook alone, a rougher sound)
	const tnefarVoices = {};
	const postfilters = d => dicts.findIndex(x => x.lang === dicts[d].lang && bareName(x.name) === 'postfilters');
	const tnefarVoice = (x, d, n) => { const p = postfilters(d), on = p >= 0 && libOn[p];
		return tnefarVoices[`${d} ${n} ${on}`] ??= askDict(d, {type: 'media', words: [`tnefar${n}`]}).then(async r => {
			const v = r.files[0]?.[1];
			if (!v) throw new Error(`tnefar: ${dicts[d].name} has no voice (tnefar${n}.voice)`);
			const end = 4 + new DataView(v.buffer, v.byteOffset).getUint32(0, true);
			const pf = on ? (await askDict(p, {type: 'media', words: [new TextDecoder().decode(v.subarray(end))]}).catch(() => null))?.files[0]?.[1] : null;
			const voice = new Uint8Array(end + (pf?.length ?? 0));
			voice.set(v.subarray(0, end));
			if (pf) voice.set(pf, end);
			return [toWasm(x, voice), voice.length];
		});
	};
	// Play recordings ([type, bytes]: tnefar's, and the others' (webm, ...),
	// decoded; a compound's parts', one after another), all in the one Web
	// Audio context; tapped again while it plays, pause (⏸ while it plays,
	// 🔊 paused or done). Called in the tap: phones start sound only there
	// (an <audio> started when another ends isn't), so the audio is started
	// first and the sound follows
	// (from, to: just those frames of a recording; then: called at its end)
	// The speed (a chapter's menu's, a word's recordings', a gloss's, one
	// for all, remembered): tnefar's are made at it (tnefar_speed: the pitch
	// stays); another's can't be, its pitch would go with it
	const SPEEDS = [.5, .75, 1, 1.25, 1.5, 2];
	let soundSpeed = stored('soundSpeed') || 1;
	function nextSpeed(){
		const o = tnefarOn;
		if (o?.live() && o.button.classList.contains('ch-play')) { // (what's made so far has the old one: from here, when it goes on)
			o.button.at = o.frame();
			o.stop();
		}
		store('soundSpeed', soundSpeed = SPEEDS[(SPEEDS.indexOf(soundSpeed) + 1) % SPEEDS.length]);
		document.querySelectorAll('.speed').forEach(b => { b.textContent = `${soundSpeed}×`; });
	}
	function speedButton(){
		const b = named(document.createElement('button'), 'Speed');
		b.className = 'speed';
		b.textContent = `${soundSpeed}×`;
		b.onclick = nextSpeed;
		return b;
	}
	async function soundPlay(recs, d, button, from = 0, to = 0, then){
		if (!tnefarCtx) {
			try { navigator.audioSession.type = 'playback'; } catch (e) { /* (iOS: heard even with the ringer off, like <audio>) */ }
			const AC = window.AudioContext || window.webkitAudioContext;
			// ('playback': a bigger buffer, for listening; the smallest one, the default, crackles on phones, above all as it starts again after a pause)
			try { tnefarCtx = new AC({sampleRate: 16000, latencyHint: 'playback'}); } catch (e) { tnefarCtx = new AC({latencyHint: 'playback'}); }
		}
		const ctx = tnefarCtx;
		if (tnefarOn?.button === button && tnefarOn.live()) { // (its own button: pause, or go on)
			const on = ctx.state !== 'running';
			on ? ctx.resume() : ctx.suspend(); // (the decoding waits too: it keeps just ahead of the sound)
			return tnefarShow(button, on);
		}
		ctx.resume();
		tnefarOn?.stop();
		const job = ++tnefarJob, srcs = [], rate = recs.some(([t]) => TNEFAR.test(t)) ? soundSpeed : 1;
		let at = 0, first, made = true; // (when the next piece starts, and the sound would have; made: all of it is)
		const me = tnefarOn = {button,
			live: () => job === tnefarJob && (!made || ctx.currentTime < at),
			frame: () => from + Math.max(0, ctx.currentTime - (ctx.outputLatency || 0) - (first ?? Infinity)) * 100 * rate, // (the frame being heard)
			stop: () => { ++tnefarJob; srcs.forEach(s => s.stop()); tnefarShow(button, false); }};
		tnefarShow(button, true);
		const play = (pcm, rate = 16000) => {
			const b = ctx.createBuffer(1, pcm.length, rate), s = ctx.createBufferSource();
			b.copyToChannel(pcm, 0);
			s.buffer = b;
			s.connect(ctx.destination);
			const late = Math.max(at, ctx.currentTime + .02); // (late: right away)
			first = (first ?? late) + (srcs.length ? late - at : 0);
			s.start(at = late);
			s.onended = () => { // (the end)
				if (!made || s !== srcs.at(-1) || tnefarOn !== me) return;
				const done = job === tnefarJob;
				tnefarShow(button, false);
				if (done) then?.();
			};
			srcs.push(s);
			at += b.duration;
		};
		made = false;
		const ahead = () => job === tnefarJob && at - ctx.currentTime;
		try { for (const [type, bytes, voice] of recs) if (job === tnefarJob) await (TNEFAR.test(type) ? tnefarMake(bytes, d, voice, play, ahead, from, to, rate) : soundMake(type, bytes, ctx, play)); }
		finally { made = true; }
	}
	// Another recording's sound (webm, codec2, ...: the browser decodes it)
	async function soundMake(type, bytes, ctx, play){
		if (!tnefarDone.has(bytes)) {
			const data = /codec2|c2/i.test(type) ? await (await codec2toWav(bytes)).arrayBuffer() : bytes.slice().buffer; // (a copy: decoding takes it)
			const b = await new Promise((ok, no) => ctx.decodeAudioData(data, ok, no));
			tnefarDone.set(bytes, [b.getChannelData(0), b.sampleRate]);
		}
		play(...tnefarDone.get(bytes));
	}
	// A recording's sound to play(), a piece at a time (ahead(): how far
	// it's ahead of what's playing, or false: stop)
	async function tnefarMake(bytes, d, voice, play, ahead, from, to, rate){
		if (!to && !from && rate === 1 && tnefarDone.has(bytes)) return play(...tnefarDone.get(bytes));
		const x = await tnefarWasm(), [v, vn] = await tnefarVoice(x, d, voice), held = tnefarHeld?.bytes === bytes;
		let h = tnefarHeld?.h;
		if (!held) {
			const p = toWasm(x, bytes);
			h = x.tnefar_open(p, bytes.length, v, vn);
			x.free(p);
			if (h < 0) throw new Error(`tnefar: can't decode it (${h})`);
		}
		const short = x.tnefar_frames(h) <= 3000; // (up to 30 s: kept, to play again; longer, a chapter: left open, to go to its words)
		if (!short && !held) {
			if (tnefarHeld) x.tnefar_close(tnefarHeld.h);
			tnefarHeld = {bytes, h};
		}
		if (held || from) x.tnefar_seek(h, from);
		x.tnefar_speed(h, rate);
		let parts = short && !to && !from && rate === 1 ? [] : null, left = to ? Math.round((to - from) * 160 / rate) : Infinity;
		try {
			for (let n = 4, k; left > 0 && ahead() !== false && (k = x.tnefar_run(h, n)) > 0; n = 16) {
				const pcm = new Float32Array(x.memory.buffer, x.tnefar_pcm(h), Math.min(k, left)).slice();
				left -= pcm.length;
				if (!left) for (let i = 0, m = Math.min(480, pcm.length); i < m; i++) pcm[pcm.length - 1 - i] *= i / m; // (30 ms: no click)
				parts?.push(pcm);
				play(pcm);
				// (a long one, a chapter: made just a few seconds ahead of what's playing)
				while (ahead() > 5) await new Promise(r => setTimeout(r, 500));
				await new Promise(r => setTimeout(r)); // (the page stays responsive)
			}
		} finally { if (short) x.tnefar_close(h); }
		if (!parts || ahead() === false) return;
		const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
		parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
		tnefarDone.set(bytes, [all, 16000]);
	}

	// A button's look while it plays (⏸, Pause) or not (as it was: 🔊, Play)
	function tnefarShow(b, playing){
		named(b, playing ? 'Pause' : 'Play').textContent = playing ? '⏸' : '🔊';
		b.classList.toggle('playing', playing);
		if (playing && b.reader) follow(Object.assign(b.reader, {b}));
	}
	// A 🔊 that plays the recordings ([type, bytes]: a compound's parts')
	// A dictionary's colour, from its name (a speaker's, on their 🔊): a hue
	const voiced = (b, d, n = 0) => b.style.setProperty('--voice', ([...dicts[d].path].reduce((h, c) => h * 33 + c.charCodeAt(0) >>> 0, 7) + n * 90) % 360);
	function soundButton(recs, d){
		if (recs.some(([t]) => TNEFAR.test(t))) tnefarWasm().catch(() => {}); // (loading while it's not played yet)
		const b = named(document.createElement('button'), 'Play');
		b.className = 'sound';
		b.textContent = '🔊';
		voiced(b, d, recs[0]?.[2] || 0);
		b.sound = [recs, d];
		b.onclick = () => playWord(b);
		return b;
	}

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
	const popupResults = $('popupResults'), popupBox = $('popupContent'), popupSheet = $('popupSheet'); // (popupBox: the box that scrolls)

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
	const isBibleText = d => dicts[d].cat === 'bible/text', isNote = d => dicts[d].collapsed; // (notes: #collapsed, their entries start hidden)
	const hasBible = dictIds.some(isBibleText);
	// A verse's chapter: "rom 8.1" -> "rom 8.", else null
	const chapterOf = h => (/^(.+ \d+\.)\d+$/.exec(h || '') || [])[1] || null;
	// A range of verses ("rom 1.4-20", "rom 1:4-2:3") or of chapters ("rom
	// 1-5", "rom1-5"): its book as typed (a code, or a book's name; "Rom.")
	// and its first and last verses as chapter * 1000 + verse (addVerse's)
	function rangeOf(q){
		const m = /^(.*?\D)\.? ?(\d+)(?:[.:](\d+))? ?[-–] ?(?:(\d+)[.:])?(\d+)\.?$/.exec((q || '').replace(/\p{Nd}/gu, digit)); // (in any digits: "រ៉ូម ៨:២៨-៣០")
		if (!m) return null;
		const [, book, c1, v1, c2, n] = m;
		const from = c1 * 1000 + (+v1 || 1), to = v1 || c2 ? (+c2 || +c1) * 1000 + +n : n * 1000 + 999;
		return to < from ? null : {bk: book.trim(), from, to};
	}
	// Bible d's lines in range r ({d, at (the first), last}, in its order:
	// the Bible's), or null. Its book: its code, or the name a Bible gives it.
	// (names compared in lower case, without invisible spaces ("បទ​ចំរៀង"),
	// their digits in any script: "១ កូរិនថូស" is "1 កូរិនថូស")
	const nameKey = t => t.toLowerCase().replace(/[​⁠­﻿]/g, '').replace(/\p{Nd}/gu, digit);
	const bookCode = book => (b => books?.find(x => x.code === b || nameKey(x.name) === b)?.code || b)(nameKey(book));
	// A Bible's (or commentary's) headwords, each [its book's code, chapter * 1000 + verse]: "gen 1.1"
	const headsCache = {};
	const headsOf = d => headsCache[d] ??= askDict(d, {type: 'heads'}).then(r => r.heads.map(h => (([bk, c, v]) => [bk, c * 1000 + +v])(h.split(/[ .]/))));
	const rangeLines = (d, r) => new Promise(then => books ? then() : loadBooks(then)).then(() => headsOf(d)).then(heads => {
		const code = bookCode(r.bk);
		let at = -1, last = -1;
		heads.forEach(([bk, v], i) => {
			if (bk !== code) return;
			if (at < 0 && v >= r.from) at = i;
			if (v <= r.to) last = i;
		});
		return at >= 0 && last >= at ? {d, at, last} : null;
	});
	const lineMsg = (from, n) => ({type: 'renderlines', lines: Array.from({length: n}, (_, i) => [from + i, 3])}); // (3: by line)
	// A Bible card for ref (a chapter's, a range's, a verse's) in box,
	// filled: its translations (texts; none: the search's), at its verse
	// hl; cmp, Compare's (another color)
	function bibleCard(box, ref, q, texts, hl, cmp){
		const card = document.createElement('p-d');
		card.className = 'chapter';
		if (box === popupResults) card.dataset.pop = cmp ? 'cmp' : 1;
		if (texts) card.dataset.texts = texts.join();
		if (hl) card.dataset.hl = hl;
		box.append(card);
		addCardBar(card, ref, q);
		return fillCard(card).then(() => card);
	}
	// At its verse (once it's showing)
	const toHl = card => card.querySelector('.vs.ctx')?.scrollIntoView({block: 'center'});
	// A chapter or a range searched: its card (in no Bible, searched)
	function bibleSearch(ref, otherwise){
		const gen = ++searchGen;
		worker_code.fill(true); // (nothing for the workers to go on with)
		num = 0;
		Promise.all(barTexts().map(d => rangeLines(d, ref))).then(parts => {
			if (gen !== searchGen) return;
			if (!parts.some(Boolean)) return otherwise();
			cleanup(resultsDiv);
			lastRead = `${bookCode(ref.bk)} ${chOf(ref.from)}.`; // (the Bible bar's)
			renderBibleBar();
			bibleCard(resultsDiv, ref, query, null, readHl).then(toHl);
		});
	}
	// In the popup: the range's card
	const popupRange = (text, texts, cmp) => bibleCard(popupResults, popupRef(), popupQuery, texts, popupHl, cmp).then(card => popupQuery === text && (popupOpen(), toHl(card)));
	const search = text => { setQueryText(text); startSearch(); addHistory(queryText); };
	let readHl = ''; // The verse to show in its chapter (Read in context)

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
		(booksLoad ??= headsOf(d).then(heads => {
			const list = [], firsts = [];
			let s = 0;
			heads.forEach(([code, cv], i) => {
				if (list.at(-1)?.code !== code) {
					s = Math.max(s, sections.indexOf(code));
					list.push({code, n: 0, s, vs: []}); firsts.push(i);
				}
				const b = list.at(-1), c = chOf(cv);
				b.n = Math.max(b.n, c);
				b.vs[c] = Math.max(b.vs[c] || 0, cv % 1000); // (its chapters' last verses)
			});
			return askDict(d, {type: 'renderlines', lines: firsts.map(i => [i, 3])}).then(r => {
				r.entries.forEach((e, i) => {
					const [, name, one] = /^(.*) (\p{Nd})/u.exec(refOf(e.body)); // (its first verse's: "លោកុប្បត្តិ ១:១")
					Object.assign(list[i], {name, zero: one.codePointAt(0) - 1});
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
	const bookName = (x, n) => escapeHTML(x.name) + (n ? ' ' + bookNum(x, n) : '') + (x.name !== x.code ? `<small>${escapeHTML(x.code.toUpperCase())}</small>` : '');
	const bookNum = (x, n) => String(n).replace(/\d/g, d => String.fromCodePoint(x.zero + +d)); // In the Bible's digits
	// A chapter ("joh 3."): its reference ({bk, from, to, kind}), or null
	const chapterRef = q => (m => m && {bk: m[1], from: m[2] * 1000 + 1, to: m[2] * 1000 + 999, kind: 'chapter'})(/^(.+) (\d+)\.$/.exec(q || ''));
	const chapterRange = q => q.replace(/ (\d+)\.$/, ' $1-$1'); // ("joh 4." as a range, "joh 4-4": the popup's)
	const chOf = cv => Math.floor(cv / 1000); // (chapter * 1000 + verse: its chapter)
	// A book and a number ("gen 1", "Genesis 1", "លោកុប្បត្តិ ១"): its chapter, "gen 1."
	const digit = ch => { let k = 0; const cp = ch.codePointAt(0); while (/\p{Nd}/u.test(String.fromCodePoint(cp - k - 1))) ++k; return k % 10; };
	function asChapter(q){
		const m = books && /^(.*\S)\s+(\p{Nd}+)$/u.exec(q || ''), b = m && bookOf(m[1]), n = m && +[...m[2]].map(digit).join('');
		return b && n >= 1 && n <= b.n ? `${b.code} ${n}.` : q;
	}
	// The chapter before or after book b's chapter c (dir -1 or 1), across
	// books ("joh 4."; none at the ends)
	function nextChapter(b, c, dir){
		const i = books.indexOf(b), to = c + dir;
		const bk = to < 1 ? books[i - 1] : to > b.n ? books[i + 1] : b;
		return bk ? `${bk.code} ${to < 1 ? bk.n : bk === b ? to : 1}.` : null;
	}

	// The search's translations: the Bible texts that are on; more than
	// one, in parallel (each verse in each of them, one after the other)
	const moreHTML = '<p class="empty">Want more? <button class="text-btn" data-library="1">Go to the library</button></p>';
	const barTexts = () => dictIds.filter(d => isBibleText(d) && isOn(d)); // (in the filter: Bible unticked, none)

	// Bible mode (a Bible category picked, or a Bible page), and reading a
	// chapter, have the Bible bar at the top of the results: ‹ book and
	// chapter ▾, translation ▾ ›. The book opens the Books drawer (the books,
	// a book's chapters), the translation the translations drawer. The
	// search bar's there to type in too.
	const bibleMode = () => hasBible && (pParts.includes('bible') || picks.filter.some(id => id.split('/')[0] === 'bible'));
	let lastRead = ''; // The chapter read last ("joh 3.")
	let booksPick = null; // The book whose chapters the drawer shows
	let booksOpen = false; // (the books showing, not a book's chapters)
	const bibleBar = $('chNav');
	// (A card's bar, as for the chapter read last: renderCardBar; no
	// chapter read: Books)
	function renderBibleBar(){
		renderCardBars(); // (their translations, if they're the Bible bar's)
		if (chapterRef(query)) lastRead = query;
		bibleBar.hidden = !bibleMode() || !!query; // (just with nothing searched: a search's Bible cards have their own)
		if (bibleBar.hidden) return;
		if (!books) return loadBooks(renderBibleBar); // (after it's started: not while the page is)
		Object.assign(bibleBar.dataset, chapterRef(lastRead) || {bk: ''});
		renderCardBar(bibleBar);
	}
	// (now: the chapter the panel's card is in, "joh 3.")
	function booksHTML(now = lastRead){
		if (!books) {
			loadBooks(() => drawerView === 'bible' && renderDrawer());
			return '<p class="empty">Loading…</p>';
		}
		const b = !booksOpen && books.find(x => x.code === booksPick), cur = on => on ? ' aria-current="true"' : '';
		return (b ? `<div class="bk-grid ch">${Array.from({length: b.n}, (_, i) => `${b.code} ${i + 1}.`).map((ref, i) => `<button data-q="${ref}"${cur(ref === now)}>${bookNum(b, i + 1)}</button>`).join('')}</div>` :
			`<div class="bk-grid">${books.map(x => `<button style="--sec:#${secColors[x.s]}" data-book="${escapeHTML(x.code)}" title="${escapeHTML(x.name)}" aria-label="${escapeHTML(x.name)}"${cur(now.startsWith(x.code + ' '))}>${escapeHTML(x.ab || x.name)}${/^[\x00-\x7f]*$/.test(x.ab || x.name) ? '' : `<small>${escapeHTML(x.code)}</small>`}</button>`).join('')}</div>`);
	}

	// ---------------------------------------------------------------
	// Each Bible card (a verse's, a chapter's, a range's) has its heading:
	// its reference, the Bible button (the Bible panel: its translations,
	// ‹ its chapter ›, the books) and ⋮. A card has the search's
	// translations (barTexts) until some are picked in its panel: then
	// they're its own (data-texts), and its verses are read again from
	// them (fillCard). Apply to all makes them the search's, and every card's.
	// ---------------------------------------------------------------
	const inPopup = card => !!card.dataset.pop || !!card.closest('#popupResults'); // (pop: made for it, before it's in it)
	// A card's translations: its own (data-texts), or the search's (a
	// popup's: the gloss's); more than one, in parallel. Its own go with it
	// to its next chapter
	const cardTexts = card => card.dataset.texts ? card.dataset.texts.split(',').map(Number) : inPopup(card) ? dictIds.filter(d => isBibleText(d) && isOn(d, 'gloss')) : barTexts();
	const ownTexts = card => card.dataset.texts ? cardTexts(card) : null;
	// A card's reference: {bk (its book as typed or found: "joh", "Romans"),
	// from, to (chapter * 1000 + verse), kind (verse, chapter or range)}
	function verseRef(h){
		const m = /^(.+) (\d+)\.(\d+)$/.exec(h);
		return m && {bk: m[1], from: m[2] * 1000 + +m[3], to: m[2] * 1000 + +m[3], kind: 'verse'};
	}
	// The chapter or range searched
	function searchRef(){
		const r = rangeOf(query);
		return chapterRef(query) || r && {...r, kind: 'range'};
	}
	// The popup's chapter or range: a whole chapter is a chapter
	function popupRef(){
		const r = rangeOf(updateQuery(popupQuery));
		return r && {...r, kind: r.from === r.to ? 'verse' : r.from % 1000 === 1 && r.to % 1000 === 999 && r.to - r.from < 1000 ? 'chapter' : 'range'};
	}
	const cardRef = card => ({bk: card.dataset.bk, from: +card.dataset.from, to: +card.dataset.to, kind: card.dataset.kind});
	const bookOf = bk => books?.find(x => x.code === bookCode(bk));
	// A Bible card's heading (a verse's word card's: its h2); q, what it's
	// for (its bookmark's and Share's)
	function addCardBar(card, ref, q){
		if (!ref) return;
		Object.assign(card.dataset, {bk: ref.bk, from: ref.from, to: ref.to, kind: ref.kind, q});
		(card.querySelector(':scope > h2') || card.insertAdjacentElement('afterbegin', document.createElement('h2'))).className = 'card-bar';
		renderCardBar(card);
	}
	// A reference as it's searched ("rom 1.2", "rom 1.4-20", "rom 1-5"), or
	// (own) in the book's own name and digits ("រ៉ូម ១:២", "Romans 1:4–20")
	function refLabel({bk, from, to, kind}, own = true){
		const b = bookOf(bk), n = x => own && b ? bookNum(b, x) : x, [cv, dash] = own ? [':', '–'] : ['.', '-'];
		const [c1, v1, c2, v2] = [chOf(from), from % 1000, chOf(to), to % 1000];
		const name = escapeHTML(own ? b?.name || bk.toUpperCase() : bookCode(bk));
		if (kind === 'verse') return `${name} ${n(c1)}${cv}${n(v1)}`;
		if (kind === 'chapter' || (v1 === 1 && v2 === 999 && c1 === c2)) return `${name} ${n(c1)}`;
		if (v1 === 1 && v2 === 999) return `${name} ${n(c1)}${dash}${n(c2)}`;
		return `${name} ${n(c1)}${cv}${n(v1)}${dash}${c1 === c2 ? '' : n(c2) + cv}${n(v2)}`;
	}
	const refHeading = ref => refLabel(ref, false) + chevron + (bookOf(ref.bk) ? `<span class="hw-sep"> | </span><span class="hw-own">${refLabel(ref)}${chevron}</span>` : ''); // (a ▾ after each: it opens the Bible panel)
	// Every heading's ⋮ (at its right) has Collapse all: every card in the
	// results (or the popup) just its heading, to see them all; again
	// (Expand all), all of them, at the one tapped. A card's heading tapped
	// (not a button in it) collapses (or opens) just it: it's the other way
	// from the rest (flip). A popup's card's ⋮ also has Show in the results.
	const moreSVG = icon(['M12 5.5v.01M12 12v.01M12 18.5v.01', 'stroke-width="3.2"']);
	const foldBtnHTML = `<button class="cb-more" data-cb="more" title="More" aria-label="More" aria-haspopup="true">${moreSVG}</button>`;
	// (at a heading's start, seen only in the popup: what it showed before, or with nothing before, it's closed)
	const backSVG = icon('M15 18l-6-6 6-6');
	const backBtnHTML = `<button class="cb-back" data-cb="back" title="Back" aria-label="Back">${backSVG}</button>`;
	// A card's heading: its word (html), ⋮, and the popup's ‹ (back: not a gloss's)
	const headHTML = (html, back = true) => `<h2>${back ? backBtnHTML : ''}<span class="hw">${html}</span>${foldBtnHTML}</h2>`;
	const foldSVG = icon('M6 15l6-6 6 6'), unfoldSVG = icon('M6 9l6 6 6-6');
	const foldItem = b => b.closest('.collapsed') ? ['unfold', unfoldSVG, 'Expand all'] : ['fold', foldSVG, 'Collapse all'];
	const foldAll = btn => {
		const pop = btn.closest('#popupResults'), card = btn.closest('p-d');
		const boxes = pop ? [pop] : [resultsDiv, translationDiv], on = !boxes[0].classList.contains('collapsed');
		boxes.forEach(x => {
			x.classList.toggle('collapsed', on);
			x.querySelectorAll(':scope > p-d.flip').forEach(c => c.classList.remove('flip'));
		});
		card.scrollIntoView({block: 'start'});
		if (!pop) scrollBy(0, -parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stick') || 0));
	};
	document.addEventListener('click', e => {
		const card = !e.target.closest('button, a, p-a, .menu') && e.target.closest(':is(#results, #translation, #popupResults) > p-d > h2')?.parentNode;
		if (!card) return;
		card.classList.toggle('flip');
		if (card.getBoundingClientRect().top < 0) card.scrollIntoView({block: 'start'}); // (its heading was stuck: it, at the top)
	});
	// A Bible card's heading: its reference, then (at its right) ⋮, like a
	// word's. The reference is a button: it opens the Bible side panel: its translations (a drop-down list), a chapter's previous and
	// next, and the books (its book's chapters). Its ⋮: Collapse all (a
	// popup's, Show in the results first). A verse's (or a range's) card has
	// … above it if its chapter has verses before it, and below it if after:
	// either shows the whole chapter in the card, at the verse (the search
	// stays as it is). The Bible bar (an empty page's, Bible mode's) is just
	// the reference (or Bible).
	const fullSVG = icon('M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7');
	const cardActs = card => inPopup(card) ? [['full', fullSVG, 'Show in the results']] : [];
	const menuHTML = items => items.map(([a, ic, t]) => `<button data-a="${a}">${ic}<span>${escapeHTML(t)}</span></button>`).join('');
	// Its translations: their names (none: Translation)
	const textsLabel = texts => texts.length ? names(texts) : 'Translation';
	function renderCardBar(card){
		const bar = card === bibleBar ? card : card.querySelector(':scope > .card-bar');
		if (!bar) return;
		if (!books) loadBooks(() => renderCardBar(card)); // (its book's name in the meantime: its code)
		const ref = cardRef(card);
		bar.innerHTML = (card === bibleBar ? '' : backBtnHTML) +
			`<button class="hw" data-cb="bible" title="Translation, book and chapter" aria-haspopup="dialog">${ref.bk ? refHeading(ref) : 'Bible'}</button>` +
			(card === bibleBar ? '' : foldBtnHTML);
		if (card !== bibleBar) moreVerses(card, ref);
		chapterAudio(card, bar, ref);
	}
	// A chapter's recording (a media dictionary's "gen 1"): its 🔊 in the
	// chapter's heading (a card's: before the ⋮; the Bible bar's: at its
	// right). The same button when the heading's redrawn: it may be playing
	function chapterAudio(card, bar, ref){
		const c = chOf(ref.from), w = ref.bk && c === chOf(ref.to) ? bookCode(ref.bk) + ' ' + c : '';
		const text = cardTexts(card)[0], key = `${w} ${text}`; // (the card's first translation's recording, if it has one)
		const put = b => bar.insertBefore(b, bar.querySelector(':scope > .cb-more'));
		if (card._audio?.key === key) {
			const b = card._audio.b;
			if (b) { b.ref = ref; playSpan(b); put(b); }
			return;
		}
		card._audio?.b && tnefarOn?.button === card._audio.b && tnefarOn.stop(); // (another chapter now)
		card._audio = {key};
		if (!w) return;
		const ts = dictIds.filter(isBibleText); // (a recording's words have a text's timing: "gen 1 km-khsv")
		const ds = dictIds.filter(d => libOn[d] && dicts[d].media);
		Promise.all(ds.map(d => askDict(d, {type: 'media', words: [w, ...ts.map(t => `${w} ${dicts[t].name}`)]}).then(r => {
			const [f, ...ms] = r.files;
			return f?.[1] && TNEFAR.test(f[0]) ? {d, f, ms, i: ms.findIndex(m => m?.[1])} : null;
		}))).then(rs => {
			rs = rs.filter(Boolean);
			const got = rs.find(r => ts[r.i] === text) ?? rs[0]; // (read along with this text, else any)
			if (!got || card._audio.key !== key) return;
			const {d, f, ms, i} = got;
			const b = card._audio.b = soundButton([f], d);
			b.classList.add('ch-play');
			b.onclick = e => { // (playing, or Play word on: that stops; else its menu)
				const playing = tnefarOn?.button === b && tnefarOn.live() && tnefarCtx.state === 'running';
				if (playing) playWord(b);
				if (playing || b.reader?.on === 'words') return wordTaps(b, false);
				e.stopPropagation(); // (a tap on a button closes the menu)
				openCtx({el: b, chapter: true});
			};
			put(b);
			b.ref = ref;
			if (i >= 0) readAlong(w, b, ts[i], ms[i][1]);
			playSpan(b);
		});
	}
	// A chapter's read-along: its "gen 1 km-khsv.times" (times.py, in tnefar-work) says
	// when each word of that text is said. Varints, for each verse (from
	// verse 1) its number of words, then for each word its start after the
	// last's, in 20 ms units, and, if it doesn't run on to the next word (a 0,
	// no start being 0 after the last's), a 0 and its length. In frames here
	function readTimes(bytes){
		const first = [], starts = [], ends = [];
		let at = 0, t = 0;
		const num = () => { let n = 0, s = 0, c; do { c = bytes[at++]; n |= (c & 127) << s; s += 7; } while (c > 127); return n; };
		while (at < bytes.length) {
			first.push(starts.length);
			for (let n = num(); n--;) {
				starts.push(t += num() * 2);
				ends.push(bytes[at] ? 0 : (at++, t + num() * 2));
			}
		}
		first.push(starts.length);
		return {first, starts, ends};
	}
	// Where a word ends (and a bit, as a word's recording); a timed chapter's
	// 🔊 on a card of some of its verses plays those (b.from, b.to: frames)
	const wordEnd = (r, i) => (r.ends[i] || r.starts[i + 1] || r.starts[i] + 100) + 3;
	function playSpan(b){
		const r = b.reader, {kind, from, to} = b.ref, n = r ? r.first.length - 1 : 0, some = r && kind !== 'chapter' && from % 1000 <= n;
		const at = some ? r.starts[r.first[from % 1000 - 1]] : 0, end = some ? wordEnd(r, r.first[Math.min(to % 1000, n)] - 1) : 0;
		if (at !== b.from || end !== b.to) {
			b.at = 0;
			if (tnefarOn?.button === b) tnefarOn.stop(); // (the card's another size now)
		}
		Object.assign(b, {from: at, to: end});
	}
	const readers = new Map(); // (a chapter ("gen 1"): {b, text, on, words, ...readTimes})
	const chapterVerses = w => document.querySelectorAll(`.vs[data-h^="${w}."]`);
	function readAlong(w, b, text, bytes){
		const r = readers.get(w) ?? {w, text, i: -1, ...readTimes(bytes)};
		readers.set(w, r);
		if (!r.b?.isConnected) r.b = b; // (cards of a chapter share it: the one played is its button)
		b.reader = r;
		chapterVerses(w).forEach(vs => wordSpans(vs, +(vs.closest('.pv-t')?.dataset.d ?? text)));
	}
	// A timed verse's words, its headings' too, spans (as times.py counts
	// them; split where a tag is, and a verse that doesn't count up stays as
	// it is)
	const readerOf = vs => readers.get(vs.dataset.h.replace(/\.\d+$/, ''));
	function wordSpans(vs, d){
		const r = readerOf(vs);
		if (r?.text !== d || vs.querySelector('.w')) return;
		const v = vs.dataset.v % 1000, at = r.first[v - 1], n = r.first[v] - at, toks = [];
		vs.querySelectorAll('mark').forEach(m => m.replaceWith(...m.childNodes)); // (a search's: inside a word)
		vs.normalize();
		const walk = document.createTreeWalker(vs, NodeFilter.SHOW_TEXT, {acceptNode: t => t.parentElement.closest('.vs-n, .vs-note') ? 2 : 1});
		for (let t; t = walk.nextNode();) for (const m of t.data.matchAll(/[^\s\u200b]+/g)) if (/[\u1780-\u17d3]/.test(m[0])) toks.push([t, m.index, m[0].length]);
		if (toks.length !== n) return;
		for (let j = n; j--;) { // (from the last: the text before it stays where it was)
			const [t, a, len] = toks[j], rg = document.createRange(), s = document.createElement('span');
			rg.setStart(t, a);
			rg.setEnd(t, a + len);
			rg.surroundContents(s);
			s.className = 'w';
			s.dataset.i = at + j;
		}
		vs.classList.toggle('reading', !!r.on);
	}
	// The word being said, marked, till it's not playing
	function follow(r){
		if (r.going) return;
		r.going = true;
		const go = () => {
			const on = tnefarOn?.button === r.b && tnefarOn.live();
			let f = on ? tnefarOn.frame() : -1, a = 0, z = r.starts.length;
			while (a < z) { const m = a + z >> 1; r.starts[m] <= f ? a = m + 1 : z = m; }
			const i = a && (!r.ends[a - 1] || f < r.ends[a - 1]) ? a - 1 : -1;
			if (i !== r.i) {
				const copies = n => [...document.querySelectorAll(`.vs[data-h^="${r.w}."] .w[data-i="${n}"]`)]; // (a card's, a popup's)
				const was = copies(r.i), now = copies(i), seen = was.at(-1)?.getBoundingClientRect().bottom < innerHeight;
				was.forEach(x => x.classList.remove('said'));
				now.forEach(x => x.classList.add('said'));
				if (seen && now.at(-1)?.getBoundingClientRect().bottom > innerHeight - 40) now.at(-1).scrollIntoView({block: 'center', behavior: 'smooth'}); // (it keeps up, unless they've looked elsewhere)
				r.i = i;
			}
			if (on) requestAnimationFrame(go);
			else r.going = false;
		};
		requestAnimationFrame(go);
	}
	// Its menu (its 🔊): Loop: at the end it reads again what it's reading
	// (its verses, or the chapter); Play: while it's reading, a tap on a word reads from
	// it; Play word: a tap on a word says it, and the reading goes on from
	// where it was (if it was going); with either, a tap on a verse's number
	// reads from it
	function wordTaps(b, on){
		const r = b.reader;
		if (!r) return;
		r.on = on;
		r.b = b;
		b.classList.toggle('words', on === 'words');
		chapterVerses(r.w).forEach(vs => vs.classList.toggle('reading', !!on));
	}
	function goTo(b, frame){
		if (tnefarOn?.button === b && tnefarOn.live()) tnefarOn.stop();
		b.at = Math.max(b.from || 0, b.to ? Math.min(frame, b.to - 1) : frame);
		if (!b.reader?.on) wordTaps(b, 'play');
		playWord(b);
	}
	const skip = (b, by) => goTo(b, (tnefarOn?.button === b && tnefarOn.live() && !tnefarOn.word ? tnefarOn.frame() : b.at || 0) + by);
	function sayWord(r, i){
		const {b} = r, o = tnefarOn, live = o?.button === b && o.live();
		if (!live) b.back = false;
		else if (!o.word) { b.at = o.frame(); b.back = tnefarCtx.state === 'running'; }
		if (live) o.stop();
		soundPlay(...b.sound, b, r.starts[i], wordEnd(r, i), () => b.back && playWord(b)).catch(soundError(b));
		tnefarOn.word = true;
	}
	document.addEventListener('click', e => {
		const vs = !getSelection().toString().trim() && e.target.closest('.reading'), r = vs && readerOf(vs), w = e.target.closest('.w');
		if (w && r) r.on === 'words' ? sayWord(r, +w.dataset.i) : goTo(r.b, r.starts[w.dataset.i]);
		else if (r && e.target.closest('.vs-n')) goTo(r.b, r.starts[r.first[vs.dataset.v % 1000 - 1]]);
	});
	// … above a verse's card (verses before it in its chapter), below it (after)
	function moreVerses(card, ref){
		card.querySelectorAll(':scope > .vs-more').forEach(b => b.remove());
		const b = bookOf(ref.bk), [c1, v1, c2, v2] = [chOf(ref.from), ref.from % 1000, chOf(ref.to), ref.to % 1000];
		if (ref.kind === 'chapter' || !b) return;
		const btn = (dir, id) => `<button class="vs-more" data-dir="${dir}" data-id="${id}" title="The whole chapter" aria-label="The whole chapter">…</button>`;
		if (v1 > 1) card.querySelector(':scope > .card-bar').insertAdjacentHTML('afterend', btn(-1, -1e9));
		if (v2 < (b.vs[c2] || 0)) card.insertAdjacentHTML('beforeend', btn(1, 2e9));
	}
	// The card's whole chapter (or chapters), at its verse: the verse (in
	// every translation) marked, where it was on the screen
	function wholeChapter(card, dir){
		const ref = cardRef(card), [c1, c2] = [chOf(ref.from), chOf(ref.to)];
		const y = (card.querySelector('.vs') || card.querySelector(':scope > p-e'))?.getBoundingClientRect().top;
		Object.assign(card.dataset, {from: c1 * 1000 + 1, to: c2 * 1000 + 999, kind: c1 === c2 ? 'chapter' : 'range', hl: `${bookCode(ref.bk)} ${c1}.${ref.from % 1000}`});
		renderCardBar(card);
		fillCard(card).then(() => {
			const vs = card.querySelector('.vs.ctx');
			if (dir < 0 && vs && y !== undefined) (inPopup(card) ? popupBox : window).scrollBy(0, vs.getBoundingClientRect().top - y); // (the popup's box scrolls, not the page)
		});
	}
	// (… in the results: the chapter in the popup, at the verse; in the
	// popup: there, in the card)
	document.addEventListener('click', e => {
		const b = e.target.closest('p-d > .vs-more'), card = b?.parentNode;
		if (!b) return;
		if (inPopup(card)) return wholeChapter(card, +b.dataset.dir);
		const ref = cardRef(card), code = bookCode(ref.bk), c1 = chOf(ref.from), c2 = chOf(ref.to);
		openPopupSearch(`${code} ${c1}-${c2}`, `${code} ${c1}.${ref.from % 1000}`, ownTexts(card));
	});
	const cardBars = () => document.querySelectorAll('#results > p-d > .card-bar, #popupResults > p-d > .card-bar');
	const renderCardBars = () => cardBars().forEach(bar => renderCardBar(bar.parentNode));
	// A heading's buttons (a card's, the Bible bar's)
	document.addEventListener('click', e => {
		const b = e.target.closest('button[data-cb]'), card = b && (b.closest('p-d') || bibleBar);
		if (!b) return;
		if (b.dataset.cb === 'bible') return openBible(card);
		if (b.dataset.cb === 'back') return popupBack();
		popMenu(b, menuHTML([...cardActs(card), foldItem(b)]), a => /fold/.test(a) ? foldAll(b) : cardAct(card, a));
	});
	function cardAct(card, act, go){
		const pop = inPopup(card);
		if (act === 'full' && card.dataset.kind !== 'chapter') { // What the popup has, in the results
			const q = popupQuery;
			closePopup();
			return search(q);
		}
		const ref = cardRef(card), b0 = bookOf(ref.bk), code = bookCode(ref.bk), c = chOf(ref.from);
		if (go) { // The chapter before or after (the popup's, in it)
			const next = b0 && nextChapter(b0, c, +go);
			if (!next) return;
			return pop ? openPopupSearch(chapterRange(next), '', ownTexts(card), card.dataset.pop === 'cmp') : search(next);
		}
		if (act === 'full') { // Its chapter in the results, at its verse
			readHl = card.dataset.hl || `${code} ${c}.${ref.from % 1000}`;
			closePopup();
			query = ''; // (searches again even if it's the chapter showing)
			search(`${code} ${c}.`);
		}
	}
	// The Bible side panel, for a card (panelCard; the Bible bar's: the
	// search's): its translations (a drop-down list, txOpen: the downloaded
	// ones), Apply to all (ticked, a change is every card's and the
	// search's); a chapter's ‹ ›; then the books (its book's chapters: a
	// chapter picked is searched, or a popup's opens there)
	let panelCard = null, txOpen = false;
	const allKey = `peakslab-txall-${appname}`;
	let applyAll = stored(allKey) === true;
	const navCard = () => panelCard?.isConnected ? panelCard : bibleBar;
	function openBible(card){
		if (drawerView === 'bible' && panelCard === card) return closeDrawer();
		panelCard = card;
		booksPick = bookOf(cardRef(card).bk)?.code || null;
		txOpen = booksOpen = false;
		drawerView = null; // (opens it, even from another card's)
		openDrawer('bible');
	}
	// Its translations (a drop-down: their names; its list, each one's
	// name for just it, its box for it too, then Apply to all cards); then
	// ‹ its book › (the book: the books; ‹ ›: the chapter before and after),
	// and the book's chapters (or the books)
	function bibleHTML(){
		const card = navCard(), ref = cardRef(card), b = bookOf(ref.bk), empty = t => `<p class="empty">${t}</p>`;
		const texts = cardTexts(card);
		const all = dictIds.filter(d => isBibleText(d) && downloaded.has(d));
		const c = chOf(ref.from), chapter = ref.kind === 'chapter' && b, now = b ? `${b.code} ${c}.` : '';
		const pick = books?.find(x => x.code === booksPick);
		const go = (dir, label, ic) => `<button class="ch-go" data-go="${dir}" title="${label}" aria-label="${label}"${chapter && nextChapter(b, c, dir) ? '' : ' disabled'}>${ic}</button>`;
		const row = d => `<li class="row cat-row"><button class="cat-chk check" data-tx-add="${d}" aria-pressed="${texts.includes(d)}" aria-label="Also ${escapeHTML(dicts[d].name)}"></button>` +
			`<button class="cat-sel" data-tx="${d}" title="Just this"><span class="row-w">${escapeHTML(dicts[d].name)} ${typeOf(dicts[d])}</span></button></li>`;
		return `<div class="tx-dd"><button class="tx-drop" data-tx-drop="1" aria-haspopup="listbox" aria-expanded="${txOpen}"><span>${escapeHTML(textsLabel(texts))}</span><span class="tx-caret">${chevron}</span></button>` +
			(txOpen ? `<div class="tx-list">${all.length ? `<ul class="rows">${all.map(row).join('')}</ul>` : empty('None downloaded.')}` +
				(card !== bibleBar ? `<ul class="rows tx-all-row">${rowHTML('check', `data-tx-all="1" aria-pressed="${applyAll}"`, 'Apply to all cards', 'And to what\'s searched next')}</ul>` : '') +
				`${moreHTML}</div>` : '') + '</div>' +
			(books ? `<div class="ch-nav">${go(-1, 'Previous chapter', prevSVG)}<button class="bk-btn" data-books-toggle="1" aria-expanded="${booksOpen || !pick}">${pick ? bookName(pick, pick === b && c) : 'Books'}<span class="tx-caret">${chevron}</span></button>${go(1, 'Next chapter', nextSVG)}</div>` : '') +
			booksHTML(now);
	}
	const prevSVG = icon('M15 6l-6 6 6 6'), nextSVG = icon('M9 6l6 6-6 6');
	// The name: just it (the list closes); its box: it too (or not). The
	// card's, or (Apply to all, the Bible bar's) every card's and the search's
	function cardTextsClick({tx, txAdd, txAll}){
		const card = navCard(), d = +(tx ?? txAdd), add = txAdd !== undefined, cur = cardTexts(card);
		const texts = txAll ? cur : add ? (cur.includes(d) ? cur.filter(x => x !== d) : dictIds.filter(x => x === d || cur.includes(x))) : [d];
		if (txAll) store(allKey, applyAll = !applyAll);
		else if (!add) txOpen = false;
		if (texts.length && (applyAll || card === bibleBar)) setAllTexts(texts);
		else if (texts.length && !txAll) setCardTexts(card, texts);
		renderDrawer();
	}
	function setCardTexts(card, texts){
		card.dataset.texts = texts.join();
		renderCardBar(card);
		return fillCard(card);
	}
	function setAllTexts(texts){
		const owned = bibleCards().filter(c => c.dataset.texts);
		owned.forEach(c => { delete c.dataset.texts; });
		setOn(dictIds.filter(isBibleText), d => texts.includes(d));
		owned.forEach(c => { renderCardBar(c); fillCard(c); });
	}
	// The card's verses again, from its translations: a verse's card, their
	// entries for it (its other dictionaries' stay); a chapter's or a
	// range's, all their verses in it (as many as it has)
	const bibleCards = () => [...document.querySelectorAll(':is(#results, #popupResults) > p-d:has(> .card-bar)')];
	function fillCard(card){
		const gen = card._gen = (card._gen || 0) + 1, r = cardRef(card), texts = cardTexts(card), par = texts.length > 1;
		const live = () => card._gen === gen && card.isConnected, t = document.createElement('template');
		card.querySelectorAll(':scope > p-e').forEach(pe => (!pe.dataset.d || isBibleText(+pe.dataset.d) || isNote(+pe.dataset.d)) && pe.remove()); // (its verses and notes are these; a verse's other dictionaries' stay)
		card.classList.toggle('parallel', par);
		t.innerHTML = par || !texts.length ? '<p-e data-id="-1e6"></p-e>' : entryHTML(texts[0]);
		const pe = t.content.firstChild;
		insertSorted(card, pe, +pe.dataset.id); // (between its …s)
		if (!texts.length) return Promise.resolve(pe.insertAdjacentHTML('beforeend', '<p class="empty">No translation ticked.</p>'));
		// Each translation's lines, 100 at a time, in order
		const more = (d, p) => {
			if (p.at > p.last || !live()) return null;
			const n = Math.min(100, p.last - p.at + 1);
			p.at += n;
			return askDict(d, lineMsg(p.at - n, n)).then(res => {
				if (!live()) return;
				res.entries.forEach(e => e && addVerse(e, e.header, d, card));
				return more(d, p);
			});
		};
		// Its notes: the commentaries on (all of them at once)
		card._notes = new Map();
		dictIds.filter(d => libOn[d] && isNote(d)).forEach(d => rangeLines(d, r).then(p => p && askDict(d, lineMsg(p.at, p.last - p.at + 1))).then(res => {
			if (live()) res?.entries.forEach(e => e && addNote(card, d, e));
		}));
		return Promise.all(texts.map(d => rangeLines(d, r).then(p => p && more(d, p))));
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
		const secs = [...new Set(mine.map(f => f[0].split('/')[1]))].filter(c => c !== 'aux');
		return `<ul class="rows">${langRow(`/${curLang}${qs}`, cap(curLang), langCounts[curLang], pParts.length < 2, curLang)}` +
			(secs.length > 1 ? secs.map(c => langRow(`/${curLang}/${c}${qs}`, `${cap(curLang)}: ${catLabel(c)}`, mine.filter(f => f[0].split('/')[1] === c).length, pParts[1] === c, curLang)).join('') : '') + '</ul>' +
			'<h3 class="drawer-h">Other languages</h3>' + langRows(curLang, qs);
	}
	// What the filter (the gloss) has picked, as HTML: All, their names, or
	// with fewer of the ones it has any of left out, All but theirs (short,
	// for the bar: just theirs, struck through)
	function filterLabel(view, short){
		if (!filtered(view)) return 'All';
		const has = cats.filter(c => shown(c, view)), off = has.filter(c => !picks[view].includes(c.id));
		// (by group: a whole one's name, or "Bible: Text, Audio")
		const names = cs => escapeHTML(groups.flatMap(g => (in_ => !in_.length ? [] : g.cats.every(c => in_.includes(c) || !has.includes(c)) ? [g.label] : [`${g.label}: ${in_.map(c => c.short).join(', ')}`])(g.cats.filter(c => cs.includes(c)))).join(' + '));
		return !off.length || off.length >= has.length - off.length ? names(cats.filter(c => picks[view].includes(c.id))) : short ? `<s>${names(off)}</s>` : `All but ${names(off)}`;
	}
	// The bar: the filter's button, with what it searches and how many
	// dictionaries that is (on, in what it has picked), and the gloss's
	const quickIcons = {filter: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>', gloss: '<span aria-hidden="true">⇄</span>'};
	function renderQuick(){
		renderBibleBar();
		const b = Object.keys(VIEWS).map(v => { const text = filterLabel(v), n = dictIds.filter(d => isOn(d, v)).length, all = `${VIEWS[v].title}: ${text}, ${n} ${n === 1 ? 'dictionary' : 'dictionaries'}`;
			return `<button class="qk" data-view="${v}" aria-pressed="${filtered(v)}" title="${all}" aria-label="${all}">${quickIcons[v]}${filterLabel(v, true)}<span class="qk-n" aria-hidden="true">${n}</span></button>`; }).join('');
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
		document.documentElement.style.setProperty('--stick', hide ? '0px' : header.getBoundingClientRect().height + 'px');
	};
	window.addEventListener('scroll', () => {
		const y = window.scrollY;
		if (y > lastY + 6 && y > 80) setHeader(true);
		else if (y < lastY - 6 || y < 40) setHeader(false);
		lastY = y;
	}, {passive: true});
	// The results start below the whole header
	new ResizeObserver(() => {
		document.documentElement.style.setProperty('--hh', header.getBoundingClientRect().height + 'px');
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
		if (drawerView) renderDrawer();
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

	const headwordOf = pd => pd.dataset.q || (pd.querySelector(':scope > h2 .hw')?.textContent || '').trim();
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
	const drawers = {history: ['History', listView], bookmarks: ['Bookmarks', listView], bible: ['Bible', bibleHTML],
		library: ['Library', libraryHTML],
		lang: ['Language', langHTML], first: ['Download dictionaries', firstHTML], about: ['About', () => $('about').innerHTML]};
	function renderDrawer(){
		let v = drawerView, scroll = drawerBody.scrollTop, [title, html] = drawers[v] || [VIEWS[v].title, filterHTML];
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
	// A list's dictionaries, in their order: a category's (its id), or ('')
	// all of them. The filter has just the downloaded ones.
	const listOf = (id, view) => (id ? catById(id).members : dictIds).filter(inView(view));
	// A category the view has any of (the filter: any downloaded)
	const shown = (c, view) => c.members.some(inView(view));
	// A dictionary's name, kind, size (with its state, if any) and description
	const infoHTML = (x, size = x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') =>
		`<span class="lib-name"><span class="row-w">${escapeHTML(x.name)}</span>${typeOf(x)}${size}</span><span class="lib-desc">${x.desc}</span>`;
	// A dictionary's row: its details; in a tick box (check: its
	// attributes), or with the library's button (dl: [state, its
	// data-attribute, what it does]: ⬇, a circle while it downloads, then
	// 🗑), its size under it; then more (✕, ☆, Add)
	const stateOf = d => loading.has(d) ? 'loading' : downloaded.has(d) ? 'got' : 'down';
	function dictRow(x, {check, dl, more = '', star}){
		const info = infoHTML(x, dl ? '' : undefined);
		return `<li class="row dict-row${star ? ' starred' : ''}">` +
			(check ? `<button class="row-main check" ${check}>${info}</button>` : `<div class="row-main">${info}</div>`) +
			(dl ? `<div class="dict-acts"><button class="dict-act ${dl[0]}" ${dl[1]}${dl[0] === 'loading' ? ' disabled' : ''} title="${dl[2]}" aria-label="${dl[2]}: ${escapeHTML(x.name)}">${{down: '⬇', loading: '', got: '🗑'}[dl[0]]}</button>` +
				(x.size ? `<span class="lib-size">${sizeText(x.size)}</span>` : '') + '</div>' : '') + more + '</li>';
	}
	// The page's: in the filter, on or off, and its star (the gloss's: on
	// or off for glosses, no star: they're everything's); in the library,
	// its download, and its star; one added from another language, ✕ too
	// (it comes off the page, its download stays)
	function dictRowHTML(d, view){
		const x = dicts[d], state = stateOf(d), star = isStar(d);
		if (view !== 'library') return dictRow(x, {check: `data-on="${d}" aria-pressed="${onIn(view)(d)}"`, more: view === 'gloss' ? '' : starBtnHTML(d), star});
		return dictRow(x, {dl: [state, `data-${state === 'got' ? 'del' : 'get'}="${d}"`, {down: 'Download', loading: 'Downloading…', got: 'Delete its download'}[state]], star,
			more: (x.added ? `<button class="dict-del" data-unlink="${d}" title="Take it off this page (its download stays)" aria-label="Remove ${escapeHTML(x.name)}">✕</button>` : '') + starBtnHTML(d)});
	}
	function rowsHTML(id, view){
		const ds = listOf(id, view);
		return ds.length ? `<ul class="rows dict-rows">${ds.map(d => dictRowHTML(d, view)).join('')}</ul>` : '<p class="empty">None downloaded.</p>';
	}
	// The groups; opened, their categories (a group of one: its
	// dictionaries), and a category's dictionaries. In the filter and the
	// gloss each is ticked (a group: all its categories, or some: mixed) and
	// its name picks just it; in the library its name opens it.
	function catsHTML(view){
		if (!choice) return rowsHTML('', view);
		const isIn = c => !picks[view]?.length || picks[view].includes(c.id); // (the library: no ticks)
		const item = (id, label, cs, body) => {
			const members = cs.flatMap(c => c.members), n = cs.filter(isIn).length, btn = (act, attrs, html) => `<button data-cat="${id}" data-act="${act}" ${attrs}>${html}</button>`;
			return groupHTML(`${view}:${id}`, view !== 'library' ?
				btn('sel', `class="cat-chk check" aria-pressed="${n === cs.length ? true : n ? 'mixed' : false}" aria-label="${VIEWS[view].title}: ${escapeHTML(label)}"`, '') +
				btn('only', 'class="cat-sel" title="Just this"', wordsHTML(escapeHTML(label), catCount({members}, view))) :
				groupHead(`${view}:${id}`, label, catCount({members}, view)), body);
		};
		const group = g => (cs => cs.length > 1 ? item(g.id + '/', g.label, cs, () => `<ul class="rows cats subcats">${cs.map(c => item(c.id, c.short, [c], () => rowsHTML(c.id, view))).join('')}</ul>`) :
			item(cs[0].id, g.label, cs, () => rowsHTML(cs[0].id, view)))(g.cats.filter(c => shown(c, view)));
		return `<ul class="rows cats">${groups.filter(g => g.cats.some(c => shown(c, view))).map(group).join('')}</ul>`;
	}
	// The filter (view 'filter') and the gloss's (view 'gloss'): All (every category ticked), then the categories, with
	// their downloaded dictionaries; untick any to search (or gloss) with
	// just the rest, or tap one's name for just it
	// The gloss's rows: each one's category (or off) and language, of the
	// ones its downloaded dictionaries have
	const pickHTML = (i, k, cur, opts) => `<select data-row="${i}" data-k="${k}" aria-label="Row ${i + 1}: ${k === 'cat' ? 'category' : 'language'}">` +
		opts.map(([v, t]) => `<option value="${escapeHTML(v)}"${v === cur ? ' selected' : ''}>${escapeHTML(t)}</option>`).join('') + '</select>';
	function glossRowsHTML(){
		const ls = [...new Set([...got().flatMap(d => langsOf(dicts[d])), ...allDicts.filter(isAligned).map(x => langsOf(x)[0])].filter(Boolean))].sort(); // (and every aligned one's: picked, it's added)
		return '<div class="gloss-rows">' + glossRows.map((r, i) => `<div><span>${i + 1}</span>` +
			pickHTML(i, 'cat', r ? r.cat || '' : '-', [['-', 'Off'], ['', 'Any category'], ...groups.flatMap(g => (cs => cs.length > 1 ? [[g.id + '/', g.label], ...cs.map(c => [c.id, `${g.label}: ${c.short}`])] : cs.map(c => [c.id, g.label]))(g.cats.filter(c => shown(c, 'gloss'))))]) +
			(r ? pickHTML(i, 'lang', r.lang || '', [['', 'Any language'], ...ls.map(l => [l, cap(l)])]) : '') + '</div>').join('') + '</div>';
	}
	function filterHTML(view){
		return (view === 'gloss' ? glossRowsHTML() : '') + levelHTML(onLevel(view)) +
			(choice ? `<ul class="rows">${rowHTML('radio', `data-all="1" aria-pressed="${!filtered(view)}"`, 'All', catCount({members: dictIds}, view))}</ul>` : '') +
			catsHTML(view) +
			`<p class="empty">Tick as many as you like, or tap a name for just it: ${VIEWS[view].uses} use their dictionaries that are on${view === 'gloss' ? ' here (just for glosses and popups: searches don\'t change). 1, 2, 3: what each row of a word\'s box has; a language\'s words by sense give its words for another\'s senses.' : ' Star a dictionary (☆) for its entries to come first.'}</p>` + moreHTML;
	}
	const renderLibrary = () => { if (drawerView === 'library') renderDrawer(); };
	// The library (the menu's, a drawer): every dictionary on the
	// page, by category; then other languages' to add; then the settings
	// (dark mode, highlighting, text size) and the version
	function libraryHTML(){
		const byLang = new Map();
		allDicts.filter(x => !dictIds.some(d => dicts[d] === x)).forEach(x => push(byLang, x.lang, x));
		const lang = ([l, xs]) => groupHTML(`lang:${l}`, groupHead(`lang:${l}`, cap(l), `${xs.length} ${xs.length === 1 ? 'dictionary' : 'dictionaries'}`),
			() => `<ul class="rows dict-rows">${xs.map(x => dictRow(x, {dl: cachedPaths.has(x.path) && ['got', `data-delpath="${escapeHTML(x.path)}"`, 'Delete its download'], more: addBtn(x)})).join('')}</ul>`);
		const addBtn = x => `<button class="text-btn" data-add="${escapeHTML(x.path)}">Add</button>`;
		const here = sizeOf(dictIds.filter(d => downloaded.has(d) && dicts[d].lang === curLang)); // (not other languages')
		return '<p class="lib-help"><button class="text-btn" data-first="again">Download the suggested dictionaries…</button></p>' +
			`<p class="lib-space">Space used: ${sizeText(here)} for ${escapeHTML(cap(curLang) || 'this page')}${usage ? ` · ${sizeText(usage)} for all of PeakSlab` : ''} <button class="text-btn" data-first="delete">Delete everything…</button></p>` +
			catsHTML('library') +
			(byLang.size ? `<ul class="rows cats">${groupHTML('library:langs', groupHead('library:langs', 'Other languages', `${byLang.size} languages: add their dictionaries`),
				() => `<ul class="rows cats">${[...byLang].sort(([a], [b]) => a.localeCompare(b)).map(lang).join('')}</ul>`)}</ul>` : '') +
			`<details class="lib-ver"><summary>Version ${escapeHTML($('version').textContent)} and loading times</summary><div>${$('timing').innerHTML}</div></details>`;
	}
	// The first time (nothing saved): which to download. A slider picks how
	// many: Bare (priority 1), Recommended (and 0), Extra (and 2, -1), Max
	// (and 3, -2); its dictionaries are listed, ticked, by category (the
	// aux folder's each under its own: Audio, Images), to untick any, and
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
			firstListHTML() +
			'<p class="empty">Or <button class="text-btn" data-first="custom">choose my own in the library</button></p>';
	}
	// The level's dictionaries and Download
	function firstListHTML(){
		let prev = null, html = '';
		// (by folder, as the filter has them: another language's at the bottom of its)
		const label = d => dicts[d].cat === 'aux' ? cap(dicts[d].name) : catLabel(dicts[d].folder);
		const labels = [...new Set(dictIds.map(label))];
		const ids = notGot().sort((a, b) => labels.indexOf(label(a)) - labels.indexOf(label(b)) || dicts[b].primary - dicts[a].primary || a - b);
		ids.forEach(d => {
			const l = label(d);
			if (l !== prev) html += `${prev === null ? '' : '</ul>'}<h4 class="cat-subh">${escapeHTML(l)}</h4><ul class="rows dict-rows">`;
			prev = l;
			html += dictRow(dicts[d], {check: `data-pick="${d}" aria-pressed="${firstPick.has(d)}"`});
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
	// Let go at level n: the prompt lists the level's dictionaries; the
	// filter (the gloss: on for glosses) has, of the downloaded ones (it
	// downloads none), the level's on, the rest off. Its level: the first
	// whose are just the ones on (none: -1)
	const got = () => dictIds.filter(d => downloaded.has(d));
	const onLevel = view => LEVELS.findIndex((_, n) => got().every(d => onIn(view)(d) === levelOf(dicts[d]) <= n));
	function pickLevel(n){
		if (drawerView === 'first') return setLevel(n), renderDrawer();
		const view = drawerView === 'gloss' ? 'gloss' : 'filter';
		(view === 'gloss' ? setGlossOn : setOn)(got(), d => levelOf(dicts[d]) <= n);
	}
	drawerBody.addEventListener('change', e => {
		const {row, k} = e.target.dataset, v = e.target.value;
		if (e.target.matches('.first-level input')) pickLevel(+v);
		else if (row) { // A gloss's row
			glossRows[row] = v === '-' ? null : {...glossRows[row], [k]: v};
			store(rowsKey, glossRows);
			rowOn(glossRows[row] || {});
			renderDrawer();
			regloss();
		}
	});
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
		if (VIEWS[drawerView] || drawerView === 'bible') renderDrawer();
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
		cats.filter(c => c.members.includes(d)).forEach(c => expandedCats.add(`library:${c.id}`).add(`library:${c.group.id}/`));
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
	const offDict = d => libOn[d] ? setOn([d], false) : loaded.has(d) && unloadDict(d);
	async function deleteDict(d){
		const x = dicts[d];
		offDict(d);
		for (const [c, r, path] of await cachedDicts()) if (path === x.path) await c.delete(r);
		downloaded.delete(d);
		refreshUsage();
		renderLists();
	}
	// An added one taken off the page, turned off; its download stays (its
	// number stays, unused)
	function unlinkDict(d){
		const x = dicts[d];
		offDict(d);
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

	// The buttons in the drawers
	function rowClick(e){
		const b = e.target.closest('button');
		if (!b) return;
		const {book, all, q, rm, w, clear, open, act, on, get, del, delpath, unlink, add, exp, library, pick, level, first, tx, txAdd, txAll, txDrop, go} = b.dataset;
		const drawerBooks = drawerView === 'bible';
		if (tx !== undefined || txAdd !== undefined || txAll) return cardTextsClick(b.dataset); // (a card's translations)
		if (txDrop) {
			txOpen = !txOpen;
			return renderDrawer();
		}
		if (go) {
			closeDrawer();
			return cardAct(navCard(), '', +go); // (the card it's for: a popup's, the popup's chapter, even with Apply to all)
		}
		const view = VIEWS[drawerView] ? drawerView : 'filter'; // (whose categories)
		if (pick) { // The first time's choices
			if (!firstPick.delete(+pick)) firstPick.add(+pick);
			renderDrawer();
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
		else if (on) {
			if (drawerView === 'gloss') setGlossOn([+on], !glossOn(+on));
			else setOn([+on], !libOn[+on]);
		} else if (book) {
			booksPick = book;
			booksOpen = false;
			renderDrawer();
		} else if (b.dataset.booksToggle) {
			booksOpen = !booksOpen;
			renderDrawer();
		} else if (all) {
			setFilter(view, []);
		} else if (act) { // A category's, or a group's (its categories): ticked, all of them; unticked, none (All: all but them)
			const has = cats.filter(c => shown(c, view)).map(c => c.id), ids = under(b.dataset.cat).map(c => c.id).filter(id => has.includes(id)), s = filtered(view) ? picks[view] : has;
			if (act === 'sel') return setFilter(view, ids.every(id => s.includes(id)) ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])]);
			if (act === 'only') return setFilter(view, ids);
		} else if (q !== undefined) {
			closeDrawer();
			const pc = navCard();
			if (drawerBooks && inPopup(pc) && chapterRef(q)) openPopupSearch(chapterRange(q), '', ownTexts(pc), pc.dataset.pop === 'cmp');
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
	// (the translations' list open: a tap anywhere else in the panel closes it)
	drawerBody.addEventListener('click', e => {
		if (txOpen && drawerView === 'bible' && !e.target.closest('.tx-dd')) {
			txOpen = false;
			renderDrawer();
		}
	});

	updateFilterUI();

	ack = url => { // In the offline cache
		const d = dicts.findIndex(x => x.path === url);
		if (d >= 0 && !downloaded.has(d)) { downloaded.add(d); renderListsSoon(); }
	};

	// Loads the dictionaries a search uses (on, and in the filter) and any asked
	// for (a gloss's, a recording's voice, ...: askDict loads them when they're
	// needed); the ones that are off go
	function applyOn(){
		dicts.forEach((_, d) => searched(d) || asked.has(d) ? loadDict(d) : !libOn[d] && loaded.has(d) && unloadDict(d));
		renderQuick();
	}

	// Turns these dictionaries on or off (on: true, false, or one for each),
	// and searches again if what's searched changed (one still loading
	// searches again once it's loaded)
	function setOn(ds, on){
		const was = searchMask();
		ds.forEach(d => {
			libOn[d] = each(on, d);
			if (!libOn[d]) asked.delete(d); // (not kept loaded)
		});
		saveState();
		applyOn();
		ds.forEach(d => libOn[d] && loadDict(d)); // (turned on: downloaded now, whatever the filter has)
		renderLists();
		renderBibleBar();
		const off = ds.filter(d => !libOn[d]);
		if (ds.some(d => isBibleText(d) || isNote(d))) bibleCards().forEach(c => {
			const own = ownTexts(c), keep = own?.filter(d => !off.includes(d)); // (a card's own translations, without those)
			if (own ? keep.length === own.length && !ds.some(isNote) : !inPopup(c) && !off.length) return;
			if (own) {
				keep.length ? c.dataset.texts = keep.join() : delete c.dataset.texts;
				renderCardBar(c);
			}
			fillCard(c);
		});
		// What's on the screen of the ones turned off (a search again wouldn't
		// reach a popup, or anything if none's left): gone, a card left with nothing too
		off.forEach(d => document.querySelectorAll(`p-d:not(.chapter) p-e[data-d="${d}"]`).forEach(pe => {
			const card = pe.closest('p-d');
			pe.remove();
			if (!card.querySelector('p-e')) card.remove();
		}));
		if (ds.some(d => was[d] !== searched(d) && (!searched(d) || loaded.has(d)))) searchAgain();
	}

	// Turns these on or off for glosses only (the gloss's drawer; on: true,
	// false, or one for each, as setOn's)
	function setGlossOn(ds, on){
		ds.forEach(d => { glossSet[dicts[d].path] = each(on, d); });
		if (!solo.length) store(glossKey, glossSet);
		renderLists();
		renderQuick();
		regloss();
	}

	// A row picked turns on for glosses what it takes: the page's
	// dictionaries in its category and language, and the aligned ones in
	// the page's language and in its (another language's added; an aligned
	// one not downloaded turned on: it downloads), their categories picked too
	function rowOn({cat, lang}){
		if (!cat && !lang) return;
		const want = x => !lang || langsOf(x).includes(lang) || isAligned(x) && langsOf(x)[0] === curLang;
		const xs = allDicts.filter(x => (!cat || under(cat).some(c => c.id === catId(x))) && (dicts.includes(x) ? want(x) : isAligned(x) && lang && langsOf(x)[0] === lang));
		xs.forEach(x => dicts.includes(x) || addDict(x.path));
		const ds = xs.map(x => dicts.indexOf(x));
		setGlossOn(ds, true);
		setOn(ds.filter(d => isAligned(dicts[d]) && !libOn[d] && !downloaded.has(d)), true);
		if (filtered('gloss')) setFilter('gloss', [...new Set([...picks.gloss, ...ds.map(catOf)])]);
	}

	// Changes what the filter (or the gloss) has picked
	function setFilter(view, ids){
		let s = ids.filter(catById);
		if (cats.every(c => s.includes(c.id) || !shown(c, view))) s = []; // Every one (it has any of): All
		picks[view] = s;
		store(VIEWS[view].key, s);
		updateFilterUI();
		VIEWS[view].changed();
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
		if (filtered()) p.set('mode', groups.flatMap(g => (cs => cs.length && cs.every(c => picks.filter.includes(c.id)) ? [g.cats.length > 1 && catById(g.id) ? g.id + '/' : g.id] : cs.filter(c => picks.filter.includes(c.id)).map(c => c.id))(g.cats.filter(c => shown(c, 'filter')))).join()); // (a whole group: its id)
		if (queryText) p.set('text', queryText);
		const qs = p.toString();
		history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
	}

	// How many there are, in the header's second line: results loaded, or
	// words glossed (what, its title); none searched, nothing
	function updateStatus(n, what = ''){
		countSpan.textContent = n;
		countSpan.title = what && `${n} ${what}`;
	}



	function updateStarUI(){
		document.querySelectorAll('[data-d] > p-h').forEach(h => { h.outerHTML = entryHeadHTML(+h.parentNode.dataset.d); });
		renderLists();
	}


	// What the popup shows (its ⤢ searches it in the results): what the
	// gloss has, its Bible texts too; a range, its card
	// (Compare's: the verse in every one the gloss has, its bars blue)
	let popupQuery = '';
	let popupHl = ''; // The verse a chapter in it is for (a Bible card's Popup)
	// (a range: its card's translations, texts; cmp: Compare's)
	const openPopupSearch = (text, hl, texts, cmp) => popupGo(() => popupSearch(text, hl, texts, cmp));
	// What the popup's shown since it opened: each a way to show it again,
	// and where it was scrolled to; popupY: where to go back to, once it's
	// there (results come in a few at a time)
	// (its ‹: only with somewhere to go back to)
	let popupPast = [], popupNow = null, popupY = 0;
	const setPast = past => popupResults.classList.toggle('has-past', !!(popupPast = past).length);
	function popupGo(show){
		if (popupShown() && popupNow) setPast([...popupPast, {show: popupNow, y: popupBox.scrollTop}]);
		popupNow = show;
		popupY = 0;
		show();
	}
	function popupBack(){
		const last = popupPast.at(-1);
		if (!last) return closePopup();
		setPast(popupPast.slice(0, -1));
		popupNow = last.show;
		popupY = last.y;
		last.show();
	}
	function popupSearch(text, hl = '', texts = null, cmp = false){
		popupHl = hl;
		popupQuery = text;
		cleanup(popupResults);
		popupBox.scrollTop = 0;
		popupResults.classList.remove('collapsed');
		const q = updateQuery(text), mask = glossMask();
		if (hasBible && rangeOf(q)) return popupRange(text, texts, cmp);
		const go = m => forWorkers(m, (w, code) => [1, 2].forEach(st => w.postMessage({type: "tempsearch", st, query: q, dest: "popup", dicts: code})));
		go(mask);
		// The gloss's that aren't loaded (off on the page): once they are
		mask.forEach((on, d) => on && !loaded.has(d) && ensureLoaded(d, () => popupQuery === text && go(dicts.map((_, i) => i === d))));
	}
	function popupScroll(){
		if (!popupY) return;
		popupBox.scrollTop = popupY;
		if (popupBox.scrollTop >= popupY - 1) popupY = 0;
	}
	// The sheet: where it's at (px down from the top; open, it's part of the
	// way up), and the timer of its closing (sliding down)
	let sheetY = 0, popupClosing = 0;
	const popupShown = () => popupOverlay.style.display === 'block' && !popupClosing;
	const sheetPart = () => Math.round(popupSheet.offsetHeight * .4);
	const sheetTo = y => popupSheet.style.setProperty('--sheet-y', `${sheetY = Math.max(0, y)}px`);
	function popupOpen(){
		const was = popupShown();
		clearTimeout(popupClosing);
		popupClosing = 0;
		popupOverlay.style.display = 'block';
		document.body.classList.add('no-scroll');
		if (!was) {
			popupSheet.style.setProperty('--sheet-y', '100%');
			popupSheet.getBoundingClientRect(); // (from below the screen)
			sheetTo(sheetPart());
			popupOverlay.classList.add('open');
		}
		popupScroll();
		setTimeout(() => document.addEventListener('click', closePopupClick)); // A click outside closes it (after the click that opened it, if one did)
	}
	function closePopupClick(e){
		if (!e.composedPath().some(n => n.matches?.('#popupSheet, #controls, #drawer, #ctxMenu'))) closePopup(); // (its buttons below, and the drawer it opens, are usable; by where it was tapped: what's tapped may be gone by now)
	}
	function closePopup(){
		document.removeEventListener('click', closePopupClick);
		setPast([]);
		popupNow = null;
		document.body.classList.remove('no-scroll');
		popupOverlay.classList.remove('open');
		popupSheet.style.setProperty('--sheet-y', '100%');
		clearTimeout(popupClosing);
		popupClosing = setTimeout(() => {
			popupClosing = 0;
			cleanup(popupResults);
			popupOverlay.style.display = 'none';
		}, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300);
	}
	// Dragging it: its grip any way (a tap: all the way up, or back); its text
	// any way while it isn't all the way up (up past the top, it scrolls it),
	// and down while it's scrolled to its top: decided at the first move, so
	// the page's own scrolling never starts with it. Let go, it goes to the nearest of the top, part of
	// the way, and closed (a flick goes on in its direction)
	let drag = null;
	function dragStart(y, grip){
		if (document.body.classList.contains('fullscreen')) return;
		drag = {y0: y, s0: sheetY, grip, on: grip, last: y, t: performance.now(), v: 0, moved: false};
		if (grip) popupSheet.classList.add('drag');
	}
	function dragMove(y, e){
		if (!drag) return;
		if (!drag.on) {
			if (y === drag.y0) return;
			if (!(sheetY > 0 || y > drag.y0 && popupBox.scrollTop <= 0)) return void (drag = null);
			Object.assign(drag, {on: true, sc: popupBox.scrollTop});
			popupSheet.classList.add('drag');
		}
		if (e.cancelable) e.preventDefault();
		const now = performance.now();
		drag.v = (y - drag.last) / Math.max(1, now - drag.t);
		drag.moved ||= Math.abs(y - drag.y0) > 4;
		drag.last = y;
		drag.t = now;
		const want = drag.s0 + y - drag.y0;
		sheetTo(want);
		if (want < 0 && !drag.grip) popupBox.scrollTop = drag.sc - want; // (all the way up: on, it scrolls)
	}
	function dragEnd(){
		const d = drag;
		drag = null;
		if (!d?.on) return;
		popupSheet.classList.remove('drag');
		const part = sheetPart(), h = popupSheet.offsetHeight;
		if (d.grip && !d.moved) return sheetTo(sheetY ? 0 : part);
		const y = sheetY + Math.max(-150, Math.min(150, d.v * 150));
		if (y > part + (h - part) / 2) return closePopup();
		sheetTo(y < part / 2 ? 0 : part);
	}
	const grip = $('popupGrip');
	grip.addEventListener('pointerdown', e => { grip.setPointerCapture(e.pointerId); dragStart(e.clientY, true); });
	grip.addEventListener('pointermove', e => dragMove(e.clientY, e));
	grip.addEventListener('pointerup', dragEnd);
	grip.addEventListener('pointercancel', dragEnd);
	popupBox.addEventListener('touchstart', e => e.touches.length === 1 ? dragStart(e.touches[0].clientY, false) : (drag = null), {passive: true});
	popupBox.addEventListener('touchmove', e => dragMove(e.touches[0].clientY, e), {passive: false});
	popupBox.addEventListener('touchend', dragEnd);
	popupBox.addEventListener('touchcancel', dragEnd);
	popupBox.addEventListener('wheel', e => { if (sheetY > 0 && e.deltaY > 0 && !document.body.classList.contains('fullscreen')) { e.preventDefault(); sheetTo(0); } }, {passive: false}); // (a mouse: scrolling down, it goes all the way up first)
	// A tap outside it, or Escape, closes it (and dragging it down)
	document.addEventListener('keydown', e => { if (e.key === 'Escape' && popupShown() && !drawerView && !ctx) closePopup(); }, true); // (before the drawer's and the context menu's: what's over it goes first)

	function nextst(){
		const i = STAGES.indexOf(st);
		if (i < 0 || i == STAGES.length - 1) return false;
		st = STAGES[i + 1];
		return true;
	}

	// What's searched for: lower case, no zero width spaces, \t a tab
	const updateQuery = (text = queryText) => text ? text.toLowerCase().replaceAll("​", "").replaceAll("\\t", "\t") : null;

	// Nothing searched: nothing showing
	function showNothing(){
		loader = null;
		updateStatus('');
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
			applyWiktPairs();
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
		if(query && loader && loader.getBoundingClientRect().top <= window.innerHeight + 400 && worker_code.includes(false))
			getResults();
	}
	// (once a frame, after the scroll: a fast one's end is never missed)
	let checking = false;
	const scrollCheck = () => checking || (checking = requestAnimationFrame(() => { checking = false; loadmore(); }));
	window.addEventListener('scroll', scrollCheck, {passive: true});
	window.addEventListener('resize', scrollCheck);

	const globreg = /[!+*^@]/;

	// Glosses use the dictionaries that are on (a link's: just its) in the
	// categories the gloss has picked, each word's box with a row for each
	// row's (glossRows). The ones first win a word: starred (in the order
	// starred), then by priority (0, 1, 2, 3, ..., then -1, -2, ...: rank),
	// then the dictionaries' order
	const glossIds = () => dictIds.filter(d => isOn(d, 'gloss'))
		.sort((a, b) => isStar(a) || isStar(b) ? sortId(a) - sortId(b) : rank(dicts[a].priority) - rank(dicts[b].priority) || a - b); // (starred first)
	const glossMask = () => dicts.map((_, d) => isOn(d, 'gloss'));
	const names = ids => ids.map(d => escapeHTML(dicts[d].name)).join(' + ');

	// The gloss's dictionaries changed: the glosses showing again, with
	// them (none: they go), and the popup's (its search's)
	const regloss = debounce(() => {
		const ids = glossIds();
		if (translationDiv.childElementCount) ids.length ? translate() : translationDiv.replaceChildren();
		document.querySelectorAll('.tr-entry').forEach(box => !ids.length ? box.remove() :
			box.dataset.text !== undefined && glossInto(box.parentNode, box.dataset.text, ids, true));
		if (popupShown() && !rangeOf(updateQuery(popupQuery))) popupSearch(popupQuery, popupHl);
	}, 300);
	// The query word by word, when the search found nothing (a Bible text's
	// headwords are its verses, so "rom 8.1 gal 1.1" links to each)
	function translate(){
		const q = query; // (with search symbols too: "!" may be just an exclamation mark)
		const ids = glossIds();
		if (ids.length) translateText(ids, queryText, pieces => showTranslation(pieces, q, ids));
	}

	function showTranslation(pieces, q, ids){
		if (q !== query || num || !pieces.some(p => p.ds.length)) return;
		const div = document.createElement('p-d');
		div.className = 'translation';
		fillGloss(div, pieces, ids, queryText, n => headHTML(n, false));
		translationDiv.replaceChildren(div);
		updateStatus(pieces.filter(p => p.ds.length).length, 'words glossed');
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
	// An entry's text, without its labels (p-n: parts of speech, ...)
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
	// (matched in lower case; its words and the text between them shown as
	// typed, unless lower case changes its length)
	function translateText(ids, typed, done){
		typed = typed.replace(/[​⁠­﻿]/g, ''); // Invisible formatting: the dictionaries say where words break
		const text = typed.toLowerCase();
		Promise.all([...ids.map((d, k) => askDict(d, {type: 'matchall', query: text}).then(r => r.matches
			.filter(([a]) => !/\s/.test(text[a])) // A word doesn't start with the space before it (a second index word can)
			.map(([a, len, m, ix, sec]) => ({a, len, m, ix, sec, d, rank: k})))), rangeMatches(ids, text)])
			.then(all => pickPieces(all.flat(), typed.length === text.length ? typed : text, ids, done));
	}
	// The Bible ranges in a text ("rom 1.4-20", "Romans 8:28-30"): a word
	// each (first: before its parts), its gloss the start of its verses, in a
	// Bible text that glosses; tapped, the popup has
	// them all (popupRange)
	// (a book's name up to four words: "Song of Songs 2:1-3"; any digits)
	const RANGES = /(^|[^\p{L}\p{N}])((?:[\p{L}\p{M}\p{Nd}]+ ){0,3}(?:\p{Nd} ?)?\p{L}[\p{L}\p{M}]*\.? ?\p{Nd}+(?:[.:]\p{Nd}+)? ?[-–] ?(?:\p{Nd}+[.:])?\p{Nd}+)(?!\p{N})/gu;
	function rangeMatches(ids, text){
		const d = ids.find(isBibleText);
		// (the words before it may be a book's name or not: "see Romans
		// 8:28-30", "2 rom 9.1-8" are Romans 8:28-30 and rom 9.1-8 too, without
		// the first words; the whole text's split picks, the longest that's a book)
		const found = d === undefined ? [] : [...text.matchAll(RANGES)].flatMap(m => {
			const vs = [m[2]];
			while (/^\S+ ./.test(vs.at(-1))) vs.push(vs.at(-1).replace(/^\S+ /, ''));
			return vs.filter(s => /^(\p{Nd} ?)?\p{L}/u.test(s)).map(s => ({a: m.index + m[1].length + m[2].length - s.length, s, r: rangeOf(s)}));
		}).filter(x => x.r);
		if (!found.length) return [];
		return Promise.all(found.map(x => rangeLines(d, x.r).then(p => p && askDict(d, lineMsg(p.at, Math.min(20, p.last - p.at + 1))).then(res => ({
			a: x.a, len: x.s.length, d, rank: -1, sec: 0,
			r: {header: x.s, body: res.entries.filter(Boolean).map(e => textOf(e.body)).join(' ')}, // (rendered already)
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

	// Each word's rows: in each, the entry for exactly it from the row's
	// first dictionary that has it (glossIds' order: starred first, then by
	// priority; a headword over a second index word), as the popup has it;
	// else its parts' entries, if they make it all up. Not from auxiliary
	// ones (audio, pictures, word counts): they split the text too, and add
	// their files (addMedia), but have no gloss to give (music's details do)
	const glosses = d => dicts[d].type !== 'aux';
	const render = (d, xs) => askDict(d, {type: 'renderlines', lines: xs.map(x => [x.m, x.ix])}).then(r => xs.forEach((x, i) => { x.r = r.entries[i]; }));
	const renderAll = xs => { const by = new Map(); xs.forEach(x => x.r || push(by, x.d, x)); return Promise.all([...by].map(([d, xs]) => render(d, xs))); }; // (a range's is rendered)
	// The rows' languages' words for the aligned ones' keys matched
	// (x.via[lang]: [its words, the dictionary]): the entry for the key in
	// that language's aligned one in the same category
	function senseWords(xs, ids){
		const ts = ids.filter(t => isAligned(dicts[t]) && glossRows.some(r => r?.lang === outLang({d: t})));
		const ss = xs.filter(x => isAligned(dicts[x.d]) && x.sec);
		if (!ts.length || !ss.length) return Promise.resolve();
		return renderAll(ss).then(() => Promise.all(ts.map(t => {
			const heads = [...new Set(ss.map(x => x.r?.header.toLowerCase()).filter(Boolean))], at = new Map();
			heads.reduce((a, h) => (at.set(a, h), a + h.length + 1), 0);
			return askDict(t, {type: 'matchall', query: heads.join('\n')}).then(r => {
				const ys = r.matches.filter(([a, len, , , sec]) => !sec && at.get(a)?.length === len).map(([a, , m, ix]) => ({d: t, m, ix, h: at.get(a)}));
				return render(t, ys).then(() => ys.forEach(y => y.r && ss.forEach(x => {
					if (x.r?.header.toLowerCase() === y.h && catOf(x.d) === catOf(t)) (x.via ||= {})[outLang({d: t})] ||= [textLines(y.r.body.replace(/<p-(n|ipa)>[^]*?<\/p-\1>/g, '')).filter(Boolean).join(', '), t];
				})));
			});
		})));
	}
	function pickPieces(matches, text, ids, done){
		const pieces = splitText(matches, text, 0, text.length);
		pieces.forEach(p => { p.xs = p.w ? matches.filter(x => x.a >= p.a && x.a + x.len <= p.b && glosses(x.d)).sort((x, y) => x.rank - y.rank || x.sec - y.sec) : []; });
		// (a piece's entries in ys: the one for all of it, else its parts', if they make it all up)
		const cover = (p, ys) => { const x = ys.find(x => x.a === p.a && x.len === p.b - p.a), parts = x ? [{w: x}] : splitText(ys, text, p.a, p.b); return parts.every(q => q.w) ? parts.map(q => q.w) : []; };
		senseWords(pieces.flatMap(p => p.xs), ids).then(() => pieces.forEach(p => {
			const xs = p.xs;
			xs.forEach(x => { x.row = glossRows.findIndex(r => fits(r, x)); });
			p.rows = glossRows.map((row, r) => cover(p, xs.filter(x => x.row === r || viaOf(row, x))));
		})).then(() => renderAll(pieces.flatMap(p => p.rows.flat()))).then(() => done(pieces.map(p => {
			const gs = p.rows.map((xs, r) => xs.map(x => x.r && glossOf(x, text.slice(x.a, x.a + x.len), glossRows[r])).filter(Boolean)); // (a media file with no details has no text)
			// (each media dictionary's files for it, like a row: its own, else its parts' (a compound's recordings, one after another))
			const media = !p.w ? [] : ids.filter(d => dicts[d].media).map(d => [d, cover(p, matches.filter(x => x.d === d && x.a >= p.a && x.a + x.len <= p.b)).map(x => text.slice(x.a, x.a + x.len))]).filter(([, ws]) => ws.length);
			const ds = p.rows.flatMap((xs, r) => xs.flatMap(x => [x.d, viaOf(glossRows[r], x)?.[1]])).filter(d => d !== undefined).concat(media.map(([d]) => d));
			return {text: text.slice(p.a, p.b), d: p.w?.d, rows: gs.map(g => g.join(' ')), media, ds: [...new Set(ds)]}; // ds: the dictionaries in its rows, and its media's
		})));
	}

	// Each word in a box, with its rows under it, each an entry in a line
	// (a second index match is a word in an entry, so the entry's headword
	// says what it means, unless it's in the same script: then the word is
	// the entry's other spelling); tapping the word shows what the popup
	// search finds for it
	const script = t => (t.match(/\p{L}/u)?.[0] ?? ' ').codePointAt(0) >> 7; // (its Unicode block, roughly)
	// (in a row's language, that language's: its words for a sense)
	const glossOf = (x, word, row) => viaOf(row, x)?.[0] ?? (x.sec && (row.lang || script(x.r.header) !== script(word)) ? x.r.header : summary(x.r.body, x.r.header));
	function translationHTML(pieces){
		return pieces.map(p => {
			if (!p.ds.length) return escapeHTML(p.text).replace(/\n/g, '<br>'); // Nothing to gloss it with: as it is (notes between the words glossed)
			const w = escapeHTML(p.text.trim());
			return `<span class="tr-w" data-w="${w}" title="${names(p.ds)}"><p-a>${w}</p-a>` +
				p.rows.map((t, i) => t ? `<span class="tr-r tr-r${i + 1}" title="${escapeHTML(t)}">${escapeHTML(t)}</span>` : '').join('') + '</span>';
		}).join('');
	}

	// The media dictionaries' files for the words (loading them; a
	// compound's, its parts', p.media): a recording, a 🔊 in the word's box
	// that plays it (no player), a compound's its parts' one after another; a
	// picture (of all of it, not a part's), under it. Each dictionary with the
	// word is a voice: the one 🔊 goes through them a tap at a time, by priority
	const AUDIO = /webm|ogg|opus|mp3|wav|m4a|codec2|c2|tnefar/i;
	function addMedia(box, pieces){
		const by = new Map(); // (a dictionary's: word -> its files' words)
		pieces.forEach(p => p.media.forEach(([d, ws]) => (by.get(d) ?? by.set(d, new Map()).get(d)).set(p.text.trim(), ws)));
		by.forEach((of, d) => {
			const words = [...new Set([...of.values()].flat())];
			askDict(d, {type: 'media', words}).then(r => of.forEach((ws, word) => {
				const fs = ws.map(w => r.files[words.indexOf(w)]);
				if (!fs.every(f => f?.[1]) || !AUDIO.test(fs[0][0]) && fs.length > 1) return;
				if (!box.dataset.ds.split(',').includes(String(d))) box.dataset.ds += `,${d}`;
				const bs = box.querySelectorAll(`.tr-w[data-w="${CSS.escape(word)}"]`), [type, bytes] = fs[0];
				if (!AUDIO.test(type)) return bs.forEach(w => { if (!w.querySelector('.tr-img')) w.appendChild(mediaElement(type, bytes, word)).classList.add('tr-img'); });
				bs.forEach(w => {
					const b = w.querySelector('.tr-play') ?? Object.assign(w.appendChild(soundButton(fs, d)), {className: 'sound tr-play', voices: [], turn: 0});
					b.voices.push(...(fs.length === 1 ? r.all[words.indexOf(ws[0])].map(f => [[f], d]) : [[fs, d]]));
					if (b.voices.some(v => v[0].length === 1)) b.voices = b.voices.filter(v => v[0].length === 1); // (one's parts one after another: only if none has the word itself)
					b.voices.sort((x, y) => rank(dicts[x[1]].priority) - rank(dicts[y[1]].priority));
					if (b.voices.length > 1) b.dataset.n = b.voices.length; else delete b.dataset.n;
					if (!b.turn) voiced(b, b.voices[0][1], b.voices[0][0][0][2]);
				});
				if (bs.length && TNEFAR.test(type) && !box.querySelector('.speed')) { // (one for all: before the words, after the heading)
					const b = speedButton(), head = [...box.children].filter(c => c.matches('h2, .tr-head')).pop();
					b.classList.add('tr-speed');
					head ? head.after(b) : box.prepend(b);
				}
			}));
		});
	}
	const soundError = b => e => { b.firstChild.data = '⚠'; b.title = `Can't play it here: ${e.message}`; };
	window.playWord = b => {
		if (b.voices && !(tnefarOn?.button === b && tnefarOn.live())) voiced(b, (b.sound = b.voices[b.turn++ % b.voices.length])[1], b.sound[0][0][2]); // (playing: it pauses)
		soundPlay(...b.sound, b, b.at || b.from, b.to, () => {
			b.at = 0;
			if (b.loop) return playWord(b);
			if (b.reader?.on === 'play') wordTaps(b, false);
		}).catch(soundError(b));
	};

	// The gloss of an entry's (or verse's) text, or some of it: above the
	// text (after the entry's name and buttons), so a long one doesn't push
	// it out of view
	function glossInto(pe, text, ids, again = false){
		if (!ids.length) return;
		pe.querySelector(':scope > .tr-entry')?.remove();
		const box = document.createElement('div');
		box.className = 'tr-entry';
		const text1 = [...pe.childNodes].find(n => n.nodeType === 1 ? !n.matches('p-h, button, .menu') : n.textContent.trim());
		pe.insertBefore(box, text1 || null);
		if (!again) box.scrollIntoView({block: 'nearest'});
		box.textContent = `Glossing with ${ids.map(d => dicts[d].name).join(' + ')}…`;
		translateText(ids, text, pieces => {
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
		box.innerHTML = head(names(ds)) + (pieces.some(p => p.ds.length) ? translationHTML(pieces) : 'No words found.');
		addMedia(box, pieces);
	}

	// ---------------------------------------------------------------
	// Sharing a card (a word's, a chapter's, a gloss; the context menu's
	// Share): its text copied, or a link to it that has just the
	// dictionaries in it (?dict=, see solo: they download without asking)
	// ---------------------------------------------------------------
	const visible = el => el.checkVisibility?.() ?? true; // (not a hidden dictionary's)
	// (a word glossed: it · its rows; text between: as it is)
	const glossText = box => [...box.childNodes].map(n => n.matches?.('.tr-w') ? [n.querySelector('p-a'), ...n.querySelectorAll('.tr-r')].map(x => x.textContent.trim()).join(' · ') : n.matches?.('h2, .tr-head, .speed') ? '' : n.textContent.trim()).filter(Boolean).join('\n');
	function cardText(card){
		if (card.dataset.ds !== undefined) return `${card.dataset.text}\n\n${glossText(card)}`;
		const pes = [...card.querySelectorAll(':scope > p-e')].filter(visible);
		return card.matches('.chapter') ? pes.map(entryText).join('\n\n') :
			[headwordOf(card), ...pes.map(pe => `${dicts[pe.dataset.d].name}\n${entryText(pe)}`)].join('\n\n');
	}
	function cardLink(card){
		const gloss = card.dataset.ds !== undefined;
		const ds = gloss ? card.dataset.ds.split(',').filter(Boolean) : [...card.querySelectorAll('p-e[data-d], .pv-t[data-d], .vs-note[data-d]')].filter(visible).map(x => x.dataset.d);
		const p = new URLSearchParams({text: gloss ? card.dataset.text : headwordOf(card)});
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
		const q0 = updateQuery();
		if (hasBible && !books && /\s\p{Nd}+$/u.test(q0)) return loadBooks(startSearch); // (it may be a chapter: "gen 1")
		query = asChapter(q0);
		renderQuick();
		if(!query){
			hideRefresh();
			showNothing();
			return;
		}
		historyTimer();
		if(chapterOf(readHl) !== query)
			readHl = '';
		if(query == prevquery){
			return;
		}
		hideRefresh(); // (this search has every dictionary that's loaded)
		closeCtx();
		[resultsDiv, translationDiv].forEach(x => x.classList.remove('collapsed'));
		translationDiv.replaceChildren();
		window.scrollTo(0, 0);
		updateStatus(0, 'results loaded');
		queryInput.classList.add("error");
		const ref = hasBible && searchRef();
		if (ref) bibleSearch(ref, runSearch);
		else runSearch();
	}
	function runSearch(){
		worker_code.fill(false);
		st = globreg.test(query) ? 0 : STAGES[0];
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
	document.body.classList.toggle('no-mark', stored('mark') === false);
	// A setting changed (the library's, the context menu's Appearance)
	function setPref(p){
		if (p === 'smaller' || p === 'bigger') setFont(fontSize + (p === 'bigger' ? 2 : -2));
		else if (p === 'dark') store('darkMode', document.body.classList.toggle('dark-mode'));
		else if (p === 'mark') store('mark', !document.body.classList.toggle('no-mark'));
	}

	// The library: a drawer
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
	const ICONS = {
		gloss: icon('M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4'),
		search: icon('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21'),
		popup: popupSVG,
		speak: icon('M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
		share: icon('M12 15V3M7 8l5-5 5 5M5 12v8h14v-8'),
		copy: icon('M9 9h11v11H9zM5 15H4V4h11v1'),
		link: icon('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'),
		back: backSVG,
		hide: icon('M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a14 14 0 0 1-3 4.2M6.5 6.6A14 14 0 0 0 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 5.3-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'),
		bookmark: icon('M6 3h12v18l-6-4.5L6 21z'),
		compare: icon('M12 6C10 4.5 7 4 3 4v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2zM12 6v14'),
		look: icon('M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5zM7.5 12.5v.01M10 8v.01M14.5 8v.01M17 11.5v.01'),
		smaller: '<span class="ctx-glyph" aria-hidden="true">A−</span>',
		bigger: '<span class="ctx-glyph" aria-hidden="true">A+</span>',
		dark: icon('M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'),
		mark: icon('M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'),
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
		if (tnefarOn?.live() && tnefarCtx.state === 'running') { // (it pauses for a menu; its 🔊 goes on)
			tnefarCtx.suspend();
			tnefarShow(tnefarOn.button, false);
		}
		ctx = c;
		if (!c.sel) c.el.classList.add('ctx-on');
		renderCtx();
		ctxMenu.hidden = false;
		if (c.chapter) { // (by its button)
			const r = c.el.getBoundingClientRect(), w = ctxMenu.offsetWidth;
			ctxMenu.style.cssText = `top:${r.bottom + 6}px;bottom:auto;left:${Math.max(8, Math.min(r.right, innerWidth - 8) - w)}px;right:auto;transform:none`;
		}
		document.body.classList.add('ctx-open'); // (hides the round buttons it would cover)
	}
	function closeCtx(){
		clearTimeout(ctxTimer);
		ctx?.el?.classList.remove('ctx-on');
		ctx = null;
		ctxMenu.hidden = true;
		ctxMenu.style.cssText = '';
		document.body.classList.remove('ctx-open');
	}
	// Its text: what's selected, a gloss's text, or the entry's
	const ctxText = () => ctx.sel || ctx.el.dataset.text || entryText(ctx.el);
	const isGloss = el => el.matches('.tr-entry, p-d.translation');
	// A Bible verse's reference, to Compare it (the popup: every Bible text the gloss has)
	const compareOf = () => !ctx.sel && ctx.el.closest('.vs')?.dataset.h;
	// What Bookmark is for: what's selected, a verse, or a word's card (not a gloss, or a chapter)
	const bmTarget = () => ctx.sel || (ctx.el.matches('.vs') ? ctx.el.dataset.h : !isGloss(ctx.el) && headwordOf(ctx.el.closest('p-d')));
	const linkTo = (text, ds = []) => location.origin + location.pathname + '?' + new URLSearchParams(ds.length ? {text, dict: ds.map(d => dicts[d].name).join()} : {text});
	// What Share has: [label, copy or link, its text or link]
	function shares(){
		const {el, sel} = ctx;
		if (sel) return [['Copy', 'copy', sel], ['Link', 'link', linkTo(sel)]];
		const card = el.closest('.tr-entry, p-d'), all = [['Copy', 'copy', cardText(card)], ['Link', 'link', cardLink(card)]];
		const h = el.matches('.vs') && el.dataset.h;
		if (!h) return all;
		const d = +el.closest('[data-d]').dataset.d, t = document.createElement('template');
		t.innerHTML = refLabel(verseRef(h));
		return [['Copy verse', 'copy', `${t.content.textContent} (${dicts[d].name})\n${entryText(el)}`], ['Verse link', 'link', linkTo(h, [d])],
			['Copy all', 'copy', all[0][2]], ['Link to all', 'link', all[1][2]]];
	}
	function renderCtx(){
		const {el, sel, sub} = ctx;
		let html;
		if (ctx.chapter) html = ctxBtn('rew', 'Rewind', '', '<b>⏪&#xFE0E;</b>') + ctxBtn('play', 'Play', '', '<b>▶&#xFE0E;</b>') + ctxBtn('ffw', 'Forward', '', '<b>⏩&#xFE0E;</b>') +
			ctxBtn('loop', 'Loop', `aria-pressed="${!!el.loop}"`, '<b>🔁&#xFE0E;</b>') + ctxBtn('speed', 'Speed', '', `<b>${soundSpeed}×</b>`) +
			(el.reader ? ctxBtn('words', 'Play word', `aria-pressed="${el.reader.on === 'words'}"`, ICONS.speak) : '');
		else if (sub === 'speak') html = ctxBtn('back', 'Back') + voiceLangs().map(x => ctxBtn('say', x.name, `data-lang="${x.val}"`,
			abbr[x.name.toLowerCase()]?.[3] ? `<span class="ctx-flag" aria-hidden="true">${abbr[x.name.toLowerCase()][3]}</span>` : ICONS.speak)).join('');
		else if (sub === 'look') html = ctxBtn('back', 'Back') + ctxBtn('smaller', 'Smaller') + ctxBtn('bigger', 'Bigger') +
			ctxBtn('dark', document.body.classList.contains('dark-mode') ? 'Light mode' : 'Dark mode') +
			ctxBtn('mark', 'Highlight', `aria-pressed="${!document.body.classList.contains('no-mark')}"`);
		else if (sub === 'share') html = ctxBtn('back', 'Back') + (ctx.shares ??= shares()).map(([label, kind], i) => ctxBtn(kind, label, `data-i="${i}"`)).join('');
		else {
			const gloss = el && !isGloss(el), glossed = gloss && !sel && el.querySelector(':scope > .tr-entry'), w = bmTarget();
			html = (el?.matches('.tr-entry') || glossed ? ctxBtn('hide', 'Hide gloss') : gloss ? ctxBtn('gloss', 'Gloss') : '') +
				(sel ? ctxBtn('search', 'Search') + ctxBtn('popup', 'Popup') : '') +
				(compareOf() ? ctxBtn('compare', 'Compare') : '') +
				(w && !sel ? ctxBtn('bookmark', isBookmarked(w) ? 'Bookmarked' : 'Bookmark', `aria-pressed="${isBookmarked(w)}"`) : '') +
				(voiceLangs().length ? ctxBtn('speak', 'Speak') : '') + (sel ? '' : ctxBtn('share', 'Share')) + ctxBtn('look', 'Appearance');
		}
		ctxMenu.innerHTML = `<div class="ctx-row">${html}</div>`;
	}
	// Done (copied, ...): said for a moment, then it closes
	function ctxDone(msg){
		ctxMenu.innerHTML = `<div class="ctx-row ctx-said" role="status">${escapeHTML(msg)}</div>`;
		ctxTimer = setTimeout(closeCtx, 1200);
	}
	const SUBS = new Set(['speak', 'share', 'look', 'back']), PREFS = new Set(['smaller', 'bigger', 'dark', 'mark']); // (menus in it; settings: it stays open)
	ctxMenu.addEventListener('click', async e => {
		e.stopPropagation(); // (a popup's entry: keeps the popup open)
		const b = e.target.closest('button');
		if (!b || !ctx) return;
		const {el, sel} = ctx, act = b.dataset.c, h = compareOf(); // (before it closes)
		if (ctx.chapter) { // (Rewind, Forward: 10 s, and it's left open to go further; Loop: on or off, Speed: the next, left open)
			if (act === 'rew' || act === 'ffw') return skip(el, act === 'rew' ? -1000 : 1000);
			if (act === 'loop') { el.loop = !el.loop; return renderCtx(); }
			if (act === 'speed') { nextSpeed(); return renderCtx(); }
			closeCtx();
			wordTaps(el, act);
			return act === 'play' && playWord(el);
		}
		// A menu in it (Back: out of it), or what stays open (tap again for more, or to undo)
		if (SUBS.has(act)) ctx.sub = act === 'back' ? null : act;
		else if (PREFS.has(act)) setPref(act);
		else if (act === 'bookmark') toggleBookmark(bmTarget(), sel ? null : el.closest('.vs') || el.closest('p-d')?.querySelector(':scope > p-e'));
		if (SUBS.has(act) || PREFS.has(act) || act === 'bookmark') return renderCtx();
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
		else if (act === 'compare') openPopupSearch(`${h}-${h.split('.').pop()}`, '', dictIds.filter(d => isBibleText(d) && isOn(d, 'gloss')), true); // (the verse, in every Bible text the gloss has)
	});
	document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctx) closeCtx(); });
	// A tap on an entry's text (not on a word that looks itself up, a
	// button, a link, ...): its menu; anywhere else, closed
	document.addEventListener('click', e => {
		if (getSelection().toString().trim()) return; // (the selection's)
		const t = e.target;
		const el = !t.closest('a, button, input, textarea, select, audio, video, [role="button"], p-a, p-w, .tr-w, .menu, p-d > h2, .reading .w, .reading .vs-n') &&
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
