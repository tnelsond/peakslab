"use strict";

// Startup is done here, off the page's main thread: as soon as this worker
// starts it reads peak.wasm (and later each dictionary) straight from the
// offline cache (Cache Storage). Only when the cache has no current copy
// does it ask the page, which fetches through the service worker (which
// downloads and caches it).
const origin = self.location.origin + '/';
const cached = async path => { try { return await caches.match(new URL(path, origin)); } catch (e) { return null; } }; // (no Cache API here)
const tsOf = r => +(r.headers.get('x-peak-timestamp') || 0);
// Bytes the page sends when asked ('needwasm' / 'needbytes')
const fromPage = {};
const askPage = (key, msg) => new Promise(resolve => { fromPage[key] = resolve; self.postMessage(msg); });

// Start reading + compiling peak.wasm now; its timestamp is checked once
// the page sends the expected one with 'init'.
const cachedWasm = cached('peak.wasm').then(async r => r && {ts: tsOf(r), module: await WebAssembly.compile(await r.arrayBuffer())}).catch(() => null);
// Everything used below. A cached peak.wasm missing some of these is an old
// build saved under a newer timestamp (downloaded while a deploy was still
// reaching the CDN): drop it everywhere so a fresh copy gets fetched.
const wasmExports = ['memory', 'malloc', 'free', 'load_peak', 'free_peak', 'peak_init', 'init_search', 'continue_search', 'get_result', 'switchstate', 'match_at', 'last_match', 'last_index', 'render_match', 'head_at'];
const hasExports = m => { const have = WebAssembly.Module.exports(m).map(x => x.name); return wasmExports.every(n => have.includes(n)); };
let wasmModuleResolve;
const wasmModule = new Promise(resolve => { wasmModuleResolve = resolve; });

let id = 0;
const dicts = [];
let adicts = []; // Which are searched
let query = '';
let cdic = 0; // The one in order whose results are next
let st = 0;
let order = []; // Dictionaries in the order searched: the starred ones first
let gen = 0; // Which search this is; the page drops results from older ones

// A result as a message: text, or a media file (its header's tabs are the
// name, its details and its filetype)
function result(d, did, extra){
	const msg = {type: 'result', id, did, dict: d.name, header: d.getHeader(), ...extra};
	if (!d.slab) return {...msg, body: d.getBody()};
	const h = msg.header.split('\t');
	return {...msg, header: h[0], subheader: h.slice(1, -1), filetype: h.at(-1), body: d.getBytes()?.slice()}; // (slice: just the file, not all of the wasm memory)
}
const loaded = d => d?.x;

