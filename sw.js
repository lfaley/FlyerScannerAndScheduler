// FlyerSnap service worker.
//
// v9.20 — CACHE FIRST, then revalidate. Until now this was network-first,
// which meant the whole 395KB index.html was fetched on EVERY launch while
// online; the cache was only a fallback for being offline. Launching now
// paints from the cache immediately and checks for a new version in the
// background.
//
// The cost of that is one launch of staleness: a push shows up the NEXT time
// the app opens. That was the reason network-first was chosen, so it is not
// simply given away — when the background check finds a new build, the page
// is told, and it offers a one-tap reload. Deliberate delay, visible, with a
// way to skip it.
//
// BUMP THIS EVERY RELEASE or installed phones keep serving the old app.
const CACHE = 'flyersnap-v173';

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

/** Tell every open page something happened. */
async function tellPages(msg) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((c) => c.postMessage(msg));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // ONLY our own files. Everything else goes straight to the network, every
  // time, uncached: the Anthropic API, the self-hosted model, and — the one
  // that would actually have broken — the Gmail watcher, which is JSONP.
  // A JSONP response is executable JavaScript fetched with a <script> tag,
  // so it is a GET, and under cache-first the app would have replayed a
  // stale email queue forever. Network-first hid that; an origin check fixes
  // it properly.
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // ORDER MATTERS, and getting it wrong is silent. Both the network request
  // and waitUntil must start SYNCHRONOUSLY, while the event is still being
  // dispatched. Calling e.waitUntil() after an await is too late: the browser
  // has stopped listening, the worker is free to die once respondWith settles,
  // and the cache write never lands -- so the app serves the same stale copy
  // forever and nothing anywhere reports a problem. This was written the wrong
  // way round first and only the browser test caught it.
  const fresh = fetch(e.request)
    .then(async (res) => {
      if (!res || !res.ok) return res;
      const c = await caches.open(CACHE);
      // Compare against what is already stored, so "there is an update" means
      // an actual change rather than merely a successful re-download.
      if (e.request.mode === 'navigate') {
        const prev = await c.match(e.request);
        if (prev) {
          const [before, after] = await Promise.all([prev.text(), res.clone().text()]);
          if (before !== after) tellPages({ type: 'update-ready' });
        }
      }
      await c.put(e.request, res.clone());
      return res;
    })
    .catch(() => null);
  e.waitUntil(fresh);

  e.respondWith(
    // Cached copy wins the race when there is one; otherwise wait for the
    // network, and fall back to the shell so a deep link still opens offline.
    caches.match(e.request).then((hit) => hit || fresh.then((r) => r || caches.match('./index.html')))
  );
});
