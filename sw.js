const CURRENT_CACHE = 'peakslab-0.4.0.1';   // ← Bump this on every deploy!

// Optional: restrict which files can be cached (leave empty to allow everything)
const ALLOWED_TO_CACHE = [
  './',
  '/app.js',
  '/peak.js',
  '/peakworker.js',
  '/peak.wasm',
  '/peakslab.svg',
  '/peak32x32.png',
  '/peak192x192.png',
  '/peak512x512.png',
  '/style.css',

  '/khmer/config.js',
  '/khmer/',
  '/khmer/db/ant.peak.zst',
  '/khmer/db/baby.peak.zst',
  '/khmer/db/bible.peak.zst',
  '/khmer/db/biblewordkm.peak.zst',
  '/khmer/db/choukprov.peak.zst',
  '/khmer/db/hymns7.peak.zst',
  '/khmer/db/khmer92_h97.peak.zst',
  '/khmer/db/kmULB.peak.zst',
  '/khmer/db/nath2022_8.peak.zst',
  '/khmer/db/plantdict.peak.zst',
  '/khmer/db/seacount.peak.zst',
  '/khmer/db/sonv3.peak.zst',
  '/khmer/db/zzz.slab.zst',
  '/khmer/manifest.json',

  '/khmermusic/config.js',
  '/khmermusic/',
  '/khmermusic/manifest.json',

  '/lao/config.js',
  '/lao/',
  '/lao/db/agrilao.peak.zst',
  '/lao/db/csea.peak.zst',
  '/lao/db/kerr4.peak.zst',
  '/lao/db/laobibleword.peak.zst',
  '/lao/db/laotech.peak.zst',
  '/lao/db/lo_ulb.peak.zst',
  '/lao/db/pat4.peak.zst',
  '/lao/manifest.json',

  '/lozi/config.js',
  '/lozi/',
  '/lozi/db/lozi.peak.zst',
  '/lozi/manifest.json',

  '/english/config.js',
  '/english/',
  '/english/db/bibleworden.peak.zst',
  '/english/db/eng-bsb.peak.zst',
  '/english/db/eng-kjv.peak.zst',
  '/english/db/engULB.peak.zst',
  '/english/db/opted.peak.zst',
  '/english/db/strongs.peak.zst',
  '/english/manifest.json',

  '/chitonga/config.js',
  '/chitonga/',
  '/chitonga/db/tnouns.peak.zst',
  '/chitonga/db/toibible.peak.zst',
  '/chitonga/db/tother.peak.zst',
  '/chitonga/db/tverbs.peak.zst',
  '/chitonga/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

async function sendCacheVersion() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'version',
      version: CURRENT_CACHE
    });
  });
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'get version') {
    event.source.postMessage({
      type: 'version',
      version: CURRENT_CACHE
    });
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      consolidateOldCaches(),   // Merge all old caches into one + cleanup
			sendCacheVersion()
    ])
  );
});

// =============================================
//  Consolidate all old caches into the newest one
// =============================================
async function consolidateOldCaches() {
  const allCaches = await caches.keys();
  const oldCaches = allCaches.filter(name => name !== CURRENT_CACHE);

  if (oldCaches.length <= 1) return; // Nothing to consolidate

  // Sort old caches by name (assuming semantic versioning like peakslab-0.8.3)
  oldCaches.sort();

  const targetOldCacheName = oldCaches[oldCaches.length - 1]; // most recent old cache
  const targetOldCache = await caches.open(targetOldCacheName);

  console.log(`Consolidating ${oldCaches.length} old caches into ${targetOldCacheName}`);

  for (const oldName of oldCaches) {
    if (oldName === targetOldCacheName) continue;

    const oldCache = await caches.open(oldName);
    const requests = await oldCache.keys();

    for (const request of requests) {
      const response = await oldCache.match(request);
      if (!response) continue;

      // If file doesn't exist in target old cache, or this one is newer, copy it
      const existing = await targetOldCache.match(request);
      if (!existing || isNewer(response, existing)) {
        await targetOldCache.put(request, response.clone());
      }
    }

    // Delete the older cache after merging
    await caches.delete(oldName);
    console.log(`Merged and deleted old cache: ${oldName}`);
  }
}

// Simple heuristic: compare Last-Modified or ETag
function isNewer(responseA, responseB) {
  const lmA = responseA.headers.get('Last-Modified');
  const lmB = responseB.headers.get('Last-Modified');
  if (lmA && lmB) return new Date(lmA) > new Date(lmB);

  const etagA = responseA.headers.get('ETag');
  const etagB = responseB.headers.get('ETag');
  return etagA && etagA !== etagB;
}

// =============================================
//  Main fetch handler
// =============================================
async function getOldCacheName() {
  const names = await caches.keys();
  const oldOnes = names.filter(name => name !== CURRENT_CACHE);
  return oldOnes.length ? oldOnes[0] : null; // now there should be at most one
}

function isAllowed(url) {
  if (!ALLOWED_TO_CACHE.length) return true;
  return ALLOWED_TO_CACHE.some(pattern => 
    pattern.endsWith('/') ? url.includes(pattern) : url === pattern || url.endsWith(pattern)
  );
}

async function cleanupOldCacheIfEmpty() {
  const oldName = await getOldCacheName();
  if (!oldName) return;

  const oldCache = await caches.open(oldName);
  const keys = await oldCache.keys();
  if (keys.length === 0) {
    await caches.delete(oldName);
    console.log('🗑️ Old cache is now empty and deleted:', oldName);
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      const currentCache = await caches.open(CURRENT_CACHE);

      // 1. Current (new) cache first
      let response = await currentCache.match(event.request);
      if (response) return response;

      // 2. Check the single old cache
      const oldCacheName = await getOldCacheName();
      let oldResponse = null;
      let oldCache = null;
      if (oldCacheName) {
        oldCache = await caches.open(oldCacheName);
        oldResponse = await oldCache.match(event.request);
      }

      // 3. Check network for updates
      try {
        const networkResponse = await fetch(event.request);

        if (networkResponse?.status === 200 && networkResponse.type === 'basic') {
          const url = event.request.url;
          if (!isAllowed(url)) return networkResponse;

          const isNewerOnNetwork = !oldResponse ||
            networkResponse.headers.get('ETag') !== oldResponse.headers.get('ETag') ||
            networkResponse.headers.get('Last-Modified') !== oldResponse.headers.get('Last-Modified');

          if (isNewerOnNetwork) {
            await currentCache.put(event.request, networkResponse.clone());
            if (oldResponse) await oldCache.delete(event.request);
            console.log('✅ Updated from network:', url);
            await cleanupOldCacheIfEmpty();
            return networkResponse;
          } else if (oldResponse) {
            // Move from old → new without re-download
            await currentCache.put(event.request, oldResponse.clone());
            await oldCache.delete(event.request);
            console.log('✅ Moved from old to new cache:', url);
            await cleanupOldCacheIfEmpty();
            return oldResponse;
          } else {
            await currentCache.put(event.request, networkResponse.clone());
            return networkResponse;
          }
        }

        // Network failed or bad status → use old cache
        return oldResponse || networkResponse;

      } catch (err) {
        console.error('Network failed:', err);
        return oldResponse || new Response('Offline', { status: 503 });
      }
    })()
  );
});
