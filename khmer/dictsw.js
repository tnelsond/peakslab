let CACHE_NAME = 'peakslab khmer 0.5.3.8';
let CACHE_PREFIX = 'peakslab khmer';
const FILES_TO_CACHE = [
 './index.html',
 './chota.css',
 './peak32x32.png',
 './peak64x64.png',
 './peakslab.svg',
 './peakmono.svg',
 './khmer.db.html',
 './khmerass.db.html',
 './manifest.json',
 './dict.js',
 './sqlite3.js',
 './sqlite3.wasm'];

// Utility function to normalize URL by removing query parameters and standardizing directory paths
function normalizeUrl(url) {
  const urlObj = new URL(url);
  let pathname = urlObj.pathname;

  // Ensure trailing slash for directory-like URLs
  if (pathname.endsWith('/')) {
    pathname += 'index.html'; // Convert /khmer/ to /khmer/index.html
  } else if (!pathname.match(/\.[a-zA-Z0-9]+$/)) {
    // If no file extension, assume it's a directory and append /index.html
    pathname += '/index.html';
  }

  return urlObj.origin + pathname; // Return normalized URL without query parameters
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