self.onmessage = async ({data}) => {
	const d = dicts[data.did];
	switch (data.type) {
	case 'init': {
		id = data.id;
		const c = await cachedWasm;
		const current = c && c.ts >= data.wasmTimestamp;
		if (current && !hasExports(c.module))
			try { for (const name of await caches.keys()) await (await caches.open(name)).delete(new URL('peak.wasm', origin)); } catch (e) { /* no Cache API here */ }
		wasmModuleResolve(current && hasExports(c.module) ? c.module : await askPage('wasm', {type: 'needwasm', id}));
		break;
	}
	case 'wasm': fromPage.wasm(data.wasm); break;
	case 'bytes': fromPage['bytes' + data.did](data.buf); break;
	case 'load':
		if (!d) dicts[data.did] = new Dic(...data.msg, data.did, data.timestamp);
		break;
	case 'destroy':
		if (d) {
			d.x?.free_peak(); // (still loading: nothing to free yet)
			dicts[data.did] = null;
		}
		break;
	case 'setquery':
		query = data.query;
		dicts.forEach(d => loaded(d) && d.setQuery(d.fitQuery(query))); // A long text is searched by its start (translation gets all of it)
		break;
	case 'initsearch':
		adicts = data.dicts;
		gen = data.gen;
		// fallthrough
	case 'continuesearch':
		cdic = 0;
		st = data.st;
		{
			const first = [].concat(data.focus).filter(f => f >= 0 && f < dicts.length);
			order = [...first, ...dicts.keys()].filter((x, i, a) => a.indexOf(x) === i);
		}
		// A new search resets every dictionary (the results build up)
		dicts.forEach((d, i) => loaded(d) && (data.type === 'initsearch' ? d.x.init_search(st, 1) : adicts[i] && d.x.continue_search(st)));
		break;
	case 'tempsearch': // Another search, without losing this one's place (the popup, a section's other entries)
		data.dicts.forEach((on, i) => {
			const d = dicts[i];
			if (!on || !loaded(d)) return;
			d.switchState();
			d.setQuery(data.query);
			d.x.init_search(data.st, 0);
			while (d.getResult(data.dest == 'popup' ? 1 : 0) != -1)
				self.postMessage(result(d, i, {query: data.query, st: data.st, dest: data.dest, gen: data.gen}));
			d.switchState();
		});
		break;
	case 'media': // A media dictionary's file for each word (exactly it), or null: [filetype, bytes]
		self.postMessage({type: 'rendered', id, did: data.did, tag: data.tag, files: data.words.map(w => {
			if (!loaded(d) || !d.slab) return null;
			d.switchState();
			d.setQuery(w);
			d.x.init_search(1, 0);
			const f = d.getResult(1) > 0 ? [d.getHeader().split('\t').pop(), d.getBytes()?.slice()] : null; // (a copy: the next search overwrites it)
			d.switchState();
			return f;
		})});
		break;
	case 'matchall': {
		// For translating with several dictionaries at once: this one's
		// headwords at each place in the text, every length (second index
		// words where no headword starts), as [start, length, match, index,
		// second] in UTF-16 offsets, like the page's strings. The page picks
		// between the dictionaries, then asks for the entries (renderlines).
		const matches = [];
		const bytes = new TextEncoder().encode(data.query);
		if (loaded(d) && bytes.length) {
			const x = d.x, t = x.malloc(bytes.length + 1);
			const heap = new Uint8Array(x.memory.buffer);
			heap.set(bytes, t);
			heap[t + bytes.length] = 0;
			// Each byte offset's UTF-16 offset
			const u16 = new Uint32Array(bytes.length + 1);
			let b = 0, u = 0;
			for (const ch of data.query) {
				const cp = ch.codePointAt(0);
				u16[b] = u;
				b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
				u += ch.length;
			}
			u16[bytes.length] = u;
			for (let p = 0; p < bytes.length; ++p) {
				if ((bytes[p] & 0xC0) === 0x80) continue; // Inside a character
				for (const second of [0, 1]) {
					const n = matches.length;
					for (let k = x.match_at(t, bytes.length, p, 0, second); k > 0; k = k > 1 ? x.match_at(t, bytes.length, p, k - 1, second) : 0)
						matches.push([u16[p], u16[p + k] - u16[p], x.last_match(), x.last_index(), second]);
					if (matches.length > n) break;
				}
			}
			x.free(t);
		}
		self.postMessage({type: 'matches', id, did: data.did, tag: data.tag, matches});
		break;
	}
	case 'heads': { // Every headword, in the file's order
		const heads = [];
		if (loaded(d))
			for (let i = 0, n; (n = d.x.head_at(i)) >= 0; ++i)
				heads.push(d.str(d.rptr, n));
		self.postMessage({type: 'rendered', id, did: data.did, tag: data.tag, heads});
		break;
	}
	case 'renderlines':
		self.postMessage({type: 'rendered', id, did: data.did, tag: data.tag, entries: (data.lines || []).map(([m, index]) => {
			const n = loaded(d) ? d.x.render_match(m, index) : -1;
			if (n <= 0) return null;
			const entry = d.str(d.rptr, n), tab = entry.indexOf('\t');
			return {header: entry.slice(0, tab).trim(), body: entry.slice(tab + 1)};
		})});
		break;
	case 'getresults': // The next result, from the dictionaries in order
		for (;;) {
			const c = order[cdic];
			if (adicts[c] && dicts[c]?.getResult() > 0) {
				self.postMessage(result(dicts[c], c, {query, st, gen}));
				break;
			}
			if (++cdic >= order.length) {
				self.postMessage({type: 'nomore', id, st, gen});
				break;
			}
		}
	}
};

