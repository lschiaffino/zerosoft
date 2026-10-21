/**
 * Flow — tablas de datos del workspace: búsquedas, dedupe y estado entre
 * corridas (el nodo "Tabla de datos" busca, inserta, actualiza o borra
 * filas). Cada fila es un JSON con las columnas tipadas de su tabla; las
 * búsquedas comparan una columna con json_extract. Topes en
 * lib/flow-tables-schema.ts. Server-only.
 */
import { getDb, type FlowTableDataRow, type FlowTableRow } from './db';
import { nowIso, parseJson } from './flow';
import {
  coerceCell,
  coerceRow,
  MAX_ROW_BYTES,
  MAX_TABLE_ROWS,
  MAX_TABLES,
  TableValueError,
  type FlowTableColumn,
} from './flow-tables-schema';

export interface FlowTableDto {
  id: string;
  name: string;
  columns: FlowTableColumn[];
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Fila leída: id, fechas y una clave por columna. */
export type FlowTableRowDto = { id: string; createdAt: string; updatedAt: string } & Record<string, unknown>;

export type TableErrorCode =
  | 'not_found'
  | 'duplicate_name'
  | 'too_many_tables'
  | 'table_full'
  | 'row_too_large'
  | 'invalid_value'
  | 'unknown_column';

export class TableError extends Error {
  constructor(
    public code: TableErrorCode,
    public column?: string,
  ) {
    super(code);
  }
}

function columnsOf(row: Pick<FlowTableRow, 'columns'>): FlowTableColumn[] {
  const cols = parseJson<FlowTableColumn[]>(row.columns, []);
  return Array.isArray(cols) ? cols.filter((c) => c && typeof c.name === 'string') : [];
}

function toRowDto(columns: readonly FlowTableColumn[], row: FlowTableDataRow): FlowTableRowDto {
  const data = parseJson<Record<string, unknown>>(row.data, {});
  const out: FlowTableRowDto = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  for (const c of columns) out[c.name] = data[c.name] ?? null;
  return out;
}

async function tableRow(workspaceId: string, id: string): Promise<FlowTableRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM flow_tables WHERE id = ? AND user_id = ?')
    .get(id, workspaceId)) as FlowTableRow | undefined) ?? null;
}

async function requireTable(workspaceId: string, id: string): Promise<{ row: FlowTableRow; columns: FlowTableColumn[] }> {
  const row = await tableRow(workspaceId, id);
  if (!row) throw new TableError('not_found');
  return { row, columns: columnsOf(row) };
}

async function countRows(tableId: string): Promise<number> {
  const r = (await getDb().prepare('SELECT COUNT(*) AS n FROM flow_table_rows WHERE table_id = ?').get(tableId)) as { n: number };
  return Number(r.n) || 0;
}

