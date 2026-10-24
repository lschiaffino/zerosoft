/**
 * CRM — objetos propios (custom objects, como en HubSpot). Server-only.
 *
 * El admin define un objeto (nombre singular y plural, label de la propiedad
 * primaria) y sus propiedades son custom fields de entidad `obj:<id>` (mismos
 * tipos que los campos propios de contactos). Cada registro tiene nombre
 * (la propiedad primaria), owner y `custom`; se asocia a contactos, empresas
 * y deals (crm_object_links) y tiene notas y tareas en su timeline
 * (crm_activities.object_record_id).
 */
import { getDb, type CrmContactRow, type CrmCustomFieldRow, type CrmObjectRecordRow, type CrmObjectRow, type Db } from './db';
import { appendAdvancedFilters, parseCustom, type AdvancedFieldDef, type FilterFieldType, type FilterRule } from './crm';
import { assertRefs, CrmRefError } from './crm-refs';
import { ownerScopeSql, type OwnerScope } from './crm-visibility';
import { deleteFieldPermissions } from './crm-field-perms';
import { coerceCustomFieldValue } from './crm-custom-fields';

export const OBJECT_LINK_ENTITIES = ['contact', 'company', 'deal'] as const;
export type ObjectLinkEntity = (typeof OBJECT_LINK_ENTITIES)[number];

/** Tope de objetos por workspace (HubSpot Enterprise permite 10). */
export const MAX_OBJECTS = 20;

/** Entidad de custom fields de un objeto. */
export function objectEntity(objectId: string): string {
  return `obj:${objectId}`;
}

export function isObjectEntity(entity: string): boolean {
  return /^obj:[A-Za-z0-9-]{1,64}$/.test(entity);
}

/** Slug para la URL a partir del plural ("Vehículos" → "vehiculos"). Puro. */
export function objectSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'object';
}

/** Slugs que chocan con rutas del CRM. */
const RESERVED = new Set(['new', 'settings']);

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// ---------- Definición ----------

export async function listObjects(workspaceId: string, db: Db = getDb()): Promise<CrmObjectRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_objects WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(workspaceId)) as CrmObjectRow[];
}

