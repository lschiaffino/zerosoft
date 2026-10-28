/**
 * CRM offline: reglas de la cola de cambios y helpers de la página.
 *
 * El service worker (public/sw.js) guarda en IndexedDB los POST/PATCH/DELETE a
 * /api/crm/** que fallan por falta de red y responde 202 con el header
 * `x-zs-queued: 1`. Al volver la red la página le pide que los reenvíe en
 * orden. Las reglas de qué se encola viven duplicadas en sw.js (no hay build
 * para el worker); tests/unit/offline-queue.test.ts verifica que coincidan.
 *
 * Client-safe (sin imports de server).
 */

import { NOTES_DB_PREFIX, notesDbName } from '@/components/notes/notesOffline';

export const QUEUED_HEADER = 'x-zs-queued';
/** Evento de window: un cambio quedó en la cola (detail: { url }). */
export const QUEUED_EVENT = 'zs:offline-queued';

/** Rutas que nunca se encolan: mandan email, suben archivos o son largas. */
export const NEVER_QUEUE = [
  '/api/crm/emails',
  '/api/crm/import',
  '/api/crm/export',
  '/api/crm/files',
  '/api/crm/email-templates/preview',
  '/api/crm/search',
  '/api/crm/voice',
  '/api/crm/calls',
] as const;

/** ¿Se encola este request si falla por red? Solo JSON (o sin cuerpo) a /api/crm/**. */
export function shouldQueue(pathname: string, method: string, contentType: string | null): boolean {
  const m = method.toUpperCase();
  if (m !== 'POST' && m !== 'PATCH' && m !== 'PUT' && m !== 'DELETE') return false;
  if (!pathname.startsWith('/api/crm/')) return false;
  if (NEVER_QUEUE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  if (pathname.endsWith('/draft') || pathname.includes('/ai')) return false;
  const ct = (contentType ?? '').toLowerCase();
  return ct === '' || ct.startsWith('application/json');
}

export interface QueuedRequest {
  id: number;
  url: string;
  method: string;
  contentType: string | null;
  body: string | null;
  createdAt: number;
}

export interface QueueStore {
  all(): Promise<QueuedRequest[]>;
  remove(id: number): Promise<void>;
}

export interface ReplayResult {
  done: number;
  failed: number;
  remaining: number;
}

/**
 * Reenvía la cola en orden. Si se corta la red se detiene (lo que falta queda
 * para la próxima). Una respuesta HTTP (aunque sea 4xx/5xx) saca el item: el
 * servidor ya decidió y reintentarlo daría el mismo resultado.
 */
export async function replayQueue(
  store: QueueStore,
  doFetch: (req: QueuedRequest) => Promise<{ ok: boolean; status: number }>,
): Promise<ReplayResult> {
  const items = (await store.all()).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  let done = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += 1) {
    let res: { ok: boolean; status: number };
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

/** La respuesta es del service worker: el cambio quedó en la cola offline. */
export function isQueuedResponse(res: Response | null | undefined): boolean {
  return Boolean(res && res.status === 202 && res.headers.get(QUEUED_HEADER) === '1');
}

/** Avisa a la página (banner offline) que un cambio quedó en la cola. */
export function announceQueued(url: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUEUED_EVENT, { detail: { url } }));
}

/** Cachés del service worker de la app (las de antes del rename y las actuales). */
export function isOfflineCacheName(name: string): boolean {
  return name.startsWith('zs-crm') || name.startsWith('zs-app-');
}

/**
 * Al cerrar sesión: borra las vistas guardadas y la cola de este
 * dispositivo, y las grabaciones de Rec guardadas de esa persona (solo las
 * suyas: cada persona tiene su base, ver components/rec/recStore.ts).
 */
export async function clearOfflineData(owner?: { userId: string; ws: string }): Promise<void> {
  if (typeof window === 'undefined') return;
  if (owner) {
    const { clearRecData } = await import('@/components/rec/recStore');
    await clearRecData(owner.userId, owner.ws).catch(() => undefined);
  }
  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      // Todo lo que guardó el service worker (public/sw.js): las vistas de
      // la app (zs-app-<versión>-pages, con datos de esta persona) y los
      // estáticos. Antes solo se borraban los zs-crm* de la versión vieja y
      // las vistas quedaban para quien entrara después en el mismo equipo.
      await Promise.all(keys.filter(isOfflineCacheName).map((k) => caches.delete(k)));
    }
    if ('indexedDB' in window) {
      indexedDB.deleteDatabase('zs-offline');
      // Trozos de reuniones de Voice que esperaban reintento (components/voice/failedStore.ts).
      indexedDB.deleteDatabase('zs-voice');
      // Base vieja de Rec, de antes de separarla por persona.
      indexedDB.deleteDatabase('zs-rec');
      // Copias offline de Notes (una por persona y workspace, con el texto de
      // las notas): todas las de este navegador, no solo la de quien sale.
      const names = new Set<string>();
      if (owner) names.add(notesDbName({ userId: owner.userId, ws: owner.ws }));
      const list = await indexedDB.databases?.().catch(() => []);
      for (const db of list ?? []) if (db.name?.startsWith(`${NOTES_DB_PREFIX}:`)) names.add(db.name);
      for (const name of names) indexedDB.deleteDatabase(name);
    }
  } catch {
    /* almacenamiento bloqueado: no hay nada que borrar */
  }
  // El worker olvida a la persona (no guarda ni sirve vistas hasta la próxima sesión).
  if (typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({ type: 'zs-user', id: null });
  // La cookie con la que el worker reconoce la sesión (middleware.ts): sin ella no sirve nada guardado.
  if (typeof document !== 'undefined') document.cookie = 'zs_who=; Max-Age=0; path=/';
  // Docs: borradores sin conexión y páginas "disponibles sin conexión" (lib/docs-offline.ts).
  const { forgetOtherOfflineData, OFFLINE_IDENTITY_KEY } = await import('./docs-offline');
  forgetOtherOfflineData(null);
  try {
    localStorage.removeItem(OFFLINE_IDENTITY_KEY);
    // Voice: los avisos de reunión ya mostrados (components/voice/MeetingReminders.tsx), de cualquier persona.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('zs-voice-reminded')) localStorage.removeItem(key);
    }
  } catch {
    /* sin storage */
  }
}
