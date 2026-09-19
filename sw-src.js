/*
 * PeakSlab service worker
 * - Cache-first for everything.
 * - files.json is the manifest of truth: core entries are [path, timestamp];
 *   dicts entries are [path, timestamp, description, size, order]. timestamp
 *   is always element[1] regardless of file type.
 * - On install: build a NEW versioned cache (name derived from files.json content),
 *   consolidating unchanged files straight out of any existing "peakslab*" caches
 *   (no re-download) and fetching only new/updated files from the network.
 *   Core files are mandatory; if any core file can't be obtained from an old
 *   cache or the network, install still completes (so the worker can still
 *   activate and serve whatever it does have), but is marked incomplete -
 *   see the "__install_complete__" marker below.
 * - On activate: delete every old "peakslab*" cache, leaving only the new one -
 *   but ONLY if the new cache's install completed cleanly (see above). An
 *   incomplete new cache still activates and takes over, but the old
 *   cache(s) are kept as a fallback rather than deleted, since they may hold
 *   files the new cache is still missing.
 * - On fetch: serve from cache immediately. files.json is only re-checked when a new
 *   service worker is installed (the browser's normal SW update check is what
 *   triggers that) - there's no periodic polling while the app is just running.
 * - manifest.json is never cached/fetched from the network - it's generated on the fly
 *   for whatever path it was requested from (root or per-language sub-app).
 * - Any HTML / navigation / directory request whose path isn't a known file in
 *   files.json falls back to 404.html, which doubles as the SPA shell (no
 *   separate index.html - that duplication was removed).
 */


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
// NOTE: these are plain module variables, which do NOT survive the worker
// being killed and respawned by the browser between separate events -
// 'install' and 'activate' are not guaranteed to run in the same worker
// lifetime. If that happens, this file re-executes top to bottom and
// cacheName/cachedCacheName reset to null. doActivate() below is written to
// tolerate that explicitly - see the comment there.

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
  const cache = await caches.open(await getCurrentCacheName());

  // Only report files that are actually in the cache right now - dicts are
  // cached lazily (see consolidateOnly), so most of the manifest may not be
  // downloaded yet and shouldn't be reported as available.
  // Use cache.match(path) per entry (same lookup cacheFirst() uses) rather
  // than comparing cache.keys() URLs against filesMap paths directly - the
  // Cache API stores/returns percent-encoded URLs, so a raw string
  // comparison silently fails to match anything with encoded characters.
  const files = {};
  await Promise.all(
    Array.from(filesMap.entries()).map(async ([path, meta]) => {
      const cached = await cache.match(path);
      if (cached) files[path] = meta.timestamp;
    })
  );

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

