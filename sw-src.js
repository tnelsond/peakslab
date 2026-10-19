/*
 * PeakSlab service worker
 * - Cache-first for everything. files.json lists every file with its
 *   timestamp (element 1 of both core and dicts entries).
 * - Install builds a NEW cache, named by files.json's hash, carrying forward
 *   files from the old "peakslab*" caches that are still current; outdated
 *   core files that were cached are downloaded again. Nothing else is
 *   downloaded: every file is cached the first time it's requested.
 * - Activate deletes the old caches, but only if the new one's install
 *   finished (its "__install_complete__" marker); else they stay as a
 *   fallback.
 * - files.json is re-checked in the background (throttled, conditional)
 *   after navigations and when the app comes back to the foreground, and a
 *   changed one is applied to the current cache in place (checkFiles).
 * - manifest.json is generated for whatever directory asks for it.
 * - An HTML request for anything files.json doesn't list gets 404.html, the
 *   app's one page.
 */

const PREFIX = 'peakslab';
const DICT_RE = /\.(peak|slab)(\.zst)?$/;

// Module state. It doesn't survive the browser restarting the worker between
// events ('install' and 'activate' may run in different lifetimes), so
// everything here can be rebuilt from the caches.
let files = new Map(); // path -> timestamp
let installed = null;  // The cache this install made
let current = null;    // The cache in use (currentCache)

const ours = async () => (await caches.keys()).filter(k => k.startsWith(PREFIX));
const tsOf = r => +(r.headers.get('x-peak-timestamp') || 0);
const slash = p => p.startsWith('/') ? p : '/' + p;
const listed = data => new Map([...(data.core || []), ...(data.dicts || [])].map(([p, t]) => [slash(p), t]));
const coreOf = data => (data.core || []).map(([p]) => slash(p)).filter(p => p !== '/files.json');
function hash(s) { // The user-visible version
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
// The cached files.json keeps the server's ETag (for cheap conditional
// checks) and its hash (the version)
const filesJson = (text, etag, map) => new Response(text, {headers: {
  'Content-Type': 'application/json', 'x-peak-version': hash(text),
  'x-peak-timestamp': String(map.get('/files.json') || 0), ...(etag && {'x-peak-etag': etag})}});
// The URL with ?v=<timestamp>: the CDN caches by URL, and right after a
// deploy it could still hand out an old copy to be saved as the new one
const versioned = (p, ts) => ts ? `${p}?v=${ts}` : p;

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(install()); });
self.addEventListener('activate', e => e.waitUntil(activate()));
self.addEventListener('message', e => {
  if (e.data?.type === 'getstatus') e.waitUntil(sendStatus(e.source));
  if (e.data?.type === 'checkupdate') e.waitUntil(checkFiles()); // The app back in the foreground
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(handleFetch(e.request, decodeURIComponent(url.pathname)));
  if (e.request.mode === 'navigate') e.waitUntil(checkFiles()); // (throttled)
});

// The version, and which files are cached (match per file, as the Cache API
// percent-encodes its keys)
async function sendStatus(client) {
  await ensureFiles();
  const cache = await caches.open(await currentCache());
  const cached = {};
  await Promise.all([...files].map(async ([p, ts]) => { if (await cache.match(p)) cached[p] = ts; }));
  const fj = await cache.match('/files.json');
  client.postMessage({type: 'status', version: fj?.headers.get('x-peak-version') || await currentCache(), files: cached});
}

// files.json from the network ('no-cache': revalidated, so the copy the page
// just downloaded is reused), else from any cache
async function loadFiles() {
  try {
    const res = await fetch('/files.json', {cache: 'no-cache'});
    return {text: await res.text(), etag: res.headers.get('etag')};
  } catch (e) {
    for (const k of await ours()) {
      const r = await (await caches.open(k)).match('/files.json');
      if (r) return {text: await r.text(), etag: r.headers.get('x-peak-etag')};
    }
    throw e;
  }
}
// The newest cache whose install FINISHED (never one still being built: its
// files would all miss and be downloaded again); caches.keys() is in
// creation order. Old caches from before the marker: the oldest.
async function installedCache() {
  const keys = await ours();
  for (const k of [...keys].reverse())
    if (await (await caches.open(k)).match('/__install_complete__')) return k;
  return keys[0] || null;
}
const currentCache = async () => current ||= (await installedCache()) || installed;
async function ensureFiles() {
  if (files.size) return;
  try {
    const r = await (await caches.open(await currentCache())).match('/files.json');
    if (r) files = listed(await r.json());
  } catch (e) { /* none yet */ }
}
// A copy at least as new as ts (any copy, without one) in these caches
async function freshIn(names, path, ts) {
  for (const k of names) {
    const r = await (await caches.open(k)).match(path);
    if (r && (!ts || tsOf(r) >= ts)) return r;
  }
  return null;
}

