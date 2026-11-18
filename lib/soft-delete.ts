/**
 * Borrado suave de las limpiezas automáticas (retención e inactividad). Server-only.
 *
 * Una limpieza que antes borraba en duro llama a `softDelete`: guarda en `soft_deleted` un snapshot del registro
 * y de lo que su borrado se lleva puesto (lib/row-snapshot.ts, siguiendo las FKs, más las filas sin FK que la app
 * nombre) y saca esas filas de sus tablas en la misma transacción. Así ninguna query existente (listas, búsqueda,
 * Cmd+K, asistente, API, exportaciones) tiene que filtrar nada: el registro no está. Los archivos no se tocan
 * hasta la purga.
 *
 * Restaurar (`restoreSoftDeleted`) re-inserta el snapshot mientras la entrada exista. El cron horario
 * (`purgeDueSoftDeleted`, app/api/cron/tick) borra para siempre las entradas cuyo purge_at pasó, con sus
 * archivos; la app puede purgar una antes (`purgeSoftDeleted`).
 *
 * Plazos y privacidad: una limpieza que cumple un plazo prometido de borrado (la retención de un form, de
 * candidatos, de videos) no lo puede estirar. Para esas, `retentionPlan` adelanta la entrada a la papelera y
 * deja purge_at en el mismo momento en que antes se borraba: la gracia sale de adentro del plazo, nunca se suma.
 * Mientras está en la papelera el contenido es inaccesible (no está en ninguna tabla que lea la app) y solo se
 * ve su etiqueta.
 */
import { randomBytes } from 'crypto';
import { dbBatch, getDb, type BatchStatement, type Db } from './db';
import {
  chunks,
  collectRows,
  decodeValue,
  emptySnapshot,
  insertSnapshotRow,
  q,
  restoreNulls,
  schemaInfo,
  type Row,
  type RowSnapshot,
  type SchemaInfo,
} from './row-snapshot';

/** Período de gracia: días que algo borrado por una limpieza se puede restaurar. */
export const SOFT_DELETE_GRACE_DAYS = 30;
/** En limpiezas con plazo corto, la gracia nunca pasa de esta fracción del plazo. */
const GRACE_MAX_SHARE = 1 / 3;
const DAY_MS = 86_400_000;
/** Un reclamo de purga más viejo que esto (una corrida que murió a mitad) se puede volver a tomar. */
const CLAIM_TTL_MS = 15 * 60_000;

export type SoftDeleteReason = 'retention' | 'inactivity';

export interface SoftDeleteEntry {
  id: string;
  workspaceId: string;
  app: string;
  kind: string;
  recordId: string;
  scopeId: string | null;
  label: string;
  reason: SoftDeleteReason;
  deletedAt: string;
  purgeAt: string;
}

interface EntryRow {
  id: string;
  workspace_id: string;
  app: string;
  kind: string;
  record_id: string;
  scope_id: string | null;
  label: string;
  reason: string;
  deleted_at: string;
  purge_at: string;
}

function entryOf(r: EntryRow): SoftDeleteEntry {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    app: r.app,
    kind: r.kind,
    recordId: r.record_id,
    scopeId: r.scope_id,
    label: r.label,
    reason: r.reason === 'inactivity' ? 'inactivity' : 'retention',
    deletedAt: r.deleted_at,
    purgeAt: r.purge_at,
  };
}

const ENTRY_COLS = 'id, workspace_id, app, kind, record_id, scope_id, label, reason, deleted_at, purge_at';

/**
 * Archivos de cada app: cómo se borran al purgar. Import dinámico: este módulo no carga las apps.
 * Cada app que usa el borrado suave con archivos suma su entrada.
 */
const FILE_DROPPERS: Record<string, () => Promise<(refs: string[]) => Promise<unknown>>> = {
  forms: () => import('./forms/files').then((m) => m.deleteFormFiles),
  rec: () => import('./rec').then((m) => m.dropRecFiles),
};

// ---------- Plazos ----------

/** Días de gracia para un plazo de `retentionDays`: SOFT_DELETE_GRACE_DAYS, y nunca más de un tercio del plazo. */
export function graceDaysFor(retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  return Math.min(SOFT_DELETE_GRACE_DAYS, Math.floor(retentionDays * GRACE_MAX_SHARE));
}

