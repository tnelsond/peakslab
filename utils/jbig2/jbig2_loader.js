// Minimal jbig2dec WebAssembly loader — no Emscripten runtime.
// Usage:
//   const jbig2 = await loadJbig2('/path/to/jbig2.wasm');
//   const pngBytes = jbig2.decode(jbig2DataUint8Array);

export async function loadJbig2(wasmUrl) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {
    env: {
      // jbig2dec calls emscripten_memcpy_big / sbrk / abort etc. at runtime.
      // For STANDALONE_WASM those are replaced by wasi stubs; expose the
      // minimum wasi_snapshot_preview1 surface required.
      abort: () => { throw new Error('wasm abort'); },
    },
    wasi_snapshot_preview1: {
      fd_write:           () => 0,
      fd_seek:            () => 0,
      fd_close:           () => 0,
      proc_exit:          (code) => { throw new Error('exit ' + code); },
      environ_get:        () => 0,
      environ_sizes_get:  () => 0,
    },
  });
  const { memory, malloc, free,
          jbig2_decode_to_png,
          jbig2_get_result_ptr, jbig2_get_result_size,
          jbig2_free_result } = instance.exports;

  return {
    /**
     * Decode a JBIG2 blob and return a PNG as Uint8Array.
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    decode(data) {
      const ptr = malloc(data.byteLength);
      if (!ptr) throw new Error('jbig2: malloc failed');
      new Uint8Array(memory.buffer, ptr, data.byteLength).set(data);
      const size = jbig2_decode_to_png(ptr, data.byteLength);
      free(ptr);
      if (size <= 0) throw new Error('jbig2: decode failed');
      const resultPtr  = jbig2_get_result_ptr();
      const resultSize = jbig2_get_result_size();
      // Copy out before freeing
      const out = new Uint8Array(memory.buffer, resultPtr, resultSize).slice();
      jbig2_free_result();
      return out;
    },
  };
}
