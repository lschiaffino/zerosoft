/* zerosoft service worker: el único de la suite (scope /, lo registra
 * lib/sw-client.ts desde el CRM y desde Groups).
 *
 * CRM offline:
 * - /_next/static/**: cache-first (los archivos tienen hash).
 * - Navegaciones a /<locale>/app/crm/** y GET /api/crm/**: network-first con
 *   fallback a la caché, así lo ya visitado abre sin red.
 * - POST/PATCH/PUT/DELETE a /api/crm/** que fallan por red: se guardan en
 *   IndexedDB y se responde 202 con `x-zs-queued: 1`. Se reenvían en orden
 *   cuando la página avisa que volvió la red (o con Background Sync).
 *
 * Las reglas de qué se encola son las de lib/offline-queue.ts (shouldQueue,
 * replayQueue); tests/unit/offline-queue.test.ts carga este archivo y
 * compara. Sin dependencias ni build.
 * - El inicio de la app instalada (/app, start_url de app/manifest.ts) también
 *   es network-first con la última versión guardada.
 *
 * Docs sin conexión (D5):
 * - Navegaciones a /<locale>/app/docs/**: network-first con la última versión
 *   guardada, así una página ya abierta (o marcada "Disponible sin conexión",
 *   que la página manda a guardar con zs-warm junto con sus subpáginas) se lee
 *   sin red. Lo que se escribe sin red lo guarda el editor en el dispositivo
 *   (lib/docs-offline.ts) y lo manda al volver: acá no se encola nada de Docs.
 *
 * Push de Groups (lib/groups-push.ts):
 * - push: el servidor manda un push vacío (firma VAPID). Acá se piden los
 *   avisos pendientes con la sesión (/api/groups/push/pending) y se muestran.
 *   El texto nunca pasa por el servicio de push.
 * - notificationclick: abre (o enfoca) el chat del aviso.
 * - La bandeja de Groups no se cachea: siempre se ve al día.
 */
const VERSION = 'zs-app-v3';
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const DB_NAME = 'zs-offline';
const STORE = 'queue';
const SYNC_TAG = 'zs-crm-queue';
const QUEUED_HEADER = 'x-zs-queued';

const NEVER_QUEUE = [
  '/api/crm/emails',
  '/api/crm/import',
  '/api/crm/export',
  '/api/crm/files',
  '/api/crm/email-templates/preview',
  '/api/crm/search',
  '/api/crm/voice',
  '/api/crm/calls',
];

function shouldQueue(pathname, method, contentType) {
  const m = String(method).toUpperCase();
  if (m !== 'POST' && m !== 'PATCH' && m !== 'PUT' && m !== 'DELETE') return false;
  if (!pathname.startsWith('/api/crm/')) return false;
  if (NEVER_QUEUE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  if (pathname.endsWith('/draft') || pathname.includes('/ai')) return false;
  const ct = String(contentType || '').toLowerCase();
  return ct === '' || ct.startsWith('application/json');
}

async function replayQueue(store, doFetch) {
  const items = (await store.all()).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  let done = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += 1) {
    let res;
    try {
      res = await doFetch(items[i]);
    } catch {
      return { done, failed, remaining: items.length - i };
    }
    await store.remove(items[i].id);
    if (res.ok) done += 1;
    else failed += 1;
  }
  return { done, failed, remaining: 0 };
}

// El CRM entero y el inicio de la app (/app, sin subruta).
const CRM_PAGE = /^\/(en|es|pt)\/app(\/crm(\/|$)|\/?$)/;
const CRM_ROOT = /^\/app(\/crm(\/|$)|\/?$)/;

// Docs: el editor y la lista (D5).
const DOCS_PAGE = /^\/(en|es|pt)\/app\/docs(\/|$)/;
const DOCS_ROOT = /^\/app\/docs(\/|$)/;

function isCrmNavigation(url) {
  return CRM_PAGE.test(url.pathname) || CRM_ROOT.test(url.pathname);
}

/** Navegaciones que se guardan para abrir sin red: el CRM, el inicio y Docs. */
function isOfflineNavigation(url) {
  return isCrmNavigation(url) || DOCS_PAGE.test(url.pathname) || DOCS_ROOT.test(url.pathname);
}

// ---------- IndexedDB ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
        t.onerror = () => reject(t.error);
      }),
  );
}

const idbStore = {
  add: (item) => tx('readwrite', (s) => s.add(item)),
  all: () => tx('readonly', (s) => s.getAll()),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
  count: () => tx('readonly', (s) => s.count()),
};

// ---------- Mensajes a la página ----------

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage(msg);
}

async function broadcastCount() {
  const count = await idbStore.count().catch(() => 0);
  await broadcast({ type: 'zs-queue', count });
}

let replaying = null;
function replay() {
  if (replaying) return replaying;
  replaying = (async () => {
    const pending = await idbStore.count().catch(() => 0);
    if (!pending) return { done: 0, failed: 0, remaining: 0 };
    await broadcast({ type: 'zs-sync-start', count: pending });
    const result = await replayQueue(idbStore, (item) =>
      fetch(item.url, {
        method: item.method,
        headers: item.contentType ? { 'content-type': item.contentType } : {},
        body: item.body === null ? undefined : item.body,
        credentials: 'same-origin',
      }),
    );
    await broadcast({ type: 'zs-sync-done', ...result });
    await broadcastCount();
    return result;
  })().finally(() => {
    replaying = null;
  });
  return replaying;
}

// ---------- Ciclo de vida ----------

