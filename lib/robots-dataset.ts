/**
 * Robots — tabla acumulada (robot_rows). Server-only.
 *
 * Cada corrida exitosa junta las filas de la variable de lista del robot
 * (la elegida en la pestaña Datos, o la primera lista de los pasos) en una
 * tabla por robot: filas nuevas, filas que cambiaron (misma clave, otros
 * valores) y filas que ya no aparecieron en la última corrida. La clave es
 * la combinación de las columnas elegidas, o la fila entera.
 *
 * captured_by: con el acceso de quién se capturó la fila (si la corrida usó
 * un login o una sesión guardada). Esas filas solo las ven esa persona y los
 * admins (canSeeRobotData en lib/robots.ts); las públicas, todo el workspace.
 */
import { createHash } from 'crypto';
import { getDb, type RobotRowRow } from './db';
import { stableJson } from './robots-diff';
import { MAX_DATASET_ROWS } from './robots-schema';

export interface DatasetMergeResult {
  variable: string;
  added: number;
  changed: number;
  removed: number;
  total: number;
  /** Filas nuevas y cambiadas de esta corrida (para los envíos: append, CRM). */
  fresh: Array<Record<string, unknown>>;
  /** Se cortó porque la tabla llegó al tope. */
  capped?: boolean;
}

/** Fila de una variable como objeto (las listas de textos o arrays pasan a columnas). */
export function toRowObject(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const o: Record<string, unknown> = {};
    v.forEach((x, i) => {
      o[`col${i + 1}`] = x;
    });
    return o;
  }
  if (typeof v === 'object') return v as Record<string, unknown>;
  return { value: v };
}

/** Filas de una variable (lista) como objetos. */
export function rowsOf(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const v of value) {
    const o = toRowObject(v);
    if (o) out.push(o);
  }
  return out;
}

/** Clave estable de una fila: las columnas clave (si todas tienen valor) o la fila entera. */
export function rowKey(row: Record<string, unknown>, keyFields: readonly string[]): string {
  const keyed = keyFields.length ? keyFields.map((k) => row[k]) : null;
  const basis = keyed && keyed.every((v) => v !== undefined && v !== null && String(v).trim() !== '') ? keyed : row;
  return createHash('sha256').update(stableJson(basis)).digest('hex').slice(0, 40);
}

/**
 * Junta las filas de una corrida en la tabla del robot (upsert por clave).
 * Las que no aparecieron pasan a 'removed' (vuelven a 'active' si reaparecen).
 */
export async function mergeDataset(opts: {
  workspaceId: string;
  robotId: string;
  runId: string;
  variable: string;
  rows: Array<Record<string, unknown>>;
  keyFields: readonly string[];
  capturedBy: string | null;
  /** Entradas de la corrida (JSON tal como quedó en robot_runs.input). */
  input?: string;
  now?: string;
}): Promise<DatasetMergeResult> {
  const db = getDb();
  const ts = opts.now ?? new Date().toISOString();
  const existing = (await db
    .prepare('SELECT id, row_key, data, status FROM robot_rows WHERE robot_id = ? AND user_id = ?')
    .all(opts.robotId, opts.workspaceId)) as Array<Pick<RobotRowRow, 'id' | 'row_key' | 'data' | 'status'>>;
  const byKey = new Map(existing.map((r) => [r.row_key, r]));
  const seen = new Set<string>();
  const result: DatasetMergeResult = { variable: opts.variable, added: 0, changed: 0, removed: 0, total: 0, fresh: [] };
  let count = existing.length;
  for (const row of opts.rows) {
    const key = rowKey(row, opts.keyFields);
    if (seen.has(key)) continue;
    seen.add(key);
    const data = JSON.stringify(row).slice(0, 20_000);
    const prev = byKey.get(key);
    if (!prev) {
      if (count >= MAX_DATASET_ROWS) {
        result.capped = true;
        continue;
      }
      count += 1;
      await db
        .prepare(
          `INSERT INTO robot_rows (id, robot_id, user_id, row_key, data, status, first_run_id, last_run_id, first_seen_at, last_seen_at, captured_by)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
           ON CONFLICT (robot_id, row_key) DO UPDATE SET data = excluded.data, status = 'active', last_run_id = excluded.last_run_id,
             last_seen_at = excluded.last_seen_at, removed_at = NULL`,
        )
        .run(crypto.randomUUID(), opts.robotId, opts.workspaceId, key, data, opts.runId, opts.runId, ts, ts, opts.capturedBy);
      result.added += 1;
      result.fresh.push(row);
      continue;
    }
    const changed = stableJson(JSON.parse(prev.data)) !== stableJson(JSON.parse(data));
    await db
      .prepare(
        `UPDATE robot_rows SET data = ?, status = 'active', last_run_id = ?, last_seen_at = ?, removed_at = NULL,
           changed_at = CASE WHEN ? = 1 THEN ? ELSE changed_at END, captured_by = ?
         WHERE id = ?`,
      )
      .run(data, opts.runId, ts, changed ? 1 : 0, ts, opts.capturedBy, prev.id);
    if (changed) {
      result.changed += 1;
      result.fresh.push(row);
    } else if (prev.status === 'removed') {
      // Volvió a aparecer: cuenta como nueva para los envíos.
      result.fresh.push(row);
    }
  }
  // Ya no aparecen: solo las que vio por última vez una corrida con las mismas
  // entradas (en un lote o con otra URL, cada entrada tiene sus propias filas).
  const gone = (await db
    .prepare(
      `UPDATE robot_rows SET status = 'removed', removed_at = ?
       WHERE robot_id = ? AND user_id = ? AND status = 'active' AND last_run_id != ?
         AND last_run_id IN (SELECT id FROM robot_runs WHERE robot_id = ? AND input = ?)`,
    )
    .run(ts, opts.robotId, opts.workspaceId, opts.runId, opts.robotId, opts.input ?? '{}')) as { changes: number };
  result.removed = gone.changes;
  const total = (await db
    .prepare("SELECT COUNT(*) AS n FROM robot_rows WHERE robot_id = ? AND user_id = ? AND status = 'active'")
    .get(opts.robotId, opts.workspaceId)) as { n: number };
  result.total = Number(total.n) || 0;
  return result;
}

