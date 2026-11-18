/**
 * Snapshot de filas para papeleras. Server-only.
 *
 * Guarda una fila y todo lo que su borrado se lleva puesto siguiendo las foreign keys declaradas del esquema
 * (se leen de SQLite, no hay que mantener una lista a mano): las hijas que el DELETE borra en cascada y las
 * columnas que pone en NULL (ON DELETE SET NULL). Restaurar re-inserta las filas en el mismo orden (padre
 * primero) con las columnas que la tabla tenga hoy, y vuelve a apuntar las columnas que quedaron en NULL.
 *
 * Lo usan la papelera del CRM (lib/crm-trash.ts) y el borrado suave de las limpiezas por inactividad
 * (lib/soft-delete.ts).
 */
import type { Db } from './db';

export type Row = Record<string, unknown>;

export interface TableRows {
  table: string;
  rows: Row[];
}

/** Columna que el borrado dejó en NULL (o que hay que re-apuntar al restaurar). */
export interface NulledRef {
  table: string;
  key: Row;
  col: string;
  value: unknown;
}

export interface RowSnapshot {
  v: 1;
  /** En orden de inserción: el registro primero, después sus hijas. */
  tables: TableRows[];
  nulls: NulledRef[];
}

export function emptySnapshot(): RowSnapshot {
  return { v: 1, tables: [], nulls: [] };
}

export function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function chunks<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- Esquema (FKs, PKs, columnas) ----------

interface FkEdge {
  child: string;
  from: string;
  to: string;
  onDelete: string;
}

export interface SchemaInfo {
  /** Tabla padre → FKs de otras tablas que la referencian. */
  children: Map<string, FkEdge[]>;
  columns: Map<string, string[]>;
  pks: Map<string, string[]>;
}

let schemaCache: Promise<SchemaInfo> | null = null;

async function loadSchema(db: Db): Promise<SchemaInfo> {
  type FkRow = { child: string; parent: string; from_col: string; to_col: string | null; on_delete: string };
  type ColRow = { tbl: string; col: string; pk: number };
  let fks: FkRow[];
  let cols: ColRow[];
  try {
    fks = (await db
      .prepare(
        `SELECT m.name AS child, p."table" AS parent, p."from" AS from_col, p."to" AS to_col, p.on_delete AS on_delete
         FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) p
         WHERE m.type = 'table'`,
      )
      .all()) as FkRow[];
    cols = (await db
      .prepare(
        `SELECT m.name AS tbl, p.name AS col, p.pk AS pk
         FROM sqlite_master m JOIN pragma_table_info(m.name) p
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`,
      )
      .all()) as ColRow[];
  } catch {
    // Si el servidor no expone las funciones pragma_* como tablas, se arma lo
    // mismo con un PRAGMA por tabla (más consultas, mismo resultado).
    const tables = (await db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all()) as Array<{ name: string }>;
    fks = [];
    cols = [];
    for (const { name } of tables) {
      const fkRows = (await db.prepare(`PRAGMA foreign_key_list(${q(name)})`).all()) as Array<{ table: string; from: string; to: string | null; on_delete: string }>;
      for (const r of fkRows) fks.push({ child: name, parent: r.table, from_col: r.from, to_col: r.to, on_delete: r.on_delete });
      const colRows = (await db.prepare(`PRAGMA table_info(${q(name)})`).all()) as Array<{ name: string; pk: number }>;
      for (const r of colRows) cols.push({ tbl: name, col: r.name, pk: r.pk });
    }
  }
  const children = new Map<string, FkEdge[]>();
  for (const fk of fks) {
    const list = children.get(fk.parent) ?? [];
    list.push({ child: fk.child, from: fk.from_col, to: fk.to_col ?? 'id', onDelete: String(fk.on_delete).toUpperCase() });
    children.set(fk.parent, list);
  }
  const columns = new Map<string, string[]>();
  const pks = new Map<string, Array<{ col: string; pk: number }>>();
  for (const c of cols) {
    columns.set(c.tbl, [...(columns.get(c.tbl) ?? []), c.col]);
    if (Number(c.pk) > 0) pks.set(c.tbl, [...(pks.get(c.tbl) ?? []), { col: c.col, pk: Number(c.pk) }]);
  }
  return {
    children,
    columns,
    pks: new Map([...pks].map(([t, list]) => [t, list.sort((a, b) => a.pk - b.pk).map((x) => x.col)])),
  };
}

