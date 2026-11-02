// Network first, so updates arrive on the next open. The cache keeps the app working offline.
const CACHE = 'cals-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fromNetwork(e.request).catch(() => fromCache(e.request)));
});

async function fromNetwork(request) {
  // On a weak signal, fall back to the cached app instead of waiting.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fromCache(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') return caches.match('./');
  return Response.error();
}
