"use strict";

// ─── Wasm bootstrap ───────────────────────────────────────────────────────────
// The module (compiled bytecode) is shared — compile once, instantiate per Dic.
// Each Dic gets its own WebAssembly.Memory and instance so their C globals
// (g_d, psa, iowa, wis, g_result_loc …) are fully isolated.

let _wasmModulePromise = null;

function getWasmModule() {
    if (!_wasmModulePromise)
        _wasmModulePromise = WebAssembly.compileStreaming(fetch('./peak.wasm'));
    return _wasmModulePromise;
}

function makeInstance(module, memory) {
    return WebAssembly.instantiate(module, {
        env: {
            memory,
            __assert_fail: (cond, file, line) => {
                throw new Error(`wasm assert @ ${file}:${line}`);
            },
            emscripten_resize_heap: (size) => {
                const current = memory.buffer.byteLength;
                const needed = Math.ceil((size - current) / 65536);
                if (needed <= 0) return 1;
                try { memory.grow(needed); return 1; }
                catch { return 0; }
            },
            emscripten_notify_memory_growth: () => {},
            _setitimer_js: () => 0,
            _abort_js: () => { throw new Error('wasm abort'); },
            _emscripten_runtime_keepalive_clear: () => {},
        },
        wasi_snapshot_preview1: {
            proc_exit: (code) => { throw new Error(`wasm exit ${code}`); },
            fd_close: () => 8,
            fd_write: () => 8,
            fd_seek:  () => 70,
        },
    });
}

const utf8dec = new TextDecoder();

// ─── Worker state ─────────────────────────────────────────────────────────────

let id = 0;
let dicts = [];
let adicts = [];
let query = '';
let cdic = 0;
let st = 0;

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e) => {
	if (e.data.type == "init") {
		if (!dicts[e.data.did]) {
			dicts[e.data.did] = new Dic(e.data.msg[0], e.data.msg[1], e.data.msg[2], e.data.did);
		}
	} else if (e.data.type == "destroy") {
		if (dicts[e.data.did]) {
			console.log(`Destroyed! ${dicts[e.data.did].name}`);
			dicts[e.data.did].destroy();
			dicts[e.data.did] = null;
		}
	} else if (e.data.type == "setquery") {
		query = e.data.query;
		dicts.forEach((d) => {
			if (d && d.ready) d.setQuery(query);
		});
	} else if (e.data.type == "initsearch") {
		cdic = 0;
		st = e.data.st;
		adicts = e.data.dicts;
		dicts.forEach((d) => {
			if (d && d.ready) d.exp.init_search(e.data.st, 1);
		});
	} else if (e.data.type == "continuesearch") {
		cdic = 0;
		st = e.data.st;
		adicts.forEach((val, i) => {
			if (val && dicts[i] && dicts[i].ready)
				dicts[i].exp.continue_search(e.data.st);
		});
	} else if (e.data.type == "tempsearch") {
		e.data.dicts.forEach((val, i) => {
			if (val) {
				const d = dicts[i];
				if (d && d.ready) {
					d.switchState();
					d.setQuery(e.data.query);
					d.exp.init_search(e.data.st, 0);
					while (d.getResult(e.data.dest == "popup" ? 1 : 0) != -1) {
						if (!d.slab) {
							self.postMessage({type: "result", id, did: i, dict: d.name, query: e.data.query, st: e.data.st, header: d.getHeader(), body: d.getBodyStr(), dest: e.data.dest});
						} else {
							const header = d.getHeader().split('\t');
							const filetype = header[header.length - 1];
							self.postMessage({type: "result", id, did: i, query: e.data.query, dict: d.name, st: e.data.st, header: header[0], filetype, body: d.getBytes(), dest: e.data.dest});
						}
					}
					d.switchState();
				}
			}
		});
	} else if (e.data.type == "getresults") {
		let num = 0;
		while (num == 0) {
			if (adicts[cdic] && dicts[cdic] && dicts[cdic].getResult() > 0) {
				const d = dicts[cdic];
				if (!d.slab) {
					self.postMessage({type: "result", id, did: cdic, dict: d.name, query, st, header: d.getHeader(), body: d.getBodyStr()});
				} else {
					const header = d.getHeader().split('\t');
					const filetype = header[header.length - 1];
					self.postMessage({type: "result", id, did: cdic, dict: d.name, query, header: header[0], st, filetype, body: d.getBytes()});
				}
				++num;
			} else {
				cdic++;
				if (cdic >= dicts.length) {
					self.postMessage({type: "nomore", id, st});
					break;
				}
			}
		}
	} else if (e.data.type == "setid") {
		id = e.data.id;
	}
};