/** Esquema cacheado por proceso (las migraciones corren antes de la primera consulta). */
export function schemaInfo(db: Db): Promise<SchemaInfo> {
  if (!schemaCache) {
    const p = loadSchema(db);
    schemaCache = p;
    p.catch(() => {
      if (schemaCache === p) schemaCache = null;
    });
  }
  return schemaCache;
}

// ---------- Serialización (BLOBs → base64) ----------

export function encodeValue(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { $blob: Buffer.from(v).toString('base64') };
  if (ArrayBuffer.isView(v)) return { $blob: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
  if (typeof v === 'bigint') return Number(v);
  return v;
}

export function decodeValue(v: unknown): string | number | null | Uint8Array {
  if (v && typeof v === 'object' && '$blob' in v) return new Uint8Array(Buffer.from(String((v as { $blob: string }).$blob), 'base64'));
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
}

export function encodeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, encodeValue(v)]));
}

// ---------- Snapshot ----------

/**
 * Suma al snapshot las filas de `table` con `col` en `values` y, por sus FKs, las hijas en cascada (hasta 6
 * niveles) y las columnas que el borrado pondría en NULL.
 */
export async function collectRows(db: Db, info: SchemaInfo, snap: RowSnapshot, table: string, col: string, values: unknown[], depth = 0): Promise<void> {
  const vals = [...new Set(values.filter((v) => v !== null && v !== undefined))] as Array<string | number>;
  if (!vals.length || depth > 6) return;
  const rows: Row[] = [];
  for (const part of chunks(vals)) {
    rows.push(
      ...((await db
        .prepare(`SELECT * FROM ${q(table)} WHERE ${q(col)} IN (${part.map(() => '?').join(',')})`)
        .all(...part)) as Row[]),
    );
  }
  if (!rows.length) return;
  snap.tables.push({ table, rows: rows.map(encodeRow) });
  for (const edge of info.children.get(table) ?? []) {
    const keys = rows.map((r) => r[edge.to]);
    if (edge.onDelete === 'CASCADE') {
      await collectRows(db, info, snap, edge.child, edge.from, keys, depth + 1);
    } else if (edge.onDelete === 'SET NULL') {
      const pk = info.pks.get(edge.child);
      if (!pk?.length) continue;
      const keyVals = [...new Set(keys.filter((v) => v !== null && v !== undefined))] as Array<string | number>;
      for (const part of chunks(keyVals)) {
        const hits = (await db
          .prepare(
            `SELECT ${[...pk, edge.from].map(q).join(', ')} FROM ${q(edge.child)}
             WHERE ${q(edge.from)} IN (${part.map(() => '?').join(',')})`,
          )
          .all(...part)) as Row[];
        for (const h of hits) {
          snap.nulls.push({
            table: edge.child,
            key: Object.fromEntries(pk.map((k) => [k, encodeValue(h[k])])),
            col: edge.from,
            value: encodeValue(h[edge.from]),
          });
        }
      }
    }
  }
}

// ---------- Restaurar ----------

/**
 * Re-inserta una fila con las columnas que la tabla tiene hoy. `orIgnore` (por defecto) no pisa una fila que ya
 * esté; sin él, un choque tira. Una FK a algo que ya no existe devuelve false.
 */
export async function insertSnapshotRow(db: Db, info: SchemaInfo, table: string, row: Row, opts: { orIgnore?: boolean } = {}): Promise<boolean> {
  const current = new Set(info.columns.get(table) ?? []);
  const cols = Object.keys(row).filter((c) => current.has(c));
  if (!cols.length) return false;
  const res = await db
    .prepare(`INSERT${opts.orIgnore === false ? '' : ' OR IGNORE'} INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => decodeValue(row[c]) as string | number | null));
  return res.changes > 0;
}

/** Vuelve a apuntar las columnas que el borrado dejó en NULL (si siguen en NULL y la fila existe). */
export async function restoreNulls(db: Db, nulls: NulledRef[]): Promise<void> {
  for (const n of nulls) {
    const keys = Object.keys(n.key);
    try {
      await db
        .prepare(`UPDATE ${q(n.table)} SET ${q(n.col)} = ? WHERE ${keys.map((k) => `${q(k)} = ?`).join(' AND ')} AND ${q(n.col)} IS NULL`)
        .run(decodeValue(n.value) as string | number | null, ...keys.map((k) => decodeValue(n.key[k]) as string | number | null));
    } catch {
      // La fila referenciada ya no existe: nada que re-apuntar.
    }
  }
}
