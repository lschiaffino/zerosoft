/**
 * CRM — papelera. Server-only.
 *
 * Borrar un contacto, empresa, deal o actividad guarda antes un snapshot del
 * registro y de todo lo que su borrado se lleva puesto, y recién después borra
 * la fila. Así ninguna query existente (listas, búsqueda, reportes,
 * dashboards, API) tiene que filtrar borrados: el registro simplemente no está.
 * Restaurar re-inserta el snapshot; pasados TRASH_RETENTION_DAYS días el cron
 * horario (app/api/cron/tick) descarta el snapshot para siempre.
 *
 * Qué entra en el snapshot:
 * - la fila del registro;
 * - las filas hijas que el DELETE borra en cascada, siguiendo las foreign keys
 *   del esquema (se leen de SQLite, no hay que mantener una lista a mano), y
 *   las columnas que el DELETE pone en NULL (ON DELETE SET NULL);
 * - los tags del registro (los borra un trigger, no una FK);
 * - las actividades propias: las que solo apuntan a registros que se borran
 *   en la misma operación (las que además apuntan a otro registro vivo se
 *   quedan con él);
 * - en empresas, las hijas que pierden su empresa madre;
 * - los adjuntos (crm_task_files, crm_record_files) entran por sus FKs: el
 *   archivo se conserva hasta que la entrada se purga, y ahí se borra.
 */
import { getDb, type Db } from './db';
import { syncContactPrimary, syncDealPrimary } from './crm-assoc';
import { activityDatesUpdateSql, type ActivityDateTable } from './crm-activity-dates';
import { ownerScopeSql, type OwnerScope } from './crm-visibility';
import { deleteUploads } from './uploads';

export const TRASH_RETENTION_DAYS = 90;

export const TRASH_ENTITIES = ['contact', 'company', 'deal', 'activity'] as const;
export type TrashEntity = (typeof TRASH_ENTITIES)[number];

const ENTITY_TABLE: Record<TrashEntity, string> = {
  contact: 'crm_contacts',
  company: 'crm_companies',
  deal: 'crm_deals',
  activity: 'crm_activities',
};

const ACTIVITY_REF: Record<Exclude<TrashEntity, 'activity'>, string> = {
  contact: 'contact_id',
  company: 'company_id',
  deal: 'deal_id',
};

type Row = Record<string, unknown>;

interface TableRows {
  table: string;
  rows: Row[];
}

/** Columna que el borrado dejó en NULL (o que hay que re-apuntar al restaurar). */
interface NulledRef {
  table: string;
  key: Row;
  col: string;
  value: unknown;
}

export interface TrashSnapshot {
  v: 1;
  /** En orden de inserción: el registro primero, después sus hijas. */
  tables: TableRows[];
  nulls: NulledRef[];
}

export interface TrashRow {
  id: string;
  user_id: string;
  entity: TrashEntity;
  record_id: string;
  label: string;
  owner_id: string | null;
  deleted_by: string;
  deleted_at: string;
  /** Empresa en la que se fusionó (merge de duplicados); null = borrado común. */
  merged_into: string | null;
}

export type TrashListRow = TrashRow & { owner_name: string | null; expires_at: string; merged_into_name: string | null };

