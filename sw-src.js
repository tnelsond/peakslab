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
 * - On fetch: serve from cache immediately. files.json is re-checked in the
 *   background (throttled, conditional request) after navigations and when
 *   the app returns to the foreground; a changed manifest is applied to the
 *   current cache in place - see checkForFilesUpdate(). A new sw.js still
 *   goes through the normal install/activate path.
 * - manifest.json is never cached/fetched from the network - it's generated on the fly
 *   for whatever path it was requested from (root or per-language sub-app).
 * - Any HTML / navigation / directory request whose path isn't a known file in
 *   files.json falls back to 404.html, which doubles as the SPA shell (no
 *   separate index.html - that duplication was removed).
 */


const CACHE_PREFIX = 'peakslab';
const DICT_RE = /\.(peak|slab)(\.zst)?$/;

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
  // Sent by the page when it comes back to the foreground (an installed PWA
  // can stay open for days without navigating). Still throttled.
  if (event.data && event.data.type === 'checkupdate') {
    event.waitUntil(checkForFilesUpdate());
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

  // Version = hash of the files.json in use (updated in place, so the cache
  // name alone no longer tells you which manifest is live).
  const fj = await cache.match('/files.json');
  const version = (fj && fj.headers.get('x-peak-version')) || await getCurrentCacheName();
  const message = { type: 'status', version, files };
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
  // Opening/reloading the app is the natural moment to look for a new
  // files.json. Runs after the response, in the background (throttled).
  if (event.request.mode === 'navigate') event.waitUntil(checkForFilesUpdate());
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

// The cached copy of files.json carries the server's ETag (for cheap
// conditional re-checks, see checkForFilesUpdate) and a content hash that
// serves as the user-visible version.
async function filesJsonResponse(text, etag, map) {
  const headers = {
    'Content-Type': 'application/json',
    'x-peak-version': await simpleHash(text),
    'x-peak-timestamp': String((map.get('/files.json') || {}).timestamp || 0)
  };
  if (etag) headers['x-peak-etag'] = etag;
  return new Response(text, { headers });
}

// Loads files.json from the network; falls back to any existing cached copy
// (from an old peakslab cache) if the network is unavailable.
async function loadFilesJson() {
  try {
    // 'no-cache', not 'no-store': always checked with the server, but if the
    // page just downloaded it (first visit) the server answers "unchanged"
    // and the browser's copy is reused instead of downloading it again.
    const res = await fetch('/files.json', { cache: 'no-cache' });
    const text = await res.text();
    const arr = JSON.parse(text);
    return { arr, map: parseFilesArray(arr), text, etag: res.headers.get('etag') };
  } catch (e) {
    const keys = await caches.keys();
    for (const key of keys.filter(k => k.startsWith(CACHE_PREFIX))) {
      const cache = await caches.open(key);
      const cached = await cache.match('/files.json');
      if (cached) {
        const text = await cached.text();
        const arr = JSON.parse(text);
        return { arr, map: parseFilesArray(arr), text, etag: cached.headers.get('x-peak-etag') };
      }
    }
    throw e;
  }
}

// Newest peakslab cache whose install has FINISHED (it contains the
// '/__install_complete__' marker, written as the last step of doInstall).
// caches.keys() returns caches in creation order, so walk it backwards.
// This must never pick a cache that's still being built: if this worker was
// restarted while a newer worker is mid-install, "just take the last cache"
// would select the half-filled new cache, every dictionary would miss, and
// cacheFirst() would re-download them all from the network - which is why
// loading was sometimes slow online but always instant offline (offline,
// no update/install ever starts). Needs no network at all.
async function findInstalledCacheName() {
  const keys = (await caches.keys()).filter(k => k.startsWith(CACHE_PREFIX));
  for (let i = keys.length - 1; i >= 0; i--) {
    const c = await caches.open(keys[i]);
    if (await c.match('/__install_complete__')) return keys[i];
  }
  // Legacy caches from before the marker existed: the oldest one is the one
  // that was fully installed; anything newer may still be mid-install.
  return keys[0] || null;
}

async function getCurrentCacheName() {
  if (cachedCacheName) return cachedCacheName;
  cachedCacheName = (await findInstalledCacheName()) || cacheName;
  return cachedCacheName;
}

// On a miss in the current cache, look for a still-fresh copy in any other
// peakslab cache before going to the network (and copy it forward).
async function matchOtherCaches(pathname, current, meta) {
  const keys = (await caches.keys()).filter(k => k.startsWith(CACHE_PREFIX) && k !== current);
  for (let i = keys.length - 1; i >= 0; i--) {
    const hit = await (await caches.open(keys[i])).match(pathname);
    if (!hit) continue;
    const ts = parseInt(hit.headers.get('x-peak-timestamp') || '0', 10);
    if (!meta || ts >= meta.timestamp) return hit;
  }
  return null;
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
  const { arr, map, text, etag } = await loadFilesJson();
  filesMap = map;

  const version = await simpleHash(text);
  cacheName = `${CACHE_PREFIX}-${version}`;
  const newCache = await caches.open(cacheName);

  // Gather every existing peakslab cache so we can consolidate from them.
  const existingKeys = await caches.keys();
  const oldCacheNames = existingKeys.filter(k => k.startsWith(CACHE_PREFIX) && k !== cacheName);
  const oldCaches = await Promise.all(oldCacheNames.map(n => caches.open(n)));

  await newCache.put('/files.json', await filesJsonResponse(text, etag, map));

  // Only 'core' files are mandatory at install time. 'dicts' are large and
  // potentially numerous - we don't want to force-download every dictionary
  // just because the manifest changed. Dicts are consolidated forward from
  // an old cache when already present (no network cost), but are otherwise
  // left uncached and picked up lazily by cacheFirst() the first time the
  // user actually requests them.
  const coreSet = new Set((arr.core || []).map(([path]) => normalizePath(path)));
  // files.json itself was just stored above - don't download it a second time.
  const entries = Array.from(filesMap.entries()).filter(([path]) => path !== '/files.json');

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
  // Carry forward files that were cached lazily but aren't listed in
  // files.json (e.g. /peak.wasm, icons). Without this they were silently
  // dropped on every update, so the first load afterwards had to fetch
  // peak.wasm over the network before ANY dictionary could start loading.
  await carryForwardUnlisted(newCache, oldCaches);

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

async function carryForwardUnlisted(newCache, oldCaches) {
  const done = new Set();
  for (const oc of oldCaches.slice().reverse()) { // newest old cache first
    try {
      for (const req of await oc.keys()) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        if (done.has(path) || filesMap.has(path) || DICT_RE.test(path) ||
            path === '/' || path.startsWith('/__')) continue;
        done.add(path);
        if (await newCache.match(path)) continue;
        const res = await oc.match(req);
        if (res) await newCache.put(path, res);
      }
    } catch (e) {
      console.warn('Failed to carry forward unlisted files from an old cache:', e);
    }
  }
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

  // Missing or stale everywhere - fetch fresh from the network.
  return fetchInto(path, meta, newCache);
}

// Download one file into `cache`, tagged with its manifest timestamp. One
// retry on a network-level failure (thrown fetch) - covers transient hiccups
// unrelated to the file actually being missing. A real non-OK response
// (404 etc.) is not retried, since retrying won't make a missing file appear.
async function fetchInto(path, meta, newCache) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 'no-cache' (see loadFilesJson): revalidate instead of re-downloading
      // files the page itself has just fetched (peak.wasm, the logo, ...).
      const res = await fetch(path, { cache: 'no-cache' });
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

// ---------------------------------------------------------------------------
// files.json updates without a new service worker
// ---------------------------------------------------------------------------
//
// The browser only re-installs the worker when sw.js itself changes, so a
// deploy that only changes files.json (new or rebuilt dictionaries, a new
// 404.html) used to never reach existing users. Instead, after a navigation
// or when the app comes back to the foreground, check files.json in the
// background:
//  - Throttled to once per CHECK_INTERVAL (stored in the cache, so it holds
//    across worker restarts). Never delays a response.
//  - Conditional request (If-None-Match with the stored ETag): when nothing
//    changed the server answers 304 with no body.
//  - When it did change, update the current cache IN PLACE: download only
//    core files whose timestamp went up, then swap in the new files.json,
//    drop entries no longer listed, and re-download only the dictionaries
//    the user already had that changed. Nothing else is copied or fetched.

const CHECK_INTERVAL = 10 * 60 * 1000; // GitHub Pages' CDN caches for 10 min anyway
const CHECK_TIMEOUT = 15 * 1000;
let filesCheck = null; // in-flight check, so concurrent triggers share one

function checkForFilesUpdate(force = false) {
  if (!filesCheck) {
    filesCheck = doFilesCheck(force)
      .catch(e => console.warn('files.json update check failed:', e))
      .finally(() => { filesCheck = null; });
  }
  return filesCheck;
}

async function doFilesCheck(force) {
  // A new worker is being installed - its install fetches files.json anyway.
  if (self.registration.installing || self.registration.waiting) return;
  const name = await getCurrentCacheName();
  if (!name) return;
  const cache = await caches.open(name);

  if (!force) {
    const last = await cache.match('/__files_checked__');
    if (last && Date.now() - Number(await last.text()) < CHECK_INTERVAL) return;
  }
  await cache.put('/__files_checked__', new Response(String(Date.now())));

  const cached = await cache.match('/files.json');
  const etag = cached && cached.headers.get('x-peak-etag');

  // cache: 'no-store' keeps the browser's HTTP cache out of it, so a 304
  // reaches us as-is instead of being turned into a cached 200.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);
  let res, text;
  try {
    res = await fetch('/files.json', {
      cache: 'no-store',
      headers: etag ? { 'If-None-Match': etag } : {},
      signal: ctrl.signal
    });
    if (res.status === 304 || !res.ok) return;
    text = await res.text();
  } catch (e) {
    return; // offline or timed out - try again on a later trigger
  } finally {
    clearTimeout(timer);
  }

  const oldText = cached ? await cached.text() : '';
  let arr;
  try { arr = JSON.parse(text); } catch (e) { return; } // partial/garbled response
  const map = parseFilesArray(arr);

  if (text === oldText) {
    // Same content, new ETag (e.g. redeploy) - just remember the new ETag.
    await cache.put('/files.json', await filesJsonResponse(text, res.headers.get('etag'), map));
    return;
  }
  await applyFilesUpdate(cache, arr, map, text, res.headers.get('etag'), oldText);
}

async function applyFilesUpdate(cache, arr, map, text, etag, oldText) {
  const tsOf = r => parseInt(r.headers.get('x-peak-timestamp') || '0', 10);
  const isFresh = async (path, meta) => {
    const r = await cache.match(path);
    return !!r && tsOf(r) >= meta.timestamp;
  };

  // 1. Core files first, BEFORE switching files.json: the shell and wasm
  //    must be ready when the new manifest takes effect. If any can't be
  //    downloaded, stop here without committing - the next check retries,
  //    and files already downloaded are skipped then (timestamps match).
  const core = (arr.core || []).map(([p]) => normalizePath(p)).filter(p => p !== '/files.json');
  const ok = await Promise.all(core.map(async p =>
    (await isFresh(p, map.get(p))) || fetchInto(p, map.get(p), cache)));
  if (ok.includes(false)) {
    console.warn('files.json changed but some core files could not be downloaded; will retry later.');
    return;
  }
  const shell = await cache.match('/404.html');
  if (shell) await cache.put('/', shell);

  // 2. Commit: from here on, every lookup sees the new manifest.
  await cache.put('/files.json', await filesJsonResponse(text, etag, map));
  let oldMap = new Map();
  try { if (oldText) oldMap = parseFilesArray(JSON.parse(oldText)); } catch (e) { /* unreadable old copy */ }
  filesMap = map;

  // 3. Drop files that are no longer listed (removed dictionaries etc.).
  await Promise.all([...oldMap.keys()].filter(p => !map.has(p)).map(p => cache.delete(p)));

  const version = await simpleHash(text);
  const all = await self.clients.matchAll();
  all.forEach(c => c.postMessage({ type: 'filesupdated', version }));
  console.log(`files.json updated in place to ${version}`);

  // 4. Re-download only dictionaries the user already has that changed.
  //    The old copy keeps being served (and works offline) until the new
  //    one replaces it. Two at a time to stay gentle on mobile connections.
  const stale = [];
  for (const [p, meta] of map) {
    if (core.includes(p) || p === '/files.json') continue;
    const r = await cache.match(p);
    if (r && tsOf(r) < meta.timestamp) stale.push([p, meta]);
  }
  const worker = async () => {
    for (let job; (job = stale.shift());) await fetchInto(job[0], job[1], cache);
  };
  await Promise.all([worker(), worker()]);
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
  //
  // This used to re-fetch files.json from the network to recompute the
  // name. Page fetches are held until activation finishes, so on a slow or
  // flaky connection every request (including every dictionary) stalled
  // behind that fetch; offline it failed instantly. The installed cache can
  // be found locally instead: it's the newest one carrying the install marker.
  if (!cacheName) {
    cacheName = await findInstalledCacheName();
    if (!cacheName) {
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

  const meta = filesMap.get(pathname);
  const other = await matchOtherCaches(pathname, await getCurrentCacheName(), meta);
  if (other) {
    cache.put(pathname, other.clone()).catch(() => {});
    return other;
  }

  try {
    const res = await fetch(request);
    // A dictionary that's no longer in files.json (removed by an update
    // while a page still had the old list) is served but not re-cached.
    const unlistedDict = DICT_RE.test(pathname) && filesMap.size && !filesMap.has(pathname);
    if (res && res.ok && !unlistedDict) {
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
