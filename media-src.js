// The media decoders: JBIG2 images (sheet music) to PNG, Codec2 audio to
// WAV. The page loads this, and each decoder's wasm, when first used.

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

export async function jbig2toPng(data) {
	const x = await decoder('jbig2'), bytes = new Uint8Array(data);
	const p = toWasm(x, bytes);
	x.jbig2_decode_to_png(p, bytes.length);
	x.free(p);
	const out = new Uint8Array(x.memory.buffer, x.jbig2_get_result_ptr(), x.jbig2_get_result_size()).slice();
	x.jbig2_free_result();
	return new Blob([out], {type: 'image/png'});
}

export async function codec2toWav(data) {
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