const decoder = new TextDecoder(), encoder = new TextEncoder();
const QMAX = 512; // Each query buffer
class Dic{
	constructor(filename, name, buflen, did, timestamp){
		this.filename = filename;
		this.timestamp = timestamp || 0; // from files.json: the cached copy must be at least this new
		this.name = name;
		this.did = did;
		this.bufmax = buflen + 1024;
		this.x = null; // peak.wasm's exports, once loaded
		this.slab = filename.includes('.slab');
		this.init();
	}
	async readBytes(){
		const r = await cached(this.filename);
		if (r && tsOf(r) >= this.timestamp) return r.arrayBuffer();
		// Not cached yet or outdated: the page fetches it through the service worker.
		const sent = await askPage('bytes' + this.did, {type: 'needbytes', id, did: this.did});
		if (sent) return sent;
		// Last resort (page fetch failed): try directly.
		const resp = await fetch(new URL(this.filename, origin));
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		return resp.arrayBuffer();
	}
	async init() {
		try {
			// Start reading the bytes right away, in parallel with setting up
			// the wasm instance.
			const bytes = this.readBytes();
			const x = (await WebAssembly.instantiate(await wasmModule, {})).exports;
			const buf = await bytes;
			const start = performance.now();
			// The database into the module
			const src = x.malloc(buf.byteLength);
			if (!src) throw new Error(`[${this.name}] malloc returned NULL for ${buf.byteLength} bytes!`);
			new Uint8Array(x.memory.buffer).set(new Uint8Array(buf), src);
			const compressed = this.filename.includes('.zst');
			const ret = x.load_peak(src, buf.byteLength, compressed);
			if (compressed) x.free(src);
			const end = performance.now();
			if (ret !== 0) throw new Error(`Load failed with code: ${ret}`);
			// Two query buffers (switchState), then the result buffer; never freed
			this.q = [x.malloc(this.bufmax)];
			this.q[1] = this.q[0] + QMAX;
			this.qc = this.q[0];
			this.rptr = this.q[1] + QMAX;
			x.peak_init(this.q[0], QMAX, this.q[1], QMAX, this.rptr, this.bufmax - QMAX * 2);
			this.x = x;
			self.postMessage({type: 'loaded', id, did: this.did, msg: `${this.name} ${Math.round(end - start)}ms`});
		} catch (err) {
			console.error(err);
		}
	}
	str(ptr, len){
		return decoder.decode(new Uint8Array(this.x.memory.buffer, ptr, len));
	}
	setQuery(query){
		const bytes = encoder.encode(query + '\0');
		if (bytes.length > QMAX) throw new Error("Query too long");
		new Uint8Array(this.x.memory.buffer).set(bytes, this.qc);
	}
	// A query cut to what fits in the query buffer, on a character boundary
	fitQuery(query){
		const bytes = encoder.encode(query);
		if (bytes.length < QMAX) return query;
		let end = QMAX - 1;
		while (end > 0 && (bytes[end] & 0xC0) == 0x80) --end;
		return decoder.decode(bytes.subarray(0, end));
	}
	// The other search state (and query buffer); always switched back
	switchState(){
		this.qc = this.qc == this.q[0] ? this.q[1] : this.q[0];
		this.x.switchstate();
	}
	getResult(skip = 0){
		if (!this.x) return -1;
		this.rlen = this.x.get_result(skip);
		// Where the headword ends: its tab (a media file's: a 0)
		const tab = this.rlen > 0 ? new Uint8Array(this.x.memory.buffer, this.rptr, this.rlen).indexOf(this.slab ? 0 : 9) : -1;
		this.tab = tab < 0 ? this.rlen : tab;
		return this.rlen;
	}
	getHeader(){
		return this.str(this.rptr, this.tab).trim();
	}
	getBody(){
		return this.rlen > 0 && this.tab < this.rlen ? this.str(this.rptr + this.tab + 1, this.rlen - this.tab - 1) : null;
	}
	getBytes(){
		return this.rlen > 0 && this.tab < this.rlen ? new Uint8Array(this.x.memory.buffer, this.rptr + this.tab + 1, this.rlen - this.tab - 1) : null;
	}
}
