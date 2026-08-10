// Service Worker for Tide Commander PWA
const CACHE_NAME = 'tide-commander-v2';

// Install event - cache essential files
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first strategy (app needs live data)
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip WebSocket connections
  if (event.request.url.includes('/ws')) return;

  // Local file previews must always come from disk. Never use Cache Storage
  // as an offline fallback for models, toolpaths, images, PDFs, or metadata.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith('/api/files/')) return;

  // Network first for everything else
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
