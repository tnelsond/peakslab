const CURRENT_CACHE = 'peakslab-0.6.0.1';   // ← Bump this on every deploy!
const OLD_CACHE = 'peakslab-old';

const FILE_VERSIONS = {
  '/': 'v8.0',
  '/app.js': 'v12.4.7',
  '/peakworker.js': 'v9.0.2',
  '/peak.wasm': 'v1.3',
  '/peakslab.svg': 'v1',
  '/peak32x32.png': 'v1',
  '/peak192x192.png': 'v1',
  '/peak512x512.png': 'v1',
  '/style.css': 'v9.3',
  '/peakgen.wasm': 'v4',
  '/peakgen.html': 'v1',
  '/peakgen.js': 'v2',
	'/jbig2.wasm': 'v4',
	'/codec2.wasm': 'v1',

	'/levantine/': 'v1',
	'/levantine/config.js': 'v2',
	'/levantine/manifest.json': 'v1',
	'/levantine/db/vandyke.peak.zst': 'v3',
	'/levantine/db/livinglevantine.peak.zst': 'v1',
	'/levantine/db/livinglevantineforms.peak.zst': 'v1',

	'/nepali/': 'v1',
	'/nepali/config.js': 'v7',
	'/nepali/manifest.json': 'v1',
	'/nepali/db/ne-gp.peak.zst': 'v1',
	'/nepali/db/ne-kaikki.peak.zst': 'v1',
	'/nepali/db/ne-sabdakosh.peak.zst': 'v2',
	'/nepali/db/ne-ULB.peak.zst': 'v2',
	'/nepali/db/biblewordne.peak.zst': 'v1',
	'/nepali/db/ne-audio.slab': 'v1',

	'/khmer/': 'v5',
  '/khmer/config.js': 'v1.4',
  '/khmer/db/ant.peak.zst': 'v3',
  '/khmer/db/baby.peak.zst': 'v4',
  '/khmer/db/bible.peak.zst': 'v2',
  '/khmer/db/biblewordkm.peak.zst': 'v3',
  '/khmer/db/choukprov.peak.zst': 'v2',
  '/khmer/db/cambogeo.peak.zst': 'v3',
  '/khmer/db/hymns7.peak.zst': 'v3',
  '/khmer/db/khmer92_h97.peak.zst': 'v2',
  '/khmer/db/kmULB.peak.zst': 'v6',
  '/khmer/db/kcb2012.peak.zst': 'v1',
  '/khmer/db/gkb.peak.zst': 'v1',
  '/khmer/db/khbiblemuslim.peak.zst': 'v1',
  '/khmer/db/khov2016.peak.zst': 'v1',
  '/khmer/db/khsv.peak.zst': 'v3',
  '/khmer/db/khov.peak.zst': 'v3',
  '/khmer/db/nath2022_8.peak.zst': 'v2',
  '/khmer/db/plantdict.peak.zst': 'v2',
  '/khmer/db/seacount.peak.zst': 'v2',
  '/khmer/db/sonv3.peak.zst': 'v2',
  '/khmer/db/media.slab.zst': 'v1',
  '/khmer/db/kora.slab': 'v3',
  '/khmer/db/khsv-ant.slab.zst': 'v1',
  '/khmer/db/khsv-aot.slab.zst': 'v1',
  '/khmer/manifest.json': 'v4',

  '/khmermusic/config.js': 'v4',
  '/khmermusic/': 'v2',
  '/khmermusic/manifest.json': 'v2',

  '/lao/config.js': 'v3',
  '/lao/': 'v3',
  '/lao/db/agrilao.peak.zst': 'v2',
  '/lao/db/csea.peak.zst': 'v2',
  '/lao/db/kerr4.peak.zst': 'v2',
  '/lao/db/laobibleword.peak.zst': 'v3',
  '/lao/db/laotech.peak.zst': 'v2',
  '/lao/db/lo_ulb.peak.zst': 'v4',
  '/lao/db/lao2012bible.peak.zst': 'v1',
  '/lao/db/laoLCVbible.peak.zst': 'v1',
  '/lao/db/laomienbible.peak.zst': 'v1',
  '/lao/db/pat4.peak.zst': 'v2',
  '/lao/manifest.json': 'v2',

  '/lozi/config.js': 'v1',
  '/lozi/': 'v3',
  '/lozi/db/lozi.peak.zst': 'v2',
  '/lozi/manifest.json': 'v3',

  '/german/config.js': 'v2',
  '/german/': 'v2',
  '/german/db/oxford-de.peak.zst': 'v3',
  '/german/db/duden.peak.zst': 'v1',
  '/german/db/deuSchBible.peak.zst': 'v3',
  '/german/manifest.json': 'v1',

  '/spanish/config.js': 'v1',
  '/spanish/': 'v2',
  '/spanish/db/esoxford.peak.zst': 'v1',
  '/spanish/db/es_biblewords.peak.zst': 'v1',
  '/spanish/db/esULB.peak.zst': 'v3',
  '/spanish/manifest.json': 'v1',

  '/portuguese/config.js': 'v4',
  '/portuguese/': 'v1',
  '/portuguese/db/pt-eng.peak.zst': 'v2',
  '/portuguese/db/pt-oxford.peak.zst': 'v1',
  '/portuguese/db/pt-biblewords.peak.zst': 'v1',
  '/portuguese/db/pt-b-onv.peak.zst': 'v2',
  '/portuguese/db/pt-b-mundial.peak.zst': 'v2',
  '/portuguese/db/pt-b-livre.peak.zst': 'v2',
  '/portuguese/manifest.json': 'v1',

  '/indonesian/config.js': 'v5',
  '/indonesian/': 'v2',
  '/indonesian/db/kaikki-ind.peak.zst': 'v4',
  '/indonesian/db/indTB.peak.zst': 'v4',
  '/indonesian/db/ind-eng2.peak.zst': 'v2',
  '/indonesian/db/ind-eng3.peak.zst': 'v1',
  '/indonesian/db/KBBI_EN.peak.zst': 'v2',
  '/indonesian/manifest.json': 'v1',

  '/english/config.js': 'v4',
  '/english/': 'v3',
  '/english/db/bibleworden.peak.zst': 'v5',
  '/english/db/hymn-collection.slab': 'v1',
  '/english/db/psascott.peak.zst': 'v1',
  '/english/db/psa1562.peak.zst': 'v1',
  '/english/db/psabradytate.peak.zst': 'v1',
  '/english/db/eng-bsb.peak.zst': 'v5',
  '/english/db/eng-kjv.peak.zst': 'v5',
  '/english/db/engULB.peak.zst': 'v8',
  '/english/db/opted.peak.zst': 'v2',
  '/english/db/oxford-a.slab': 'v1',
  '/english/db/oxforden.peak.zst': 'v1',
  '/english/db/strongs.peak.zst': 'v2',
  '/english/manifest.json': 'v3',

  '/chitonga/config.js': 'v1',
  '/chitonga/': 'v3',
  '/chitonga/db/tnouns.peak.zst': 'v2',
  '/chitonga/db/toibible.peak.zst': 'v4',
  '/chitonga/db/tother.peak.zst': 'v2',
  '/chitonga/db/tverbs.peak.zst': 'v2',
  '/chitonga/manifest.json': 'v2',
};

