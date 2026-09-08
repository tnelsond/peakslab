/*
 * PeakSlab service worker
 * ------------------------
 * - Cache-first for everything.
 * - files.json is the manifest of truth: [path, description, size, order, timestamp]
 * - On install: build a NEW versioned cache (name derived from files.json content),
 *   consolidating unchanged files straight out of any existing "peakslab*" caches
 *   (no re-download) and fetching only new/updated files from the network.
 * - On activate: delete every old "peakslab*" cache, leaving only the new one.
 * - On fetch: serve from cache immediately. files.json is only re-checked when a new
 *   service worker is installed (the browser's normal SW update check is what
 *   triggers that) - there's no periodic polling while the app is just running.
 * - manifest.json is never cached/fetched from the network - it's generated on the fly
 *   for whatever path it was requested from (root or per-language sub-app).
 * - Any HTML / navigation / directory request whose path isn't a known file in
 *   files.json falls back to the root index.html (SPA-style fallback).
 */

const VERSION = "0.66.1";
const CACHE_PREFIX = 'peakslab';

// Base manifest template - per-path manifests are derived from this.
const BASE_MANIFEST = {
  name: 'PeakSlab',
  short_name: 'PeakSlab',
  description: 'A dictionary app.',
  theme_color: '#664433',
  background_color: '#664433',
  display: 'standalone',
  scope: '/',
  start_url: '/',
  icons: [
    { src: '/peak32x32.png', sizes: '32x32', type: 'image/png' },
    { src: '/peak192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/peak512x512.png', sizes: '512x512', type: 'image/png' },
    { src: '/peakslab.svg', sizes: 'any' }
  ],
  share_target: {
    action: '/',
    method: 'GET',
    enctype: 'application/x-www-form-urlencoded',
    params: { text: 'text' }
  }
};

// ---- module state (rebuilt lazily if the worker is respawned) ----
let filesMap = new Map();      // normalized path -> {description, size, order, timestamp}
let cacheName = null;          // the cache this install created
let cachedCacheName = null;    // memoized "current" cache name for fetch handling

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(doInstall());
});

self.addEventListener('activate', event => {
  event.waitUntil(doActivate());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'getstatus') {
    event.waitUntil(sendStatus(event.source));
  }
});

async function sendStatus(client) {
  await ensureFilesLoaded();
  const files = {};
  for (const [path, meta] of filesMap.entries()) files[path] = meta.timestamp;
  const message = { type: 'status', version: await getCurrentCacheName(), files };
  if (client) {
    client.postMessage(message);
  } else {
    const all = await self.clients.matchAll();
    all.forEach(c => c.postMessage(message));
  }
}