export interface TrashOptions {
  /** Merge: el registro se fusionó en este otro (se muestra en la papelera). */
  mergedInto?: string;
  /**
   * Solo guarda el snapshot, sin borrar (el merge mueve las hijas al que
   * queda y borra la fila él mismo, dentro de su transacción).
   */
  snapshotOnly?: boolean;
}

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function chunks<T>(items: T[], size = 400): T[][] {
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

interface SchemaInfo {
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
      const quoted = `"${name.replace(/"/g, '""')}"`;
      const fkRows = (await db.prepare(`PRAGMA foreign_key_list(${quoted})`).all()) as Array<{ table: string; from: string; to: string | null; on_delete: string }>;
      for (const r of fkRows) fks.push({ child: name, parent: r.table, from_col: r.from, to_col: r.to, on_delete: r.on_delete });
      const colRows = (await db.prepare(`PRAGMA table_info(${quoted})`).all()) as Array<{ name: string; pk: number }>;
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

function schema(db: Db): Promise<SchemaInfo> {
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

function encodeValue(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { $blob: Buffer.from(v).toString('base64') };
  if (ArrayBuffer.isView(v)) return { $blob: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
  if (typeof v === 'bigint') return Number(v);
  return v;
}

function decodeValue(v: unknown): string | number | null | Uint8Array {
  if (v && typeof v === 'object' && '$blob' in v) return new Uint8Array(Buffer.from(String((v as { $blob: string }).$blob), 'base64'));
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
}

function encodeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, encodeValue(v)]));
}

// ---------- Snapshot ----------

