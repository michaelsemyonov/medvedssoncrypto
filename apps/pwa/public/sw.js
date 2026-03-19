self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : { title: 'MedvedssonCrypto', body: 'New signal received.' };

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data ?? {}
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);

      if (existing) {
        return existing.focus();
      }

      return self.clients.openWindow('/');
    })
  );
});
