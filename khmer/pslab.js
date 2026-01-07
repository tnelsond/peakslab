// pslab.js - Core dictionary engine with ZSTD decompression and pre-loaded offsets

const QUERY_FLAGS = {
  MATCH_START:     0b00001,
  MATCH_CONTAINS:  0b00010,  // not used directly now, but kept for future
  MATCH_END:       0b00100,
  SEARCH_PRIMARY:  0b01000,
  SEARCH_SECONDARY:0b10000,
  SEARCH_FULL:     0b100000,
};

let wasmInstance = null;
let wasmHeap = null;

const IMPORT_OBJECT = {
  env: {
    emscripten_notify_memory_growth: () => {
      wasmHeap = new Uint8Array(wasmInstance.exports.memory.buffer);
    }
  }
};

class ZSTDDecoder {
  static async init(wasmUrl = 'zstddec2.wasm') {
    if (wasmInstance) return;
    const resp = await fetch(wasmUrl);
    if (!resp.ok) throw new Error(`Failed to load WASM: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const mod = await WebAssembly.instantiate(buffer, IMPORT_OBJECT);
    wasmInstance = mod.instance;

    if (wasmInstance.exports.__wasm_call_ctors) {
      wasmInstance.exports.__wasm_call_ctors();
    }

    wasmHeap = new Uint8Array(wasmInstance.exports.memory.buffer);
  }

  static decode(compressed) {
    if (!wasmInstance) throw new Error("ZSTDDecoder not initialized");

    const inSize = compressed.byteLength;
    const inPtr = wasmInstance.exports.malloc(inSize);
    if (inPtr === 0) throw new Error("malloc failed for input");

    wasmHeap.set(compressed, inPtr);

    let outSizeRaw = wasmInstance.exports.ZSTD_findDecompressedSize(inPtr, inSize);

    let outSize;
    if (typeof outSizeRaw === 'bigint') {
      outSize = Number(outSizeRaw);
    } else {
      outSize = outSizeRaw;
    }

    if (outSize <= 0 || outSize > 2 ** 32) {
      outSize = compressed.byteLength * 10 + 1024; // generous estimate
    }

    const outPtr = wasmInstance.exports.malloc(outSize);
    if (outPtr === 0) throw new Error("malloc failed for output");

    const decodedSizeRaw = wasmInstance.exports.ZSTD_decompress(outPtr, outSize, inPtr, inSize);

    let decodedSize;
    if (typeof decodedSizeRaw === 'bigint') {
      decodedSize = Number(decodedSizeRaw);
    } else {
      decodedSize = decodedSizeRaw;
    }

    if (decodedSize <= 0 || decodedSize > outSize) {
      wasmInstance.exports.free(inPtr);
      wasmInstance.exports.free(outPtr);
      throw new Error(`Decompression failed: returned ${decodedSize}`);
    }

    const result = wasmHeap.slice(outPtr, outPtr + decodedSize);

    wasmInstance.exports.free(inPtr);
    wasmInstance.exports.free(outPtr);

    return result;
  }
}

export class Dictionary {
  constructor(name, desc) {
    this.name = name;
    this.desc = desc;
    this.text = null;
    this.offsets = null;
    this.loaded = false;
    this.lineCount = 0;
    this.loadTime = 0;
  }

  async load(baseUrl) {
    // baseUrl should point to the .zst file without extension
    // e.g. "dicts/english" → fetches english.zst and english.offsets
    await ZSTDDecoder.init();

    const fetchStart = performance.now();

    // Fetch compressed text and offsets in parallel
    const [textResp, offsetsResp] = await Promise.all([
      fetch(`${baseUrl}.tsv.zst`),
      fetch(`${baseUrl}.offsets`)
    ]);

    if (!textResp.ok) throw new Error(`Failed to fetch ${baseUrl}.tsv.zst: ${textResp.status}`);
    if (!offsetsResp.ok) throw new Error(`Failed to fetch ${baseUrl}.offsets: ${offsetsResp.status}`);

    const compressed = new Uint8Array(await textResp.arrayBuffer());
    const fetchTime = performance.now() - fetchStart;

    const decStart = performance.now();
    const decoded = ZSTDDecoder.decode(compressed);
    const decTime = performance.now() - decStart;

    const utfdStart = performance.now();
    this.text = new TextDecoder('utf-8').decode(decoded);
    const utfdTime = performance.now() - utfdStart;

    // Load pre-computed offsets (Uint32 little-endian)
    const offsetsBuffer = await offsetsResp.arrayBuffer();
    this.offsets = new Uint32Array(offsetsBuffer);
    this.lineCount = this.offsets.length - 1;
    this.loadTime = performance.now() - fetchStart;
    this.loaded = true;

    console.log(
      `%c✓ Loaded ${this.desc}%c | ${this.lineCount.toLocaleString()} lines | ` +
      `Fetch: ${fetchTime.toFixed(1)}ms | utf8 decode: ${utfdTime.toFixed(1)}ms` + 
      `Decompress: ${decTime.toFixed(1)}ms | Total: ${this.loadTime.toFixed(1)}ms`,
      'color: #4CAF50; font-weight: bold;', 'color: inherit;'
    );
  }

  getLine(idx) {
    if (idx < 1 || idx >= this.offsets.length) return '';
    const start = this.offsets[idx];
    const end = this.offsets[idx + 1] ?? this.text.length;
    return this.text.substring(start, end).trim();
  }

  getHeadword(line) {
    return (line.split('\t')[0] || '').trim();
  }

  getSecondary(line) {
    return (line.split('\t')[1] || '').trim();
  }

  normalize(str) {
    return str.toLowerCase();
  }

  _binarySearchFirst(targetNorm, checkFn) {
    let low = 1, high = this.offsets.length - 1, result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const head = this.normalize(this.getHeadword(this.getLine(mid)));
      if (checkFn(head)) {
        result = mid;
        high = mid - 1;
      } else if (head < targetNorm) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  search(query, flags = 0, limit = 50) {
    if (!this.loaded || !query) return [];

    const normQuery = this.normalize(query);
    const results = [];

    const matchStart = flags & QUERY_FLAGS.MATCH_START;
    const matchEnd = flags & QUERY_FLAGS.MATCH_END;
    const searchPrimary = flags & QUERY_FLAGS.SEARCH_PRIMARY;
    const searchSecondary = flags & QUERY_FLAGS.SEARCH_SECONDARY;
    const fullSearch = flags & QUERY_FLAGS.SEARCH_FULL;

    if (fullSearch) {
      for (let i = 1; i < this.offsets.length && results.length < limit; i++) {
        const line = this.getLine(i);
        if (this.normalize(line).includes(normQuery)) {
          results.push({ index: i, line, headword: this.getHeadword(line) });
        }
      }
      return results;
    }

    // Optimized: startsWith on primary only
    if (matchStart && searchPrimary && !searchSecondary && !matchEnd) {
      const first = this._binarySearchFirst(normQuery, h => h >= normQuery);
      if (first !== -1) {
        for (let i = first; i < this.offsets.length && results.length < limit; i++) {
          const head = this.normalize(this.getHeadword(this.getLine(i)));
          if (head.startsWith(normQuery)) {
            const line = this.getLine(i);
            results.push({ index: i, line, headword: this.getHeadword(line) });
          } else if (head > normQuery) {
            break;
          }
        }
        return results;
      }
    }

    // General linear scan
    for (let i = 1; i < this.offsets.length && results.length < limit; i++) {
      const line = this.getLine(i);
      const head = this.normalize(this.getHeadword(line));
      const sec = this.normalize(this.getSecondary(line));

      let matches = false;

      if (searchPrimary && head) {
        if (matchStart && head.startsWith(normQuery)) matches = true;
        else if (matchEnd && head.endsWith(normQuery)) matches = true;
      }

      if (!matches && searchSecondary && sec) {
        if (matchStart && sec.startsWith(normQuery)) matches = true;
        else if (matchEnd && sec.endsWith(normQuery)) matches = true;
      }

      if (matches) {
        results.push({ index: i, line, headword: this.getHeadword(line) });
      }
    }

    return results;
  }

  findByExactHeadword(headword) {
    if (!this.loaded) return [];
    const norm = this.normalize(headword);
    const first = this._binarySearchFirst(norm, h => h >= norm);
    if (first === -1) return [];

    const results = [];
    for (let i = first; i < this.offsets.length; i++) {
      const line = this.getLine(i);
      const h = this.getHeadword(line);
      if (this.normalize(h) > norm) break;
      if (h === headword) results.push(line);
    }
    return results;
  }
}

export { QUERY_FLAGS };