async function install() {
  const {text, etag} = await loadFiles();
  const data = JSON.parse(text);
  files = listed(data);
  installed = `${PREFIX}-${hash(text)}`;
  const cache = await caches.open(installed);
  const old = (await ours()).filter(k => k !== installed).reverse(); // Newest first
  await cache.put('/files.json', filesJson(text, etag, files));
  // Only what was already cached is kept: current copies carried forward,
  // outdated core files downloaded again (the app must stay available
  // offline). A file that can't be had doesn't stop the install: it's
  // fetched when next requested.
  const core = coreOf(data);
  await Promise.all([...files].filter(([p]) => p !== '/files.json').map(async ([p, ts]) => {
    const r = await freshIn(old, p, ts).catch(() => null);
    if (r) await cache.put(p, r);
    else if (core.includes(p) && await freshIn(old, p).catch(() => null)) await fetchInto(p, ts, cache);
  }));
  // Files cached but not listed (icons, ...), else they'd be lost
  const done = new Set();
  for (const k of old) {
    try {
      const oc = await caches.open(k);
      for (const req of await oc.keys()) {
        const p = decodeURIComponent(new URL(req.url).pathname);
        if (done.has(p) || files.has(p) || DICT_RE.test(p) || p === '/' || p.startsWith('/__')) continue;
        done.add(p);
        if (!await cache.match(p)) await cache.put(p, await oc.match(req));
      }
    } catch (e) { console.warn('Carrying files forward failed:', e); }
  }
  await cache.put('/__install_complete__', new Response('1'));
  const shell = await cache.match('/404.html');
  if (shell) await cache.put('/', shell);
  current = installed;
}

// One file into the cache, tagged with its timestamp; once more if the
// network failed (not for a 404: it won't appear)
async function fetchInto(path, ts, cache) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(versioned(path, ts), {cache: 'no-cache'});
      if (!res.ok) return false;
      await cache.put(path, await tagged(res, ts));
      return true;
    } catch (e) {
      if (attempt) console.warn(`Fetching ${path} failed:`, e);
    }
  }
  return false;
}
async function tagged(res, ts) {
  const headers = new Headers(res.headers);
  headers.set('x-peak-timestamp', String(ts));
  return new Response(await res.arrayBuffer(), {status: res.status, statusText: res.statusText, headers});
}

// files.json updates without a new service worker (the browser only
// reinstalls it when sw.js changes), at most every 10 minutes (GitHub
// Pages' CDN caches that long anyway), shared by triggers at the same time
let filesCheck = null;
const checkFiles = () => filesCheck ||= checkFilesNow().catch(e => console.warn('files.json check failed:', e)).finally(() => { filesCheck = null; });
async function checkFilesNow() {
  if (self.registration.installing || self.registration.waiting) return; // Its install gets files.json
  const name = await currentCache();
  if (!name) return;
  const cache = await caches.open(name);
  const last = await cache.match('/__files_checked__');
  if (last && Date.now() - +(await last.text()) < 600e3) return;
  await cache.put('/__files_checked__', new Response(String(Date.now())));
  const cached = await cache.match('/files.json');
  const etag = cached?.headers.get('x-peak-etag');
  let res, text;
  try { // 'no-store': a 304 reaches us as one; given up after 15 s
    res = await fetch('/files.json', {cache: 'no-store', headers: etag ? {'If-None-Match': etag} : {}, signal: AbortSignal.timeout(15e3)});
    if (!res.ok) return; // (304: unchanged)
    text = await res.text();
  } catch (e) { return; } // Offline: on a later trigger
  const oldText = cached ? await cached.text() : '';
  let data;
  try { data = JSON.parse(text); } catch (e) { return; } // Cut off
  const map = listed(data);
  const save = () => cache.put('/files.json', filesJson(text, res.headers.get('etag'), map));
  if (text === oldText) return save(); // (a new ETag)
  // In place: 1. the core files already cached, BEFORE the new list takes
  // effect; if any can't be had, nothing changes (the next check retries)
  const stale = async p => { const r = await cache.match(p); return r && tsOf(r) < map.get(p); };
  const core = coreOf(data);
  const ok = await Promise.all(core.map(async p => !await stale(p) || fetchInto(p, map.get(p), cache)));
  if (ok.includes(false)) throw new Error('core files could not be downloaded');
  const shell = await cache.match('/404.html');
  if (shell) await cache.put('/', shell);
  // 2. The new list; files no longer on it go
  await save();
  let oldMap = new Map();
  try { if (oldText) oldMap = listed(JSON.parse(oldText)); } catch (e) { /* unreadable */ }
  files = map;
  await Promise.all([...oldMap.keys()].filter(p => !map.has(p)).map(p => cache.delete(p)));
  (await self.clients.matchAll()).forEach(c => c.postMessage({type: 'filesupdated'}));
  // 3. The dictionaries already downloaded that changed (the old copy is
  //    served until then), two at a time
  const jobs = [];
  for (const p of map.keys()) if (!core.includes(p) && p !== '/files.json' && await stale(p)) jobs.push(p);
  const worker = async () => { for (let p; (p = jobs.shift());) await fetchInto(p, map.get(p), cache); };
  await Promise.all([worker(), worker()]);
}

