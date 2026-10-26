/**
 * Bases sincronizadas: lo que llega del editor no cambia filas ni
 * propiedades (las escribe la sincronización). Puro.
 */
import type { DocsBlock } from './docs-types';

/**
 * Para cada base que ya estaba sincronizada, se queda con filas,
 * propiedades, título y origen de lo guardado; del editor solo toma las
 * vistas. Una base que no estaba sincronizada no puede volverse sincronizada
 * desde el editor (se le saca la marca), salvo que su origen esté
 * registrado para ese bloque (`registered`: "origen:bloque").
 */
export function keepSyncedDatabases(previous: DocsBlock[], incoming: DocsBlock[], registered?: Set<string>): DocsBlock[] {
  const prevSynced = new Map<string, DocsBlock>();
  for (const b of previous) if (b.type === 'database' && b.db?.sync) prevSynced.set(b.id, b);
  let changed = false;
  const out = incoming.map((b) => {
    if (b.type !== 'database' || !b.db) return b;
    const prev = prevSynced.get(b.id);
    if (!prev?.db) {
      if (!b.db.sync) return b;
      // Base recién creada por la sincronización (el origen está registrado para este bloque).
      if (registered?.has(`${b.db.sync.source_id}:${b.id}`)) return b;
      changed = true;
      const { sync: _drop, ...rest } = b.db;
      void _drop;
      return { ...b, db: rest };
    }
    changed = true;
    return {
      ...b,
      db: {
        ...prev.db,
        views: b.db.views?.length ? b.db.views : prev.db.views,
        ...(b.db.active_view ? { active_view: b.db.active_view } : {}),
      },
    };
  });
  return changed ? out : incoming;
}

/** true si el bloque es una base sincronizada (solo lectura en el editor). */
export function isSyncedDatabase(block: Pick<DocsBlock, 'type' | 'db'>): boolean {
  return block.type === 'database' && Boolean(block.db?.sync);
}
