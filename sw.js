const CURRENT_CACHE = 'peakslab-0.4.4.5';   // ← Bump this on every deploy!

const FILE_VERSIONS = {
  '/': 'v1',
  '/app.js': 'v8',
  '/peak.js': 'v2',
  '/peakworker.js': 'v3',
  '/peak.wasm': 'v2',
  '/peakslab.svg': 'v1',
  '/peak32x32.png': 'v1',
  '/peak192x192.png': 'v1',
  '/peak512x512.png': 'v1',
  '/style.css': 'v3',

  '/khmer/config.js': 'v2',
  '/khmer/': 'v2',
  '/khmer/db/ant.peak.zst': 'v1',
  '/khmer/db/baby.peak.zst': 'v2',
  '/khmer/db/bible.peak.zst': 'v1',
  '/khmer/db/biblewordkm.peak.zst': 'v1',
  '/khmer/db/choukprov.peak.zst': 'v1',
  '/khmer/db/hymns7.peak.zst': 'v1',
  '/khmer/db/khmer92_h97.peak.zst': 'v1',
  '/khmer/db/kmULB.peak.zst': 'v3',
  '/khmer/db/nath2022_8.peak.zst': 'v1',
  '/khmer/db/plantdict.peak.zst': 'v1',
  '/khmer/db/seacount.peak.zst': 'v1',
  '/khmer/db/sonv3.peak.zst': 'v1',
  '/khmer/db/zzz.slab.zst': 'v3',
  '/khmer/manifest.json': 'v2',

  '/khmermusic/config.js': 'v1',
  '/khmermusic/': 'v2',
  '/khmermusic/manifest.json': 'v2',

  '/lao/config.js': 'v2',
  '/lao/': 'v2',
  '/lao/db/agrilao.peak.zst': 'v1',
  '/lao/db/csea.peak.zst': 'v1',
  '/lao/db/kerr4.peak.zst': 'v1',
  '/lao/db/laobibleword.peak.zst': 'v2',
  '/lao/db/laotech.peak.zst': 'v1',
  '/lao/db/lo_ulb.peak.zst': 'v1',
  '/lao/db/pat4.peak.zst': 'v1',
  '/lao/manifest.json': 'v2',

  '/lozi/config.js': 'v1',
  '/lozi/': 'v2',
  '/lozi/db/lozi.peak.zst': 'v1',
  '/lozi/manifest.json': 'v2',

  '/english/config.js': 'v1',
  '/english/': 'v2',
  '/english/db/bibleworden.peak.zst': 'v3',
  '/english/db/eng-bsb.peak.zst': 'v1',
  '/english/db/eng-kjv.peak.zst': 'v1',
  '/english/db/engULB.peak.zst': 'v1',
  '/english/db/opted.peak.zst': 'v1',
  '/english/db/strongs.peak.zst': 'v1',
  '/english/manifest.json': 'v2',

  '/chitonga/config.js': 'v1',
  '/chitonga/': 'v2',
  '/chitonga/db/tnouns.peak.zst': 'v1',
  '/chitonga/db/toibible.peak.zst': 'v1',
  '/chitonga/db/tother.peak.zst': 'v1',
  '/chitonga/db/tverbs.peak.zst': 'v1',
  '/chitonga/manifest.json': 'v2',
};

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

function getFileVersion(url) {
  const path = new URL(url).pathname.replace(/\/$/, '') || '/';
  return FILE_VERSIONS[path] || FILE_VERSIONS[path + '/'];
}

function isVersionedFile(url) {
  return getFileVersion(url) !== undefined;
}

async function getOldCacheNames() {
  const names = await caches.keys();
  return names.filter(name => name !== CURRENT_CACHE);
}

async function cleanupEmptyOldCaches() {
  const oldNames = await getOldCacheNames();
  for (const name of oldNames) {
    const cache = await caches.open(name);
    if ((await cache.keys()).length === 0) {
      await caches.delete(name);
      console.log('🗑️ Deleted empty old cache:', name);
    }
  }
}

