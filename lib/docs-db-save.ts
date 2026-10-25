/**
 * Lo que hace el servidor con las bases de una página al guardarla (puro):
 * quién creó y quién editó cada fila (nunca lo que mande el cliente) y las
 * automatizaciones que disparó el cambio. Las acciones que tocan la propia
 * base ya las aplicó el editor (runAutomations da lo mismo acá: no cambia
 * nada); las de afuera (notificar, webhook, agregar fila en otra base)
 * vuelven como efectos para correr después de responder.
 */
import type { DbAction, DbProperty, DbRow, DbValue, DocsBlock, DocsDatabase } from './docs-types';
import { databasePatch, formatValue, normalizeDatabase, rowTitle } from './docs-database';
import { actionIncomplete, applyDbOps, fillTemplate, remoteActions, runAutomations } from './docs-db-ops';

export interface DbEffect {
  pageId: string;
  blockId: string;
  automationId: string;
  automationName: string;
  rowId: string;
  actions: DbAction[];
  /** Acciones que ya se hicieron en el mismo guardado (id → detalle del registro): solo se registran. */
  done?: Record<string, string>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function rowChanged(a: DbRow, b: DbRow): boolean {
  // El editor pone updated_at en cada cambio: con la misma marca no hace falta comparar todo (2.000 filas con cuerpo).
  if (a.updated_at === b.updated_at) return false;
  return !same(a.values, b.values) || !same(a.body, b.body) || !same(a.files, b.files);
}

/** created_by / updated_by desde lo guardado: filas nuevas y editadas por `actorId`. */
export function stampRows(prev: DocsDatabase | null, next: DocsDatabase, actorId: string | null): DocsDatabase {
  const old = new Map((prev?.rows ?? []).map((r) => [r.id, r]));
  let changed = false;
  const rows = next.rows.map((r) => {
    const o = old.get(r.id);
    const out: DbRow = { ...r };
    delete out.created_by;
    delete out.updated_by;
    if (!o) {
      // Sin actor (restaurar una versión): queda lo que traía la fila.
      if (actorId) out.created_by = actorId;
      else if (r.created_by) out.created_by = r.created_by;
      if (!actorId && r.updated_by) out.updated_by = r.updated_by;
    } else {
      if (o.created_by) out.created_by = o.created_by;
      if (actorId && rowChanged(o, r)) out.updated_by = actorId;
      else if (o.updated_by) out.updated_by = o.updated_by;
    }
    if (out.created_by !== r.created_by || out.updated_by !== r.updated_by) changed = true;
    return out;
  });
  return changed ? { ...next, rows } : next;
}

/** Bases de una lista de bloques por id (incluye las que todavía están en el formato viejo). */
function databasesById(blocks: DocsBlock[]): Map<string, DocsDatabase> {
  const out = new Map<string, DocsDatabase>();
  for (const b of blocks) if (b.type === 'database' && !b.linked) out.set(b.id, normalizeDatabase(b));
  return out;
}

/**
 * Procesa las bases de un guardado: sella autor de filas y corre
 * automatizaciones contra la versión anterior. Devuelve los bloques a guardar
 * y los efectos de afuera.
 */
export function prepareDatabaseSave(
  pageId: string,
  prevBlocks: DocsBlock[],
  nextBlocks: DocsBlock[],
  actorId: string | null,
  now = new Date().toISOString(),
): { blocks: DocsBlock[]; effects: DbEffect[] } {
  if (!nextBlocks.some((b) => b.type === 'database' && b.db)) return { blocks: nextBlocks, effects: [] };
  const before = databasesById(prevBlocks);
  const effects: DbEffect[] = [];
  const blocks = nextBlocks.map((b) => {
    if (b.type !== 'database' || !b.db || b.linked) return b;
    const prev = before.get(b.id) ?? null;
    let db = stampRows(prev, b.db, actorId);
    const res = runAutomations(prev, db, { now });
    db = res.db;
    for (const f of res.fired) {
      const actions = remoteActions(f.automation.actions);
      if (actions.length) effects.push({ pageId, blockId: b.id, automationId: f.automation.id, automationName: f.automation.name, rowId: f.rowId, actions });
    }
    return db === b.db ? b : { ...b, db };
  });
  return { blocks, effects };
}

/** Título de la fila de un efecto (para el aviso y el webhook). */
export function effectRowTitle(db: DocsDatabase, rowId: string): string {
  const row = db.rows.find((r) => r.id === rowId);
  return row ? rowTitle(db, row) : '';
}

/**
 * "Agregar fila" de una automatización hacia una base de esta misma página:
 * se hace en el mismo guardado (no después, desde afuera), así la respuesta
 * trae la fila nueva y el editor no ve su propia página "editada por otro".
 */
export function applySamePageRows(
  pageId: string,
  blocks: DocsBlock[],
  effects: DbEffect[],
  now = new Date().toISOString(),
): { blocks: DocsBlock[]; effects: DbEffect[]; changed: boolean } {
  let cur = blocks;
  let changed = false;
  const out: DbEffect[] = [];
  const format = (p: DbProperty, r: DbRow) => formatValue(p, r);
  for (const e of effects) {
    const done: Record<string, string> = { ...(e.done ?? {}) };
    for (const a of e.actions) {
      if (a.type !== 'add_row' || done[a.id] || actionIncomplete(a) || a.target.page_id !== pageId) continue;
      const ti = cur.findIndex((b) => b.id === a.target.block_id && b.type === 'database' && !b.linked);
      if (ti === -1) continue;
      const src = cur.find((b) => b.id === e.blockId && b.type === 'database' && !b.linked);
      const srcDb = src ? normalizeDatabase(src) : null;
      const row = srcDb?.rows.find((r) => r.id === e.rowId);
      const fill = (text: string) => (srcDb ? fillTemplate(text, srcDb, row, format) : text);
      const values: Record<string, DbValue> = {};
      for (const [k, v] of Object.entries(a.values ?? {})) values[k] = typeof v === 'string' ? fill(v) : v;
      const target = normalizeDatabase(cur[ti]);
      const next = applyDbOps(target, [{ op: 'add_row', values, title: a.title ? fill(a.title) : '' }], now);
      if (next === target) continue;
      const added = next.rows.find((r) => !target.rows.some((x) => x.id === r.id));
      cur = cur.map((b, i) => (i === ti ? { ...b, ...databasePatch(next) } : b));
      done[a.id] = `row:${added?.id ?? ''}`;
      changed = true;
    }
    out.push(Object.keys(done).length ? { ...e, done } : e);
  }
  return { blocks: cur, effects: out, changed };
}
