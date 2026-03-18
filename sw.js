const CURRENT_CACHE = 'peakslab-0.4.0.4';   // ← Bump this on every deploy!

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
    client.postMessage({ type: 'version', version: CURRENT_CACHE });
  });
}

self.addEventListener('message', event => {
  if (event.data?.type === 'get version') {
    event.source.postMessage({ type: 'version', version: CURRENT_CACHE });
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      cleanupAllEmptyOldCaches(),
      sendCacheVersion()
    ])
  );
});

async function getOldCacheNames() {
  const names = await caches.keys();
  return names.filter(name => name !== CURRENT_CACHE);
}

function isAllowed(url) {
  if (!ALLOWED_TO_CACHE.length) return true;
  return ALLOWED_TO_CACHE.some(pattern => 
    pattern.endsWith('/') ? url.includes(pattern) : url === pattern || url.endsWith(pattern)
  );
}

async function cleanupAllEmptyOldCaches() {
  const oldNames = await getOldCacheNames();
  for (const name of oldNames) {
    const cache = await caches.open(name);
    if ((await cache.keys()).length === 0) {
      await caches.delete(name);
      console.log('🗑️ Deleted empty old cache:', name);
    }
  }
}

// ====================== FIXED FETCH HANDLER ======================
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || 
      !event.request.url.startsWith(self.location.origin)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      const currentCache = await caches.open(CURRENT_CACHE);

      // 1. New cache first
      const newResponse = await currentCache.match(event.request);
      if (newResponse) return newResponse;

      // 2. Look for the file in any old cache
      const oldCacheNames = await getOldCacheNames();
      let oldResponse = null;
      let oldCacheUsed = null;

      for (const oldName of oldCacheNames) {
        const oldCache = await caches.open(oldName);
        oldResponse = await oldCache.match(event.request);
        if (oldResponse) {
          oldCacheUsed = oldCache;
          break;
        }
      }

      // If we have nothing in any cache, just try network
      if (!oldResponse) {
        try {
          const resp = await fetch(event.request);
          if (resp?.status === 200 && resp.type === 'basic' && isAllowed(event.request.url)) {
            await currentCache.put(event.request, resp.clone());
          }
          return resp;
        } catch {
          return new Response('Offline', { status: 503 });
        }
      }

      // 3. We have an oldResponse → Revalidate (but gracefully handle offline)
      try {
        const headers = new Headers();
        const etag = oldResponse.headers.get('ETag');
        const lastMod = oldResponse.headers.get('Last-Modified');
        if (etag) headers.set('If-None-Match', etag);
        if (lastMod) headers.set('If-Modified-Since', lastMod);

        const networkResponse = await fetch(event.request, { headers });

        if (networkResponse.status === 304) {
          // Not modified → move old file to new cache
          await currentCache.put(event.request, oldResponse.clone());
          await oldCacheUsed.delete(event.request);
          console.log('✅ 304 Revalidated - Moved from old cache:', event.request.url);
          await cleanupAllEmptyOldCaches();
          return oldResponse;
        }

        if (networkResponse.status === 200 && networkResponse.type === 'basic') {
          if (isAllowed(event.request.url)) {
            await currentCache.put(event.request, networkResponse.clone());
            await oldCacheUsed.delete(event.request);
            console.log('✅ Updated with newer version:', event.request.url);
            await cleanupAllEmptyOldCaches();
          }
          return networkResponse;
        }

        // Other status → fallback to old
        return oldResponse;

      } catch (err) {
        // Offline or network error → just use the old cached version
        console.log('Offline - using old cache for:', event.request.url);
        return oldResponse;
      }
    })()
  );
});