export interface DatasetRowDto {
  id: string;
  data: Record<string, unknown>;
  status: 'active' | 'removed';
  firstSeenAt: string;
  lastSeenAt: string;
  changedAt: string | null;
  removedAt: string | null;
  /** Nueva en la última corrida. */
  isNew: boolean;
}

export interface DatasetViewer {
  personId: string;
  admin: boolean;
}

export type DatasetFilter = 'all' | 'active' | 'new' | 'changed' | 'removed';

/**
 * Filas de la tabla acumulada, con búsqueda de texto y filtro. Las filas
 * capturadas con un login solo las ve quien armó el robot y los admins.
 */
export async function listDataset(
  workspaceId: string,
  robotId: string,
  opts: { viewer?: DatasetViewer; q?: string; filter?: DatasetFilter; limit?: number; offset?: number } = {},
): Promise<{ rows: DatasetRowDto[]; total: number; columns: string[]; counts: Record<'active' | 'removed', number>; hidden: number }> {
  const db = getDb();
  const where: string[] = ['robot_id = ?', 'user_id = ?'];
  const args: Array<string | number> = [robotId, workspaceId];
  const filter = opts.filter ?? 'active';
  const lastRun = (await db
    .prepare("SELECT id FROM robot_runs WHERE robot_id = ? AND user_id = ? AND status = 'success' ORDER BY finished_at DESC, rowid DESC LIMIT 1")
    .get(robotId, workspaceId)) as { id: string } | undefined;
  if (filter === 'active') where.push("status = 'active'");
  else if (filter === 'removed') where.push("status = 'removed'");
  else if (filter === 'new') {
    where.push("status = 'active' AND first_run_id = ?");
    args.push(lastRun?.id ?? '');
  } else if (filter === 'changed') {
    where.push("status = 'active' AND changed_at IS NOT NULL AND last_run_id = ? AND changed_at = last_seen_at");
    args.push(lastRun?.id ?? '');
  }
  let hidden = 0;
  if (opts.viewer && !opts.viewer.admin) {
    const h = (await db
      .prepare(`SELECT COUNT(*) AS n FROM robot_rows WHERE ${where.join(' AND ')} AND captured_by IS NOT NULL AND captured_by != ?`)
      .get(...args, opts.viewer.personId)) as { n: number };
    hidden = Number(h.n) || 0;
    where.push('(captured_by IS NULL OR captured_by = ?)');
    args.push(opts.viewer.personId);
  }
  const q = (opts.q ?? '').trim().toLowerCase().slice(0, 200);
  if (q) {
    where.push("lower(data) LIKE ? ESCAPE '\\'");
    args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 5000);
  const offset = Math.max(opts.offset ?? 0, 0);
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM robot_rows WHERE ${where.join(' AND ')}`).get(...args)) as { n: number };
  const rows = (await db
    .prepare(`SELECT * FROM robot_rows WHERE ${where.join(' AND ')} ORDER BY first_seen_at DESC, rowid ASC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)) as RobotRowRow[];
  const countRows = (await db
    .prepare('SELECT status, COUNT(*) AS n FROM robot_rows WHERE robot_id = ? AND user_id = ? GROUP BY status')
    .all(robotId, workspaceId)) as Array<{ status: string; n: number }>;
  const counts = { active: 0, removed: 0 };
  for (const c of countRows) if (c.status === 'active' || c.status === 'removed') counts[c.status] = Number(c.n) || 0;
  const columns: string[] = [];
  const dtos = rows.map((r) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    for (const k of Object.keys(data)) if (!columns.includes(k) && columns.length < 30) columns.push(k);
    return {
      id: r.id,
      data,
      status: r.status,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      changedAt: r.changed_at,
      removedAt: r.removed_at,
      isNew: !!lastRun && r.first_run_id === lastRun.id,
    };
  });
  return { rows: dtos, total: Number(total.n) || 0, columns, counts, hidden };
}

/** Todas las filas activas (para sincronizar una hoja). */
export async function activeDatasetRows(workspaceId: string, robotId: string, limit = 5000): Promise<Array<Record<string, unknown>>> {
  const rows = (await getDb()
    .prepare("SELECT data FROM robot_rows WHERE robot_id = ? AND user_id = ? AND status = 'active' ORDER BY first_seen_at, rowid LIMIT ?")
    .all(robotId, workspaceId, limit)) as Array<{ data: string }>;
  return rows.map((r) => {
    try {
      return JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      return {};
    }
  });
}

/** Vacía la tabla (Datos → Vaciar tabla). */
export async function clearDataset(workspaceId: string, robotId: string): Promise<number> {
  const res = await getDb().prepare('DELETE FROM robot_rows WHERE robot_id = ? AND user_id = ?').run(robotId, workspaceId);
  return res.changes;
}
