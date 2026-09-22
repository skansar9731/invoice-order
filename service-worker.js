/**
 * Service Worker for Maharashtra Automobile PWA
 * Caches core app shell and external libraries for full offline product matching & PDF generation
 */

const CACHE_NAME = 'maharashtra-autoparts-v3';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/sampleData.js',
  './js/productSearch.js',
  './js/productImporter.js',
  './js/matchingEngine.js',
  './js/orderManager.js',
  './js/pdfGenerator.js',
  './js/excelGenerator.js',
  './js/exportDataService.js',
  './js/googleDriveService.js',
  './js/aiService.js',
  './js/ui.js',
  './js/rackMap.js',
  './js/counterMap.js',
  './js/mapManager.js',
  './js/mapSearch.js',
  './js/mapPrintService.js',
  './js/rackParser.js',
  './js/mapConfigData.js',
  './assets/icons/icon.svg',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static app shell v2');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial fail (some CDN resources may cache on demand):', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Do not cache serverless function API calls
  if (event.request.url.includes('/.netlify/functions/')) {
    return;
  }

  // Same-origin app assets: Network-first to prevent stale cache bugs
  const isSameOrigin = event.request.url.startsWith(self.location.origin);
  if (isSameOrigin) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        })
    );
    return;
  }

  // Third-party CDN resources: Cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (event.request.url.startsWith('http') || event.request.url.startsWith('https'))
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
