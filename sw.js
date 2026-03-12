const CACHE_NAME = 'peakslab-0.7.4';

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // Delete ALL old caches (not just non-matching names)
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(name => {
            if (name !== CACHE_NAME) {
              console.log('Deleting old cache:', name);
              return caches.delete(name);
            }
          })
        );
      }),
      self.clients.claim()  // Claim clients immediately
    ])
  );
});

// Rest of your fetch handler remains the same...
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(error => {
          console.error('Fetch failed:', error);
          throw error;
        });

        if (cachedResponse) {
          fetchPromise.catch(() => {});
          return cachedResponse;
        }

        return fetchPromise;
      });
    })
  );
});
