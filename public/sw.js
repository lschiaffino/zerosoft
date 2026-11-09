/* zerosoft service worker: el único de la suite (scope /, lo registra
 * lib/sw-client.ts desde el CRM y desde Groups).
 *
 * CRM y Notes offline:
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
 * Track sin conexión (y cualquier app que lo pida):
 * - Navegaciones a /<locale>/app/track/**: network-first con la última versión
 *   guardada (lo que la persona ya abrió: listas, issues, proyectos).
 * - Escrituras con el header `x-zs-offline: 1` (lib/offline-fetch.ts) a una
 *   API de OPT_IN_PREFIXES: si falla la red se encolan igual que las del CRM,
 *   con su clave de idempotencia, la versión sobre la que se editó (x-zs-base)
 *   y un nombre para la lista de pendientes (x-zs-label).
 *
 * Cola (replayQueue, igual que lib/offline-queue.ts):
 * - En orden; solo lo de la persona de la sesión (owner) y su workspace.
 * - 5xx, 429 o `x-zs-retry`: se corta y se reintenta después, sin perder nada.
 * - Otro 4xx: el cambio pasa a `failed` (la barra de estado ofrece reintentar
 *   o descartar). Un DELETE que da 404 ya está hecho.
 * - Respuesta con `x-zs-conflict: 1`: se guardó (gana lo último) pero alguien
 *   había guardado otra versión; queda en `conflicts` para avisar.
 *
 * Por persona (re-QA D5): las vistas guardadas son de quien estaba en la
 * sesión. La app avisa quién es ({type:'zs-user', id: '<persona>:<workspace>'},
 * components/app/OfflineIdentity.tsx); cada persona tiene su caché
 * (zs-app-<v>-pages-<id>), sin persona no se guarda ni se sirve nada, y si
 * cambia (o cierra sesión: id null) se borran todas las vistas guardadas.
 *
 * Push de Groups y Chat (lib/groups-push.ts):
 * - push: el servidor manda un push vacío (firma VAPID). Acá se piden los
 *   avisos pendientes con la sesión (/api/groups/push/pending) y se muestran.
 *   El texto nunca pasa por el servicio de push.
 * - notificationclick: abre (o enfoca) el chat del aviso.
 * - La bandeja de Groups no se cachea: siempre se ve al día.
 */
const VERSION = 'zs-app-v7';
const PAGES = `${VERSION}-pages`;
const META = `${VERSION}-meta`;
const USER_KEY = '/__zs-user';
const STATIC = `${VERSION}-static`;
const DB_NAME = 'zs-offline';
const STORE = 'queue';
const FAILED = 'failed';
const CONFLICTS = 'conflicts';
const DB_VERSION = 2;
/** Tope de vistas guardadas por persona (las más viejas salen primero). */
const MAX_PAGES = 300;
const SYNC_TAG = 'zs-crm-queue';
const QUEUED_HEADER = 'x-zs-queued';
const WORKSPACE_HEADER = 'x-zs-workspace';
const OPT_IN_HEADER = 'x-zs-offline';
const IDEMPOTENCY_HEADER = 'x-zs-idempotency-key';
const BASE_HEADER = 'x-zs-base';
const LABEL_HEADER = 'x-zs-label';
const CONFLICT_HEADER = 'x-zs-conflict';
const RETRY_HEADER = 'x-zs-retry';
const REPLAY_HEADER = 'x-zs-replay';

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

// APIs que aceptan encolar cuando la página lo pide (header x-zs-offline).
const OPT_IN_PREFIXES = ['/api/track/'];
// Nunca se encolan aunque se pida: integraciones, exportar, importar, en vivo.
const NEVER_OPT_IN = ['/api/track/export', '/api/track/github', '/api/track/slack', '/api/track/integrations', '/api/track/live', '/api/track/import'];