// ─── Dic class ────────────────────────────────────────────────────────────────

class Dic {
	constructor(filename, name, bufsize, did) {
		this.filename = filename;
		this.name = name;
		this.did = did;
		this.bufmax = bufsize;
		this.qmax = bufsize > 1024 ? 255 : Math.floor(bufsize / 3);
		this.qptr  = null;
		this.qptr2 = null;
		this.qptrc = null;
		this.rptr  = null;
		this.rmax  = this.bufmax - this.qmax * 2;
		this.exp    = null;    // wasm exports for this instance
		this.memory = null;    // this instance's linear memory
		this.ready  = false;
		this.loadtime = null;
		this.slab = filename.includes(".slab");
		this._tabPos = -1;
		this.rlen = 0;
		this.init();
	}

	// Always read from this instance's (possibly grown) buffer
	heap() { return new Uint8Array(this.memory.buffer); }
	utf8(ptr, len) { return utf8dec.decode(new Uint8Array(this.memory.buffer, ptr, len)); }

	destroy() {
		if (this.exp) this.exp.free_peak();
	}

async init() {
    try {
        const module = await getWasmModule();

        // Fetch the dict first so we know how big it is
        const resp = await fetch(this.filename);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();

        // Size initial memory to fit: file + 8MB headroom for stack/runtime/buffers
        const pagesNeeded = Math.ceil((buf.byteLength + 8 * 1024 * 1024) / 65536);
        this.memory = new WebAssembly.Memory({ initial: pagesNeeded, maximum: 32768 });
        const instance = await makeInstance(module, this.memory);
        this.exp = instance.exports;

        const start = performance.now();

        const srcPtr = this.exp.malloc(buf.byteLength);
        if (srcPtr === 0) throw new Error(`malloc failed for ${buf.byteLength} bytes`);
        this.heap().set(new Uint8Array(buf), srcPtr);
			const compressed = this.filename.includes(".zst");
			const loadRet = this.exp.load_peak(srcPtr, buf.byteLength, compressed);
			if (compressed) this.exp.free(srcPtr);
			const end = performance.now();

			if (loadRet !== 0) throw new Error(`load_peak failed: ${loadRet}`);

			// Allocate query/result buffers — never freed
			this.qptr  = this.exp.malloc(this.bufmax);
			this.qptr2 = this.qptr + this.qmax;
			this.qptrc = this.qptr;
			this.rptr  = this.qptr2 + this.qmax;

			const initRet = this.exp.peak_init(this.qptr, this.qmax, this.qptr2, this.qmax, this.rptr, this.rmax);
			if (initRet !== 0) throw new Error(`peak_init failed: ${initRet}`);

			this.loadtime = Math.round(end - start);
			this.ready = true;
			self.postMessage({type: "loaded", id, did: this.did, msg: `${this.name} ${this.loadtime}ms`});
		} catch (err) {
			console.error(err);
		}
	}

	setQuery(query) {
		const bytes = new TextEncoder().encode(query + '\0');
		if (bytes.length > this.qmax) throw new Error("Query too long");
		this.heap().set(bytes, this.qptrc);
	}

	switchState() {
		this.qptrc = (this.qptrc === this.qptr) ? this.qptr2 : this.qptr;
		this.exp.switchstate();
	}

	getResult(skip = 0) {
		if (!this.ready) return -1;
		this._tabPos = -1;
		this.rlen = this.exp.get_result(skip);
		return this.rlen;
	}

	getStr() {
		if (!this.rlen) return null;
		return this.utf8(this.rptr, this.rlen);
	}

	_computeTabPos() {
		const arr = new Uint8Array(this.memory.buffer, this.rptr, this.rlen);
		this._tabPos = arr.indexOf(this.slab ? 0 : 9);  // 9 = '\t'
		if (this._tabPos === -1) this._tabPos = this.rlen;
	}

	getHeader() {
		if (this._tabPos === -1) this._computeTabPos();
		return this.utf8(this.rptr, this._tabPos).trim();
	}

	getBodyStr() {
		if (!this.rlen) return null;
		if (this._tabPos === -1) this._computeTabPos();
		if (this._tabPos === this.rlen) return null;
		return this.utf8(this.rptr + this._tabPos + 1, this.rlen - this._tabPos - 1);
	}

	getBytes() {
		if (!this.rlen) return null;
		if (this._tabPos === -1) this._computeTabPos();
		if (this._tabPos === this.rlen) return null;
		return new Uint8Array(this.memory.buffer, this.rptr + this._tabPos + 1, this.rlen - this._tabPos - 1);
	}
}
