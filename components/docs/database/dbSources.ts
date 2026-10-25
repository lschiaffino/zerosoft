'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { DocsAccess, DocsDatabase } from '@/lib/docs-types';
import { dbKey } from '@/lib/docs-db-compute';
import type { DbOp } from '@/lib/docs-db-ops';
import { applyDbOps } from '@/lib/docs-db-ops';

/**
 * Bases de otras páginas (y de otros bloques de esta) que necesita una base
 * para relaciones, rollups y vistas vinculadas. Un store por pestaña:
 *
 * - Las bases de la página abierta las publica cada DocsDatabaseBlock al
 *   pintarse (`publishLocal`): sus cambios se ven al instante, sin guardar.
 * - Las de otras páginas se piden a /api/docs/databases/<página>/<bloque> y
 *   se cachean; `sendOps` les manda operaciones y actualiza la copia.
 */

export interface RemoteDb {
  db: DocsDatabase | null;
  page?: { id: string; title: string; icon: string | null };
  access?: DocsAccess;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

const local = new Map<string, DocsDatabase>();
const remote = new Map<string, RemoteDb>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Una base de la página abierta (la publica su bloque en cada cambio). */
export function publishLocal(pageId: string | null | undefined, blockId: string, db: DocsDatabase | null) {
  if (!pageId) return;
  const key = dbKey(pageId, blockId);
  if (db === null) {
    if (local.delete(key)) emit();
    return;
  }
  if (local.get(key) === db) return;
  local.set(key, db);
  emit();
}

async function fetchRemote(pageId: string, blockId: string): Promise<void> {
  const key = dbKey(pageId, blockId);
  const prev = remote.get(key);
  if (!prev) remote.set(key, { db: null, status: 'loading' });
  try {
    const res = await fetch(`/api/docs/databases/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}`);
    const data = (await res.json().catch(() => ({}))) as { db?: DocsDatabase; page?: RemoteDb['page']; access?: DocsAccess; error?: string };
    if (!res.ok || !data.db) remote.set(key, { db: null, status: 'error', error: data.error ?? 'error' });
    else remote.set(key, { db: data.db, page: data.page, access: data.access, status: 'ready' });
  } catch {
    remote.set(key, { db: prev?.db ?? null, status: 'error', error: 'network' });
  }
  emit();
}

/** Pide (una vez) la base de otra página. */
export function ensureRemote(pageId: string, blockId: string, force = false): Promise<void> {
  const key = dbKey(pageId, blockId);
  if (!force && (remote.get(key)?.status === 'ready' || inflight.has(key))) return inflight.get(key) ?? Promise.resolve();
  const p = fetchRemote(pageId, blockId).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function getSource(currentPageId: string | null | undefined, pageId: string, blockId: string): RemoteDb {
  const key = dbKey(pageId, blockId);
  if (currentPageId && pageId === currentPageId) {
    const db = local.get(key);
    if (db) return { db, status: 'ready', access: 'edit' };
  }
  return remote.get(key) ?? { db: null, status: 'loading' };
}

/**
 * Manda operaciones a la base de otra página. Aplica el cambio en la copia
 * al instante (optimista) y la reemplaza por lo que guardó el servidor; si
 * falla, vuelve a pedirla.
 */
export async function sendOps(pageId: string, blockId: string, ops: DbOp[]): Promise<{ ok: boolean; error?: string }> {
  if (!ops.length) return { ok: true };
  const key = dbKey(pageId, blockId);
  const cur = remote.get(key);
  if (cur?.db) {
    remote.set(key, { ...cur, db: applyDbOps(cur.db, ops) });
    emit();
  }
  try {
    const res = await fetch(`/api/docs/databases/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    });
    const data = (await res.json().catch(() => ({}))) as { db?: DocsDatabase; error?: string };
    if (!res.ok || !data.db) {
      void ensureRemote(pageId, blockId, true);
      return { ok: false, error: data.error ?? 'error' };
    }
    const now = remote.get(key);
    remote.set(key, { ...(now ?? { status: 'ready' }), db: stripBodies(data.db), status: 'ready' });
    emit();
    return { ok: true };
  } catch {
    void ensureRemote(pageId, blockId, true);
    return { ok: false, error: 'network' };
  }
}

function stripBodies(db: DocsDatabase): DocsDatabase {
  return { ...db, rows: db.rows.map((r) => (r.body ? (({ body: _b, ...rest }) => rest)(r) : r)) };
}

/** Re-render cuando cambia cualquier base del store. */
export function useDbStoreVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/**
 * Bases que necesita una base, por dbKey: las de la página abierta salen del
 * store local y las demás se piden. `null` = todavía cargando o sin acceso.
 */
export function useSources(currentPageId: string | null | undefined, sources: Array<{ page_id: string; block_id: string }>): Record<string, RemoteDb> {
  const v = useDbStoreVersion();
  const key = sources.map((s) => dbKey(s.page_id, s.block_id)).sort().join(',');
  useEffect(() => {
    for (const s of sources) {
      if (currentPageId && s.page_id === currentPageId && local.has(dbKey(s.page_id, s.block_id))) continue;
      void ensureRemote(s.page_id, s.block_id);
    }
    // `key` resume `sources`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, currentPageId]);
  return useMemo(() => {
    const out: Record<string, RemoteDb> = {};
    for (const s of sources) out[dbKey(s.page_id, s.block_id)] = getSource(currentPageId, s.page_id, s.block_id);
    return out;
    // `v` cambia con el store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, currentPageId, v]);
}

export interface DatabaseOption {
  page_id: string;
  page_title: string;
  page_icon: string | null;
  block_id: string;
  title: string;
  properties: Array<{ id: string; name: string; type: string }>;
}

/** Bases del workspace (selectores de relación y de vista vinculada). */
export function useWorkspaceDatabases(enabled: boolean): { rows: DatabaseOption[]; status: 'loading' | 'ready' | 'error'; reload: () => void } {
  const [state, setState] = useState<{ rows: DatabaseOption[]; status: 'loading' | 'ready' | 'error' }>({ rows: [], status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    fetch('/api/docs/databases')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { rows?: DatabaseOption[] }) => alive && setState({ rows: d.rows ?? [], status: 'ready' }))
      .catch(() => alive && setState({ rows: [], status: 'error' }));
    return () => {
      alive = false;
    };
  }, [enabled, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}
