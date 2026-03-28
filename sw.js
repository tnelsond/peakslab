const CURRENT_CACHE = 'peakslab-0.4.5.3';   // ← Bump this on every deploy!

const FILE_VERSIONS = {
  '/': 'v3',
  '/app.js': 'v10.5',
  '/peak.js': 'v2',
  '/peakworker.js': 'v4',
  '/peak.wasm': 'v2',
  '/peakslab.svg': 'v1',
  '/peak32x32.png': 'v1',
  '/peak192x192.png': 'v1',
  '/peak512x512.png': 'v1',
  '/style.css': 'v5',

  '/khmer/config.js': 'v3',
  '/khmer/': 'v3',
  '/khmer/db/ant.peak.zst': 'v3',
  '/khmer/db/baby.peak.zst': 'v4',
  '/khmer/db/bible.peak.zst': 'v2',
  '/khmer/db/biblewordkm.peak.zst': 'v2',
  '/khmer/db/choukprov.peak.zst': 'v2',
  '/khmer/db/hymns7.peak.zst': 'v2',
  '/khmer/db/khmer92_h97.peak.zst': 'v2',
  '/khmer/db/kmULB.peak.zst': 'v4',
  '/khmer/db/nath2022_8.peak.zst': 'v2',
  '/khmer/db/plantdict.peak.zst': 'v2',
  '/khmer/db/seacount.peak.zst': 'v2',
  '/khmer/db/sonv3.peak.zst': 'v2',
  '/khmer/db/zzz.slab.zst': 'v4',
  '/khmer/manifest.json': 'v2',

  '/khmermusic/config.js': 'v1',
  '/khmermusic/': 'v2',
  '/khmermusic/manifest.json': 'v2',

  '/lao/config.js': 'v2',
  '/lao/': 'v2',
  '/lao/db/agrilao.peak.zst': 'v2',
  '/lao/db/csea.peak.zst': 'v2',
  '/lao/db/kerr4.peak.zst': 'v2',
  '/lao/db/laobibleword.peak.zst': 'v3',
  '/lao/db/laotech.peak.zst': 'v2',
  '/lao/db/lo_ulb.peak.zst': 'v2',
  '/lao/db/pat4.peak.zst': 'v2',
  '/lao/manifest.json': 'v2',

  '/lozi/config.js': 'v1',
  '/lozi/': 'v2',
  '/lozi/db/lozi.peak.zst': 'v2',
  '/lozi/manifest.json': 'v3',

  '/english/config.js': 'v1',
  '/english/': 'v2',
  '/english/db/bibleworden.peak.zst': 'v4',
  '/english/db/eng-bsb.peak.zst': 'v2',
  '/english/db/eng-kjv.peak.zst': 'v2',
  '/english/db/engULB.peak.zst': 'v2',
  '/english/db/opted.peak.zst': 'v2',
  '/english/db/strongs.peak.zst': 'v2',
  '/english/manifest.json': 'v3',

  '/chitonga/config.js': 'v1',
  '/chitonga/': 'v2',
  '/chitonga/db/tnouns.peak.zst': 'v2',
  '/chitonga/db/toibible.peak.zst': 'v2',
  '/chitonga/db/tother.peak.zst': 'v2',
  '/chitonga/db/tverbs.peak.zst': 'v2',
  '/chitonga/manifest.json': 'v2',
};

const isVersionedFile = (url) => {
  const path = new URL(url).pathname.replace(/\/$/, '') || '/';
  return FILE_VERSIONS[path] !== undefined;
};

const getFileVersion = (url) => {
  const path = new URL(url).pathname.replace(/\/$/, '') || '/';
  return FILE_VERSIONS[path];
};

async function sendCacheVersion() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'version', version: CURRENT_CACHE }));
}

