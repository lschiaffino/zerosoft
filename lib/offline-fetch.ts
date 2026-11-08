/**
 * Escrituras que siguen andando sin conexión (cliente).
 *
 * `offlineFetch` es un fetch que le pide al service worker (public/sw.js)
 * guardar el cambio en el dispositivo si no hay red (header x-zs-offline). El
 * worker responde 202 con `x-zs-queued: 1` y lo reenvía en orden al volver la
 * red. Cada pedido lleva:
 * - x-zs-idempotency-key: clave propia; las altas la usan para no crearse dos
 *   veces si el primer envío llegó y la respuesta no (lib/offline-idempotency.ts).
 * - x-zs-base: el updated_at que veía la página; si al llegar el servidor ya
 *   tiene una versión más nueva, se guarda igual y la barra de estado avisa
 *   "editado en otro lado".
 * - x-zs-label: cómo nombrar el cambio en la lista de pendientes ("ZER-12").
 *
 * Sin worker (primera carga, `next dev`) es un fetch común: sin red falla
 * como siempre. Solo cliente.
 */
import { announceQueued, isQueuedResponse } from './offline-queue';

export const OFFLINE_OPT_IN_HEADER = 'x-zs-offline';
export const IDEMPOTENCY_HEADER = 'x-zs-idempotency-key';
export const BASE_HEADER = 'x-zs-base';
export const LABEL_HEADER = 'x-zs-label';

export interface OfflineFetchInit extends RequestInit {
  /** updated_at de lo que se edita, como lo veía la página. */
  base?: string | null;
  /** Nombre corto del cambio para la lista de pendientes. */
  label?: string | null;
}

export interface OfflineFetchResult {
  /** null: no hubo respuesta (sin red y sin worker). */
  res: Response | null;
  /** El cambio quedó guardado en este dispositivo y se manda al volver la red. */
  queued: boolean;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** El label va en un header: solo caracteres que un header acepta, y corto. */
export function headerSafeLabel(label: string): string {
  return encodeURIComponent(label.slice(0, 120));
}

export async function offlineFetch(url: string, init: OfflineFetchInit = {}): Promise<OfflineFetchResult> {
  const { base, label, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set(OFFLINE_OPT_IN_HEADER, '1');
  if (!headers.has(IDEMPOTENCY_HEADER)) headers.set(IDEMPOTENCY_HEADER, newIdempotencyKey());
  if (base) headers.set(BASE_HEADER, base);
  if (label) headers.set(LABEL_HEADER, headerSafeLabel(label));
  const res = await fetch(url, { ...rest, headers }).catch(() => null);
  const queued = isQueuedResponse(res);
  if (queued) announceQueued(url);
  return { res, queued };
}

// ---------- Lo que todavía está en la cola (para mostrarlo al recargar sin red) ----------

export interface PendingWrite {
  url: string;
  method: string;
  body: string | null;
  createdAt: number;
}

/**
 * Los cambios que esperan en la cola del worker (IndexedDB zs-offline), en
 * orden. La página los aplica encima de la copia guardada: así, al recargar
 * sin red, se ve lo que la persona escribió y no la versión de antes.
 * Solo los de la persona actual (`owner`, persona:workspace).
 */
export async function pendingWrites(
  owner: string | null,
  match: (pathname: string, method: string) => boolean,
  opts: { failed?: boolean } = {},
): Promise<PendingWrite[]> {
  if (typeof indexedDB === 'undefined' || !owner) return [];
  try {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('zs-offline');
      // Si la base no existía, no se crea acá (la crea el worker con sus tablas).
      req.onupgradeneeded = () => {
        req.transaction?.abort();
        resolve(null);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return [];
    if (!db.objectStoreNames.contains('queue')) {
      db.close();
      return [];
    }
    const read = (name: string) =>
      new Promise<Array<PendingWrite & { owner?: string | null }>>((resolve) => {
        if (!db.objectStoreNames.contains(name)) return resolve([]);
        const r = db.transaction(name, 'readonly').objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result as Array<PendingWrite & { owner?: string | null }>);
        r.onerror = () => resolve([]);
      });
    // Con `failed`: también lo que el servidor rechazó y espera reintentar o descartar.
    const rows = [...(await read('queue')), ...(opts.failed ? await read('failed') : [])];
    db.close();
    return rows
      .filter((r) => r.owner === owner)
      .filter((r) => {
        try {
          return match(new URL(r.url, location.origin).pathname, r.method);
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/** Persona:workspace que la app le dijo al worker (components/app/OfflineIdentity.tsx). */
export function offlineOwner(): string | null {
  try {
    return localStorage.getItem('zs-identity');
  } catch {
    return null;
  }
}
