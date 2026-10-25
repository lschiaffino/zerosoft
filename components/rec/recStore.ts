'use client';

/**
 * IndexedDB de Rec: cada parte de una grabación queda guardada en el
 * navegador hasta que el video termina de subirse y se cierra. Si se corta
 * la red, la pestaña se cierra o la subida falla, la grabación se recupera
 * desde acá (reanudar o descargar).
 */

const DB_PREFIX = 'zs-rec';
const VERSION = 1;

/**
 * Cada persona (y workspace) tiene su propia base en el navegador: en una
 * compu compartida nadie ve, descarga ni descarta las grabaciones de otro.
 * Las páginas de Rec fijan el dueño con setRecScope antes de usarla.
 */
let scope: { userId: string; ws: string } | null = null;

export function recDbName(userId: string, ws: string): string {
  const safe = (x: string) => x.replace(/[^\w-]/g, '_').slice(0, 80);
  return `${DB_PREFIX}:${safe(userId)}:${safe(ws)}`;
}

export function setRecScope(userId: string, ws: string) {
  if (scope && scope.userId === userId && scope.ws === ws) return;
  scope = { userId, ws };
  opening = null;
}

export function recScope() {
  return scope;
}

export interface RecPendingMeta {
  videoId: string;
  shareId: string;
  title: string;
  mode: 'blob' | 'local';
  partBytes: number;
  contentType: string;
  createdAt: number;
  /** Dueño de la grabación (se guarda también en cada ficha y se filtra al listar). */
  userId: string;
  ws: string;
  /** Próximo número de parte (la 1 se guarda hasta el final). */
  next: number;
  /** Partes ya confirmadas por el servidor (o por Blob, con su etag). */
  uploaded: number[];
  etags: Array<{ etag: string; partNumber: number }>;
  blob?: { pathname: string; key: string; uploadId: string; access: 'public' | 'private' };
  /** La grabación terminó: están todas las partes, la duración y los extras. */
  done: boolean;
  durationMs?: number;
  width?: number;
  height?: number;
  bytes: number;
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no_idb'));
  if (!scope) return Promise.reject(new Error('no_scope'));
  const name = recDbName(scope.userId, scope.ws);
  opening ??= openDb(name).catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

function run<T>(store: 'meta' | 'blobs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const partKey = (videoId: string, n: number) => `${videoId}:part:${n}`;
export const extraKey = (videoId: string, kind: 'audio' | 'thumb' | 'gif') => `${videoId}:${kind}`;

export function saveMeta(meta: RecPendingMeta): Promise<unknown> {
  return run('meta', 'readwrite', (s) => s.put(meta, meta.videoId));
}

export function loadMeta(videoId: string): Promise<RecPendingMeta | undefined> {
  return run('meta', 'readonly', (s) => s.get(videoId) as IDBRequest<RecPendingMeta | undefined>);
}

export async function listMetas(): Promise<RecPendingMeta[]> {
  const cur = scope;
  if (!cur) return [];
  const all = await run('meta', 'readonly', (s) => s.getAll() as IDBRequest<RecPendingMeta[]>).catch(() => [] as RecPendingMeta[]);
  return all.filter((m) => m.userId === cur.userId && m.ws === cur.ws);
}

/** Grabaciones sin subir de una persona en este navegador (para avisar al cerrar sesión). */
export async function pendingFor(userId: string, ws: string): Promise<RecPendingMeta[]> {
  const prev = scope;
  setRecScope(userId, ws);
  try {
    return (await listMetas()).filter((m) => m.next > 1);
  } finally {
    if (prev) setRecScope(prev.userId, prev.ws);
  }
}

/** Al cerrar sesión: borra la base de Rec de esa persona en este navegador. */
export async function clearRecData(userId: string, ws: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (scope && scope.userId === userId && scope.ws === ws) {
    const d = await opening?.catch(() => null);
    d?.close();
    opening = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(recDbName(userId, ws));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function saveBlob(key: string, blob: Blob): Promise<unknown> {
  return run('blobs', 'readwrite', (s) => s.put(blob, key));
}

export function loadBlob(key: string): Promise<Blob | undefined> {
  return run('blobs', 'readonly', (s) => s.get(key) as IDBRequest<Blob | undefined>);
}

/** Borra la grabación del navegador (después de cerrarla o al descartarla). */
export async function forget(videoId: string): Promise<void> {
  await run('meta', 'readwrite', (s) => s.delete(videoId)).catch(() => undefined);
  await run('blobs', 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${videoId}:`, `${videoId}:￿`))).catch(() => undefined);
}

/** El archivo entero armado con las partes guardadas (para descargarlo). */
export async function localRecording(meta: RecPendingMeta): Promise<Blob> {
  const parts: Blob[] = [];
  for (let n = 1; n < meta.next; n++) {
    const b = await loadBlob(partKey(meta.videoId, n));
    if (b) parts.push(b);
  }
  return new Blob(parts, { type: meta.contentType.split(';')[0] || 'video/webm' });
}

export function saveFile(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
