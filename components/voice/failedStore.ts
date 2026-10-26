'use client';

/**
 * Trozos de reunión que no se pudieron transcribir, guardados en IndexedDB
 * (base zs-voice) para reintentarlos aunque se recargue la página. Cada fila
 * lleva la persona y el workspace: al abrir la app con otra cuenta se borran
 * los ajenos, y al cerrar sesión se borra la base entera (lib/offline-queue
 * clearOfflineData).
 */

export interface StoredChunk {
  key: string;
  owner: string;
  sessionId: string;
  source: 'me' | 'them' | 'mixed';
  seq: number;
  offsetMs: number;
  durationMs: number;
  blob: Blob;
}

const DB = 'zs-voice';
const STORE = 'failed';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => {
        resolve(req ? (req.result as T) : null);
        db.close();
      };
      t.onerror = () => {
        resolve(null);
        db.close();
      };
    } catch {
      resolve(null);
    }
  });
}

export function chunkKey(owner: string, c: Pick<StoredChunk, 'sessionId' | 'source' | 'seq'>): string {
  return `${owner}|${c.sessionId}|${c.source}|${c.seq}`;
}

export async function saveFailedChunk(chunk: StoredChunk): Promise<void> {
  await tx('readwrite', (s) => s.put(chunk));
}

export async function deleteFailedChunk(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key));
}

/** Los trozos de esta persona en este workspace; borra los de otras cuentas. */
export async function loadFailedChunks(owner: string): Promise<StoredChunk[]> {
  const all = (await tx<StoredChunk[]>('readonly', (s) => s.getAll() as IDBRequest<StoredChunk[]>)) ?? [];
  const mine = all.filter((c) => c.owner === owner);
  const others = all.filter((c) => c.owner !== owner);
  for (const c of others) await deleteFailedChunk(c.key);
  return mine;
}