async function broadcastNew(path) {
  const all = await self.clients.matchAll();
  all.forEach(c => c.postMessage({ type: 'new', url: path }));
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  event.respondWith(handleFetch(event.request, url));
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalizePath(p) {
  return p.startsWith('/') ? p : '/' + p;
}

function parseFilesArray(arr) {
  const map = new Map();
  for (const entry of arr) {
    const [path, description, size, order, timestamp] = entry;
    map.set(normalizePath(path), { description, size, order, timestamp });
  }
  return map;
}

async function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Loads files.json from the network; falls back to any existing cached copy
// (from an old peakslab cache) if the network is unavailable.
async function loadFilesJson() {
  try {
    const res = await fetch('/files.json', { cache: 'no-store' });
    const text = await res.text();
    const arr = JSON.parse(text);
    return { arr, map: parseFilesArray(arr), text };
  } catch (e) {
    const keys = await caches.keys();
    for (const key of keys.filter(k => k.startsWith(CACHE_PREFIX))) {
      const cache = await caches.open(key);
      const cached = await cache.match('/files.json');
      if (cached) {
        const text = await cached.text();
        const arr = JSON.parse(text);
        return { arr, map: parseFilesArray(arr), text };
      }
    }
    throw e;
  }
}

async function getCurrentCacheName() {
  if (cachedCacheName) return cachedCacheName;
  const keys = await caches.keys();
  const peakCaches = keys.filter(k => k.startsWith(CACHE_PREFIX));
  cachedCacheName = peakCaches[peakCaches.length - 1] || cacheName;
  return cachedCacheName;
}

async function ensureFilesLoaded() {
  if (filesMap.size) return;
  try {
    const cache = await caches.open(await getCurrentCacheName());
    const cached = await cache.match('/files.json');
    if (cached) {
      filesMap = parseFilesArray(await cached.json());
    }
  } catch (e) {
    /* ignore - will retry on next request */
  }
}

// ---------------------------------------------------------------------------
// install: build the new cache, consolidating from old ones where possible
// ---------------------------------------------------------------------------

async function doInstall() {
  const { arr, map, text } = await loadFilesJson();
  filesMap = map;

  const version = await simpleHash(text);
  cacheName = `${CACHE_PREFIX}-${version}`;
  const newCache = await caches.open(cacheName);

  // Gather every existing peakslab cache so we can consolidate from them.
  const existingKeys = await caches.keys();
  const oldCacheNames = existingKeys.filter(k => k.startsWith(CACHE_PREFIX) && k !== cacheName);
  const oldCaches = await Promise.all(oldCacheNames.map(n => caches.open(n)));

  await newCache.put(
    '/files.json',
    new Response(text, { headers: { 'Content-Type': 'application/json' } })
  );

  const tasks = [];
  for (const [path, meta] of filesMap.entries()) {
    tasks.push(consolidateOrFetch(path, meta, newCache, oldCaches));
  }
  await Promise.allSettled(tasks);

  // Alias '/' to the root index.html so direct root requests hit cache too.
  const rootIndex = await newCache.match('/index.html');
  if (rootIndex) await newCache.put('/', rootIndex.clone());

  cachedCacheName = cacheName;
}

async function consolidateOrFetch(path, meta, newCache, oldCaches) {
  // Try to pull an up-to-date copy out of any existing cache first - avoids
  // re-downloading files that haven't changed.
  for (const oc of oldCaches) {
    const cached = await oc.match(path);
    if (cached) {
      const cachedTs = parseInt(cached.headers.get('x-peak-timestamp') || '0', 10);
      if (cachedTs >= meta.timestamp) {
        await newCache.put(path, cached.clone());
        return;
      }
    }
  }
  // Missing or stale - fetch fresh from the network.
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (res && res.ok) {
      const buf = await res.arrayBuffer();
      const headers = new Headers(res.headers);
      headers.set('x-peak-timestamp', String(meta.timestamp));
      await newCache.put(path, new Response(buf, { status: res.status, statusText: res.statusText, headers }));
      broadcastNew(path);
    }
  } catch (e) {
    /* offline during install - will be picked up on the next SW update check */
  }
}

// ---------------------------------------------------------------------------
// activate: drop old caches now that the new one has replaced them
// ---------------------------------------------------------------------------

async function doActivate() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== cacheName).map(k => caches.delete(k))
  );
  if (cacheName) cachedCacheName = cacheName;
  await self.clients.claim();
}

// ---------------------------------------------------------------------------
// fetch handling
// ---------------------------------------------------------------------------

async function handleFetch(request, url) {
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/manifest.json' || pathname.endsWith('/manifest.json')) {
    return generateManifestResponse(pathname);
  }

  const isHtmlish =
    request.mode === 'navigate' || pathname.endsWith('.html') || pathname.endsWith('/');

  if (isHtmlish) {
    return handleHtmlRequest(pathname);
  }

  return cacheFirst(request, pathname);
}

function generateManifestResponse(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const dir = segments.length > 1 ? segments[0] : '';

  const manifest = JSON.parse(JSON.stringify(BASE_MANIFEST));
  if (dir) {
    const label = dir.charAt(0).toUpperCase() + dir.slice(1);
    manifest.name = `${BASE_MANIFEST.name} ${label}`;
    manifest.short_name = `PS ${label}`;
    manifest.scope = `/${dir}/`;
    manifest.start_url = `/${dir}/`;
    manifest.share_target.action = `/${dir}/`;
  }

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/manifest+json' }
  });
}

async function handleHtmlRequest(pathname) {
  await ensureFilesLoaded();
  const cache = await caches.open(await getCurrentCacheName());

  let targetPath = pathname === '/' ? '/index.html' : pathname;
  if (targetPath.endsWith('/')) targetPath += 'index.html';

  if (!filesMap.has(targetPath)) {
    targetPath = '/index.html'; // fallback: unknown page/directory -> root SPA shell
  }

  const cached = await cache.match(targetPath);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch('/index.html');
    return res;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request, pathname) {
  await ensureFilesLoaded();
  const cache = await caches.open(await getCurrentCacheName());

  const cached = (await cache.match(pathname)) || (await cache.match(request));
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const meta = filesMap.get(pathname);
      const buf = await res.clone().arrayBuffer();
      const headers = new Headers(res.headers);
      headers.set('x-peak-timestamp', String(meta ? meta.timestamp : Date.now()));
      await cache.put(pathname, new Response(buf, { status: res.status, statusText: res.statusText, headers }));
      broadcastNew(pathname);
    }
    return res;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}