function shouldQueue(pathname, method, contentType, optIn) {
  const m = String(method).toUpperCase();
  if (m !== 'POST' && m !== 'PATCH' && m !== 'PUT' && m !== 'DELETE') return false;
  const ct = String(contentType || '').toLowerCase();
  if (ct !== '' && !ct.startsWith('application/json')) return false;
  if (pathname.endsWith('/draft') || pathname.includes('/ai')) return false;
  if (pathname.startsWith('/api/crm/')) return !NEVER_QUEUE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!optIn) return false;
  if (!OPT_IN_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  if (NEVER_OPT_IN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return !/\/(attachments|agent)(\/|$)/.test(pathname);
}

/**
 * Reenvía la cola en orden (la misma lógica que lib/offline-queue.ts, que la testea).
 * `owner`: persona:workspace de la sesión; lo de otra persona no se envía.
 */
async function replayQueue(store, doFetch, owner) {
  const items = (await store.all()).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  let done = 0;
  let failed = 0;
  let conflicts = 0;
  const blocked = new Set();
  let unknown = 0;
  const keyOf = (it) => (it.owner ? `o:${it.owner}|${it.workspace}` : `w:${it.workspace}`);
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    // Sin workspace o sin persona (cola de antes de este cambio): no se sabe de quién es.
    // No se envía con ninguna sesión; se avisa y se puede descartar.
    if (!it.workspace || !it.owner) {
      unknown += 1;
      continue;
    }
    const key = keyOf(it);
    // De otra persona (o sin sesión confirmada): espera a que vuelva la suya.
    if (it.owner && it.owner !== owner) blocked.add(key);
    if (blocked.has(key)) continue;
    let res;
    try {
      res = await doFetch(it);
    } catch {
      return { done, failed, conflicts, remaining: items.length - i };
    }
    // Sin sesión o con otro workspace activo: el item no se pierde ni se escribe en otro lado.
    // Queda, y lo que sigue del mismo workspace espera para no cambiar el orden.
    if (res.status === 401) {
      blocked.add(key);
      continue;
    }
    // El servidor no pudo ahora (caído, saturado o la misma alta en curso): se prueba después, en orden.
    if (res.status >= 500 || res.status === 429 || res.status === 408 || res.retry) {
      return { done, failed, conflicts, remaining: items.length - i, retry: true };
    }
    const gone = String(it.method).toUpperCase() === 'DELETE' && (res.status === 404 || res.status === 410);
    if (res.ok || gone) {
      await store.remove(it.id);
      done += 1;
      if (res.conflict && store.conflict) {
        await store.conflict(it);
        conflicts += 1;
      }
      continue;
    }
    // Rechazado (403, 404, 400...): no se pierde; queda aparte para reintentar o descartar.
    if (store.fail) await store.fail(it, res.status);
    else await store.remove(it.id);
    failed += 1;
  }
  let remaining = unknown;
  for (const it of items) if (it.workspace && it.owner && blocked.has(keyOf(it))) remaining += 1;
  if (!remaining) return { done, failed, conflicts, remaining: 0 };
  return unknown ? { done, failed, conflicts, remaining, blocked: true, unknown } : { done, failed, conflicts, remaining, blocked: true };
}

// El CRM entero, Notes y el inicio de la app (/app, sin subruta). Notes
// guarda sus notas en IndexedDB (components/notes/notesOffline.ts); acá
// solo se guarda la página para poder abrirla sin red.
const CRM_PAGE = /^\/(en|es|pt)\/app(\/crm(\/|$)|\/notes\/?$|\/?$)/;
const CRM_ROOT = /^\/app(\/crm(\/|$)|\/notes\/?$|\/?$)/;

// Track: listas, issues, proyectos y vistas que la persona abrió.
const TRACK_PAGE = /^\/(en|es|pt)\/app\/track(\/|$)/;
const TRACK_ROOT = /^\/app\/track(\/|$)/;

// Docs: el editor y la lista (D5).
const DOCS_PAGE = /^\/(en|es|pt)\/app\/docs(\/|$)/;
const DOCS_ROOT = /^\/app\/docs(\/|$)/;

// Notes: solo la lista (/app/notes) se guarda; nunca una nota abierta por
// link (?note=), y al bloquear una nota la página la pide borrar (zs-drop-notes).
const NOTES_PAGE = /^\/(en|es|pt)?\/?app\/notes\/?$/;

