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
import { privateChatMarker } from './crm-chat-privacy';
import { emailFreeSql, findContactByEmail } from './crm-contact-email';
import type { CrmContactRow } from './db';
import { deleteUploads } from './uploads';
import {
  chunks,
  collectRows as collect,
  encodeRow,
  insertSnapshotRow,
  restoreNulls,
  schemaInfo as schema,
  type Row,
  type RowSnapshot,
  type SchemaInfo,
} from './row-snapshot';

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

export type TrashSnapshot = RowSnapshot;

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
  // contact/company/deal.deleted para webhooks y apps (las actividades no tienen evento propio).
  if (entity !== 'activity') {
    const { emitCrmHookSoon } = await import('./crm-hooks');
    for (const row of present) {
      await emitCrmHookSoon(userId, `${entity}.deleted`, {
        id: String(row.id),
        label: labelOf(entity, row),
        deletedBy: actorEmail || null,
        mergedInto: opts.mergedInto ?? null,
      });
    }
  }
  return changes;
}

// ---------- Restaurar ----------

/** Tablas de asociación con una única primaria por registro (índice único parcial). */
const PRIMARY_ASSOC: Record<string, true> = { crm_contact_companies: true, crm_deal_companies: true };

async function insertRow(db: Db, info: SchemaInfo, table: string, row: Row): Promise<boolean> {
  try {
    if (await insertSnapshotRow(db, info, table, row)) return true;
    // Si mientras tanto otra empresa pasó a primaria, la restaurada vuelve como secundaria.
    if (PRIMARY_ASSOC[table] && Number(row.is_primary) === 1) return insertSnapshotRow(db, info, table, { ...row, is_primary: 0 });
    return false;
  } catch {
    // FK a algo que ya no existe (p. ej. un deal borrado definitivamente): se omite.
    return false;
  }
}

export type RestoreResult =
  | { ok: true; entity: TrashEntity; recordId: string }
  | { ok: false; reason: 'not_found' | 'conflict' }
  /** El email del contacto en la papelera ya es de un contacto vivo (lib/crm-contact-email.ts). */
  | { ok: false; reason: 'email_taken'; existing: CrmContactRow };

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
  const snap = JSON.parse(entry.snapshot) as TrashSnapshot;
  // El email es la identidad del contacto: si mientras estuvo en la papelera
  // otro contacto tomó su email, no se restaura (quedarían dos con el mismo).
  // La entrada sigue en la papelera hasta que el email se libere.
  for (const { table: t, rows } of snap.tables) {
    if (t !== 'crm_contacts') continue;
    for (const row of rows) {
      const taken = await findContactByEmail(userId, typeof row.email === 'string' ? row.email : '', db, String(row.id));
      if (taken) return { ok: false, reason: 'email_taken', existing: taken };
    }
  }
  // Se reclama la entrada antes de re-insertar: dos restores a la vez no duplican.
  const claimed = await db.prepare('DELETE FROM crm_trash WHERE id = ? AND user_id = ?').run(trashId, userId);
  if (!claimed.changes) return { ok: false, reason: 'not_found' };

  const info = await schema(db);
  const contacts = new Set<string>();
  const deals = new Set<string>();
  const dated: Record<ActivityDateTable, Set<string>> = {
    crm_contacts: new Set(),
    crm_companies: new Set(),
    crm_deals: new Set(),
  };
  let restored = 0;
  for (const { table: t, rows } of snap.tables) {
    for (const row of rows) {
      const email = t === 'crm_contacts' && typeof row.email === 'string' ? row.email.trim() : '';
      if (email) {
        // El contacto vuelve solo si su email sigue libre: el chequeo va en la
        // misma sentencia que el INSERT (el de arriba pudo quedar viejo).
        const free = emailFreeSql(userId, email, [String(row.id)]);
        const ok = await insertSnapshotRow(db, info, t, row, { onlyIf: free }).catch(() => false);
        if (!ok) {
          const taken = restored === 0 ? await findContactByEmail(userId, email, db, String(row.id)) : null;
          if (taken) {
            // Nada se restauró todavía: la entrada vuelve a la papelera tal cual estaba.
            await db
              .prepare(
                `INSERT OR IGNORE INTO crm_trash (id, user_id, entity, record_id, label, owner_id, deleted_by, deleted_at, snapshot, merged_into)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(entry.id, entry.user_id, entry.entity, entry.record_id, entry.label, entry.owner_id, entry.deleted_by, entry.deleted_at, entry.snapshot, entry.merged_into);
            return { ok: false, reason: 'email_taken', existing: taken };
          }
          continue;
        }
      } else if (!(await insertRow(db, info, t, row))) continue;
      restored++;
      if (t === 'crm_contacts') contacts.add(String(row.id));
      if (t === 'crm_deals') deals.add(String(row.id));
      if (t === 'crm_contact_companies') contacts.add(String(row.contact_id));
      if (t === 'crm_deal_companies') deals.add(String(row.deal_id));
      if (t === 'crm_contacts' || t === 'crm_companies' || t === 'crm_deals') dated[t].add(String(row.id));
    }
  }
  await restoreNulls(db, snap.nulls);
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
  // Una tarea de un chat de Lines: la papelera la ven personas que no ven el chat, así que lleva el
  // marcador y no su título, y no se encuentra por ese texto (lib/crm-chat-privacy.ts).
  const label = `CASE WHEN t.entity = 'activity' AND EXISTS (SELECT 1 FROM groups_tasks zgt WHERE zgt.activity_id = t.record_id) THEN '${privateChatMarker('en').replace(/'/g, "''")}' ELSE t.label END`;
  if (f.q) {
    where.push(`${label} LIKE ? ESCAPE '\\'`);
    args.push(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const cond = ownerScopeSql('t', f.ownerScope);
  if (cond.sql) {
    where.push(cond.sql);
    args.push(...cond.args);
  }
  return (await db
    .prepare(
      `SELECT t.id, t.user_id, t.entity, t.record_id, ${label} AS label, t.owner_id, t.deleted_by, t.deleted_at, t.merged_into,
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