function normalizePathname(pathname) {
  let p = pathname;
  p = p.replace(/\/index\.html?$/, '/');
  p = p.replace(/(\/[^\/.]+)$/, '$1/');
  return p;
}

function getNormalizedRequest(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  const normalizedPath = normalizePathname(url.pathname);
  url.pathname = normalizedPath;

  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    redirect: request.redirect,
    referrer: request.referrer,
    integrity: request.integrity,
    cache: request.cache,
  });
}

function addVersionHeader(response, version) {
  const headers = new Headers(response.headers);
  headers.set('X-File-Version', version);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function sendFileVersions() {
  const currentCache = await caches.open(CURRENT_CACHE);
  const cachedRequests = await currentCache.keys();
  
  const cachedFiles = {};
  for (const req of cachedRequests) {
    const normPath = new URL(req.url).pathname;
    if (normPath in FILE_VERSIONS) {
      cachedFiles[normPath] = FILE_VERSIONS[normPath];
    }
  }

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: 'status',
      version: CURRENT_CACHE,
      files: cachedFiles,
    });
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'getstatus') {
    sendFileVersions();
  }
});

// Install
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const currentCache = await caches.open(CURRENT_CACHE);
    const oldCache = await caches.open(OLD_CACHE);

    // 1. Migrate from any other old caches
    for (const cacheName of cacheNames) {
      if (cacheName === CURRENT_CACHE || cacheName === OLD_CACHE) continue;

      const sourceCache = await caches.open(cacheName);
      const requests = await sourceCache.keys();

      for (const req of requests) {
        const normReq = getNormalizedRequest(req);
        const normPath = new URL(normReq.url).pathname;
        const response = await sourceCache.match(req);

        if (response && normPath in FILE_VERSIONS) {
          await oldCache.put(normReq, response.clone());
        }
      }
      await caches.delete(cacheName);
    }

    // 2. Deduplicate: If a file is in CURRENT_CACHE, remove it from OLD_CACHE
    const oldRequests = await oldCache.keys();
    for (const oldReq of oldRequests) {
      const normReq = getNormalizedRequest(oldReq);
      if (await currentCache.match(normReq)) {
        await oldCache.delete(oldReq);
      }
    }

    // 3. Promote matching-version files from OLD_CACHE to CURRENT_CACHE
    const remainingOldRequests = await oldCache.keys();
    for (const oldReq of remainingOldRequests) {
      const normReq = getNormalizedRequest(oldReq);
      const normPath = new URL(normReq.url).pathname;
      const response = await oldCache.match(oldReq);

      if (response && normPath in FILE_VERSIONS) {
        const cachedVersion = response.headers.get('X-File-Version') || null;
        const expectedVersion = FILE_VERSIONS[normPath];

        if (cachedVersion === expectedVersion || cachedVersion === null) {
          const versionedResponse = addVersionHeader(response.clone(), expectedVersion);
          await currentCache.put(normReq, versionedResponse);
          await oldCache.delete(oldReq);
        }
      }
    }

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const originalUrl = new URL(event.request.url);
  const normReq = getNormalizedRequest(event.request);
  const normPath = new URL(normReq.url).pathname;

  // Trailing slash redirect for paths with no file extension
  if (!originalUrl.pathname.match(/\.[^\/]+$/) && !originalUrl.pathname.endsWith('/')) {
    const redirectTo = originalUrl.pathname + '/';
    return event.respondWith(
      new Response('', {
        status: 301,
        statusText: 'Moved Permanently',
        headers: { 
          'Location': redirectTo + originalUrl.search + originalUrl.hash 
        }
      })
    );
  }

  // Files not in FILE_VERSIONS → network only
  if (!(normPath in FILE_VERSIONS)) {
    return event.respondWith(fetch(event.request));
  }

  event.respondWith((async () => {
    const expectedVersion = FILE_VERSIONS[normPath];

    // 1. CURRENT_CACHE
    const currentCache = await caches.open(CURRENT_CACHE);
    let response = await currentCache.match(normReq);
    if (response) {
      if (event.request.mode === 'navigate' || normPath === '/') {
        sendFileVersions();
      }
      return response;
    }

    // 2. OLD_CACHE (only if missing from current)
    const oldCache = await caches.open(OLD_CACHE);
    response = await oldCache.match(normReq);
    if (response) {
      const cachedVersion = response.headers.get('X-File-Version') || null;

      // Background update + promote to CURRENT_CACHE if version changed or missing header
      if (cachedVersion !== expectedVersion) {
        fetch(normReq).then(async (netResp) => {
          if (netResp && netResp.ok) {
            const versionedResp = addVersionHeader(netResp.clone(), expectedVersion);
            await currentCache.put(normReq, versionedResp);

            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of clients) {
              client.postMessage({
                type: 'new',
                url: normReq.url,
                version: expectedVersion,
              });
            }

            await oldCache.delete(normReq);
          }
        }).catch(() => {});
      } else {
        // Same version → promote to CURRENT_CACHE
        const versionedResp = addVersionHeader(response.clone(), expectedVersion);
        await currentCache.put(normReq, versionedResp);
        await oldCache.delete(normReq);
      }

      if (event.request.mode === 'navigate' || normPath === '/') {
        sendFileVersions();
      }
      return response.clone();
    }

    // 3. Network fetch (first time)
    try {
      const networkResponse = await fetch(normReq);
      if (networkResponse && networkResponse.ok) {
        const versionedResponse = addVersionHeader(networkResponse.clone(), expectedVersion);
        await currentCache.put(normReq, versionedResponse);

        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({
            type: 'new',
            url: normReq.url,
            version: expectedVersion,
          });
        }
      }

      if (event.request.mode === 'navigate' || normPath === '/') {
        sendFileVersions();
      }
      return networkResponse;
    } catch (err) {
      return new Response('You are offline and this file has not been cached yet.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  })());
});
