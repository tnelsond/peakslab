"use strict";

let wasmModuleResolve = null;
const wasmModulePromise = new Promise(resolve => { wasmModuleResolve = resolve; });

let id = 0;
let dicts = []
let adicts = []
let query = ''
let cdic = 0;
let st = 0;


self.onmessage = async (e) => {
	//console.log(e.data);
	if(e.data.type == "init"){
		id = e.data.id;
		wasmModuleResolve(e.data.wasm);
	}else if(e.data.type == "load"){
		if(!dicts[e.data.did]){
			console.log(e.data.msg); // disable later
			dicts[e.data.did] = new Dic(e.data.msg[0], e.data.msg[1], e.data.msg[2], e.data.did);
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
				d.setQuery(query);
			}
		});
	}
	else if(e.data.type == "initsearch"){
		cdic = 0;
		st = e.data.st;
		adicts = e.data.dicts;
		dicts.forEach((d) => { // Yes, we have to reset all the dictionaries because the results build up.
			if(d && d.module){
				d.module._init_search(e.data.st, 1);
			}
		});
	}
	else if(e.data.type == "continuesearch"){
		cdic = 0;
		st = e.data.st;
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
							self.postMessage({type: "result", id: id, did: i, dict: d.name, query: e.data.query, st: e.data.st, header: d.getHeader(),  body: d.getBodyStr(), dest: e.data.dest});
						else{
							let header = d.getHeader().split('\t');
							const filetype = header[header.length-1];
							let subheader = header.slice(1, -1);
							header = header[0];
							self.postMessage({type: "result", id: id, did: i, query: e.data.query, dict: d.name, st: e.data.st, header: header, subheader: subheader, filetype: filetype, body: d.getBytes(), dest: e.data.dest});
						}
					}
					d.switchState(); // Switched it back :D
				}
			}
		});
	}else if(e.data.type == "getresults"){
		let num = 0;
		while(num == 0){
			if(adicts[cdic] && dicts[cdic] && dicts[cdic].getResult() > 0){
				//console.log("give!");
				if(!dicts[cdic].slab){
					self.postMessage({type: "result", id: id, did: cdic, dict: dicts[cdic].name, query: query, st: st, header: dicts[cdic].getHeader(), body: dicts[cdic].getBodyStr()});
				}else{
					let header = dicts[cdic].getHeader().split('\t');
					const filetype = header[header.length-1];
					let subheader = header.slice(1, -1);
					header = header[0];
					//header = header.substring(0, header.indexOf(9));
					self.postMessage({type: "result", id: id, did: cdic, dict: dicts[cdic].name, query: query, header: header, subheader: subheader, st: st, filetype: filetype, body: dicts[cdic].getBytes()});
				}
				++num;
			}
			else{
				cdic++;
				if(cdic >= dicts.length){
					self.postMessage({type: "nomore", id: id, st: st});
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
	constructor(filename, name, bufsize, did){
		this.filename = filename;
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
	async init() {
		try{
			const wasmBinary = await wasmModulePromise;
      this.module = await peak(wasmBinary);
			const resp = await fetch(this.filename);
			//console.log(`filename: ${this.filename}`);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const buf = await resp.arrayBuffer();
			const start = performance.now();

			// Send the database to the module
			const srcPtr = this.module._malloc(buf.byteLength);
			console.log(`[${this.name}] file=${buf.byteLength} bytes, malloc ptr=${srcPtr}, memsize=${this.module.HEAPU8.byteLength}`);
			if (srcPtr === 0) {
					throw new Error(`[${this.name}] malloc returned NULL for ${buf.byteLength} bytes!`);
			}
			this.module.HEAPU8.set(new Uint8Array(buf), srcPtr);
			console.log(`[${this.name}] set done, memsize now=${this.module.HEAPU8.byteLength}`);

			let compressed = this.filename.includes(".zst");
			const loadRet = this.module._load_peak(srcPtr, buf.byteLength, compressed);
			console.log(`[${this.name}] _load_peak returned: ${loadRet}`);
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
		const encoder = new TextEncoder();
		const bytes = encoder.encode(query + '\0');
		if (bytes.length > this.qmax) throw new Error("Query too long");
		this.module.HEAPU8.set(bytes, this.qptrc);
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
		if(!this.rlen)
			return null;
		return this.module.UTF8ToString(this.rptr, this.rlen);
	}
	getBodyStr(){
		if(!this.rlen)
			return null;
		if (this._tabPos === -1)
			this._computeTabPos();
		if (this._tabPos === -1)
			return null;
		return this.module.UTF8ToString(this.rptr + this._tabPos+1, this.rlen - this._tabPos-1);
	}
	_computeTabPos() {
		const arr = new Uint8Array(this.module.HEAPU8.buffer, this.rptr, this.rlen);
		this._tabPos = arr.indexOf(this.slab ? 0 : 9);           // 9 = ASCII/UTF-8 for '\t'
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
		if(!this.rlen)
			return null;
		if (this._tabPos === -1)
			this._computeTabPos();
		if (this._tabPos === -1)
			return null;
		return new Uint8Array(this.module.HEAPU8.buffer, this.rptr + this._tabPos+1, this.rlen - this._tabPos-1);
	}
}
