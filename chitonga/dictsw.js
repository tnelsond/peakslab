let CACHE_NAME = 'peakslab chitonga 0.5.2.5';
const FILES_TO_CACHE = [
 'index.html',
 '/',
 'chota.css',
 'peak32x32.png',
 'peak64x64.png',
 'peakslab.svg',
 'peakmono.svg',
 'chitonga.db.html',
 'dict.js',
 'sqlite3.js',
 'sqlite3.wasm'];

// Install event: Cache initial files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Installing and caching files');
        return cache.addAll(FILES_TO_CACHE);
      })
      .then(() => self.skipWaiting()) // Activate new Service Worker immediately
  );
});

// Activate event: Clean up old caches and claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim()) // Take control of clients immediately
  );
});

// Fetch event: Cache-first with network fallback
self.addEventListener('fetch', event => {
  // Ignore non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, {ignoreSearch: true})
      .then(cachedResponse => {
        // Return cached response if available
        if (cachedResponse) {
          // Start a background fetch to update cache
          event.waitUntil(updateCache(event.request));
          return cachedResponse;
        }

        // Fallback to network if not cached
        return fetch(event.request)
          .then(networkResponse => {
	    let clone = networkResponse.clone();
            // Cache the new response if valid
            if (networkResponse && networkResponse.status === 200) {
              event.waitUntil(
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, clone))
              );
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline fallback (optional, customize as needed)
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// Update cache for a request if the resource has changed
async function updateCache(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await caches.match(request);
    const networkResponse = await fetch(request);

    // Compare ETag or Last-Modified headers to check for updates
    const cachedETag = cachedResponse?.headers.get('ETag');
    const networkETag = networkResponse.headers.get('ETag');
    const cachedLastModified = cachedResponse?.headers.get('Last-Modified');
    const networkLastModified = networkResponse.headers.get('Last-Modified');

    const isUpdated = (cachedETag && networkETag && cachedETag !== networkETag) ||
                     (cachedLastModified && networkLastModified && cachedLastModified !== networkLastModified);

    // Only update cache if the resource has changed
    if (isUpdated && networkResponse.status === 200) {
      console.log(`Service Worker: Updating cache for ${request.url}`);
      await cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error(`Service Worker: Error updating cache for ${request.url}`, error);
  }
}
