const CURRENT_CACHE = 'peakslab-0.4.0.8';   // ← Bump this on every deploy!

// Map files to their content version
// Update versions only when files actually change
const FILE_VERSIONS = {
  './': 'v1',
  '/app.js': 'v1',
  '/peak.js': 'v1',
  '/peakworker.js': 'v1',
  '/peak.wasm': 'v1',
  '/peakslab.svg': 'v1',
  '/peak32x32.png': 'v1',
  '/peak192x192.png': 'v1',
  '/peak512x512.png': 'v1',
  '/style.css': 'v1',

  '/khmer/config.js': 'v1',
  '/khmer/': 'v1',
  '/khmer/db/ant.peak.zst': 'v1',
  '/khmer/db/baby.peak.zst': 'v1',
  '/khmer/db/bible.peak.zst': 'v1',
  '/khmer/db/biblewordkm.peak.zst': 'v1',
  '/khmer/db/choukprov.peak.zst': 'v1',
  '/khmer/db/hymns7.peak.zst': 'v1',
  '/khmer/db/khmer92_h97.peak.zst': 'v1',
  '/khmer/db/kmULB.peak.zst': 'v1',
  '/khmer/db/nath2022_8.peak.zst': 'v1',
  '/khmer/db/plantdict.peak.zst': 'v1',
  '/khmer/db/seacount.peak.zst': 'v1',
  '/khmer/db/sonv3.peak.zst': 'v1',
  '/khmer/db/zzz.slab.zst': 'v1',
  '/khmer/manifest.json': 'v2',

  '/khmermusic/config.js': 'v1',
  '/khmermusic/': 'v1',
  '/khmermusic/manifest.json': 'v2',

  '/lao/config.js': 'v1',
  '/lao/': 'v1',
  '/lao/db/agrilao.peak.zst': 'v1',
  '/lao/db/csea.peak.zst': 'v1',
  '/lao/db/kerr4.peak.zst': 'v1',
  '/lao/db/laobibleword.peak.zst': 'v1',
  '/lao/db/laotech.peak.zst': 'v1',
  '/lao/db/lo_ulb.peak.zst': 'v1',
  '/lao/db/pat4.peak.zst': 'v1',
  '/lao/manifest.json': 'v2',

  '/lozi/config.js': 'v1',
  '/lozi/': 'v1',
  '/lozi/db/lozi.peak.zst': 'v1',
  '/lozi/manifest.json': 'v2',

  '/english/config.js': 'v1',
  '/english/': 'v1',
  '/english/db/bibleworden.peak.zst': 'v1',
  '/english/db/eng-bsb.peak.zst': 'v1',
  '/english/db/eng-kjv.peak.zst': 'v1',
  '/english/db/engULB.peak.zst': 'v1',
  '/english/db/opted.peak.zst': 'v1',
  '/english/db/strongs.peak.zst': 'v1',
  '/english/manifest.json': 'v2',

  '/chitonga/config.js': 'v1',
  '/chitonga/': 'v1',
  '/chitonga/db/tnouns.peak.zst': 'v1',
  '/chitonga/db/toibible.peak.zst': 'v1',
  '/chitonga/db/tother.peak.zst': 'v1',
  '/chitonga/db/tverbs.peak.zst': 'v1',
  '/chitonga/manifest.json': 'v2',
};

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

function getFileVersion(url) {
  const path = new URL(url).pathname.replace(/\/$/, '') || '/';
  return FILE_VERSIONS[path] || FILE_VERSIONS[path + '/'];
}

function isAllowed(url) {
  return getFileVersion(url) !== undefined;
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

function generateOfflineHtml(requestUrl) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Offline - Peakslab</title>
      </head>
    <body>
         <p>The requested resource is not available offline:</p>
          <div class="missing-url">${requestUrl}</div>
    </body>
    </html>
  `;
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

      // 1. Check current cache first
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
        } catch (err) {
          // Offline and no cache - show helpful offline page
          const html = generateOfflineHtml(event.request.url);
          return new Response(html, { 
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html' }
          });
        }
      }

      // 3. We have an oldResponse → Check if file version changed
      try {
        const currentVersion = getFileVersion(event.request.url);
        const oldVersion = oldResponse.headers.get('X-File-Version');

        // If versions match, file hasn't changed - move to current cache
        if (currentVersion && oldVersion === currentVersion) {
          await currentCache.put(event.request, oldResponse.clone());
          await oldCacheUsed.delete(event.request);
          console.log('✅ Version unchanged - Moved from old cache:', event.request.url);
          await cleanupAllEmptyOldCaches();
          return oldResponse;
        }

        // Version changed or no version header - fetch new version
        const networkResponse = await fetch(event.request);

        if (networkResponse.status === 200 && networkResponse.type === 'basic') {
          if (isAllowed(event.request.url)) {
            // Add version header to cached response
            const responseToCache = networkResponse.clone();
            const newHeaders = new Headers(responseToCache.headers);
            newHeaders.set('X-File-Version', currentVersion || 'unknown');
            const responseWithVersion = new Response(responseToCache.body, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: newHeaders
            });
            
            await currentCache.put(event.request, responseWithVersion);
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