async function collect(
  db: Db,
  info: SchemaInfo,
  snap: TrashSnapshot,
  table: string,
  col: string,
  values: unknown[],
  depth: number,
): Promise<void> {
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
      await collect(db, info, snap, edge.child, edge.from, keys, depth + 1);
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

/** Actividades que solo apuntan a registros de `deleting` (se van con ellos). */
async function ownActivityIds(
  db: Db,
  userId: string,
  deleting: Partial<Record<'contact_id' | 'company_id' | 'deal_id', string[]>>,
): Promise<string[]> {
  const refCols = ['contact_id', 'company_id', 'deal_id'] as const;
  const any: string[] = [];
  const each: string[] = [];
  const anyArgs: string[] = [];
  const eachArgs: string[] = [];
  for (const c of refCols) {
    const ids = deleting[c] ?? [];
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      any.push(`${c} IN (${ph})`);
      anyArgs.push(...ids);
      each.push(`(${c} IS NULL OR ${c} IN (${ph}))`);
      eachArgs.push(...ids);
    } else {
      each.push(`${c} IS NULL`);
    }
  }
  if (!any.length) return [];
  const rows = (await db
    .prepare(`SELECT id FROM crm_activities WHERE user_id = ? AND (${any.join(' OR ')}) AND ${each.join(' AND ')}`)
    .all(userId, ...anyArgs, ...eachArgs)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function labelOf(entity: TrashEntity, row: Row): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  if (entity === 'contact') return `${s(row.first_name)} ${s(row.last_name)}`.trim() || s(row.email);
  if (entity === 'activity') return s(row.subject) || s(row.type);
  return s(row.name);
}

/** Owner que decide quién ve la entrada en la papelera. */
async function trashOwner(db: Db, entity: TrashEntity, row: Row): Promise<string | null> {
  if (entity !== 'activity') return (row.owner_id as string | null) ?? null;
  for (const [col, table] of [
    ['contact_id', 'crm_contacts'],
    ['deal_id', 'crm_deals'],
    ['company_id', 'crm_companies'],
  ] as const) {
    if (!row[col]) continue;
    const ref = (await db.prepare(`SELECT owner_id, user_id FROM ${table} WHERE id = ?`).get(row[col] as string)) as
      | { owner_id: string | null; user_id: string }
      | undefined;
    if (ref) return ref.owner_id ?? ref.user_id;
  }
  return (row.owner_id as string | null) ?? null;
}

/**
 * Guarda en la papelera los registros `ids` (del workspace) y los borra junto
 * con sus actividades propias. Devuelve cuántos registros borró. Para empresas
 * el caller sigue corriendo afterCompanyDelete (re-elige primarias).
 */
export async function trashRecords(
  userId: string,
  entity: TrashEntity,
  ids: string[],
  actorEmail = '',
  db: Db = getDb(),
  opts: TrashOptions = {},
): Promise<number> {
  if (!ids.length) return 0;
  const table = ENTITY_TABLE[entity];
  const info = await schema(db);
  const present: Row[] = [];
  for (const part of chunks(ids)) {
    present.push(
      ...((await db
        .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND id IN (${part.map(() => '?').join(',')})`)
        .all(userId, ...part)) as Row[]),
    );
  }
  if (!present.length) return 0;
  const presentIds = present.map((r) => String(r.id));
  const ownActs = entity === 'activity' ? [] : await ownActivityIds(db, userId, { [ACTIVITY_REF[entity]]: presentIds });
  const ts = nowDb();

  for (const row of present) {
    const id = String(row.id);
    const snap: TrashSnapshot = { v: 1, tables: [], nulls: [] };
    await collect(db, info, snap, table, 'id', [id], 0);
    if (entity !== 'activity') {
      const tags = (await db
        .prepare('SELECT * FROM crm_record_tags WHERE user_id = ? AND entity = ? AND record_id = ?')
        .all(userId, entity, id)) as Row[];
      if (tags.length) snap.tables.push({ table: 'crm_record_tags', rows: tags.map(encodeRow) });
      // Actividades propias de este registro (las de la operación que lo nombran).
      const mine = ownActs.length
        ? ((await db
            .prepare(
              `SELECT id FROM crm_activities WHERE ${ACTIVITY_REF[entity]} = ? AND id IN (${ownActs.map(() => '?').join(',')})`,
            )
            .all(id, ...ownActs)) as Array<{ id: string }>)
        : [];
      await collect(db, info, snap, 'crm_activities', 'id', mine.map((r) => r.id), 0);
    }
    if (entity === 'company') {
      const kids = (await db
        .prepare('SELECT id FROM crm_companies WHERE user_id = ? AND parent_company_id = ?')
        .all(userId, id)) as Array<{ id: string }>;
      for (const k of kids) snap.nulls.push({ table: 'crm_companies', key: { id: k.id }, col: 'parent_company_id', value: id });
    }
    await db
      .prepare(
        `INSERT INTO crm_trash (id, user_id, entity, record_id, label, owner_id, deleted_by, deleted_at, snapshot, merged_into)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        userId,
        entity,
        id,
        labelOf(entity, row).slice(0, 300),
        await trashOwner(db, entity, row),
        actorEmail,
        ts,
        JSON.stringify(snap),
        opts.mergedInto ?? null,
      );
  }
  if (opts.snapshotOnly) return present.length;

  let changes = 0;
  for (const part of chunks(presentIds)) {
    changes += (
      await db
        .prepare(`DELETE FROM ${table} WHERE user_id = ? AND id IN (${part.map(() => '?').join(',')})`)
        .run(userId, ...part)
    ).changes;
  }
  for (const part of chunks(ownActs)) {
    await db
      .prepare(`DELETE FROM crm_activities WHERE user_id = ? AND id IN (${part.map(() => '?').join(',')})`)
      .run(userId, ...part);
  }
  return changes;
}

// ---------- Restaurar ----------

/** Tablas de asociación con una única primaria por registro (índice único parcial). */
const PRIMARY_ASSOC: Record<string, true> = { crm_contact_companies: true, crm_deal_companies: true };

async function insertRow(db: Db, info: SchemaInfo, table: string, row: Row): Promise<boolean> {
  const current = new Set(info.columns.get(table) ?? []);
  const cols = Object.keys(row).filter((c) => current.has(c));
  if (!cols.length) return false;
  const run = (r: Row) =>
    db
      .prepare(`INSERT OR IGNORE INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => decodeValue(r[c]) as string | number | null));
  try {
    const res = await run(row);
    // Si mientras tanto otra empresa pasó a primaria, la restaurada vuelve como secundaria.
    if (!res.changes && PRIMARY_ASSOC[table] && Number(row.is_primary) === 1) {
      return (await run({ ...row, is_primary: 0 })).changes > 0;
    }
    return res.changes > 0;
  } catch {
    // FK a algo que ya no existe (p. ej. un deal borrado definitivamente): se omite.
    return false;
  }
}

export type RestoreResult =
  | { ok: true; entity: TrashEntity; recordId: string }
  | { ok: false; reason: 'not_found' | 'conflict' };

async function getTrashRow(userId: string, id: string, scope: OwnerScope | undefined, db: Db) {
  const cond = ownerScopeSql('t', scope);
  return (await db
    .prepare(`SELECT t.* FROM crm_trash t WHERE t.id = ? AND t.user_id = ?${cond.sql ? ` AND ${cond.sql}` : ''}`)
    .get(id, userId, ...cond.args)) as (TrashRow & { snapshot: string }) | undefined;
}

/** Restaura una entrada de la papelera (registro, hijas y actividades propias). */
export async function restoreTrash(
  userId: string,
  trashId: string,
  scope?: OwnerScope,
  db: Db = getDb(),
): Promise<RestoreResult> {
  const entry = await getTrashRow(userId, trashId, scope, db);
  if (!entry) return { ok: false, reason: 'not_found' };
  const table = ENTITY_TABLE[entry.entity];
  if (await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(entry.record_id)) {
    return { ok: false, reason: 'conflict' };
  }
  // Se reclama la entrada antes de re-insertar: dos restores a la vez no duplican.
  const claimed = await db.prepare('DELETE FROM crm_trash WHERE id = ? AND user_id = ?').run(trashId, userId);
  if (!claimed.changes) return { ok: false, reason: 'not_found' };

  const snap = JSON.parse(entry.snapshot) as TrashSnapshot;
  const info = await schema(db);
  const contacts = new Set<string>();
  const deals = new Set<string>();
  const dated: Record<ActivityDateTable, Set<string>> = {
    crm_contacts: new Set(),
    crm_companies: new Set(),
    crm_deals: new Set(),
  };
  for (const { table: t, rows } of snap.tables) {
    for (const row of rows) {
      if (!(await insertRow(db, info, t, row))) continue;
      if (t === 'crm_contacts') contacts.add(String(row.id));
      if (t === 'crm_deals') deals.add(String(row.id));
      if (t === 'crm_contact_companies') contacts.add(String(row.contact_id));
      if (t === 'crm_deal_companies') deals.add(String(row.deal_id));
      if (t === 'crm_contacts' || t === 'crm_companies' || t === 'crm_deals') dated[t].add(String(row.id));
    }
  }
  for (const n of snap.nulls) {
    const keys = Object.keys(n.key);
    try {
      await db
        .prepare(`UPDATE ${q(n.table)} SET ${q(n.col)} = ? WHERE ${keys.map((k) => `${q(k)} = ?`).join(' AND ')} AND ${q(n.col)} IS NULL`)
        .run(decodeValue(n.value) as string | number | null, ...keys.map((k) => decodeValue(n.key[k]) as string | number | null));
    } catch {
      // La fila referenciada ya no existe: nada que re-apuntar.
    }
  }
  for (const id of contacts) await syncContactPrimary(id, db);
  for (const id of deals) await syncDealPrimary(id, db);
  if (entry.entity === 'company') {
    // Si la empresa madre ya no existe, la restaurada queda como raíz.
    await db
      .prepare(
        `UPDATE crm_companies SET parent_company_id = NULL WHERE id = ? AND parent_company_id IS NOT NULL
           AND parent_company_id NOT IN (SELECT id FROM crm_companies WHERE user_id = ?)`,
      )
      .run(entry.record_id, userId);
  }
  // Las fechas de actividad guardadas pueden haber quedado viejas.
  for (const [t, ids] of Object.entries(dated) as Array<[ActivityDateTable, Set<string>]>) {
    for (const part of chunks([...ids])) {
      await db.prepare(activityDatesUpdateSql(t, `id IN (${part.map(() => '?').join(',')})`)).run(...part);
    }
  }
  return { ok: true, entity: entry.entity, recordId: entry.record_id };
}

// ---------- Listar / purgar ----------

export interface TrashFilter {
  entity?: TrashEntity;
  q?: string;
  ownerScope?: OwnerScope;
  limit?: number;
}

export async function listTrash(userId: string, f: TrashFilter = {}, db: Db = getDb()): Promise<TrashListRow[]> {
  const where = ['t.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.entity) {
    where.push('t.entity = ?');
    args.push(f.entity);
  }
  if (f.q) {
    where.push(`t.label LIKE ? ESCAPE '\\'`);
    args.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const cond = ownerScopeSql('t', f.ownerScope);
  if (cond.sql) {
    where.push(cond.sql);
    args.push(...cond.args);
  }
  return (await db
    .prepare(
      `SELECT t.id, t.user_id, t.entity, t.record_id, t.label, t.owner_id, t.deleted_by, t.deleted_at, t.merged_into,
         u.name AS owner_name,
         (SELECT mc.name FROM crm_companies mc WHERE mc.id = t.merged_into AND mc.user_id = t.user_id) AS merged_into_name,
         datetime(t.deleted_at, '+${TRASH_RETENTION_DAYS} days') AS expires_at
       FROM crm_trash t LEFT JOIN users u ON u.id = t.owner_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.deleted_at DESC, t.id
       LIMIT ?`,
    )
    .all(...args, Math.min(Math.max(f.limit ?? 200, 1), 500))) as TrashListRow[];
}

/** Tablas de adjuntos: sus archivos viven en el almacenamiento mientras la entrada siga en la papelera. */
const FILE_TABLES = new Set(['crm_task_files', 'crm_record_files']);

/** URLs de los adjuntos guardados en un snapshot (para borrar los archivos al purgar). */
export function snapshotFileUrls(snapshot: string): string[] {
  try {
    const snap = JSON.parse(snapshot) as TrashSnapshot;
    return snap.tables
      .filter((t) => FILE_TABLES.has(t.table))
      .flatMap((t) => t.rows.map((r) => r.url))
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  } catch {
    return [];
  }
}

/** Borra las entradas que cumplen `where` y después los archivos de sus adjuntos. */
async function purgeWhere(db: Db, where: string, args: Array<string | number>): Promise<number> {
  const rows = (await db.prepare(`SELECT id, snapshot FROM crm_trash WHERE ${where}`).all(...args)) as Array<{
    id: string;
    snapshot: string;
  }>;
  if (!rows.length) return 0;
  let n = 0;
  for (const part of chunks(rows.map((r) => r.id))) {
    n += (await db.prepare(`DELETE FROM crm_trash WHERE id IN (${part.map(() => '?').join(',')})`).run(...part)).changes;
  }
  const urls = rows.flatMap((r) => snapshotFileUrls(r.snapshot));
  if (urls.length) await deleteUploads(urls);
  return n;
}

/** Borra definitivamente entradas de la papelera (solo admins; lo decide la ruta). */
export async function purgeTrash(userId: string, ids: string[] | 'all', db: Db = getDb()): Promise<number> {
  if (ids === 'all') return purgeWhere(db, 'user_id = ?', [userId]);
  let n = 0;
  for (const part of chunks(ids)) {
    n += await purgeWhere(db, `user_id = ? AND id IN (${part.map(() => '?').join(',')})`, [userId, ...part]);
  }
  return n;
}

/** Cron: descarta lo que lleva más de TRASH_RETENTION_DAYS días en la papelera. */
export async function purgeExpiredTrash(now: Date = new Date(), db: Db = getDb()): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  return purgeWhere(db, 'deleted_at < ?', [cutoff]);
}

/** Días que le quedan a una entrada antes de la purga (0 = se purga en el próximo tick). */
export function trashDaysLeft(deletedAt: string, now: Date = new Date()): number {
  const deleted = new Date(`${deletedAt.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(deleted)) return 0;
  const left = deleted + TRASH_RETENTION_DAYS * 86_400_000 - now.getTime();
  return Math.max(0, Math.ceil(left / 86_400_000));
}
