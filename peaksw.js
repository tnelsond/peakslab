/*
 * PeakSlab service worker
 * ------------------------
 * Strategy: cache-first, revalidate-in-background.
 *  - A file is only ever downloaded once it has actually been requested
 *    (nothing is pre-fetched on install).
 *  - Every cached file is tagged with the "timestamp" (5th element) from
 *    files.json. On every request we compare that tag against the live
 *    files.json to decide whether a newer copy needs to be fetched.
 *  - While a newer copy is being fetched, the old (still valid) copy is
 *    moved into the "peakslab-old" cache so it keeps being served instantly.
 *    Once the new copy finishes downloading it lands in "peakslab" and the
 *    old copy is dropped.
 *  - Anything cached that no longer appears in files.json gets deleted.
 *  - Any request for a "manifest.json" that isn't the root one is answered
 *    by taking the root manifest.json and rewriting the path-specific
 *    fields (scope/start_url/share_target/name/short_name).
 *  - Any *.html request (or navigation) that can't be found is silently
 *    answered with index.html instead of a 404, so the app shell always
 *    loads and client-side routing can take over.
 *
 * NOTE on paths: files.json lists paths like
 *   "khmer/db/dict/ant.peak.zst"
 * This worker assumes those are served relative to the site root, i.e.
 * at "/khmer/db/dict/ant.peak.zst". Adjust DATA_BASE_PATH below if your
 * data files actually live under a different prefix.
 */

// Bump this whenever you change how caching/storage works (e.g. the
// timestamp-header scheme, cache structure, etc). It does NOT need to be
// bumped for ordinary content updates — those are handled automatically
// via files.json timestamps. Bumping it forces a clean slate: old-version
// caches are deleted on activate and everything re-downloads on demand.
const SW_VERSION = 1;

const CACHE_CURRENT = `peakslab-v${SW_VERSION}`;
const CACHE_OLD = `peakslab-old-v${SW_VERSION}`;

const DATA_BASE_PATH = ''; // e.g. '/data' if files.json paths need a prefix
const FILES_JSON_PATH = '/files.json';
const ROOT_MANIFEST_PATH = '/manifest.json';
const INDEX_HTML_PATH = '/index.html';

const TS_HEADER = 'x-peakslab-ts';

// Never delete these even if they're missing from files.json.
const PROTECTED_PATHS = new Set([
  INDEX_HTML_PATH,
  FILES_JSON_PATH,
  ROOT_MANIFEST_PATH,
]);
function isProtected(path) {
  return PROTECTED_PATHS.has(path) || path.endsWith('peakworker.js');
}

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await purgeOldVersionCaches();

      // Refresh files.json immediately (rather than waiting for the first
      // asset request) so a newly-activated worker can clean up orphans
      // without delay. This only deletes files that no longer exist in
      // files.json — it does NOT download or refresh anything. Updates
      // to existing files only happen once that file is requested again.
      const map = await getFilesManifest();
      if (map) await cleanupOrphans(map);
    })()
  );
});

// Delete any peakslab caches left over from a previous SW_VERSION.
async function purgeOldVersionCaches() {
  const keep = new Set([CACHE_CURRENT, CACHE_OLD]);
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith('peakslab') && !keep.has(name))
      .map((name) => caches.delete(name))
  );
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---------------------------------------------------------------------
// files.json helpers
// ---------------------------------------------------------------------

function normalizePath(rawPath) {
  return DATA_BASE_PATH + '/' + rawPath.replace(/^\/+/, '');
}

// Always goes to the network so we know the true, current state.
// Returns a Map<path, {desc, size, count, ts}> or null if unreachable.
async function getFilesManifest() {
  try {
    const res = await fetch(FILES_JSON_PATH, { cache: 'no-store' });
    if (!res.ok) return null;
    const arr = JSON.parse(await res.text());
    const map = new Map();
    for (const entry of arr) {
      const [path, desc, size, count, ts] = entry;
      map.set(normalizePath(path), { desc, size, count, ts: Number(ts) });
    }
    return map;
  } catch (e) {
    return null; // offline / parse error — caller should skip network-dependent work
  }
}

async function cleanupOrphans(map) {
  const files = map || (await getFilesManifest());
  if (!files) return; // can't verify against the network right now; skip this round

  for (const cacheName of [CACHE_CURRENT, CACHE_OLD]) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    for (const req of requests) {
      const path = new URL(req.url).pathname;
      if (isProtected(path)) continue;
      if (!files.has(path)) {
        await cache.delete(req);
      }
    }
  }
}

// ---------------------------------------------------------------------
// Timestamp tagging
// ---------------------------------------------------------------------

