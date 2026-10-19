"use strict";

// Startup is done here, off the page's main thread: as soon as this worker
// starts it reads peak.wasm (and later each dictionary) straight from the
// offline cache (Cache Storage). Only when the cache has no current copy
// does it ask the page, which fetches through the service worker (which
// downloads and caches it).
const origin = self.location.origin + '/';
async function fromCache(path, minTimestamp) {
	try {
		const hit = await caches.match(new URL(path, origin));
		if (hit && parseInt(hit.headers.get('x-peak-timestamp') || '0', 10) >= minTimestamp) {
			return await hit.arrayBuffer();
		}
	} catch (e) { /* no Cache API here */ }
	return null;
}
// Bytes the page sends when asked ('needwasm' / 'needbytes').
const fromPage = {};
function askPage(key, msg) {
	return new Promise(resolve => { fromPage[key] = resolve; self.postMessage(msg); });
}

// Start reading + compiling peak.wasm now; its timestamp is checked once
// the page sends the expected one with 'init'.
const cachedWasm = (async () => {
	try {
		const hit = await caches.match(new URL('peak.wasm', origin));
		if (!hit) return null;
		const ts = parseInt(hit.headers.get('x-peak-timestamp') || '0', 10);
		return { ts, module: await WebAssembly.compile(await hit.arrayBuffer()) };
	} catch (e) { return null; }
})();
// Everything peak() below uses. A cached peak.wasm missing some of these is
// an old build saved under a newer timestamp (downloaded while a deploy was
// still reaching the CDN): drop it everywhere so a fresh copy gets fetched.
const wasmExports = ['malloc', 'free', 'load_peak', 'free_peak', 'peak_init', 'init_search', 'continue_search', 'get_result', 'switchstate', 'match_at', 'last_match', 'last_index', 'render_match', 'head_at'];
function hasExports(module) {
	const have = WebAssembly.Module.exports(module).map(x => x.name);
	return wasmExports.every(name => have.includes(name));
}
async function dropCached(path) {
	try {
		for (const name of await caches.keys())
			await (await caches.open(name)).delete(new URL(path, origin));
	} catch (e) { /* no Cache API here */ }
}
let wasmModuleResolve = null;
const wasmModulePromise = new Promise(resolve => { wasmModuleResolve = resolve; });

let id = 0;
let dicts = []
let adicts = []
let query = ''
let cdic = 0;
let st = 0;
let order = []; // Dictionaries in the order searched: the starred ones first
let gen = 0; // Which search this is; the page drops results from older ones

function searchOrder(stars){
	const first = (Array.isArray(stars) ? stars : [stars]).filter(f => f >= 0 && f < dicts.length);
	order = [...first, ...Array.from({length: dicts.length}, (_, i) => i).filter(i => !first.includes(i))];
}