self.addEventListener('message', event => {
  if (event.data?.type === 'get version') {
    event.source.postMessage({ type: 'version', version: CURRENT_CACHE });
  }
});

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const currentCache = await caches.open(CURRENT_CACHE);
      const oldCacheNames = (await caches.keys()).filter(name => name !== CURRENT_CACHE);

      for (const oldName of oldCacheNames) {
        const oldCache = await caches.open(oldName);
        const requests = await oldCache.keys();

        for (const req of requests) {
          const cachedResp = await oldCache.match(req);
          if (!cachedResp) continue;

          const url = req.url;
          if (!isVersionedFile(url)) {
            await oldCache.delete(req);
            continue;
          }

          const expectedVer = getFileVersion(url);
          const storedVer = cachedResp.headers.get('X-File-Version');

          if (storedVer === expectedVer) {
            // Safe migration
            await currentCache.put(req, cachedResp.clone());
            await oldCache.delete(req);
          }
          // else: outdated → leave in old cache for fallback
        }
      }

      await self.skipWaiting();
      sendCacheVersion(); // notify clients early
    })()
  );
});

// ─────────────────────────────────────────────────────────────
// Activate: claim clients + clean empty old caches
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();

      // Clean up truly empty old caches
      const oldNames = (await caches.keys()).filter(name => name !== CURRENT_CACHE);
      for (const name of oldNames) {
        const cache = await caches.open(name);
        if ((await cache.keys()).length === 0) {
          await caches.delete(name);
        }
      }
    })()
  );
});

// ─────────────────────────────────────────────────────────────
// Fetch: Cache-first with smart background update for versioned files
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return; // let browser handle non-GET or cross-origin
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CURRENT_CACHE);
      let response = await cache.match(event.request);

      if (response) {
        // We have a good cached version → serve it immediately
        return response;
      }

      // No current cache → check old caches (rare after first migration)
      const oldNames = (await caches.keys()).filter(name => name !== CURRENT_CACHE);
      for (const oldName of oldNames) {
        const oldCache = await caches.open(oldName);
        response = await oldCache.match(event.request);
        if (response) break;
      }

      if (!response) {
        // Pure network fallback
        try {
          const netResponse = await fetch(event.request, { cache: 'reload' });

          if (netResponse.ok && netResponse.type === 'basic') {
            const clone = netResponse.clone();
            if (isVersionedFile(event.request.url)) {
              const headers = new Headers(netResponse.headers);
              headers.set('X-File-Version', getFileVersion(event.request.url));
              cache.put(event.request, new Response(clone.body, {
                status: netResponse.status,
                statusText: netResponse.statusText,
                headers
              }));
            } else {
              cache.put(event.request, clone);
            }
          }
          return netResponse;
        } catch (err) {
          // Offline
          return new Response(
            `<h2>Offline</h2><p>Resource not available: ${event.request.url}</p>`,
            { status: 503, headers: { 'Content-Type': 'text/html' } }
          );
        }
      }

      // We have an old response → serve it now, update in background if versioned
      const url = event.request.url;
      if (isVersionedFile(url)) {
        const currentVer = getFileVersion(url);
        const oldVer = response.headers.get('X-File-Version');

        if (oldVer !== currentVer) {
          // Background update (fire-and-forget)
          (async () => {
            try {
              const net = await fetch(event.request, { cache: 'reload' });
              if (!net.ok || net.type !== 'basic') return;

              const clone = net.clone();
              const headers = new Headers(net.headers);
              headers.set('X-File-Version', currentVer);

              await cache.put(event.request, new Response(clone.body, {
                status: net.status,
                statusText: net.statusText,
                headers
              }));

              // Clean up old cache entry
              const oldCache = await caches.open(oldNames[0]); // usually only one old cache left
              await oldCache.delete(event.request);
            } catch (e) { /* silent */ }
          })();
        } else {
          // Same version → move to current cache
          await cache.put(event.request, response.clone());
          // Optional: delete from old cache
        }
      } else {
        // Non-versioned → just promote to current cache
        await cache.put(event.request, response.clone());
      }

      return response; // serve the (old) response immediately
    })()
  );
});