function withTimestamp(response, ts) {
  const headers = new Headers(response.headers);
  headers.set(TS_HEADER, String(ts));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getTimestamp(response) {
  if (!response) return null;
  const v = response.headers.get(TS_HEADER);
  return v === null ? 0 : Number(v);
}

// Store a freshly-downloaded response as the new "current" copy.
async function cacheFreshResponse(path, req, response) {
  const map = await getFilesManifest();
  const ts = map && map.has(path) ? map.get(path).ts : Math.floor(Date.now() / 1000);
  const tagged = withTimestamp(response, ts);

  const current = await caches.open(CACHE_CURRENT);
  await current.put(req, tagged);

  const old = await caches.open(CACHE_OLD);
  await old.delete(req);
}

// Background check: is there a newer version of this file? If so, demote
// the currently-cached copy to peakslab-old and fetch the replacement.
async function revalidate(path, req) {
  const map = await getFilesManifest();
  if (!map) return; // offline — nothing we can safely check right now

  const current = await caches.open(CACHE_CURRENT);
  const old = await caches.open(CACHE_OLD);

  if (!map.has(path)) {
    // File was removed from files.json entirely.
    if (!isProtected(path)) {
      await current.delete(req);
      await old.delete(req);
    }
    return;
  }

  const latestTs = map.get(path).ts;
  const inCurrent = await current.match(req);
  const cachedRes = inCurrent || (await old.match(req));
  const cachedTs = getTimestamp(cachedRes);

  if (cachedRes && latestTs <= cachedTs) return; // already up to date

  // Demote the outdated copy so it's still servable while we fetch the update.
  if (inCurrent) {
    await old.put(req, inCurrent.clone());
    await current.delete(req);
  }

  try {
    const netRes = await fetch(req, { cache: 'no-store' });
    if (netRes && netRes.ok) {
      await cacheFreshResponse(path, req, netRes);
    }
  } catch (e) {
    // Offline / failed — keep serving the demoted copy from peakslab-old.
  }
}

// ---------------------------------------------------------------------
// manifest.json rewriting
// ---------------------------------------------------------------------

async function buildManifestForPath(pathname) {
  const segments = pathname.split('/').filter(Boolean); // e.g. ['khmer','manifest.json']
  const lang = segments[0] || '';
  const langLabel = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : '';

  let rootManifest;
  const current = await caches.open(CACHE_CURRENT);
  const cachedRoot = await current.match(ROOT_MANIFEST_PATH);

  if (cachedRoot) {
    rootManifest = await cachedRoot.clone().json();
  } else {
    const res = await fetch(ROOT_MANIFEST_PATH);
    rootManifest = await res.clone().json();
    await current.put(ROOT_MANIFEST_PATH, res);
  }

  const scope = `/${lang}/`;
  const manifest = {
    ...rootManifest,
    name: langLabel ? `PeakSlab ${langLabel}` : rootManifest.name,
    short_name: langLabel ? `PS ${langLabel}` : rootManifest.short_name,
    scope,
    start_url: scope,
  };

  if (rootManifest.share_target) {
    manifest.share_target = { ...rootManifest.share_target, action: scope };
  }

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------
// Generic cache-first + background-update handler
// ---------------------------------------------------------------------

async function handleAsset(event, req, url) {
  const path = url.pathname;
  const current = await caches.open(CACHE_CURRENT);
  const old = await caches.open(CACHE_OLD);

  const cached = (await current.match(req)) || (await old.match(req));

  if (cached) {
    event.waitUntil(revalidate(path, req));
    return cached;
  }

  // Not cached anywhere yet — this request is what triggers the download.
  try {
    const netRes = await fetch(req);
    if (netRes && netRes.ok) {
      event.waitUntil(cacheFreshResponse(path, req, netRes.clone()));
      return netRes;
    }
    return netRes; // pass through non-OK responses (e.g. real 404s for non-html assets)
  } catch (e) {
    return new Response('Offline and not cached', { status: 503 });
  }
}

// ---------------------------------------------------------------------
// HTML handling with "missing page -> serve index.html" fallback
// ---------------------------------------------------------------------

async function handleHtml(event, req, url) {
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const asRequest = new Request(new URL(path, url.origin), { headers: req.headers });

  const current = await caches.open(CACHE_CURRENT);
  const old = await caches.open(CACHE_OLD);

  const cached = (await current.match(asRequest)) || (await old.match(asRequest));
  if (cached) {
    event.waitUntil(revalidate(path, asRequest));
    return cached;
  }

  // Try the network for this exact page first.
  try {
    const netRes = await fetch(req);
    if (netRes && netRes.ok) {
      event.waitUntil(cacheFreshResponse(path, asRequest, netRes.clone()));
      return netRes;
    }
    // Not ok (404 etc.) — fall through to the index.html fallback below.
  } catch (e) {
    // Offline — fall through to the index.html fallback below.
  }

  // Page doesn't exist (or we're offline): serve the app shell instead,
  // without the client ever seeing a 404.
  const fallback = (await current.match(INDEX_HTML_PATH)) || (await old.match(INDEX_HTML_PATH));
  if (fallback) {
    event.waitUntil(revalidate(INDEX_HTML_PATH, new Request(new URL(INDEX_HTML_PATH, url.origin))));
    return fallback;
  }

  try {
    const netIndex = await fetch(INDEX_HTML_PATH);
    if (netIndex && netIndex.ok) {
      const indexReq = new Request(new URL(INDEX_HTML_PATH, url.origin));
      event.waitUntil(cacheFreshResponse(INDEX_HTML_PATH, indexReq, netIndex.clone()));
      return netIndex;
    }
  } catch (e) {
    // truly offline with nothing cached
  }

  return new Response('Offline', { status: 503 });
}

// ---------------------------------------------------------------------
// Fetch dispatch
// ---------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't intercept cross-origin requests

  // Any manifest.json request other than the root one gets rewritten.
  if (url.pathname.endsWith('/manifest.json') && url.pathname !== ROOT_MANIFEST_PATH) {
    event.respondWith(buildManifestForPath(url.pathname));
    return;
  }

  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(handleHtml(event, req, url));
    return;
  }

  event.respondWith(handleAsset(event, req, url));
});