function parseFilesArray(data) {
  const map = new Map();
  // Both sections now put timestamp at index 1:
  //   core:  [path, timestamp]
  //   dicts: [path, timestamp, description, size, order]
  for (const [path, timestamp] of (data.core || [])) {
    map.set(normalizePath(path), { description: undefined, size: undefined, order: undefined, timestamp });
  }
  for (const [path, timestamp, description, size, order] of (data.dicts || [])) {
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

  // Only 'core' files are mandatory at install time. 'dicts' are large and
  // potentially numerous - we don't want to force-download every dictionary
  // just because the manifest changed. Dicts are consolidated forward from
  // an old cache when already present (no network cost), but are otherwise
  // left uncached and picked up lazily by cacheFirst() the first time the
  // user actually requests them.
  const coreSet = new Set((arr.core || []).map(([path]) => normalizePath(path)));
  const entries = Array.from(filesMap.entries());

  // Both consolidate functions are exception-safe and always resolve (never
  // reject) with a boolean, so a plain Promise.all is fine here - no need
  // for allSettled, and we get a real success/failure signal per file
  // instead of it disappearing silently.
  const results = await Promise.all(entries.map(([path, meta]) =>
    coreSet.has(path)
      ? consolidateOrFetch(path, meta, newCache, oldCaches)
      : consolidateOnly(path, meta, newCache, oldCaches)
  ));

  // If a core file couldn't be obtained from an old cache OR the network
  // (offline mid-install, a transient error, a genuinely missing file), we
  // deliberately do NOT throw/abort the install over it. Aborting would
  // reject this whole install and the worker would never activate at all -
  // which is worse than a partially-populated cache, since then NOTHING
  // service-worker-dependent works (dynamic manifest.json, the HTML/SPA
  // fallback, etc.), even while online. Instead, record completeness as a
  // marker stored *inside the new cache itself* (not a module variable,
  // which can be lost if the worker restarts before doActivate runs - see
  // doActivate) and let doActivate decide whether it's safe to delete the
  // old cache(s) based on that marker. Missing files are filled in on
  // demand the next time they're actually requested (cacheFirst fetches
  // live if not cached).
  const missingCore = entries
    .filter(([path], i) => coreSet.has(path) && !results[i])
    .map(([path]) => path);
  if (missingCore.length) {
    console.warn(`Install finished with missing core file(s), keeping old cache(s) as fallback: ${missingCore.join(', ')}`);
  }
  await newCache.put('/__install_complete__', new Response(missingCore.length ? '0' : '1'));

  // Alias '/' to 404.html - it's the single SPA shell now, so direct root
  // requests hit cache too.
  const shell = await newCache.match('/404.html');
  if (shell) await newCache.put('/', shell.clone());

  cachedCacheName = cacheName;
}

async function consolidateOrFetch(path, meta, newCache, oldCaches) {
  // Try to pull an up-to-date copy out of any existing cache first - avoids
  // re-downloading files that haven't changed. Wrapped in try/catch: a
  // cache write can throw (e.g. QuotaExceededError if storage is full), and
  // that shouldn't propagate out of here uncaught - just fall through to
  // the network-fetch attempt below instead.
  try {
    for (const oc of oldCaches) {
      const cached = await oc.match(path);
      if (cached) {
        const cachedTs = parseInt(cached.headers.get('x-peak-timestamp') || '0', 10);
        if (cachedTs >= meta.timestamp) {
          await newCache.put(path, cached.clone());
          return true;
        }
        // else: stale copy in this old cache - keep checking the rest of
        // oldCaches for a fresher one before giving up on consolidating.
      }
    }
  } catch (e) {
    console.warn(`Failed to consolidate ${path} from an old cache, will try the network:`, e);
  }

  // Missing or stale everywhere - fetch fresh from the network. One retry
  // on a network-level failure (thrown fetch) - covers transient hiccups
  // (a dropped connection, a dev-server reset) unrelated to the file
  // actually being missing. A real non-OK response (404 etc.) is not
  // retried, since retrying won't make a missing file appear.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (res && res.ok) {
        const buf = await res.arrayBuffer();
        const headers = new Headers(res.headers);
        headers.set('x-peak-timestamp', String(meta.timestamp));
        await newCache.put(path, new Response(buf, { status: res.status, statusText: res.statusText, headers }));
        broadcastNew(path);
        return true;
      }
      return false;
    } catch (e) {
      if (attempt === 1) console.warn(`Failed to fetch ${path}:`, e);
      // else: loop around for the retry
    }
  }
  return false;
}

// Like consolidateOrFetch, but never hits the network. Used for files (e.g.
// dictionaries) that shouldn't be force-downloaded just because they're
// listed in the manifest - only carried forward if already cached.
async function consolidateOnly(path, meta, newCache, oldCaches) {
  try {
    for (const oc of oldCaches) {
      const cached = await oc.match(path);
      if (cached) {
        const cachedTs = parseInt(cached.headers.get('x-peak-timestamp') || '0', 10);
        if (cachedTs >= meta.timestamp) {
          await newCache.put(path, cached.clone());
          return true;
        }
        // else: this old cache's copy is stale - fall through and keep
        // checking the rest of oldCaches instead of giving up immediately.
        // (Previously this `return`ed unconditionally right here, so a
        // stale match in the first old cache checked would stop the loop
        // before ever looking at a possibly-fresher copy in a later one -
        // silently dropping an already-downloaded dictionary back to
        // "not downloaded" depending on old-cache iteration order.)
      }
    }
  } catch (e) {
    console.warn(`Failed to consolidate ${path} from an old cache:`, e);
  }
  // Not previously cached anywhere (or consolidating it failed) - leave it
  // uncached. cacheFirst() will fetch and cache it the first time it's
  // actually requested.
  return false;
}

// ---------------------------------------------------------------------------
// activate: drop old caches now that the new one has replaced them
// ---------------------------------------------------------------------------