async function migrateAndCleanCaches() {
  const currentCache = await caches.open(CURRENT_CACHE);
  const oldNames = await getOldCacheNames();

  for (const oldName of oldNames) {
    const oldCache = await caches.open(oldName);
    const requests = await oldCache.keys();

    for (const req of requests) {
      const res = await oldCache.match(req);
      if (!res) continue;

      const url = req.url;

      if (!isVersionedFile(url)) {
        await oldCache.delete(req);
        continue;
      }

      const expected = getFileVersion(url);
      const stored = res.headers.get('X-File-Version') || null;

      if (stored === expected) {
        // Safe: clone once → put clone → original can still be used if needed elsewhere
        await currentCache.put(req, res.clone());
        await oldCache.delete(req);
      }
      // outdated → keep in old for fallback
    }
  }

  // Clean stale in current
  const currReqs = await currentCache.keys();
  for (const req of currReqs) {
    const res = await currentCache.match(req);
    if (!res) continue;
    const url = req.url;
    if (!isVersionedFile(url)) continue;
    const expected = getFileVersion(url);
    const actual = res.headers.get('X-File-Version') || null;
    if (actual !== expected) {
      await currentCache.delete(req);
    }
  }

  await cleanupEmptyOldCaches();
}

self.addEventListener('install', event => {
  event.waitUntil(
    migrateAndCleanCaches().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function generateOfflinePage(url) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Offline</title></head>
<body style="font-family:sans-serif;text-align:center;padding:2rem;">
<h2>Offline</h2><p>Resource not available offline:</p><code>${url}</code>
</body></html>`;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CURRENT_CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    // Try old caches
    let oldResp = null;
    let oldCacheName = null;
    const oldNames = await getOldCacheNames();

    for (const name of oldNames) {
      const oldC = await caches.open(name);
      const r = await oldC.match(event.request);
      if (r) {
        oldResp = r;
        oldCacheName = name;
        break;
      }
    }

    if (!oldResp) {
      // Pure network path
      try {
        const netResp = await fetch(event.request, {cache: 'reload'});
        if (netResp.ok && netResp.type === 'basic') {
          const clone = netResp.clone();
          if (isVersionedFile(event.request.url)) {
            const ver = getFileVersion(event.request.url);
            const h = new Headers(netResp.headers);
            h.set('X-File-Version', ver);
            cache.put(event.request, new Response(clone.body, { status: netResp.status, statusText: netResp.statusText, headers: h }));
          } else {
            cache.put(event.request, clone);
          }
        }
        return netResp;
      } catch {
        return new Response(generateOfflinePage(event.request.url), { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    }

    // We have old response → serve it immediately (fast + offline safe)
    const url = event.request.url;
    const versioned = isVersionedFile(url);
    const currentVer = getFileVersion(url);
    const oldVer = oldResp.headers.get('X-File-Version') || null;

    if (versioned && oldVer === currentVer) {
      // Move forward safely
      cache.put(event.request, oldResp.clone());
      const oldC = await caches.open(oldCacheName);
      oldC.delete(event.request);
      cleanupEmptyOldCaches();
    } else if (versioned && oldVer !== currentVer) {
      // Serve old → update in background
      (async () => {
        try {
          const net = await fetch(event.request, {cache: 'reload'});
          if (!net.ok || net.type !== 'basic') return;
          const clone = net.clone();
          const h = new Headers(net.headers);
          h.set('X-File-Version', currentVer);
          cache.put(event.request, new Response(clone.body, { status: net.status, statusText: net.statusText, headers: h }));
          const oldC = await caches.open(oldCacheName);
          oldC.delete(event.request);
          cleanupEmptyOldCaches();
        } catch {} // silent
      })();
    } else {
      // Non-versioned in old → just move
      cache.put(event.request, oldResp.clone());
      const oldC = await caches.open(oldCacheName);
      oldC.delete(event.request);
    }

    return oldResp;  // ← always return the old one first → no lock issue

  })());
});