export async function getObject(workspaceId: string, id: string, db: Db = getDb()): Promise<CrmObjectRow | null> {
  return ((await db.prepare('SELECT * FROM crm_objects WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmObjectRow
    | undefined) ?? null;
}

export async function getObjectBySlug(workspaceId: string, slug: string, db: Db = getDb()): Promise<CrmObjectRow | null> {
  return ((await db.prepare('SELECT * FROM crm_objects WHERE slug = ? AND user_id = ?').get(slug, workspaceId)) as
    | CrmObjectRow
    | undefined) ?? null;
}

export interface ObjectInput {
  singular?: string;
  plural?: string;
  primaryLabel?: string;
  description?: string;
}

async function freeSlug(workspaceId: string, base: string, db: Db, exceptId?: string): Promise<string> {
  let slug = RESERVED.has(base) ? `${base}-1` : base;
  for (let i = 2; i < 100; i++) {
    const taken = (await db
      .prepare('SELECT id FROM crm_objects WHERE user_id = ? AND slug = ?')
      .get(workspaceId, slug)) as { id: string } | undefined;
    if (!taken || taken.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export type CreateObjectResult = { ok: true; object: CrmObjectRow } | { ok: false; reason: 'limit' };

export async function createObject(
  workspaceId: string,
  data: Required<Pick<ObjectInput, 'singular' | 'plural'>> & ObjectInput,
  db: Db = getDb(),
): Promise<CreateObjectResult> {
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM crm_objects WHERE user_id = ?').get(workspaceId)) as { n: number };
  if (count.n >= MAX_OBJECTS) return { ok: false, reason: 'limit' };
  const id = crypto.randomUUID();
  const slug = await freeSlug(workspaceId, objectSlug(data.plural), db);
  await db
    .prepare(
      `INSERT INTO crm_objects (id, user_id, slug, singular, plural, primary_label, description, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, slug, data.singular, data.plural, data.primaryLabel ?? '', data.description ?? '', count.n);
  return { ok: true, object: (await getObject(workspaceId, id, db))! };
}

export async function updateObject(
  workspaceId: string,
  id: string,
  data: ObjectInput,
  db: Db = getDb(),
): Promise<CrmObjectRow | null> {
  const existing = await getObject(workspaceId, id, db);
  if (!existing) return null;
  const sets: Array<[string, string]> = [];
  if (data.singular !== undefined) sets.push(['singular', data.singular]);
  if (data.plural !== undefined) sets.push(['plural', data.plural]);
  if (data.primaryLabel !== undefined) sets.push(['primary_label', data.primaryLabel]);
  if (data.description !== undefined) sets.push(['description', data.description]);
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_objects SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), now(), id);
  }
  return getObject(workspaceId, id, db);
}

/** Borra el objeto con sus registros, propiedades, reglas y actividades. */
export async function deleteObject(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const existing = await getObject(workspaceId, id, db);
  if (!existing) return false;
  const fields = (await db
    .prepare('SELECT id FROM crm_custom_fields WHERE user_id = ? AND entity = ?')
    .all(workspaceId, objectEntity(id))) as Array<{ id: string }>;
  await deleteFieldPermissions(workspaceId, fields.map((f) => f.id), db);
  await db.prepare('DELETE FROM crm_custom_fields WHERE user_id = ? AND entity = ?').run(workspaceId, objectEntity(id));
  await db
    .prepare(
      `DELETE FROM crm_activities WHERE user_id = ? AND object_record_id IN
         (SELECT id FROM crm_object_records WHERE object_id = ? AND user_id = ?)`,
    )
    .run(workspaceId, id, workspaceId);
  await db.prepare('DELETE FROM crm_objects WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return true;
}

// ---------- Registros ----------

export interface RecordFilter {
  q?: string;
  owner?: string;
  filters?: FilterRule[];
  customTypes?: Record<string, FilterFieldType>;
  ownerScope?: OwnerScope;
  sort?: 'newest' | 'oldest' | 'name' | 'name_desc';
  page?: number;
  pageSize?: number;
}

export type RecordListRow = CrmObjectRecordRow & { owner_name: string | null };

const RECORD_FIELDS: Record<string, AdvancedFieldDef> = {
  name: { expr: 'r.name', type: 'text' },
  owner: { expr: 'r.owner_id', type: 'select' },
  created: { expr: 'r.created_at', type: 'date' },
};

const RECORD_ORDER: Record<NonNullable<RecordFilter['sort']>, string> = {
  newest: 'r.created_at DESC, r.id',
  oldest: 'r.created_at ASC, r.id',
  name: 'r.name COLLATE NOCASE ASC, r.id',
  name_desc: 'r.name COLLATE NOCASE DESC, r.id',
};

export async function listRecords(
  workspaceId: string,
  objectId: string,
  f: RecordFilter = {},
  db: Db = getDb(),
): Promise<{ rows: RecordListRow[]; total: number }> {
  const where: string[] = ['r.user_id = ?', 'r.object_id = ?'];
  const args: Array<string | number> = [workspaceId, objectId];
  if (f.q) {
    where.push(`r.name LIKE ? ESCAPE '\\'`);
    args.push(`%${escapeLike(f.q)}%`);
  }
  if (f.owner) {
    where.push('r.owner_id = ?');
    args.push(f.owner);
  }
  appendAdvancedFilters(where, args, 'r', RECORD_FIELDS, f.filters, f.customTypes);
  const scope = ownerScopeSql('r', f.ownerScope);
  if (scope.sql) {
    where.push(scope.sql);
    args.push(...scope.args);
  }
  const w = where.join(' AND ');
  const total = ((await db.prepare(`SELECT COUNT(*) AS n FROM crm_object_records r WHERE ${w}`).get(...args)) as { n: number }).n;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const rows = (await db
    .prepare(
      `SELECT r.*, u.name AS owner_name FROM crm_object_records r
       LEFT JOIN users u ON u.id = r.owner_id
       WHERE ${w} ORDER BY ${RECORD_ORDER[f.sort ?? 'newest'] ?? RECORD_ORDER.newest} LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as RecordListRow[];
  return { rows, total };
}

export async function getRecord(workspaceId: string, id: string, db: Db = getDb()): Promise<CrmObjectRecordRow | null> {
  return ((await db.prepare('SELECT * FROM crm_object_records WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmObjectRecordRow
    | undefined) ?? null;
}

export interface RecordInput {
  name?: string;
  ownerId?: string | null;
  custom?: Record<string, unknown>;
}

/**
 * Normaliza el custom contra las propiedades del objeto: descarta claves que
 * no son propiedades y valores que no validan para su tipo. Puro.
 */
export function cleanRecordCustom(
  defs: Array<Pick<CrmCustomFieldRow, 'name' | 'type' | 'options'>>,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    if (!Object.prototype.hasOwnProperty.call(custom, def.name)) continue;
    const v = coerceCustomFieldValue(def, custom[def.name]);
    if (v !== undefined && v !== null) out[def.name] = v;
  }
  return out;
}

async function objectDefs(workspaceId: string, objectId: string, db: Db): Promise<CrmCustomFieldRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE user_id = ? AND entity = ?')
    .all(workspaceId, objectEntity(objectId))) as CrmCustomFieldRow[];
}

export async function createRecord(
  workspaceId: string,
  objectId: string,
  data: RecordInput & { name: string },
  db: Db = getDb(),
): Promise<CrmObjectRecordRow> {
  await assertRefs(workspaceId, { ownerId: data.ownerId }, db);
  const id = crypto.randomUUID();
  const custom = data.custom ? cleanRecordCustom(await objectDefs(workspaceId, objectId, db), data.custom) : {};
  const ts = now();
  await db
    .prepare(
      `INSERT INTO crm_object_records (id, user_id, object_id, owner_id, name, custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, objectId, data.ownerId ?? null, data.name, JSON.stringify(custom), ts, ts);
  return (await getRecord(workspaceId, id, db))!;
}

export async function updateRecord(
  workspaceId: string,
  id: string,
  data: RecordInput,
  db: Db = getDb(),
): Promise<CrmObjectRecordRow | null> {
  const existing = await getRecord(workspaceId, id, db);
  if (!existing) return null;
  await assertRefs(workspaceId, { ownerId: data.ownerId }, db);
  const sets: Array<[string, string | null]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.ownerId !== undefined) sets.push(['owner_id', data.ownerId]);
  if (data.custom !== undefined) {
    sets.push(['custom', JSON.stringify(cleanRecordCustom(await objectDefs(workspaceId, existing.object_id, db), data.custom))]);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_object_records SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), now(), id);
  }
  return getRecord(workspaceId, id, db);
}

export async function deleteRecord(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const existing = await getRecord(workspaceId, id, db);
  if (!existing) return false;
  await db.prepare('DELETE FROM crm_activities WHERE user_id = ? AND object_record_id = ?').run(workspaceId, id);
  await db.prepare('DELETE FROM crm_object_records WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return true;
}

// ---------- Asociaciones ----------

const LINK_TABLE: Record<ObjectLinkEntity, string> = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' };

export async function linkRecord(
  workspaceId: string,
  recordId: string,
  entity: ObjectLinkEntity,
  entityId: string,
  db: Db = getDb(),
): Promise<boolean> {
  if (!(await getRecord(workspaceId, recordId, db))) return false;
  const ref = await db.prepare(`SELECT 1 FROM ${LINK_TABLE[entity]} WHERE id = ? AND user_id = ?`).get(entityId, workspaceId);
  if (!ref) throw new CrmRefError(`invalid_${entity}`);
  await db
    .prepare('INSERT OR IGNORE INTO crm_object_links (record_id, user_id, entity, entity_id) VALUES (?, ?, ?, ?)')
    .run(recordId, workspaceId, entity, entityId);
  return true;
}

export async function unlinkRecord(
  workspaceId: string,
  recordId: string,
  entity: ObjectLinkEntity,
  entityId: string,
  db: Db = getDb(),
): Promise<boolean> {
  return (
    (await db
      .prepare('DELETE FROM crm_object_links WHERE record_id = ? AND user_id = ? AND entity = ? AND entity_id = ?')
      .run(recordId, workspaceId, entity, entityId)).changes > 0
  );
}

export interface RecordLinks {
  contacts: Array<Pick<CrmContactRow, 'id' | 'first_name' | 'last_name' | 'email' | 'owner_id' | 'user_id'>>;
  companies: Array<{ id: string; name: string; domain: string; owner_id: string | null; user_id: string }>;
  deals: Array<{ id: string; name: string; amount: number; currency: string; owner_id: string | null; user_id: string }>;
}

export async function recordLinks(workspaceId: string, recordId: string, db: Db = getDb()): Promise<RecordLinks> {
  const [contacts, companies, deals] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.owner_id, c.user_id FROM crm_object_links l
         JOIN crm_contacts c ON c.id = l.entity_id
         WHERE l.record_id = ? AND l.user_id = ? AND l.entity = 'contact' ORDER BY l.created_at`,
      )
      .all(recordId, workspaceId) as Promise<RecordLinks['contacts']>,
    db
      .prepare(
        `SELECT co.id, co.name, co.domain, co.owner_id, co.user_id FROM crm_object_links l
         JOIN crm_companies co ON co.id = l.entity_id
         WHERE l.record_id = ? AND l.user_id = ? AND l.entity = 'company' ORDER BY l.created_at`,
      )
      .all(recordId, workspaceId) as Promise<RecordLinks['companies']>,
    db
      .prepare(
        `SELECT d.id, d.name, d.amount, d.currency, d.owner_id, d.user_id FROM crm_object_links l
         JOIN crm_deals d ON d.id = l.entity_id
         WHERE l.record_id = ? AND l.user_id = ? AND l.entity = 'deal' ORDER BY l.created_at`,
      )
      .all(recordId, workspaceId) as Promise<RecordLinks['deals']>,
  ]);
  return { contacts, companies, deals };
}

export interface LinkedRecord {
  id: string;
  name: string;
  object_id: string;
  owner_id: string | null;
  user_id: string;
}

/** Registros de objetos propios asociados a un contacto, empresa o deal. */
export async function recordsLinkedTo(
  workspaceId: string,
  entity: ObjectLinkEntity,
  entityId: string,
  db: Db = getDb(),
): Promise<LinkedRecord[]> {
  return (await db
    .prepare(
      `SELECT r.id, r.name, r.object_id, r.owner_id, r.user_id FROM crm_object_links l
       JOIN crm_object_records r ON r.id = l.record_id
       WHERE l.user_id = ? AND l.entity = ? AND l.entity_id = ?
       ORDER BY r.name COLLATE NOCASE`,
    )
    .all(workspaceId, entity, entityId)) as LinkedRecord[];
}

/** Búsqueda de Cmd+K: registros de todos los objetos por nombre. */
export async function searchRecords(
  workspaceId: string,
  q: string,
  ownerScope?: OwnerScope,
  limit = 8,
  db: Db = getDb(),
): Promise<Array<CrmObjectRecordRow & { slug: string; singular: string }>> {
  const scope = ownerScopeSql('r', ownerScope);
  return (await db
    .prepare(
      `SELECT r.*, o.slug, o.singular FROM crm_object_records r JOIN crm_objects o ON o.id = r.object_id
       WHERE r.user_id = ? AND r.name LIKE ? ESCAPE '\\'${scope.sql ? ` AND ${scope.sql}` : ''}
       ORDER BY r.updated_at DESC LIMIT ?`,
    )
    .all(workspaceId, `%${escapeLike(q)}%`, ...scope.args, limit)) as Array<
    CrmObjectRecordRow & { slug: string; singular: string }
  >;
}

/** Valor de una propiedad para mostrar en la tabla. */
export function recordCustom(row: Pick<CrmObjectRecordRow, 'custom'>): Record<string, unknown> {
  return parseCustom(row.custom);
}
