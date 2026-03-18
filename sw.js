const CURRENT_CACHE = 'peakslab-0.8.1';   // ← Bump this on every deploy!

// Optional: restrict which files can be cached (leave empty to allow everything)
const ALLOWED_TO_CACHE = [
  '/',
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

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Helper: Find the single old cache (any cache that isn't the current one)
async function getOldCacheName() {
  const names = await caches.keys();
  const oldOnes = names.filter(name => name !== CURRENT_CACHE);
  return oldOnes.length ? oldOnes[0] : null;
}

// Helper: Check if URL is allowed to be cached
function isAllowed(url) {
  if (!ALLOWED_TO_CACHE.length) return true;
  return ALLOWED_TO_CACHE.some(pattern => 
    pattern.endsWith('/') ? url.includes(pattern) : url === pattern || url.endsWith(pattern)
  );
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || 
      !event.request.url.startsWith(self.location.origin)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      const currentCache = await caches.open(CURRENT_CACHE);

      // 1. Check new cache first (fast path)
      let response = await currentCache.match(event.request);
      if (response) return response;

      // 2. Not in new cache → check old cache
      const oldCacheName = await getOldCacheName();
      let oldResponse = null;
      if (oldCacheName) {
        const oldCache = await caches.open(oldCacheName);
        oldResponse = await oldCache.match(event.request);
      }

      // 3. Always check the network to see if there's a newer version
      try {
        const networkResponse = await fetch(event.request);

        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const url = event.request.url;

          if (!isAllowed(url)) {
            return networkResponse; // don't cache
          }

          // Decide what to store in the new cache
          const shouldUseNetwork = !oldResponse || 
            networkResponse.headers.get('ETag') !== oldResponse.headers.get('ETag') ||
            networkResponse.headers.get('Last-Modified') !== oldResponse.headers.get('Last-Modified');

          if (shouldUseNetwork) {
            // Newer version on network → store it and remove from old
            await currentCache.put(event.request, networkResponse.clone());
            if (oldCacheName && oldResponse) {
              const oldCache = await caches.open(oldCacheName);
              await oldCache.delete(event.request);
              console.log('✅ Updated from network & migrated:', url);
            }
            return networkResponse;
          } else {
            // Network is identical → copy from old cache into new (avoid re-download)
            await currentCache.put(event.request, oldResponse.clone());
            console.log('✅ Migrated from old cache (no change):', url);
            return oldResponse;   // return the old one (already in memory)
          }
        }

        // Network returned error status → fall back to old cache if we have it
        return oldResponse || networkResponse;

      } catch (err) {
        // Offline or network error → return old cache if available
        console.error('Network failed:', err);
        return oldResponse || new Response('Offline and no cache', { status: 503 });
      }
    })()
  );
});
