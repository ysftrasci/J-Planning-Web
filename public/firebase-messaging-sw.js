// Firebase Cloud Messaging (FCM) Web Push Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Arka planda gelen FCM Push bildirimlerini işleme
self.addEventListener('push', function (event) {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    payload = { title: 'J-Planning 🔔', body: event.data ? event.data.text() : 'Görevlerinizi kontrol edin!' };
  }

  const notificationTitle = payload.notification?.title || payload.title || 'J-Planning 🔔';
  const notificationOptions = {
    body: payload.notification?.body || payload.body || 'Görevlerinize göz atmayı unutmayın!',
    icon: payload.notification?.icon || payload.icon || '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'j-planning-fcm-notification',
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(notificationTitle, notificationOptions));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
