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
import { LINES_DRAFT_PREFIX, UNSENT_LINES_KEY } from './optimistic-send';
import { clearSessionHint } from '@/lib/session-hint';

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

/** APIs que aceptan encolar cuando la página lo pide (header x-zs-offline, lib/offline-fetch.ts). */
export const OPT_IN_PREFIXES = ['/api/track/'] as const;
/** Nunca se encolan aunque se pida: integraciones, exportar, importar, en vivo. */
export const NEVER_OPT_IN = [
  '/api/track/export',
  '/api/track/github',
  '/api/track/slack',
  '/api/track/integrations',
  '/api/track/live',
  '/api/track/import',
] as const;

/**
 * ¿Se encola este request si falla por red? Solo JSON (o sin cuerpo): todo
 * /api/crm/** (salvo NEVER_QUEUE) y, si la página lo pide (`optIn`), las APIs
 * de OPT_IN_PREFIXES salvo NEVER_OPT_IN, adjuntos y agentes.
 */
export function shouldQueue(pathname: string, method: string, contentType: string | null, optIn = false): boolean {
  const m = method.toUpperCase();
  if (m !== 'POST' && m !== 'PATCH' && m !== 'PUT' && m !== 'DELETE') return false;
  const ct = (contentType ?? '').toLowerCase();
  if (ct !== '' && !ct.startsWith('application/json')) return false;
  if (pathname.endsWith('/draft') || pathname.includes('/ai')) return false;
  if (pathname.startsWith('/api/crm/')) return !NEVER_QUEUE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!optIn) return false;
  if (!OPT_IN_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  if (NEVER_OPT_IN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return !/\/(attachments|agent)(\/|$)/.test(pathname);
}

export interface QueuedRequest {
  id: number;
  url: string;
  method: string;
  contentType: string | null;
  /** Workspace de la pestaña que escribió: al reenviar se exige el mismo. */
  workspace?: string | null;
  /** Persona:workspace de la sesión que escribió: solo se manda con esa sesión. */
  owner?: string | null;
  /** Clave de idempotencia (la misma en cada reenvío). */
  idem?: string | null;
  /** updated_at sobre el que se editó (x-zs-base). */
  base?: string | null;
  /** Nombre del cambio para la lista de pendientes. */
  label?: string | null;
  body: string | null;
  createdAt: number;
}

export interface QueueStore {
  all(): Promise<QueuedRequest[]>;
  remove(id: number): Promise<void>;
  /** Rechazado por el servidor (4xx): se aparta para reintentar o descartar. Sin esto, se saca. */
  fail?(item: QueuedRequest, status: number): Promise<void>;
  /** Se guardó encima de una versión más nueva: se anota para avisar. */
  conflict?(item: QueuedRequest): Promise<void>;
}

export interface ReplayResult {
  done: number;
  failed: number;
  /** Guardados encima de una versión más nueva ("editado en otro lado"). */
  conflicts: number;
  remaining: number;
  /** Quedaron cambios que esta sesión no puede enviar (401 u otra persona). */
  blocked?: boolean;
  /** De esos, cuántos no dicen de qué workspace son. */
  unknown?: number;
  /** El servidor no pudo ahora (5xx, 429): lo que falta se reintenta después. */
  retry?: boolean;
}

export interface ReplayResponse {
  ok: boolean;
  status: number;
  conflict?: boolean;
  retry?: boolean;
}

/**
 * Reenvía la cola en orden (public/sw.js tiene la misma función; el test la
 * compara). Si se corta la red, o el servidor responde 5xx/429, se detiene y
 * lo que falta queda para la próxima. Un 401 o un cambio de otra persona
 * (`owner` distinto) queda en la cola y lo que sigue de esa sesión espera.
 * Otro 4xx aparta el cambio (fail) para reintentar o descartar; un DELETE con
 * 404 ya estaba hecho.
 */
export async function replayQueue(
  store: QueueStore,
  doFetch: (req: QueuedRequest) => Promise<ReplayResponse>,
  owner?: string | null,
): Promise<ReplayResult> {
  const items = (await store.all()).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  let done = 0;
  let failed = 0;
  let conflicts = 0;
  const blocked = new Set<string>();
  let unknown = 0;
  const keyOf = (it: QueuedRequest) => (it.owner ? `o:${it.owner}|${it.workspace}` : `w:${it.workspace}`);
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    // Sin workspace o sin persona: no se sabe de quién es; no se manda con ninguna sesión.
    if (!it.workspace || !it.owner) {
      unknown += 1;
      continue;
    }
    const key = keyOf(it);
    if (it.owner && it.owner !== owner) blocked.add(key);
    if (blocked.has(key)) continue;
    let res: ReplayResponse;
    try {
      res = await doFetch(it);
    } catch {
      return { done, failed, conflicts, remaining: items.length - i };
    }
    if (res.status === 401) {
      blocked.add(key);
      continue;
    }
    if (res.status >= 500 || res.status === 429 || res.status === 408 || res.retry) {
      return { done, failed, conflicts, remaining: items.length - i, retry: true };
    }
    const gone = it.method.toUpperCase() === 'DELETE' && (res.status === 404 || res.status === 410);
    if (res.ok || gone) {
      await store.remove(it.id);
      done += 1;
      if (res.conflict && store.conflict) {
        await store.conflict(it);
        conflicts += 1;
      }
      continue;
    }
    if (store.fail) await store.fail(it, res.status);
    else await store.remove(it.id);
    failed += 1;
  }
  let remaining = unknown;
  for (const it of items) if (it.workspace && it.owner && blocked.has(keyOf(it))) remaining += 1;
  if (!remaining) return { done, failed, conflicts, remaining: 0 };
  return unknown ? { done, failed, conflicts, remaining, blocked: true, unknown } : { done, failed, conflicts, remaining, blocked: true };
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

export const WORKSPACE_GUARD_KEY = 'zs-workspace-guard';

/**
 * Al cerrar sesión: borra las vistas guardadas y la cola de este
 * dispositivo, y las grabaciones de Rec guardadas de esa persona (solo las
 * suyas: cada persona tiene su base, ver components/rec/recStore.ts).
 */
export async function clearOfflineData(owner?: { userId: string; ws: string }): Promise<void> {
  if (typeof window === 'undefined') return;
  // El header del sitio deja de mostrar "Ir a la app" (lib/session-hint.ts).
  clearSessionHint();
  try {
    // El aviso de pestaña vieja nombra un workspace: no queda para quien use esta pestaña después.
    sessionStorage.removeItem(WORKSPACE_GUARD_KEY);
  } catch {
    // Sin almacenamiento: nada que borrar.
  }
  try {
    // Borrador del bloc de Notes (components/notes/NotesHome.tsx): no queda para quien entre después.
    localStorage.removeItem('zs:notes:scratch-draft');
  } catch {
    // Sin almacenamiento: nada que borrar.
  }
  try {
    // Lines: los textos que no salieron y los borradores de cada chat (lib/optimistic-send.ts): nada de esto queda
    // para quien entre después en la misma pestaña.
    sessionStorage.removeItem(UNSENT_LINES_KEY);
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(LINES_DRAFT_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Sin almacenamiento: nada que borrar.
  }
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