export async function listTables(workspaceId: string): Promise<FlowTableDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM flow_table_rows r WHERE r.table_id = t.id) AS row_count
       FROM flow_tables t WHERE t.user_id = ? ORDER BY lower(t.name)`,
    )
    .all(workspaceId)) as Array<FlowTableRow & { row_count: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    columns: columnsOf(r),
    rowCount: Number(r.row_count) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getTable(workspaceId: string, id: string): Promise<FlowTableDto | null> {
  const row = await tableRow(workspaceId, id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    columns: columnsOf(row),
    rowCount: await countRows(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function nameTaken(workspaceId: string, name: string, exceptId?: string): Promise<boolean> {
  const row = await getDb()
    .prepare('SELECT id FROM flow_tables WHERE user_id = ? AND lower(name) = lower(?) AND id != ?')
    .get(workspaceId, name, exceptId ?? '');
  return !!row;
}

export async function createTable(
  workspaceId: string,
  actorId: string | null,
  input: { name: string; columns: FlowTableColumn[] },
): Promise<FlowTableDto> {
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM flow_tables WHERE user_id = ?').get(workspaceId)) as { n: number };
  if (Number(n.n) >= MAX_TABLES) throw new TableError('too_many_tables');
  const name = input.name.trim();
  if (await nameTaken(workspaceId, name)) throw new TableError('duplicate_name');
  const id = crypto.randomUUID();
  const ts = nowIso();
  await db
    .prepare('INSERT INTO flow_tables (id, user_id, name, columns, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, name, JSON.stringify(input.columns), actorId, ts, ts);
  return (await getTable(workspaceId, id))!;
}

/**
 * Renombra la tabla o cambia sus columnas. Una columna quitada deja de
 * leerse y escribirse (el dato viejo queda en la fila hasta que se reescriba).
 */
export async function updateTable(
  workspaceId: string,
  id: string,
  patch: { name?: string; columns?: FlowTableColumn[] },
): Promise<FlowTableDto> {
  const { row } = await requireTable(workspaceId, id);
  const name = patch.name?.trim() || row.name;
  if (name !== row.name && (await nameTaken(workspaceId, name, id))) throw new TableError('duplicate_name');
  await getDb()
    .prepare('UPDATE flow_tables SET name = ?, columns = ?, updated_at = ? WHERE id = ?')
    .run(name, patch.columns ? JSON.stringify(patch.columns) : row.columns, nowIso(), id);
  return (await getTable(workspaceId, id))!;
}

export async function deleteTable(workspaceId: string, id: string): Promise<boolean> {
  const db = getDb();
  if (!(await tableRow(workspaceId, id))) return false;
  await db.prepare('DELETE FROM flow_table_rows WHERE table_id = ?').run(id);
  await db.prepare('DELETE FROM flow_tables WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return true;
}

function serialize(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  if (json.length > MAX_ROW_BYTES) throw new TableError('row_too_large');
  return json;
}

function coerced(columns: readonly FlowTableColumn[], data: Record<string, unknown>, base?: Record<string, unknown>) {
  for (const k of Object.keys(data)) {
    if (!columns.some((c) => c.name === k)) throw new TableError('unknown_column', k);
  }
  try {
    return coerceRow(columns, data, base);
  } catch (err) {
    if (err instanceof TableValueError) throw new TableError('invalid_value', err.column);
    throw err;
  }
}

export async function listTableRows(
  workspaceId: string,
  tableId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: FlowTableRowDto[]; total: number }> {
  const { columns } = await requireTable(workspaceId, tableId);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 500);
  const offset = Math.max(Math.floor(opts.offset ?? 0), 0);
  const rows = (await getDb()
    .prepare('SELECT * FROM flow_table_rows WHERE table_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?')
    .all(tableId, limit, offset)) as FlowTableDataRow[];
  return { rows: rows.map((r) => toRowDto(columns, r)), total: await countRows(tableId) };
}

export async function insertTableRow(workspaceId: string, tableId: string, data: Record<string, unknown>): Promise<FlowTableRowDto> {
  const { columns } = await requireTable(workspaceId, tableId);
  const values = coerced(columns, data);
  const json = serialize(values);
  if ((await countRows(tableId)) >= MAX_TABLE_ROWS) throw new TableError('table_full');
  const id = crypto.randomUUID();
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO flow_table_rows (id, table_id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, tableId, workspaceId, json, ts, ts);
  return { id, createdAt: ts, updatedAt: ts, ...values };
}

/** Cambia las columnas que vienen en `data` (el resto queda igual). */
export async function updateTableRow(
  workspaceId: string,
  tableId: string,
  rowId: string,
  data: Record<string, unknown>,
): Promise<FlowTableRowDto | null> {
  const { columns } = await requireTable(workspaceId, tableId);
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM flow_table_rows WHERE id = ? AND table_id = ?').get(rowId, tableId)) as
    | FlowTableDataRow
    | undefined;
  if (!row) return null;
  const values = coerced(columns, data, parseJson<Record<string, unknown>>(row.data, {}));
  const ts = nowIso();
  await db.prepare('UPDATE flow_table_rows SET data = ?, updated_at = ? WHERE id = ?').run(serialize(values), ts, rowId);
  return { id: rowId, createdAt: row.created_at, updatedAt: ts, ...values };
}

export async function deleteTableRow(workspaceId: string, tableId: string, rowId: string): Promise<boolean> {
  await requireTable(workspaceId, tableId);
  const res = await getDb().prepare('DELETE FROM flow_table_rows WHERE id = ? AND table_id = ?').run(rowId, tableId);
  return res.changes > 0;
}

/** Condición "columna = valor" con el tipo de la columna (json_extract devuelve 1/0 para booleanos). */
function matchClause(columns: readonly FlowTableColumn[], column: string, value: unknown): { sql: string; args: unknown[] } {
  const col = columns.find((c) => c.name === column);
  if (!col) throw new TableError('unknown_column', column);
  let v: string | number | boolean | null;
  try {
    v = coerceCell(col, value);
  } catch {
    throw new TableError('invalid_value', column);
  }
  if (v === null) return { sql: `json_extract(data, '$."${col.name}"') IS NULL`, args: [] };
  return { sql: `json_extract(data, '$."${col.name}"') = ?`, args: [typeof v === 'boolean' ? (v ? 1 : 0) : v] };
}

/** Filas cuya columna es igual al valor (sin columna: las más recientes). */
export async function findTableRows(
  workspaceId: string,
  tableId: string,
  match: { column?: string; value?: unknown },
  limit = 1,
): Promise<FlowTableRowDto[]> {
  const { columns } = await requireTable(workspaceId, tableId);
  const n = Math.min(Math.max(Math.floor(limit) || 1, 1), 100);
  const where = match.column ? matchClause(columns, match.column, match.value) : { sql: '1 = 1', args: [] };
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM flow_table_rows WHERE table_id = ? AND ${where.sql} ORDER BY created_at ASC, rowid ASC LIMIT ?`,
    )
    .all(tableId, ...(where.args as Array<string | number>), n)) as FlowTableDataRow[];
  return rows.map((r) => toRowDto(columns, r));
}

/** Actualiza la primera fila que coincide o, si no hay, inserta una (con la columna de búsqueda incluida). */
export async function upsertTableRow(
  workspaceId: string,
  tableId: string,
  match: { column: string; value: unknown },
  data: Record<string, unknown>,
): Promise<{ created: boolean; row: FlowTableRowDto }> {
  const [found] = await findTableRows(workspaceId, tableId, match, 1);
  if (found) {
    const row = await updateTableRow(workspaceId, tableId, found.id, data);
    if (row) return { created: false, row };
  }
  const row = await insertTableRow(workspaceId, tableId, { [match.column]: match.value, ...data });
  return { created: true, row };
}

/** Borra las filas cuya columna es igual al valor. */
export async function deleteTableRowsWhere(
  workspaceId: string,
  tableId: string,
  match: { column: string; value: unknown },
): Promise<number> {
  const { columns } = await requireTable(workspaceId, tableId);
  const where = matchClause(columns, match.column, match.value);
  const res = await getDb()
    .prepare(`DELETE FROM flow_table_rows WHERE table_id = ? AND ${where.sql}`)
    .run(tableId, ...(where.args as Array<string | number>));
  return res.changes;
}
