// J-Planning — Service Worker (PWA Çevrimdışı Çalışma Desteği)

const CACHE_NAME = 'j-planning-v2';

// Service Worker Kurulumu & Önbelleğe alma
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Eski Önbellekleri Temizleme (Her yeni yayında eski önbelleği anında sil)
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

// İstek Yönetimi (Network First — Her zaman öncelikle güncel sunucu dosyasını çek)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // HTML sayfa gezintisi için her zaman canlı sunucudan dene
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // Statik dosyalar için Network-First stratejisi
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
