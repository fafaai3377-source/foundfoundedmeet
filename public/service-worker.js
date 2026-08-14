self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
  let title = 'foundfoundedmeet';
  const iconUrl = new URL('/icon-192.png', self.location.origin).href;
  let options = {
    body: '새로운 알림이 도착했습니다.',
    icon: iconUrl,
    badge: iconUrl,
    vibrate: [100, 50, 100],
    tag: 'ffm-push-' + Date.now(),
    renotify: true,
    data: {
      url: '/'
    }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      options.body = data.body || options.body;
      if (data.url) {
        options.data.url = data.url;
      }
    } catch (e) {
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options).catch(err => {
      console.error('showNotification error:', err);
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || '/';
  const targetFullUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if ('focus' in client) {
          if (client.url === targetFullUrl || client.url.startsWith(self.location.origin)) {
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetFullUrl);
      }
    })
  );
});
