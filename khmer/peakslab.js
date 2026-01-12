// peakslab.js
import init, { PeakDecoder } from './wasm/peakdec.js';
import { dictionaryGroups } from './config.js';

// ── Internal state (private) ─────────────────────────────────
const cache = {
  decoders: new Array(12).fill(null),
  diagnostics: new Array(12).fill(null),
};

let currentIndex = 0;
let currentDecoder = null;

let currentSearch = {
  query: '',
  reverse: false,
  startTime: 0,
};

let pagination = {
  level: 0,
  decoderIdx: 0,
  done: false,
};

// ── Public API ───────────────────────────────────────────────

// 1. Initialization
export async function initializeWasm() {
  await init();
}

export async function loadDictionary(index) {
  const dict = findDictByIndex(index);
  if (!dict) throw new Error(`Dictionary ${index} not found`);

  const start = performance.now();
  try {
    const response = await fetch(dict.filename);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = new Uint8Array(await response.arrayBuffer());
    const decoder = new PeakDecoder(buffer, true);

    cache.decoders[index] = decoder;
    cache.diagnostics[index] = {
      loadTimeMs: (performance.now() - start).toFixed(0),
      sizeMB: (buffer.byteLength / 1024 / 1024).toFixed(2),
    };

    return { success: true };
  } catch (err) {
    cache.diagnostics[index] = { error: err.message };
    return { success: false, error: err.message };
  }
}

export function startBackgroundLoading() {
  dictionaryGroups.slice(1).flatMap(g => g.subDicts)
    .forEach(d => {
      if (!cache.decoders[d.index]) loadDictionary(d.index);
    });
}

// 2. Tab / Dictionary switching
export function switchDictionary(index) {
  currentIndex = index;
  currentDecoder = index === 0 ? null : cache.decoders[index];
  resetPagination();
}

export function getCurrentDictionaryIndex() {
  return currentIndex;
}

export function isDictionaryLoaded(index) {
  return !!cache.decoders[index];
}

export async function ensureDictionaryLoaded(index) {
  if (index === 0 || cache.decoders[index]) return true;
  const result = await loadDictionary(index);
  return result.success;
}

// 3. Search
export function startSearch(query, reverse = false) {
  currentSearch = {
    query: query.trim(),
    reverse,
    startTime: performance.now(),
  };

  const targets = getSearchTargets();
  targets.forEach(({ decoder }) => {
    if (decoder) decoder.search(currentSearch.query, currentSearch.reverse);
  });

  resetPagination();
  return {
    searchStartedAt: currentSearch.startTime,
    targetCount: targets.length,
  };
}

export function getNextBatch(num) {
	console.log("Getting batch!");
  const targets = getSearchTargets();
  if (!currentSearch.query || !targets.length || pagination.done) return [];
  const batch = [];
	console.log("Getting next batch!");

  while (batch.length === 0) {
		console.log(`Index: ${pagination.decoderIdx}, Level: ${pagination.level}`);
		if(pagination.done) return [];
    const current = targets[pagination.decoderIdx];
    if (!current?.decoder) {
      advance();
      continue;
    }

    const dec = current.decoder;

		const raw = dec.get_results_from_level(pagination.level, num);
		if(raw.length === 0){
			advance();
			continue;
		}
		const texts = raw.map(v => new TextDecoder().decode(new Uint8Array(v)));

		texts.forEach(text => {
			batch.push({
				dictIndex: current.index,
				dictName: current.name,
				text,
				level: pagination.level,
			});
		});
  }
  return batch;
}

// ── Helpers ──────────────────────────────────────────────────

function findDictByIndex(index) {
  return dictionaryGroups.flatMap(g => g.subDicts).find(d => d.index === index);
}

function getSearchTargets() {
  if (currentIndex === 0) {
    return cache.decoders
      .map((dec, i) => i > 0 && dec ? { index: i, decoder: dec, name: findDictByIndex(i)?.displayName || `Dict${i}` } : null)
      .filter(Boolean);
  }
  return currentDecoder ? [{
    index: currentIndex,
    decoder: currentDecoder,
    name: findDictByIndex(currentIndex)?.displayName || 'Current'
  }] : [];
}

function advance() {
  pagination.decoderIdx++;
  const targets = getSearchTargets();
  if (pagination.decoderIdx >= targets.length) {
    pagination.decoderIdx = 0;
    pagination.level++;
    // We could check if level >= max_level of all, but for simplicity we just keep going
		if(pagination.level > 4){
			pagination.done = true;
		}
  }
}

function resetPagination() {
  pagination = { level: 0, decoderIdx: 0, done: false };
}

export function getLoadDiagnostics() {
  return cache.diagnostics;
}
