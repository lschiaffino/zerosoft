/* Groups: service worker de la app instalable (PWA).
 *
 * - push: el servidor manda un push vacío (firma VAPID). Acá se piden los
 *   avisos pendientes con la sesión (/api/groups/push/pending) y se muestran.
 *   El texto nunca pasa por el servicio de push.
 * - notificationclick: abre (o enfoca) el chat del aviso.
 * - Sin caché offline: la bandeja siempre se ve al día.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let list = [];
      try {
        const res = await fetch('/api/groups/push/pending', { credentials: 'include', cache: 'no-store' });
        if (res.ok) list = (await res.json()).notifications || [];
      } catch (e) {
        list = [];
      }
      if (list.length === 0) {
        // El navegador exige mostrar algo por cada push.
        await self.registration.showNotification('Groups', { body: '', tag: 'groups', data: { url: '/app/groups/inbox' }, icon: '/api/groups/pwa-icon?size=192' });
        return;
      }
      for (const n of list) {
        await self.registration.showNotification(n.title || 'Groups', {
          body: n.body || '',
          tag: n.url || n.id,
          renotify: true,
          data: { url: n.url || '/app/groups/inbox' },
          icon: '/api/groups/pwa-icon?size=192',
          badge: '/api/groups/pwa-icon?size=192',
        });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/groups/inbox';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c && new URL(c.url).pathname.includes('/app/groups')) {
          await c.focus();
          if ('navigate' in c) await c.navigate(url).catch(() => null);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