self.onmessage = async (e) => {
	//console.log(e.data);
	if(e.data.type == "init"){
		id = e.data.id;
		const c = await cachedWasm;
		const current = c && c.ts >= e.data.wasmTimestamp;
		if (current && !hasExports(c.module))
			await dropCached('peak.wasm');
		wasmModuleResolve(current && hasExports(c.module)
			? c.module
			: await askPage('wasm', {type: 'needwasm', id}));
	}else if(e.data.type == "wasm"){
		fromPage.wasm(e.data.wasm);
	}else if(e.data.type == "bytes"){
		fromPage['bytes' + e.data.did](e.data.buf);
	}else if(e.data.type == "load"){
		if(!dicts[e.data.did]){
			dicts[e.data.did] = new Dic(e.data.msg[0], e.data.msg[1], e.data.msg[2], e.data.did, e.data.timestamp);
		}
	}else if(e.data.type == "destroy"){
		if(dicts[e.data.did]){
			console.log(`Destroyed! ${dicts[e.data.did].name}`);
			dicts[e.data.did].destroy();
			dicts[e.data.did] = null;
		}
	}
	else if(e.data.type == "setquery"){
		query = e.data.query;
		dicts.forEach((d) => {
			if(d && d.module){
				d.setQuery(d.fitQuery(query)); // A long text is searched by its start (translation gets all of it)
			}
		});
	}
	else if(e.data.type == "initsearch"){
		cdic = 0;
		st = e.data.st;
		adicts = e.data.dicts;
		gen = e.data.gen;
		searchOrder(e.data.focus);
		dicts.forEach((d) => { // Yes, we have to reset all the dictionaries because the results build up.
			if(d && d.module){
				d.module._init_search(e.data.st, 1);
			}
		});
	}
	else if(e.data.type == "continuesearch"){
		cdic = 0;
		st = e.data.st;
		searchOrder(e.data.focus);
		adicts.forEach((val, i) => {
			if(val){
				if(dicts[i] && dicts[i].module){
					dicts[i].module._continue_search(e.data.st);
				}
			}
		});
	}else if(e.data.type == "tempsearch"){
		//w.postMessage({type: "tempsearch", st: 2, query: text, dest: "popup", dicts: dicts});
		e.data.dicts.forEach((val, i) => {
			if(val){
				let d = dicts[i];
				if(d && d.module){
					d.switchState(); // Make sure that you always switch it back.
					d.setQuery(e.data.query);
					d.module._init_search(e.data.st, 0);
					while(d.getResult(e.data.dest == "popup" ? 1 : 0) != -1){
						if(!d.slab)
							self.postMessage({type: "result", id: id, did: i, dict: d.name, query: e.data.query, st: e.data.st, header: d.getHeader(),  body: d.getBodyStr(), dest: e.data.dest, gen: e.data.gen});
						else{
							let header = d.getHeader().split('\t');
							const filetype = header[header.length-1];
							let subheader = header.slice(1, -1);
							header = header[0];
							self.postMessage({type: "result", id: id, did: i, query: e.data.query, dict: d.name, st: e.data.st, header: header, subheader: subheader, filetype: filetype, body: d.getBytes()?.slice(), dest: e.data.dest, gen: e.data.gen}); // (slice: just the file, not all of the wasm memory)
						}
					}
					d.switchState(); // Switched it back :D
				}
			}
		});
	}else if(e.data.type == "media"){
		// A media dictionary's file for each word (exactly it), or null:
		// [filetype, bytes]
		const d = dicts[e.data.did];
		const files = e.data.words.map(w => {
			if(!d || !d.module || !d.slab) return null;
			d.switchState();
			d.setQuery(w);
			d.module._init_search(1, 0);
			const f = d.getResult(1) > 0 ? [d.getHeader().split('\t').pop(), d.getBytes()?.slice()] : null; // (a copy: the next search overwrites it)
			d.switchState();
			return f;
		});
		self.postMessage({type: "rendered", id: id, did: e.data.did, tag: e.data.tag, files: files});
	}else if(e.data.type == "matchall"){
		// For translating with several dictionaries at once: this one's
		// headwords at each place in the text, every length (second index
		// words where no headword starts), as [start, length, match, index,
		// second] in UTF-16 offsets, like the page's strings. The page picks
		// between the dictionaries, then asks for the entries (renderlines).
		const d = dicts[e.data.did];
		const matches = [];
		const bytes = new TextEncoder().encode(e.data.query);
		if(d && d.module && bytes.length){
			const tptr = d.module._malloc(bytes.length + 1);
			d.module.HEAPU8.set(bytes, tptr);
			d.module.HEAPU8[tptr + bytes.length] = 0;
			// Each byte offset's UTF-16 offset
			const u16 = new Uint32Array(bytes.length + 1);
			let b = 0, u = 0;
			for(const ch of e.data.query){
				const cp = ch.codePointAt(0);
				u16[b] = u;
				b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
				u += ch.length;
			}
			u16[bytes.length] = u;
			for(let p = 0; p < bytes.length; ++p){
				if((bytes[p] & 0xC0) === 0x80) continue; // Inside a character
				for(const second of [0, 1]){
					const n = matches.length;
					for(let k = d.module._match_at(tptr, bytes.length, p, 0, second); k > 0; k = k > 1 ? d.module._match_at(tptr, bytes.length, p, k - 1, second) : 0)
						matches.push([u16[p], u16[p + k] - u16[p], d.module._last_match(), d.module._last_index(), second]);
					if(matches.length > n) break;
				}
			}
			d.module._free(tptr);
		}
		self.postMessage({type: "matches", id: id, did: e.data.did, tag: e.data.tag, matches: matches});
	}else if(e.data.type == "heads"){
		// Every headword, in the file's order
		const d = dicts[e.data.did];
		const heads = [];
		if(d && d.module)
			for(let i = 0, n; (n = d.module._head_at(i)) >= 0; ++i)
				heads.push(d.module.UTF8ToString(d.rptr, n));
		self.postMessage({type: "rendered", id: id, did: e.data.did, tag: e.data.tag, heads: heads});
	}else if(e.data.type == "renderlines"){
		const d = dicts[e.data.did];
		const entries = (e.data.lines || []).map(([m, index]) => {
			const n = d && d.module ? d.module._render_match(m, index) : -1;
			if(n <= 0) return null;
			const entry = d.module.UTF8ToString(d.rptr, n);
			const tab = entry.indexOf('\t');
			return {header: entry.slice(0, tab).trim(), body: entry.slice(tab + 1)};
		});
		self.postMessage({type: "rendered", id: id, did: e.data.did, tag: e.data.tag, entries: entries});
	}else if(e.data.type == "getresults"){
		let num = 0;
		while(num == 0){
			const c = order[cdic];
			if(adicts[c] && dicts[c] && dicts[c].getResult() > 0){
				//console.log("give!");
				if(!dicts[c].slab){
					self.postMessage({type: "result", id: id, did: c, dict: dicts[c].name, query: query, st: st, header: dicts[c].getHeader(), body: dicts[c].getBodyStr(), gen: gen});
				}else{
					let header = dicts[c].getHeader().split('\t');
					const filetype = header[header.length-1];
					let subheader = header.slice(1, -1);
					header = header[0];
					//header = header.substring(0, header.indexOf(9));
					self.postMessage({type: "result", id: id, did: c, dict: dicts[c].name, query: query, header: header, subheader: subheader, st: st, filetype: filetype, body: dicts[c].getBytes()?.slice(), gen: gen}); // (just the file)
				}
				++num;
			}
			else{
				cdic++;
				if(cdic >= order.length){
					self.postMessage({type: "nomore", id: id, st: st, gen: gen});
					break;
				}
			}
		}
	}
}

