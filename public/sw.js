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

// Bildirim Gösterimi (Android/mobil Chrome: new Notification() çalışmadığı için
// sayfa tarafından postMessage ile buraya istek gönderilir, showNotification burada tetiklenir)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = event.data.payload || {};
    event.waitUntil(
      self.registration.showNotification(title || 'J-Planning', {
        body: body || 'Görevlerine göz atmayı unutma!',
        icon: icon || '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'j-planning-notification',
      })
    );
  }
});

// Bildirime tıklanınca uygulamayı öne getir / aç
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
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