// The other caches go, if the one kept is really there and complete. (After
// a restart, installed is found again from the caches, not the network:
// page requests wait for activation.)
async function activate() {
  installed ||= await installedCache();
  const keys = await ours();
  if (installed && keys.includes(installed)) {
    if (await (await caches.open(installed)).match('/__install_complete__'))
      await Promise.all(keys.filter(k => k !== installed).map(k => caches.delete(k)));
    else console.warn('The new cache is incomplete: keeping the old ones until an install succeeds.');
    current = installed;
  }
  await self.clients.claim();
}

async function handleFetch(request, path) {
  if (path.endsWith('/manifest.json')) return manifest(path, request.referrer);
  if (request.mode === 'navigate' || path.endsWith('.html') || path.endsWith('/')) {
    await ensureFiles();
    let p = path.endsWith('/') ? path + '404.html' : path;
    if (!files.has(p)) p = '/404.html'; // The app's page
    return (await (await caches.open(await currentCache())).match(p)) || cacheFirst(new Request('/404.html'), '/404.html');
  }
  return cacheFirst(request, path);
}

// The manifest for the page's directory: the referrer's (a relative
// manifest.json from /khmer/music is requested as /khmer/manifest.json),
// else the request's
function manifest(path, referrer) {
  let dirs = [];
  try { if (new URL(referrer).origin === self.location.origin) dirs = new URL(referrer).pathname.split('/').filter(Boolean); } catch (e) { /* none */ }
  if (!dirs.length) dirs = path.split('/').filter(Boolean).slice(0, -1);
  const dir = dirs.length ? `/${dirs.join('/')}/` : '/', label = dirs.map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
  return new Response(JSON.stringify({
    name: label ? `PeakSlab ${label}` : 'PeakSlab', short_name: label ? `PS ${label}` : 'PeakSlab', description: 'A dictionary app.',
    theme_color: '#664433', background_color: '#664433', display: 'standalone', scope: dir, start_url: dir,
    icons: [...['32x32', '192x192', '512x512'].map(s => ({src: `/peak${s}.png`, sizes: s, type: 'image/png'})), {src: '/peakslab.svg', sizes: 'any'}],
    share_target: {action: dir, method: 'GET', enctype: 'application/x-www-form-urlencoded', params: {text: 'text'}},
  }), {headers: {'Content-Type': 'application/manifest+json'}});
}

// The cache, else a fresh copy in an old cache (copied forward), else the
// network (cached, so it works offline from now on)
async function cacheFirst(request, path) {
  await ensureFiles();
  const name = await currentCache();
  const cache = await caches.open(name);
  const hit = (await cache.match(path)) || (await cache.match(request));
  if (hit) return hit;
  const ts = files.get(path);
  const other = await freshIn((await ours()).filter(k => k !== name).reverse(), path, ts).catch(() => null);
  if (other) {
    cache.put(path, other.clone()).catch(() => {});
    return other;
  }
  try {
    const res = await (ts ? fetch(versioned(path, ts), {cache: 'no-cache'}) : fetch(request));
    // (A dictionary no longer listed is served, not cached)
    if (res.ok && !(DICT_RE.test(path) && files.size && !files.has(path)))
      await cache.put(path, await tagged(res.clone(), ts || Date.now()));
    return res;
  } catch (e) {
    return new Response('Offline', {status: 503});
  }
}
