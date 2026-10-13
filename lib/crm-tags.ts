/**
 * CRM — tags de contactos, empresas y deals. Server-only.
 * Un tag es del workspace (nombre único sin importar mayúsculas) y tiene un
 * color de la paleta de productos (TAG_COLORS). Los registros borrados limpian
 * sus tags por trigger (022_crm_model_tables).
 */
import { CrmRefError } from './crm-refs';
import { TAG_COLORS, type TagEntity } from './crm-constants';
import { getDb, type CrmTagRow, type Db } from './db';

export type { TagEntity };

const TABLE: Record<TagEntity, string> = {
  contact: 'crm_contacts',
  company: 'crm_companies',
  deal: 'crm_deals',
};

export interface TagWithCount extends CrmTagRow {
  contacts: number;
  companies: number;
  deals: number;
}

/**
 * Tags del workspace con la cantidad de registros de cada entidad. Con
 * `ownerScope` (visibilidad por owner) solo cuenta los registros visibles.
 */
export async function listTags(
  userId: string,
  db: Db = getDb(),
  ownerScope?: string[] | null,
): Promise<TagWithCount[]> {
  const count = (entity: TagEntity) => {
    const base = `SELECT COUNT(*) FROM crm_record_tags rt WHERE rt.tag_id = t.id AND rt.entity = '${entity}'`;
    if (!ownerScope) return { sql: base, args: [] as string[] };
    if (!ownerScope.length) return { sql: '0', args: [] as string[] };
    const ph = ownerScope.map(() => '?').join(',');
    return {
      sql: `${base} AND EXISTS (SELECT 1 FROM ${TABLE[entity]} vr WHERE vr.id = rt.record_id AND COALESCE(vr.owner_id, vr.user_id) IN (${ph}))`,
      args: [...ownerScope],
    };
  };
  const [c, co, d] = [count('contact'), count('company'), count('deal')];
  return (await db
    .prepare(
      `SELECT t.*, (${c.sql}) AS contacts, (${co.sql}) AS companies, (${d.sql}) AS deals
       FROM crm_tags t WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(...c.args, ...co.args, ...d.args, userId)) as TagWithCount[];
}

export async function getTag(userId: string, id: string, db: Db = getDb()): Promise<CrmTagRow | null> {
  return (
    ((await db.prepare('SELECT * FROM crm_tags WHERE id = ? AND user_id = ?').get(id, userId)) as
      | CrmTagRow
      | undefined) ?? null
  );
}

function normColor(color: string | undefined): string {
  return color && (TAG_COLORS as readonly string[]).includes(color) ? color : 'crm';
}

export type TagResult = { ok: true; tag: CrmTagRow } | { ok: false; error: 'duplicate_tag' | 'not_found' };

export async function createTag(
  userId: string,
  data: { name: string; color?: string },
  db: Db = getDb(),
): Promise<TagResult> {
  const name = data.name.trim().slice(0, 60);
  const dupe = await db
    .prepare('SELECT 1 FROM crm_tags WHERE user_id = ? AND name = ? COLLATE NOCASE')
    .get(userId, name);
  if (dupe) return { ok: false, error: 'duplicate_tag' };
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_tags (id, user_id, name, color) VALUES (?, ?, ?, ?)')
    .run(id, userId, name, normColor(data.color));
  return { ok: true, tag: (await getTag(userId, id, db))! };
}

export async function updateTag(
  userId: string,
  id: string,
  data: { name?: string; color?: string },
  db: Db = getDb(),
): Promise<TagResult> {
  const tag = await getTag(userId, id, db);
  if (!tag) return { ok: false, error: 'not_found' };
  const name = data.name !== undefined ? data.name.trim().slice(0, 60) : tag.name;
  if (name.toLowerCase() !== tag.name.toLowerCase()) {
    const dupe = await db
      .prepare('SELECT 1 FROM crm_tags WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?')
      .get(userId, name, id);
    if (dupe) return { ok: false, error: 'duplicate_tag' };
  }
  const color = data.color !== undefined ? normColor(data.color) : tag.color;
  await db.prepare('UPDATE crm_tags SET name = ?, color = ? WHERE id = ?').run(name, color, id);
  return { ok: true, tag: (await getTag(userId, id, db))! };
}

export async function deleteTag(userId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_tags WHERE id = ? AND user_id = ?').run(id, userId)).changes > 0;
}

/**
 * Agrega o quita un tag a varios registros. Solo toca registros del workspace
 * (los ids ajenos se ignoran). Devuelve cuántos registros cambiaron.
 */
export async function applyTag(
  userId: string,
  tagId: string,
  entity: TagEntity,
  ids: string[],
  action: 'add' | 'remove',
  db: Db = getDb(),
): Promise<number> {
  if (!(await getTag(userId, tagId, db))) throw new CrmRefError('invalid_tag');
  const unique = [...new Set(ids)].slice(0, 1000);
  if (!unique.length) return 0;
  const ph = unique.map(() => '?').join(',');
  const owned = (
    (await db
      .prepare(`SELECT id FROM ${TABLE[entity]} WHERE user_id = ? AND id IN (${ph})`)
      .all(userId, ...unique)) as Array<{ id: string }>
  ).map((r) => r.id);
  if (!owned.length) return 0;
  let changed = 0;
  if (action === 'add') {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO crm_record_tags (tag_id, user_id, entity, record_id) VALUES (?, ?, ?, ?)',
    );
    for (const id of owned) changed += (await ins.run(tagId, userId, entity, id)).changes;
  } else {
    const oph = owned.map(() => '?').join(',');
    changed = (
      await db
        .prepare(`DELETE FROM crm_record_tags WHERE tag_id = ? AND entity = ? AND record_id IN (${oph})`)
        .run(tagId, entity, ...owned)
    ).changes;
  }
  return changed;
}

/** Reemplaza el set de tags de un registro (para el editor del detalle). */
export async function setRecordTags(
  userId: string,
  entity: TagEntity,
  recordId: string,
  tagIds: string[],
  db: Db = getDb(),
): Promise<void> {
  if (!(await db.prepare(`SELECT 1 FROM ${TABLE[entity]} WHERE id = ? AND user_id = ?`).get(recordId, userId))) {
    throw new CrmRefError(`invalid_${entity}`);
  }
  const unique = [...new Set(tagIds)];
  if (unique.length) {
    const ph = unique.map(() => '?').join(',');
    const valid = (await db
      .prepare(`SELECT id FROM crm_tags WHERE user_id = ? AND id IN (${ph})`)
      .all(userId, ...unique)) as Array<{ id: string }>;
    if (valid.length !== unique.length) throw new CrmRefError('invalid_tag');
  }
  await db
    .prepare('DELETE FROM crm_record_tags WHERE user_id = ? AND entity = ? AND record_id = ?')
    .run(userId, entity, recordId);
  const ins = db.prepare('INSERT INTO crm_record_tags (tag_id, user_id, entity, record_id) VALUES (?, ?, ?, ?)');
  for (const tagId of unique) await ins.run(tagId, userId, entity, recordId);
}

export interface RecordTag {
  id: string;
  name: string;
  color: string;
}

/** Tags de varios registros en una query: Map recordId → tags (orden alfabético). */
export async function tagsForRecords(
  userId: string,
  entity: TagEntity,
  recordIds: string[],
  db: Db = getDb(),
): Promise<Map<string, RecordTag[]>> {
  const out = new Map<string, RecordTag[]>();
  const unique = [...new Set(recordIds)];
  if (!unique.length) return out;
  const ph = unique.map(() => '?').join(',');
  const rows = (await db
    .prepare(
      `SELECT rt.record_id, t.id, t.name, t.color FROM crm_record_tags rt
       JOIN crm_tags t ON t.id = rt.tag_id
       WHERE rt.user_id = ? AND rt.entity = ? AND rt.record_id IN (${ph})
       ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(userId, entity, ...unique)) as Array<RecordTag & { record_id: string }>;
  for (const r of rows) {
    const list = out.get(r.record_id) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    out.set(r.record_id, list);
  }
  return out;
}

/**
 * Condición SQL "el registro (alias.id) tiene el tag". Solo concatena el alias
 * y la entidad, que salen de constantes internas; el tag va como parámetro.
 */
export function tagCondition(alias: string, entity: TagEntity): string {
  return `EXISTS (SELECT 1 FROM crm_record_tags rt WHERE rt.entity = '${entity}' AND rt.record_id = ${alias}.id AND rt.tag_id = ?)`;
}
