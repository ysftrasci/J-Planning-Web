// J-Planning — Service Worker (PWA Çevrimdışı Çalışma Desteği)

const CACHE_NAME = 'j-planning-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-icon.png',
];

// Service Worker Kurulumu & Önbelleğe alma
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Eski Önbellekleri Temizleme
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Çevrimdışı İstek Yönetimi (Network First, Cache Fallback)
self.addEventListener('fetch', (event) => {
  // Sadece GET isteklerini işle (Firebase veya API POST isteklerini bypass et)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Statik varlıklar veya sayfa yönlendirmeleri için strateji
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Başarılı sunucu yanıtını önbelleğe kaydet
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Çevrimdışıysak önbellekten yanıt dön
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Sayfa navigasyonu için index.html dön
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