/** ¿Se puede guardar esta respuesta? Notes con ?note= (u otros parámetros) no. */
function storable(url) {
  if (NOTES_PAGE.test(url.pathname) && url.search) return false;
  return true;
}

function isCrmNavigation(url) {
  return CRM_PAGE.test(url.pathname) || CRM_ROOT.test(url.pathname);
}

/** Navegaciones que se guardan para abrir sin red: el CRM, el inicio, Docs, Notes y Track. Nunca el sitio público. */
function isOfflineNavigation(url) {
  return (
    isCrmNavigation(url) ||
    DOCS_PAGE.test(url.pathname) ||
    DOCS_ROOT.test(url.pathname) ||
    TRACK_PAGE.test(url.pathname) ||
    TRACK_ROOT.test(url.pathname)
  );
}

// ---------- IndexedDB ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(FAILED)) db.createObjectStore(FAILED, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CONFLICTS)) db.createObjectStore(CONFLICTS, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn, name) {
  const storeName = name || STORE;
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const out = fn(t.objectStore(storeName));
        t.oncomplete = () => {
          db.close();
          resolve(out && 'result' in out ? out.result : undefined);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

const idbStore = {
  add: (item) => tx('readwrite', (s) => s.add(item)),
  put: (item) => tx('readwrite', (s) => s.put(item)),
  all: () => tx('readonly', (s) => s.getAll()),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
  count: () => tx('readonly', (s) => s.count()),
  /** Rechazado por el servidor: pasa a `failed` con el código. */
  fail: async (item, status) => {
    await tx('readwrite', (s) => s.put({ ...item, status, failedAt: Date.now() }), FAILED);
    await tx('readwrite', (s) => s.delete(item.id));
  },
  /** Se guardó encima de una versión más nueva de otra persona: se avisa. */
  conflict: (item) =>
    tx('readwrite', (s) => s.add({ url: item.url, method: item.method, label: item.label || null, owner: item.owner || null, at: Date.now() }), CONFLICTS),
};

const failedStore = {
  all: () => tx('readonly', (s) => s.getAll(), FAILED),
  remove: (id) => tx('readwrite', (s) => s.delete(id), FAILED),
};
const conflictStore = {
  all: () => tx('readonly', (s) => s.getAll(), CONFLICTS),
  remove: (id) => tx('readwrite', (s) => s.delete(id), CONFLICTS),
};

// ---------- Mensajes a la página ----------

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage(msg);
}

/** Lo que la barra de estado muestra: pendientes, rechazados y avisos de "editado en otro lado" de la persona actual. */
async function broadcastCount() {
  const owner = await getUser().catch(() => null);
  const mine = (it) => Boolean(owner) && it.owner === owner;
  const all = await idbStore.all().catch(() => []);
  const queue = all.filter(mine);
  // Sin persona o sin workspace: no se muestra qué son, solo cuántos (para descartarlos).
  const unknown = all.filter((it) => !it.owner || !it.workspace).length;
  const failed = (await failedStore.all().catch(() => [])).filter(mine);
  const conflicts = (await conflictStore.all().catch(() => [])).filter(mine);
  const brief = (it) => ({ id: it.id, url: it.url, method: it.method || null, label: it.label || null, status: it.status || null, at: it.failedAt || it.at || it.createdAt });
  await broadcast({
    type: 'zs-queue',
    count: queue.length,
    unknown,
    pending: queue.slice(0, 50).map(brief),
    failed: failed.slice(0, 50).map(brief),
    conflicts: conflicts.slice(-20).map(brief),
  });
}

