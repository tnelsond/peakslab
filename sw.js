const CURRENT_CACHE = 'peakslab-0.4.0.3';   // ← Bump this on every deploy!

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

      // 2. Check old caches
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

      // 3. Revalidate step BEFORE moving old cache
      try {
        // Create a conditional request (GitHub Pages may respect it)
        const headers = new Headers();
        if (oldResponse) {
          const etag = oldResponse.headers.get('ETag');
          const lastMod = oldResponse.headers.get('Last-Modified');
          if (etag) headers.set('If-None-Match', etag);
          if (lastMod) headers.set('If-Modified-Since', lastMod);
        }

        const networkResponse = await fetch(event.request, { headers });

        const url = event.request.url;

        if (networkResponse.status === 304 && oldResponse) {
          // Not modified → safe to move old response to new cache
          await currentCache.put(event.request, oldResponse.clone());
          await oldCacheUsed.delete(event.request);
          console.log('✅ Revalidated 304 - Moved from old cache:', url);
          await cleanupAllEmptyOldCaches();
          return oldResponse;
        }

        if (networkResponse.status === 200 && networkResponse.type === 'basic') {
          if (!isAllowed(url)) return networkResponse;

          // Newer version available → store it
          await currentCache.put(event.request, networkResponse.clone());

          // Clean up from old cache
          if (oldResponse && oldCacheUsed) {
            await oldCacheUsed.delete(event.request);
          }

          console.log('✅ Updated with newer version from network:', url);
          await cleanupAllEmptyOldCaches();
          return networkResponse;
        }

        // Other status (404, 500, etc.) → fall back to old cache
        if (oldResponse) return oldResponse;
        return networkResponse;

      } catch (err) {
        // Network failed (offline, etc.) → use old cache if we have it
        console.error('Revalidate failed:', err);
        return oldResponse || new Response('Offline', { status: 503 });
      }
    })()
  );
});
