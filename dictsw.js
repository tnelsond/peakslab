let cache_name = 'peakslab 0.5.1.2';
let urls_to_cache = [
 'index.html',
 './',
 'chota.css',
 'favicon16x16.png',
 'favicon32x32.png',
 'favicon64x64.png',
 'favicon148x148.png',
 'dict.js',
 'sqlite3.js',
 'sqlite3.wasm'];

self.addEventListener('install', (e) => {
 console.log("[Service Worker] Trying to install");
 self.skipWaiting()
 e.waitUntil(caches.open(cache_name).then((cache) => {
    /*const stack = [];
    urls_to_cache.forEach(file => stack.push(
        await cache.add(file).catch(_=>console.error(`can't load ${file} to cache`))
    ));
    return Promise.all(stack);*/
  return cache.addAll(urls_to_cache);
 }) )
})

self.addEventListener('activate', event => {
  const cacheWhitelist = [cache_name];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
/*
self.addEventListener('fetch', event => {
	console.log(`[Service Worker] Fetching resource: ${event.request.url}`);
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).catch(() => {
        return caches.match('index.html');
      });
    })
  );
});*/
/*
self.addEventListener('fetch', (e) => {
 e.respondWith(caches.match(e.request).then((response) => {
  if(response)
   return response
  else
   return fetch(e.request)
 }) )
})
*/
/*
self.tuninstall = function(){
	caches.keys().then(function(names) {
			for (let name of names)
					caches.delete(name);
	});
}*/
self.addEventListener("fetch", (e) => {
  e.respondWith(
    (async () => {
      var r = await caches.match(e.request, {ignoreSearch: true});
      console.log(`[Service Worker] Fetching resource: ${e.request.url}`);
      if (r) {
        return r;
			}
      const response = await fetch(e.request);
      const cache = await caches.open(cache_name);
      console.log(`[Service Worker] Caching new resource: ${e.request.url}`);
      cache.put(e.request, response.clone());
      return response;
    })(),
  );
});