async function peak(wasmModule){
	const requiredImports = WebAssembly.Module.imports(wasmModule);
	const instance = await WebAssembly.instantiate(wasmModule, {env: {emscripten_notify_memory_growth: () => {}}});
	const exp = instance.exports;
	const mem = exp.memory;
	if (!exp.memory) {
			throw new Error("peak.wasm didn't export memory");
	}
 
	const decoder = new TextDecoder();
 
	return {
		_malloc:          exp.malloc,
		_free:            exp.free,
		_load_peak:       exp.load_peak,
		_free_peak:       exp.free_peak,
		_peak_init:       exp.peak_init,
		_init_search:     exp.init_search,
		_continue_search: exp.continue_search,
		_get_result:      exp.get_result,
		_switchstate:     exp.switchstate,
		_match_at:        exp.match_at,
		_last_match:      exp.last_match,
		_last_index:      exp.last_index,
		_render_match:    exp.render_match,
		_head_at:         exp.head_at,
 
		get HEAPU8() { return new Uint8Array(mem.buffer); },
 
		UTF8ToString(ptr, len) {
			const buf = new Uint8Array(mem.buffer);
			if (len === undefined) {
				let end = ptr;
				while (buf[end] !== 0) end++;
				len = end - ptr;
			}
			return decoder.decode(buf.subarray(ptr, ptr + len));
		},
	};
}