export interface RetentionPlan {
  /** Lo que tiene su fecha antes de esto entra a la papelera. */
  trashBefore: Date;
  /** Cuándo se purga algo con fecha `base`: el mismo momento en que se borraba antes (nunca más tarde). */
  purgeAt(base: string | Date): Date;
  graceDays: number;
}

/**
 * Plan para una limpieza que borra lo que tiene su fecha antes de `cutoff` (cutoff = ahora menos el plazo).
 * La papelera arranca `graceDays` antes del plazo y la purga cae en el plazo: base + (now − cutoff).
 */
export function retentionPlan(cutoff: Date, now: Date = new Date()): RetentionPlan {
  const term = Math.max(0, now.getTime() - cutoff.getTime());
  const graceDays = graceDaysFor(Math.floor(term / DAY_MS));
  return {
    graceDays,
    trashBefore: new Date(cutoff.getTime() + graceDays * DAY_MS),
    purgeAt: (base) => {
      const t = typeof base === 'string' ? Date.parse(base.includes('T') || base.endsWith('Z') ? base : `${base.replace(' ', 'T')}Z`) : base.getTime();
      return new Date(Math.max(now.getTime(), (Number.isNaN(t) ? now.getTime() : t) + term));
    },
  };
}

/** Días enteros que le quedan a una entrada (0 = se purga en el próximo tick). */
export function softDeleteDaysLeft(purgeAt: string, now: Date = new Date()): number {
  const t = Date.parse(purgeAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

// ---------- Borrar ----------

export interface SoftDeleteInput {
  workspaceId: string;
  app: string;
  kind: string;
  recordId: string;
  /** Agrupa entradas dentro de la app (p. ej. el form de una respuesta). */
  scopeId?: string | null;
  /** Lo único que se ve de la entrada mientras está en la papelera. */
  label: string;
  reason: SoftDeleteReason;
  /** Tabla del registro y su columna clave (por defecto `id`, con el valor recordId). */
  root: { table: string; column?: string };
  /** Filas que cuelgan del registro sin FK declarada (sus propias hijas por FK se siguen solas). */
  extra?: Array<{ table: string; column: string; values: Array<string | number> }>;
  /** Referencias de archivos de la app que se borran recién al purgar. */
  files?: string[];
  purgeAt: Date;
  now?: Date;
  /** Sentencias que van en la misma transacción que el borrado (p. ej. bajar un contador). */
  also?: BatchStatement[];
}

/** DELETE de cada fila del snapshot por su clave primaria; las hijas antes que el padre. */
function deleteStatements(info: SchemaInfo, snap: RowSnapshot): BatchStatement[] {
  const out: BatchStatement[] = [];
  for (const { table, rows } of [...snap.tables].reverse()) {
    const pk = info.pks.get(table);
    const cols = pk?.length ? pk : (info.columns.get(table) ?? []);
    if (!cols.length) continue;
    for (const row of rows) {
      out.push({
        sql: `DELETE FROM ${q(table)} WHERE ${cols.map((c) => `${q(c)} IS ?`).join(' AND ')}`,
        args: cols.map((c) => decodeValue(row[c]) as string | number | null),
      });
    }
  }
  return out;
}

function newEntryId(): string {
  return `sdel_${randomBytes(12).toString('hex')}`;
}

/**
 * Pasa un registro a la papelera: snapshot + borrado de sus filas en una transacción. Devuelve el id de la
 * entrada, o null si el registro no existe o ya está en la papelera.
 */
export async function softDelete(input: SoftDeleteInput, db: Db = getDb()): Promise<string | null> {
  const info = await schemaInfo(db);
  const snap = emptySnapshot();
  await collectRows(db, info, snap, input.root.table, input.root.column ?? 'id', [input.recordId]);
  if (!snap.tables.length) return null;
  for (const x of input.extra ?? []) await collectRows(db, info, snap, x.table, x.column, x.values);
  // Una fila alcanzada por dos caminos se guarda una vez (la primera, que es la del orden de inserción).
  const seen = new Set<string>();
  for (const t of snap.tables) {
    const pk = info.pks.get(t.table);
    t.rows = t.rows.filter((r) => {
      const key = `${t.table}:${JSON.stringify((pk?.length ? pk : Object.keys(r)).map((c) => r[c]))}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  snap.tables = snap.tables.filter((t) => t.rows.length);
  const id = newEntryId();
  const now = (input.now ?? new Date()).toISOString();
  try {
    await dbBatch([
      {
        sql: `INSERT INTO soft_deleted (id, workspace_id, app, kind, record_id, scope_id, label, reason, snapshot, files, deleted_at, purge_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.workspaceId,
          input.app,
          input.kind,
          input.recordId,
          input.scopeId ?? null,
          input.label.slice(0, 300),
          input.reason,
          JSON.stringify(snap),
          JSON.stringify([...new Set((input.files ?? []).filter((f) => typeof f === 'string' && f))]),
          now,
          input.purgeAt.toISOString(),
        ],
      },
      ...deleteStatements(info, snap),
      ...(input.also ?? []),
    ]);
  } catch (err) {
    // Ya estaba en la papelera (único por app, tipo e id): otra corrida llegó antes.
    if (/UNIQUE|constraint/i.test(String(err))) return null;
    throw err;
  }
  return id;
}

// ---------- Listar ----------

export async function listSoftDeleted(
  workspaceId: string,
  app: string,
  f: { kind?: string; scopeIds?: string[]; limit?: number } = {},
  db: Db = getDb(),
): Promise<SoftDeleteEntry[]> {
  const where = ['workspace_id = ?', 'app = ?'];
  const args: Array<string | number> = [workspaceId, app];
  if (f.kind) {
    where.push('kind = ?');
    args.push(f.kind);
  }
  if (f.scopeIds) {
    if (!f.scopeIds.length) return [];
    where.push(`scope_id IN (${f.scopeIds.map(() => '?').join(',')})`);
    args.push(...f.scopeIds);
  }
  const rows = (await db
    .prepare(`SELECT ${ENTRY_COLS} FROM soft_deleted WHERE ${where.join(' AND ')} ORDER BY deleted_at DESC, id LIMIT ?`)
    .all(...args, Math.min(Math.max(f.limit ?? 200, 1), 500))) as EntryRow[];
  return rows.map(entryOf);
}

export async function getSoftDeleted(workspaceId: string, app: string, id: string, db: Db = getDb()): Promise<SoftDeleteEntry | null> {
  const r = (await db.prepare(`SELECT ${ENTRY_COLS} FROM soft_deleted WHERE id = ? AND workspace_id = ? AND app = ?`).get(id, workspaceId, app)) as EntryRow | undefined;
  return r ? entryOf(r) : null;
}

// ---------- Restaurar ----------

export type SoftRestoreResult = { ok: true; entry: SoftDeleteEntry } | { ok: false; reason: 'not_found' | 'conflict' };

function pkWhere(info: SchemaInfo, table: string, row: Row): { sql: string; args: Array<string | number | null> } | null {
  const pk = info.pks.get(table);
  if (!pk?.length) return null;
  return { sql: pk.map((c) => `${q(c)} = ?`).join(' AND '), args: pk.map((c) => decodeValue(row[c]) as string | number | null) };
}

/**
 * Restaura una entrada de la papelera de `app` en el workspace: el registro primero (si choca con algo que se
 * creó mientras tanto, la entrada queda y devuelve conflict), después lo demás (lo que ya no tiene a qué colgarse
 * se omite). La app hace lo suyo después (reiniciar el plazo, contadores).
 */
export async function restoreSoftDeleted(workspaceId: string, app: string, id: string, db: Db = getDb()): Promise<SoftRestoreResult> {
  const full = (await db.prepare(`SELECT ${ENTRY_COLS}, snapshot, files FROM soft_deleted WHERE id = ? AND workspace_id = ? AND app = ?`).get(id, workspaceId, app)) as
    | (EntryRow & { snapshot: string; files: string })
    | undefined;
  if (!full) return { ok: false, reason: 'not_found' };
  const snap = JSON.parse(full.snapshot) as RowSnapshot;
  const info = await schemaInfo(db);
  const [first, ...rest] = snap.tables;
  const root = first?.rows[0];
  if (!first || !root) return { ok: false, reason: 'not_found' };
  const where = pkWhere(info, first.table, root);
  if (where && (await db.prepare(`SELECT 1 FROM ${q(first.table)} WHERE ${where.sql}`).get(...where.args))) return { ok: false, reason: 'conflict' };
  // Se reclama la entrada antes de re-insertar: dos restores a la vez no duplican.
  const claimed = await db.prepare('DELETE FROM soft_deleted WHERE id = ? AND workspace_id = ? AND app = ?').run(id, workspaceId, app);
  if (!claimed.changes) return { ok: false, reason: 'not_found' };
  let rootOk = false;
  try {
    rootOk = await insertSnapshotRow(db, info, first.table, root, { orIgnore: false });
  } catch {
    rootOk = false;
  }
  if (!rootOk) {
    // Choque (un único que se ocupó mientras tanto, o el padre ya no está): la entrada vuelve a la papelera.
    await db
      .prepare(
        `INSERT OR IGNORE INTO soft_deleted (id, workspace_id, app, kind, record_id, scope_id, label, reason, snapshot, files, deleted_at, purge_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(full.id, full.workspace_id, full.app, full.kind, full.record_id, full.scope_id, full.label, full.reason, full.snapshot, full.files, full.deleted_at, full.purge_at);
    return { ok: false, reason: 'conflict' };
  }
  for (const row of first.rows.slice(1)) await insertSnapshotRow(db, info, first.table, row).catch(() => false);
  for (const { table, rows } of rest) {
    for (const row of rows) await insertSnapshotRow(db, info, table, row).catch(() => false);
  }
  await restoreNulls(db, snap.nulls);
  return { ok: true, entry: entryOf(full) };
}

// ---------- Purgar ----------

function parseFiles(v: unknown): string[] {
  try {
    const out = JSON.parse(String(v ?? '[]'));
    return Array.isArray(out) ? out.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  } catch {
    return [];
  }
}

async function dropFiles(app: string, refs: string[]): Promise<void> {
  if (!refs.length) return;
  const load = FILE_DROPPERS[app];
  if (!load) return;
  try {
    await (await load())(refs);
  } catch (err) {
    console.error('[soft-delete] files', app, err instanceof Error ? err.name : 'error');
  }
}

/** Purga una entrada ya (la app decide quién puede). */
export async function purgeSoftDeleted(workspaceId: string, app: string, id: string, db: Db = getDb()): Promise<boolean> {
  const rows = (await db.prepare('DELETE FROM soft_deleted WHERE id = ? AND workspace_id = ? AND app = ? RETURNING files').all(id, workspaceId, app)) as Array<{ files: string }>;
  if (!rows.length) return false;
  await dropFiles(app, parseFiles(rows[0].files));
  return true;
}

/**
 * Cron: purga las entradas cuyo purge_at pasó, con sus archivos. Cada una se reclama con compare-and-set
 * (purge_claimed_at) para que dos corridas no la purguen dos veces.
 */
export async function purgeDueSoftDeleted(now: Date = new Date(), limit = 500, db: Db = getDb()): Promise<{ purged: number }> {
  const stamp = now.toISOString();
  const stale = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();
  const due = (await db
    .prepare('SELECT id, purge_claimed_at FROM soft_deleted WHERE purge_at <= ? AND (purge_claimed_at IS NULL OR purge_claimed_at < ?) ORDER BY purge_at LIMIT ?')
    .all(stamp, stale, limit)) as Array<{ id: string; purge_claimed_at: string | null }>;
  let purged = 0;
  for (const part of chunks(due, 100)) {
    for (const r of part) {
      const claim = await db.prepare("UPDATE soft_deleted SET purge_claimed_at = ? WHERE id = ? AND COALESCE(purge_claimed_at, '') = ?").run(stamp, r.id, r.purge_claimed_at ?? '');
      if (!claim.changes) continue;
      const gone = (await db.prepare('DELETE FROM soft_deleted WHERE id = ? AND purge_claimed_at = ? RETURNING app, files').all(r.id, stamp)) as Array<{ app: string; files: string }>;
      if (!gone.length) continue;
      await dropFiles(gone[0].app, parseFiles(gone[0].files));
      purged++;
    }
  }
  return { purged };
}

/** Archivos guardados en una entrada (para el borrado de cuenta o workspace, lib/privacy.ts). */
export function softDeletedFiles(row: { app?: unknown; files?: unknown }): Array<{ app: string; ref: string }> {
  const app = typeof row.app === 'string' ? row.app : '';
  return app ? parseFiles(row.files).map((ref) => ({ app, ref })) : [];
}
