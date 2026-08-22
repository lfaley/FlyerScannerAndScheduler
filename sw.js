// FlyerSnap service worker — network-first so git pushes show up immediately,
// with cache fallback so the app still opens offline.
// BUMP THIS EVERY RELEASE or installed phones keep serving the old app.
const CACHE = 'flyersnap-v87';

// index.html is fully self-contained -- it fetches nothing to boot (guarded by
// tests; see the v8.1-v8.5 blank-screen incident). So the shell is only the
// page itself plus the install-time assets the OS asks for.
const SHELL = [
  './', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // addAll is all-or-nothing: one 404 and NOTHING is cached, leaving the app
  // with no offline copy at all. Cache each entry on its own so a missing
  // optional asset cannot take the whole install down.
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(SHELL.map((url) =>
      c.add(url).catch((err) => console.warn('[sw] could not cache', url, err))
    ))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Never intercept API calls
  if (e.request.url.includes('api.anthropic.com')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html')))
  );
});
