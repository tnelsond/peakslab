let CACHE_NAME = 'peakslab khmer 0.5.5.8';
let CACHE_PREFIX = 'peakslab khmer';
const FILES_TO_CACHE = [
 './index.html',
 './style.css',
 './peakslab.svg',
 './peak32x32.png',
 './db/kh.peak.zst',
 './db/nath2022.peak.zst',
 './db/ant.peak.zst',
 './db/sonv.peak.zst',
 './db/sea_count.peak.zst',
 './db/baby.peak.zst',
 './db/km_ulb.peak.zst',
 './db/bible.peak.zst',
 './db/bibletrans.peak.zst',
 './app.js',
 './wasm/peakdec.js',
 './wasm/peakdec_bg.wasm'];

// Utility function to normalize URL by removing query parameters and standardizing directory paths
function normalizeUrl(url) {
  const urlObj = new URL(url);
  let pathname = urlObj.pathname;

  // Remove trailing slash for consistency
  if (pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // If pathname is empty (root) or matches the app directory without slash,
  // treat as index.html
  if (pathname === '' || pathname === '/') {  // Adjust '/' if your path differs
    pathname = '/index.html';  // Full path to index.html
  } else if (!pathname.match(/\.[a-zA-Z0-9]+$/)) {
    // No extension → assume directory, append /index.html
    pathname += '/index.html';
  }

  return urlObj.origin + pathname;
}

// Install event: Cache initial files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Installing and caching files');
        return cache.addAll(FILES_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event: Clean up old caches and claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
       
	cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache.startsWith(CACHE_PREFIX)) {
            console.log('Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
       );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: Cache-first with network fallback
self.addEventListener('fetch', event => {
  // Ignore non-GET requests
  if (event.request.method !== 'GET') return;

  // Normalize the URL for cache key
  const cacheKey = normalizeUrl(event.request.url);

  event.respondWith(
    caches.match(cacheKey, { ignoreSearch: true })
      .then(cachedResponse => {
        // Return cached response if available
        if (cachedResponse) {
          // Start a background fetch to update cache
          event.waitUntil(updateCache(event.request, cacheKey));
          return cachedResponse;
        }

        // Fallback to network if not cached
        return fetch(event.request)
          .then(networkResponse => {
            let clone = networkResponse.clone();
            // Cache the new response if valid, using normalized URL
            if (networkResponse && networkResponse.status === 200) {
              event.waitUntil(
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(cacheKey, clone))
              );
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline fallback
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// Update cache for a request if the resource has changed
async function updateCache(request, cacheKey) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await caches.match(cacheKey, { ignoreSearch: true });
    const networkResponse = await fetch(request);

    // Compare ETag or Last-Modified headers to check for updates
    const cachedETag = cachedResponse?.headers.get('ETag');
    const networkETag = networkResponse.headers.get('ETag');
    const cachedLastModified = cachedResponse?.headers.get('Last-Modified');
    const networkLastModified = networkResponse.headers.get('Last-Modified');

    const isUpdated = (cachedETag && networkETag && cachedETag !== networkETag) ||
                     (cachedLastModified && networkLastModified && cachedLastModified !== networkLastModified);

    // Only update cache if the resource has changed, using normalized URL
    if (isUpdated && networkResponse.status === 200) {
      console.log(`Service Worker: Updating cache for ${cacheKey}`);
      await cache.put(cacheKey, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error(`Service Worker: Error updating cache for ${cacheKey}`, error);
  }
}