function offlineHtml(locale) {
  const text = {
    en: ['You are offline', 'This page has not been opened on this device yet. It will load when the connection is back.'],
    es: ['Sin conexión', 'Esta página todavía no se abrió en este dispositivo. Va a cargar cuando vuelva la conexión.'],
    pt: ['Sem conexão', 'Esta página ainda não foi aberta neste dispositivo. Ela carrega quando a conexão voltar.'],
  }[locale] || null;
  const [title, body] = text || ['You are offline', 'This page will load when the connection is back.'];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:340px;padding:24px}h1{font-size:1.25rem;margin:0 0 8px}button{font:inherit;padding:8px 14px;border:1px solid currentColor;border-radius:3px;background:none;color:inherit;cursor:pointer}</style></head><body><main><h1>${title}</h1><p>${body}</p><button onclick="location.reload()">↻</button></main></body></html>`;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected) await cache.put(request, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

async function crmNavigation(request) {
  const url = new URL(request.url);
  try {
    return await networkFirst(request, PAGES);
  } catch {
    const cache = await caches.open(PAGES);
    // /app, /app/crm o /app/docs sin locale (como abre la app instalada): la versión cacheada en cualquier idioma.
    if (CRM_ROOT.test(url.pathname) || DOCS_ROOT.test(url.pathname)) {
      for (const l of ['en', 'es', 'pt']) {
        const hit = await cache.match(`${url.origin}/${l}${url.pathname}`, { ignoreSearch: true });
        if (hit) return hit;
      }
    }
    const loose = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (loose) return loose;
    const locale = (CRM_PAGE.exec(url.pathname) || DOCS_PAGE.exec(url.pathname) || [])[1] || 'en';
    return new Response(offlineHtml(locale), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) await cache.put(request, res.clone());
  return res;
}

async function queueOrSend(request) {
  const clone = request.clone();
  try {
    return await fetch(request);
  } catch {
    const body = clone.method === 'DELETE' ? await clone.text().catch(() => '') : await clone.text();
    await idbStore.add({
      url: clone.url,
      method: clone.method,
      contentType: clone.headers.get('content-type'),
      body: body === '' ? null : body,
      createdAt: Date.now(),
    });
    if (self.registration.sync) self.registration.sync.register(SYNC_TAG).catch(() => null);
    await broadcastCount();
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { 'content-type': 'application/json', [QUEUED_HEADER]: '1' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'GET') {
    if (url.pathname.startsWith('/_next/static/')) {
      event.respondWith(cacheFirst(request));
      return;
    }
    if (request.mode === 'navigate' && isOfflineNavigation(url)) {
      event.respondWith(crmNavigation(request));
      return;
    }
    // GET de la API del CRM (listas, ajustes): network-first. Las páginas RSC
    // (?_rsc=) no se cachean: si fallan, Next hace una navegación completa.
    // Archivos (videos, PDFs) y pedidos con Range quedan afuera: una respuesta
    // parcial (206) no se puede guardar en la caché y el video no cargaba.
    if (
      url.pathname.startsWith('/api/crm/') &&
      !/^\/api\/crm\/(export|voice|extension)(\/|$)/.test(url.pathname) &&
      !/\/file$/.test(url.pathname) &&
      !request.headers.has('range')
    ) {
      event.respondWith(networkFirst(request, PAGES));
    }
    return;
  }

  if (shouldQueue(url.pathname, request.method, request.headers.get('content-type'))) {
    event.respondWith(queueOrSend(request));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replay());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'zs-sync') event.waitUntil(replay());
  else if (data.type === 'zs-count') event.waitUntil(broadcastCount());
  else if (data.type === 'zs-warm' && Array.isArray(data.urls)) {
    // La página ya cargó su JS y CSS antes de que el worker la controlara: se guardan ahora.
    event.waitUntil(
      (async () => {
        const statics = await caches.open(STATIC);
        const pages = await caches.open(PAGES);
        for (const raw of data.urls.slice(0, 200)) {
          try {
            const u = new URL(raw, self.location.origin);
            if (u.origin !== self.location.origin) continue;
            if (u.pathname.startsWith('/_next/static/')) {
              if (!(await statics.match(u.href))) await statics.add(u.href);
            } else if (isOfflineNavigation(u)) {
              const res = await fetch(u.href, { credentials: 'same-origin' });
              if (res.ok && !res.redirected) await pages.put(u.href, res);
            }
          } catch {
            /* sin red o recurso que ya no existe */
          }
        }
      })(),
    );
  }
});

// ---------- Push de Groups ----------

const GROUPS_ICON = '/api/pwa-icon/192';
const GROUPS_INBOX = '/app/groups/inbox';

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let list = [];
      try {
        const res = await fetch('/api/groups/push/pending', { credentials: 'include', cache: 'no-store' });
        if (res.ok) list = (await res.json()).notifications || [];
      } catch {
        list = [];
      }
      if (list.length === 0) {
        // El navegador exige mostrar algo por cada push.
        await self.registration.showNotification('Groups', { body: '', tag: 'groups', data: { url: GROUPS_INBOX }, icon: GROUPS_ICON });
        return;
      }
      for (const n of list) {
        await self.registration.showNotification(n.title || 'Groups', {
          body: n.body || '',
          tag: n.url || n.id,
          renotify: true,
          data: { url: n.url || GROUPS_INBOX },
          icon: GROUPS_ICON,
          badge: GROUPS_ICON,
        });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || GROUPS_INBOX;
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

// Para tests/unit/offline-queue.test.ts (en el navegador no molesta).
self.__zsOffline = { shouldQueue, replayQueue, NEVER_QUEUE, isOfflineNavigation };