async function doActivate() {
  // The worker may have been killed and respawned between 'install' and
  // 'activate' (see the note on module state above), in which case
  // `cacheName` is null here even though doInstall() already finished
  // successfully in a prior worker instance. Previously that meant the
  // delete-old-caches filter below (`k !== cacheName`) matched EVERY
  // peakslab cache - including the one doInstall() just finished
  // downloading - wiping out the freshly downloaded files instead of the
  // stale ones. Recompute the same deterministic name doInstall() would
  // have used before doing anything destructive.
  if (!cacheName) {
    try {
      const { text } = await loadFilesJson();
      cacheName = `${CACHE_PREFIX}-${await simpleHash(text)}`;
    } catch (e) {
      // Can't determine the current version (fully offline, no cached
      // files.json at all anywhere) - don't delete anything, just take
      // control with whatever's already active.
      await self.clients.claim();
      return;
    }
  }

  const keys = await caches.keys();
  const ours = keys.filter(k => k.startsWith(CACHE_PREFIX));

  // Extra safety net: only consider deleting other caches once we've
  // confirmed the cache we're keeping actually exists on disk. If it
  // doesn't (e.g. the recomputed name above doesn't match anything, because
  // files.json changed again in between), bail out instead of wiping every
  // versioned cache with nothing confirmed to replace them.
  if (!ours.includes(cacheName)) {
    await self.clients.claim();
    return;
  }

  // Only delete the old cache(s) if this new cache's install finished
  // completely (see the "__install_complete__" marker written in
  // doInstall). If it's missing core files, keep the old cache(s) around as
  // a fallback for anything the new one can't yet serve, rather than
  // deleting the last known-good copies. A cache with no marker at all
  // (e.g. one that predates this fix) is treated as complete, so existing
  // installs aren't affected.
  const newCache = await caches.open(cacheName);
  const marker = await newCache.match('/__install_complete__');
  const complete = marker ? (await marker.text()) === '1' : true;

  if (complete) {
    await Promise.all(ours.filter(k => k !== cacheName).map(k => caches.delete(k)));
  } else {
    console.warn('New cache is incomplete - keeping old cache(s) as fallback until a future install succeeds.');
  }

  cachedCacheName = cacheName;
  await self.clients.claim();
}

// ---------------------------------------------------------------------------
// fetch handling
// ---------------------------------------------------------------------------

async function handleFetch(request, url) {
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/manifest.json' || pathname.endsWith('/manifest.json')) {
    return generateManifestResponse(pathname, request.referrer);
  }

  const isHtmlish =
    request.mode === 'navigate' || pathname.endsWith('.html') || pathname.endsWith('/');

  if (isHtmlish) {
    return handleHtmlRequest(pathname);
  }

  return cacheFirst(request, pathname);
}

function generateManifestResponse(pathname, referrer) {
  // Prefer the referring page's own URL to determine the app directory.
  // A <link rel="manifest" href="manifest.json"> is a *relative* reference,
  // and the browser resolves it against the page URL's own directory - but
  // our pages are addressed without a trailing slash (e.g. /khmer/music),
  // so the browser treats "music" as a filename and resolves the relative
  // link one level up, actually requesting /khmer/manifest.json. Stripping
  // the trailing 'manifest.json' segment from *that* request pathname would
  // then wrongly land one directory short. The referrer still holds the
  // real, un-mangled page path, so use it whenever it's available.
  let dirSegments = [];
  if (referrer) {
    try {
      const refUrl = new URL(referrer);
      if (refUrl.origin === self.location.origin) {
        dirSegments = refUrl.pathname.split('/').filter(Boolean);
      }
    } catch (e) {
      /* malformed/absent referrer - fall through to the pathname-based guess */
    }
  }
  if (!dirSegments.length) {
    // Fallback: no usable referrer, so fall back to the (possibly-mangled)
    // request pathname itself, treating everything but the trailing
    // 'manifest.json' segment as the app directory.
    const segments = pathname.split('/').filter(Boolean);
    dirSegments = segments.slice(0, -1);
  }
  const dir = dirSegments.join('/');

  const manifest = JSON.parse(JSON.stringify(BASE_MANIFEST));
  if (dir) {
    const label = dirSegments
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
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

  let targetPath = pathname === '/' ? '/404.html' : pathname;
  if (targetPath.endsWith('/')) targetPath += '404.html';

  if (!filesMap.has(targetPath)) {
    targetPath = '/404.html'; // fallback: unknown page/directory -> SPA shell
  }

  const cached = await cache.match(targetPath);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch('/404.html');
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
