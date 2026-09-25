// Site Rescue service worker — app-shell cache ONLY (spec > Frontend > PWA).
//
// HONESTY CONTRACT (prd.md > Look and Feel — never dress up the unavailable
// as available):
//   - Only the static shell files listed in SHELL are ever cached: the start
//     page, stylesheet, app script, manifest, and icons.
//   - /api/* is NEVER cached, never served from cache, and never intercepted
//     with a cache fallback. A scan is live work against a real website — the
//     installed app must never imply scans can run without network. Offline,
//     the POST reaches the network and fails as an ordinary network error,
//     which the UI already reports honestly.
//   - No background sync, no queueing, no offline "results".
//
// Strategy: network-first for shell files (always fresh when online, cache
// fallback when offline), plain passthrough for everything else.
const CACHE = 'site-rescue-shell-v1';
const SHELL = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Non-GET (the POST /api/scan stream included) → network, untouched.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Cross-origin assets → network, untouched.
  if (url.origin !== self.location.origin) return;
  // Everything not on the shell list — /api/* above all → network only.
  if (!SHELL.includes(url.pathname)) return;

  // Shell file: network first, cache fallback for offline launch.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        // Navigations may carry a query string; the shell is cached at '/'.
        const cached = await caches.match(request, {
          ignoreSearch: request.mode === 'navigate',
        });
        return cached || Response.error();
      })
  );
});