class Dic{
	constructor(filename, name, bufsize, did, timestamp){
		this.filename = filename;
		this.timestamp = timestamp || 0; // from files.json: the cached copy must be at least this new
		this.name = name;
		this.did = did;
		this.bufmax = bufsize + 1024;
		this.qmax = 512;
		this.qptr = null;
		this.qptr2 = null;
		this.qptrc = null;
		this.rptr = null;
		this.rmax = this.bufmax - this.qmax*2
		this.module = null;
    this.loadtime = null;           // cache the first load time
		this.slab = filename.includes(".slab");
		this.init();
	}
	destroy(){
		this.module._free_peak();
	}
	async readBytes(){
		const buf = await fromCache(this.filename, this.timestamp);
		if (buf) return buf;
		// Not cached yet or outdated: the page fetches it through the service worker.
		const sent = await askPage('bytes' + this.did, {type: 'needbytes', id, did: this.did});
		if (sent) return sent;
		// Last resort (page fetch failed): try directly.
		const resp = await fetch(new URL(this.filename, origin));
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		return resp.arrayBuffer();
	}
	async init() {
		try{
			// Start reading the bytes right away, in parallel with setting up
			// the wasm instance.
			const bytes = this.readBytes();
			const wasmBinary = await wasmModulePromise;
      this.module = await peak(wasmBinary);
			const buf = await bytes;
			const start = performance.now();

			// Send the database to the module
			const srcPtr = this.module._malloc(buf.byteLength);
			//console.log(`[${this.name}] file=${buf.byteLength} bytes, malloc ptr=${srcPtr}, memsize=${this.module.HEAPU8.byteLength}`);
			if (srcPtr === 0) {
					throw new Error(`[${this.name}] malloc returned NULL for ${buf.byteLength} bytes!`);
			}
			this.module.HEAPU8.set(new Uint8Array(buf), srcPtr);
			//console.log(`[${this.name}] set done, memsize now=${this.module.HEAPU8.byteLength}`);

			let compressed = this.filename.includes(".zst");
			const loadRet = this.module._load_peak(srcPtr, buf.byteLength, compressed);
			//console.log(`[${this.name}] _load_peak returned: ${loadRet}`);
			//console.log(`load_peak returned: ${loadRet}`);
			if(compressed)
				this.module._free(srcPtr);
			const end = performance.now();

			if (loadRet !== 0) {
				throw new Error(`Load failed with code: ${loadRet}`);
			}
	// Allocate in WASM linear memory — never freed
			this.qptr  = this.module._malloc(this.bufmax);
			this.qptr2  = this.qptr + this.qmax;
			this.qptrc = this.qptr;
			this.rptr = this.qptr2 + this.qmax;

			const initRet = this.module._peak_init(this.qptr, this.qmax, this.qptr2, this.qmax, this.rptr, this.rmax);
			//console.log(`${this.filename} peak_init returned: ${initRet}`);
			this.loadtime = Math.round(end - start);
			//timingDiv.innerHTML += `${this.filename} ${this.loadtime}ms<br>`;
			self.postMessage({type: "loaded", id: id, did: this.did, msg: `${this.name} ${this.loadtime}ms`})
			/*this.setQuery("ghost");
			this.module._init_search(0);
			while(this.getResult() > 0){
				self.postMessage({type: "result", msg: this.getStr()});
			}*/
		}
		catch(err){
			console.error(err);
		}
	}
	setQuery(query){
		if (!this.qptrc) return; // still loading: no query buffer yet (would write at address 0)
		const encoder = new TextEncoder();
		const bytes = encoder.encode(query + '\0');
		if (bytes.length > this.qmax) throw new Error("Query too long");
		this.module.HEAPU8.set(bytes, this.qptrc);
	}
	// Cut a query to what fits in the query buffer, on a character boundary.
	fitQuery(query){
		const bytes = new TextEncoder().encode(query);
		if (bytes.length < this.qmax) return query;
		let end = this.qmax - 1;
		while (end > 0 && (bytes[end] & 0xC0) == 0x80) --end;
		return new TextDecoder().decode(bytes.subarray(0, end));
	}
	switchState(){
		this.qptrc = this.qptrc == this.qptr ? this.qptr2 : this.qptr;
		this.module._switchstate();
	}
	getResult(skip = 0){
		if(!this.module || this.loadtime === null)
			return -1;
		this._tabPos = -1;
		this.rlen = this.module._get_result(skip);
		return this.rlen;
	}
	getStr(){
		if(this.rlen <= 0)
			return null;
		return this.module.UTF8ToString(this.rptr, this.rlen);
	}
	getBodyStr(){
		if(this.rlen <= 0)
			return null;
		if (this._tabPos === -1)
			this._computeTabPos();
		if (this._tabPos === -1 || this._tabPos >= this.rlen)
			return null;
		return this.module.UTF8ToString(this.rptr + this._tabPos+1, this.rlen - this._tabPos-1);
	}
	_computeTabPos() {
		const arr = new Uint8Array(this.module.HEAPU8.buffer, this.rptr, this.rlen);
		this._tabPos = arr.indexOf(this.slab ? 0 : 9); // 9 = ASCII/UTF-8 for '\t'
		if (this._tabPos === -1)
			this._tabPos = this.rlen;              // no tab → headword = whole buffer
	}
	getHeader(){
		if (this._tabPos === -1)
			this._computeTabPos();

		// UTF8ToString only on the headword part (no full-string decode)
		return this.module.UTF8ToString(this.rptr, this._tabPos).trim(); // The trimming should be done in the wasm instead, but this is a workaround for now
	}
	getBytes(){
		if(this.rlen <= 0)
			return null;
		if (this._tabPos === -1)
			this._computeTabPos();
		if (this._tabPos === -1 || this._tabPos >= this.rlen)
			return null;
		return new Uint8Array(this.module.HEAPU8.buffer, this.rptr + this._tabPos+1, this.rlen - this._tabPos-1);
	}
}