let replaying = null;
function replay() {
  if (replaying) return replaying;
  replaying = (async () => {
    const pending = await idbStore.count().catch(() => 0);
    if (!pending) return { done: 0, failed: 0, remaining: 0 };
    await broadcast({ type: 'zs-sync-start', count: pending });
    // Solo con la sesión de quien escribió (zs_who igual al confirmado): si no, nada tiene dueño válido y todo espera.
    const owner = (await sessionMatches().catch(() => false)) ? await getUser().catch(() => null) : null;
    // Varios cambios al mismo registro: el segundo se apoya en lo que dejó el primero, no en la base vieja.
    const latest = new Map();
    const result = await replayQueue(
      idbStore,
      async (item) => {
        const base = latest.get(item.url) || item.base;
        const res = await fetch(item.url, {
          method: item.method,
          headers: {
            ...(item.contentType ? { 'content-type': item.contentType } : {}),
            ...(item.workspace ? { [WORKSPACE_HEADER]: item.workspace } : {}),
            ...(item.idem ? { [IDEMPOTENCY_HEADER]: item.idem } : {}),
            ...(base ? { [BASE_HEADER]: base } : {}),
            [REPLAY_HEADER]: '1',
          },
          body: item.body === null ? undefined : item.body,
          credentials: 'same-origin',
        });
        if (res.ok) {
          const data = await res
            .clone()
            .json()
            .catch(() => null);
          if (data && typeof data.updated_at === 'string') latest.set(item.url, data.updated_at);
        }
        return { ok: res.ok, status: res.status, conflict: res.headers.get(CONFLICT_HEADER) === '1', retry: res.headers.get(RETRY_HEADER) === '1' };
      },
      owner,
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

// ---------- Persona de la sesión ----------

// La sesión dura 30 días (NextAuth): una persona confirmada hace más que eso no cuenta.
const IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Cookie no httpOnly que el middleware pone con la sesión (hash de la persona) y que
// se va con ella: si no está o es de otra persona, no se sirve nada guardado.
const WHO_COOKIE = 'zs_who';

let currentMeta;

async function getMeta() {
  if (currentMeta !== undefined) return currentMeta;
  try {
    const hit = await (await caches.open(META)).match(USER_KEY);
    const data = hit ? await hit.json() : null;
    currentMeta = data && data.id ? { id: data.id, who: data.who || null, at: Number(data.at) || 0 } : null;
  } catch {
    currentMeta = null;
  }
  return currentMeta;
}

async function getUser() {
  const meta = await getMeta();
  return meta ? meta.id : null;
}

async function dropPages() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(PAGES)).map((k) => caches.delete(k)));
}

/**
 * La app (con red) dice quién es: persona:workspace y el valor de zs_who.
 * Si cambió la persona (otra cuenta, otro workspace o cerró sesión: id null),
 * fuera todas las vistas guardadas. Cada aviso renueva la confirmación.
 */
async function setUser(id, who) {
  const next = typeof id === 'string' && id ? id.slice(0, 200) : null;
  const prevMeta = await getMeta();
  const prev = prevMeta ? prevMeta.id : null;
  if (prev !== next) await dropPages();
  const meta = await caches.open(META);
  if (!next) {
    currentMeta = null;
    await meta.delete(USER_KEY);
    return;
  }
  // Sin `who` en el aviso (mensajes viejos): se mantiene el de la misma persona.
  const nextWho = typeof who === 'string' && who ? who.slice(0, 100) : prev === next && prevMeta ? prevMeta.who : null;
  currentMeta = { id: next, who: nextWho, at: Date.now() };
  await meta.put(USER_KEY, new Response(JSON.stringify(currentMeta), { headers: { 'content-type': 'application/json' } }));
}

/**
 * ¿La sesión actual es la de quien guardó las vistas? Con Cookie Store
 * (Chromium) se compara zs_who: sin la cookie (sesión vencida o cerrada) o con
 * la de otra persona, no. Sin Cookie Store, alcanza con que la persona se haya
 * confirmado con red dentro de los 30 días de la sesión.
 */
async function sessionMatches() {
  const meta = await getMeta();
  if (!meta) return false;
  if (!meta.at || Date.now() - meta.at > IDENTITY_MAX_AGE_MS) return false;
  const store = self.cookieStore;
  if (store && typeof store.get === 'function') {
    let cookie = null;
    try {
      cookie = await store.get(WHO_COOKIE);
    } catch {
      cookie = null;
    }
    if (!cookie || !cookie.value || !meta.who || cookie.value !== meta.who) return false;
  }
  return true;
}

/** Caché de vistas de la persona actual, solo si la sesión es la suya (null: no se guarda ni se sirve nada). */
async function pagesCache() {
  const meta = await getMeta();
  if (!meta || !(await sessionMatches())) return null;
  return caches.open(`${PAGES}-${encodeURIComponent(meta.id)}`);
}

async function networkFirst(request) {
  const cache = await pagesCache();
  if (!cache) return fetch(request);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected && storable(new URL(request.url))) {
      await cache.put(request, res.clone()).catch(() => undefined);
      await trimPages(cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

/** Que las vistas guardadas no crezcan sin fin: fuera las más viejas. */
async function trimPages(cache) {
  try {
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k);
  } catch {
    /* nada que recortar */
  }
}

async function crmNavigation(request) {
  const url = new URL(request.url);
  try {
    return await networkFirst(request);
  } catch {
    const cache = (await pagesCache()) || (await caches.open(`${PAGES}-none`));
    // /app, /app/crm o /app/docs sin locale (como abre la app instalada): la versión cacheada en cualquier idioma.
    if (CRM_ROOT.test(url.pathname) || DOCS_ROOT.test(url.pathname) || TRACK_ROOT.test(url.pathname)) {
      for (const l of ['en', 'es', 'pt']) {
        const hit = await cache.match(`${url.origin}/${l}${url.pathname}`, { ignoreSearch: true });
        if (hit) return hit;
      }
    }
    const loose = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (loose) return loose;
    // Un issue de Track cambia de slug con el título (/issue/<ref>/<slug>): sin red vale la copia del mismo issue.
    const ISSUE_PAGE = /^(\/(?:en|es|pt))?\/app\/track\/issue\/([^/]+)(?:\/|$)/;
    const issue = ISSUE_PAGE.exec(url.pathname);
    if (issue) {
      for (const key of await cache.keys()) {
        const m = ISSUE_PAGE.exec(new URL(key.url).pathname);
        if (m && m[2] === issue[2] && (!issue[1] || m[1] === issue[1])) {
          const hit = await cache.match(key);
          if (hit) return hit;
        }
      }
    }
    const locale = (CRM_PAGE.exec(url.pathname) || DOCS_PAGE.exec(url.pathname) || TRACK_PAGE.exec(url.pathname) || [])[1] || 'en';
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

function newKey() {
  return self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function decodeLabel(raw) {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).slice(0, 120);
  } catch {
    return null;
  }
}

async function queueOrSend(request) {
  const clone = request.clone();
  try {
    return await fetch(request);
  } catch (err) {
    // Sin persona confirmada no se guarda nada: el cambio falla como sin worker.
    const owner = (await sessionMatches().catch(() => false)) ? await getUser().catch(() => null) : null;
    if (!owner) throw err;
    const body = clone.method === 'DELETE' ? await clone.text().catch(() => '') : await clone.text();
    await idbStore.add({
      url: clone.url,
      method: clone.method,
      contentType: clone.headers.get('content-type'),
      // El workspace de la pestaña que escribió: al reenviar se exige el mismo.
      workspace: clone.headers.get(WORKSPACE_HEADER),
      // La persona de la sesión: lo suyo no se manda con la sesión de otra.
      owner,
      // La misma clave en cada reenvío: un alta que ya llegó no se crea dos veces.
      idem: clone.headers.get(IDEMPOTENCY_HEADER) || newKey(),
      base: clone.headers.get(BASE_HEADER),
      label: decodeLabel(clone.headers.get(LABEL_HEADER)),
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
      event.respondWith(networkFirst(request));
    }
    return;
  }

  if (shouldQueue(url.pathname, request.method, request.headers.get('content-type'), request.headers.get(OPT_IN_HEADER) === '1')) {
    event.respondWith(queueOrSend(request));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replay());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'zs-user') event.waitUntil(setUser(data.id, data.who));
  else if (data.type === 'zs-sync') event.waitUntil(replay());
  else if (data.type === 'zs-drop-unscoped') {
    // La persona descarta lo que no se sabe de qué workspace es.
    event.waitUntil(
      (async () => {
        for (const it of await idbStore.all()) if (!it.workspace || !it.owner) await idbStore.remove(it.id);
        await broadcastCount();
        await broadcast({ type: 'zs-sync-done', done: 0, failed: 0 });
      })(),
    );
  }
  else if (data.type === 'zs-drop-notes') {
    // Una nota se bloqueó: fuera las páginas de Notes guardadas (podían tener su texto).
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        for (const k of keys.filter((name) => name.startsWith(PAGES))) {
          const cache = await caches.open(k);
          for (const req of await cache.keys()) if (NOTES_PAGE.test(new URL(req.url).pathname)) await cache.delete(req);
        }
        // Y se vuelve a guardar la lista actual (ya sin el texto), si la sesión es la de quien guarda.
        const pages = await pagesCache();
        for (const raw of (Array.isArray(data.refetch) ? data.refetch : []).slice(0, 3)) {
          try {
            const u = new URL(raw, self.location.origin);
            if (u.origin !== self.location.origin || !NOTES_PAGE.test(u.pathname) || !pages) continue;
            const res = await fetch(u.href, { credentials: 'same-origin' });
            if (res.ok && !res.redirected) await pages.put(u.href, res);
          } catch {
            /* sin red: queda sin guardar hasta la próxima visita */
          }
        }
      })(),
    );
  }
  else if (data.type === 'zs-count') event.waitUntil(broadcastCount());
  else if (data.type === 'zs-retry-failed') {
    // Reintentar lo rechazado (uno o todos los de la persona): vuelve a la cola en su orden original.
    event.waitUntil(
      (async () => {
        const owner = await getUser().catch(() => null);
        for (const it of await failedStore.all()) {
          if (data.id != null && it.id !== data.id) continue;
          if (it.owner !== owner) continue;
          const back = { ...it };
          delete back.status;
          delete back.failedAt;
          await idbStore.put(back);
          await failedStore.remove(it.id);
        }
        await broadcastCount();
        await replay();
      })(),
    );
  }
  else if (data.type === 'zs-discard-failed') {
    event.waitUntil(
      (async () => {
        const owner = await getUser().catch(() => null);
        for (const it of await failedStore.all()) {
          if (data.id != null && it.id !== data.id) continue;
          if (it.owner !== owner) continue;
          await failedStore.remove(it.id);
        }
        await broadcastCount();
      })(),
    );
  }
  else if (data.type === 'zs-clear-conflicts') {
    // Solo los avisos de la persona actual.
    event.waitUntil(
      (async () => {
        const owner = await getUser().catch(() => null);
        for (const it of await conflictStore.all()) if (it.owner === owner) await conflictStore.remove(it.id);
        await broadcastCount();
      })(),
    );
  }
  else if (data.type === 'zs-warm' && Array.isArray(data.urls)) {
    // La página ya cargó su JS y CSS antes de que el worker la controlara: se guardan ahora.
    event.waitUntil(
      (async () => {
        // La página manda quién es junto con lo que hay que guardar.
        if ('user' in data) await setUser(data.user, data.who);
        const statics = await caches.open(STATIC);
        const pages = await pagesCache();
        for (const raw of data.urls.slice(0, 200)) {
          try {
            const u = new URL(raw, self.location.origin);
            if (u.origin !== self.location.origin) continue;
            if (u.pathname.startsWith('/_next/static/')) {
              if (!(await statics.match(u.href))) await statics.add(u.href);
            } else if (pages && isOfflineNavigation(u) && storable(u)) {
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
const GROUPS_INBOX = '/app/lines/inbox';

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
        await self.registration.showNotification('Lines', { body: '', tag: 'groups', data: { url: GROUPS_INBOX }, icon: GROUPS_ICON });
        return;
      }
      for (const n of list) {
        await self.registration.showNotification(n.title || 'Lines', {
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
        if ('focus' in c && new URL(c.url).pathname.includes('/app/')) {
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
self.__zsOffline = { shouldQueue, replayQueue, NEVER_QUEUE, NEVER_OPT_IN, OPT_IN_PREFIXES, isOfflineNavigation, setUser, getUser, pagesCache, sessionMatches };
