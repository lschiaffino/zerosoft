/**
 * CRM en vivo (C3): firmas que cambian cuando cambia algo que la persona ve.
 * Server-only. La usa POST /api/crm/live (sondeo, como Track) y la vista
 * recarga lo que muestra por las rutas y páginas de siempre, que ya aplican el
 * alcance. Acá nunca sale un dato: solo un hash.
 *
 * Privacidad: la firma se arma solo con lo que la persona puede ver.
 * - Registros: los de su alcance (ownerScopeSql). Uno que no ve no cuenta, ni
 *   cuando se crea, cambia o borra.
 * - Campos: cada fila pasa por redactRow con sus campos ocultos y sin
 *   updated_at, así un cambio en un campo oculto no cambia la firma (ni
 *   siquiera avisa que "algo cambió").
 * - Ficha: además del registro, sus actividades visibles (activityScopeSql),
 *   sus tags y las asociaciones a registros que ve.
 */
import { createHash } from 'node:crypto';
import { getDb, type Db } from './db';
import { activityScopeSql, canSeeRecord, ownerScopeSql, type OwnerScope } from './crm-visibility';
import { hiddenFieldsFor, isUnrestricted, redactRow, type FieldViewer } from './crm-field-perms';

export const LIVE_ENTITIES = ['contacts', 'companies', 'deals'] as const;
export type LiveEntity = (typeof LIVE_ENTITIES)[number];
export type LiveKind = 'contact' | 'company' | 'deal';

const TABLE: Record<LiveEntity, 'crm_contacts' | 'crm_companies' | 'crm_deals'> = {
  contacts: 'crm_contacts',
  companies: 'crm_companies',
  deals: 'crm_deals',
};
export const KIND_ENTITY: Record<LiveKind, LiveEntity> = { contact: 'contacts', company: 'companies', deal: 'deals' };

/** Filas a la vista que se firman una por una (más que esto solo cuenta la cantidad y lo último creado). */
export const MAX_LIVE_IDS = 500;

/** Columnas que cambian sin que cambie nada que se vea. */
const NOISE = new Set(['updated_at', 'score_updated_at']);

function hash(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
}

/** Una fila ya sin campos ocultos y sin las columnas de ruido, con las claves en orden. */
function rowPrint(row: Record<string, unknown>): string {
  const keys = Object.keys(row).filter((k) => !NOISE.has(k)).sort();
  return JSON.stringify(keys.map((k) => [k, row[k]]));
}

async function hiddenFor(viewer: FieldViewer, entity: LiveEntity, db: Db): Promise<ReadonlySet<string>> {
  return isUnrestricted(viewer) ? new Set<string>() : hiddenFieldsFor(viewer, entity, db);
}

/**
 * Firma de una lista (tabla o board): cuántos registros ve la persona, el
 * último que se creó y el contenido visible de las filas que tiene en
 * pantalla (`ids`, solo las de su alcance y su workspace).
 */
export async function listSignature(
  viewer: FieldViewer,
  scope: OwnerScope,
  entity: LiveEntity,
  opts: { ids?: string[]; pipelineId?: string } = {},
  db: Db = getDb(),
): Promise<string> {
  const table = TABLE[entity];
  const s = ownerScopeSql('t', scope);
  const where = ['t.user_id = ?'];
  const args: string[] = [viewer.workspaceId];
  if (s.sql) {
    where.push(s.sql);
    args.push(...s.args);
  }
  if (entity === 'deals' && opts.pipelineId) {
    where.push('t.pipeline_id = ?');
    args.push(opts.pipelineId);
  }
  const head = (await db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(t.created_at), '') AS c FROM ${table} t WHERE ${where.join(' AND ')}`)
    .get(...args)) as { n: number; c: string };
  const ids = [...new Set(opts.ids ?? [])].slice(0, MAX_LIVE_IDS);
  let rows: string[] = [];
  if (ids.length) {
    const hidden = await hiddenFor(viewer, entity, db);
    const found = (await db
      .prepare(`SELECT t.* FROM ${table} t WHERE ${where.join(' AND ')} AND t.id IN (${ids.map(() => '?').join(',')}) ORDER BY t.id`)
      .all(...args, ...ids)) as Array<Record<string, unknown> & { custom: string }>;
    const hiddenCompanies = entity !== 'deals' ? await unseenCompanies(ws(viewer), scope, found, db) : new Set<string>();
    rows = found.map((r) => rowPrint(maskCompany(redactRow(r, hidden), hiddenCompanies)));
  }
  return hash([Number(head.n), head.c, rows]);
}

/**
 * Firma de una ficha. null si la persona no ve el registro (la ruta responde
 * 404 sin decir si existe).
 */
export async function recordSignature(
  viewer: FieldViewer,
  scope: OwnerScope,
  kind: LiveKind,
  id: string,
  db: Db = getDb(),
): Promise<string | null> {
  const entity = KIND_ENTITY[kind];
  const table = TABLE[entity];
  const ws = viewer.workspaceId;
  if (!(await canSeeRecord(ws, table, id, scope, db))) return null;
  const row = (await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, ws)) as
    | (Record<string, unknown> & { custom: string })
    | undefined;
  if (!row) return null;
  const hidden = await hiddenFor(viewer, entity, db);
  const col = kind === 'contact' ? 'contact_id' : kind === 'company' ? 'company_id' : 'deal_id';
  const act = activityScopeSql('a', scope);
  const acts = (await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(a.updated_at), '') AS u FROM crm_activities a
       WHERE a.user_id = ? AND a.${col} = ?${act.sql ? ` AND ${act.sql}` : ''}`,
    )
    .get(ws, id, ...act.args)) as { n: number; u: string };
  const tags = (await db
    .prepare('SELECT COUNT(*) AS n FROM crm_record_tags WHERE user_id = ? AND entity = ? AND record_id = ?')
    .get(ws, kind, id)) as { n: number };
  const assoc = await visibleAssociations(ws, kind, id, scope, db);
  const hiddenCompanies = kind !== 'deal' ? await unseenCompanies(ws, scope, [row], db) : new Set<string>();
  return hash([rowPrint(maskCompany(redactRow(row, hidden), hiddenCompanies)), Number(acts.n), acts.u, Number(tags.n), assoc]);
}

function ws(viewer: FieldViewer): string {
  return viewer.workspaceId;
}

/**
 * Empresas principales (company_id de contactos) o madres (parent_company_id) que la persona no ve: en la
 * firma valen todas lo mismo, así un cambio entre dos empresas que no ve no
 * la cambia (la ficha muestra "registro privado" en las dos).
 */
async function unseenCompanies(workspaceId: string, scope: OwnerScope, rows: Array<Record<string, unknown>>, db: Db): Promise<Set<string>> {
  if (!scope) return new Set();
  const ids = [...new Set(rows.flatMap((r) => [r.company_id, r.parent_company_id]).filter((v): v is string => typeof v === 'string' && !!v))];
  if (!ids.length) return new Set();
  const s = ownerScopeSql('co', scope);
  const seen = (await db
    .prepare(`SELECT co.id FROM crm_companies co WHERE co.user_id = ? AND co.id IN (${ids.map(() => '?').join(',')})${s.sql ? ` AND ${s.sql}` : ''}`)
    .all(workspaceId, ...ids, ...s.args)) as Array<{ id: string }>;
  const ok = new Set(seen.map((r) => r.id));
  return new Set(ids.filter((i) => !ok.has(i)));
}

function maskCompany<T extends Record<string, unknown>>(row: T, unseen: ReadonlySet<string>): T {
  const out: Record<string, unknown> = { ...row };
  for (const col of ['company_id', 'parent_company_id']) if (typeof out[col] === 'string' && unseen.has(out[col] as string)) out[col] = 'private';
  return out as T;
}

/** Cuántos registros asociados ve la persona, por tipo (los que no ve no cuentan). */
async function visibleAssociations(ws: string, kind: LiveKind, id: string, scope: OwnerScope, db: Db): Promise<number[]> {
  const count = async (sql: string, table: string, alias: string, args: string[]) => {
    const s = ownerScopeSql(alias, scope);
    const r = (await db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} ${alias} WHERE ${alias}.user_id = ? AND ${alias}.id IN (${sql})${s.sql ? ` AND ${s.sql}` : ''}`)
      .get(ws, ...args, ...s.args)) as { n: number };
    return Number(r.n);
  };
  if (kind === 'contact') {
    return [
      await count('SELECT deal_id FROM crm_deal_contacts WHERE contact_id = ?', 'crm_deals', 'd', [id]),
      await count('SELECT company_id FROM crm_contact_companies WHERE contact_id = ?', 'crm_companies', 'co', [id]),
    ];
  }
  if (kind === 'company') {
    return [
      await count('SELECT contact_id FROM crm_contact_companies WHERE company_id = ?', 'crm_contacts', 'c', [id]),
      await count('SELECT deal_id FROM crm_deal_companies WHERE company_id = ?', 'crm_deals', 'd', [id]),
    ];
  }
  return [
    await count('SELECT contact_id FROM crm_deal_contacts WHERE deal_id = ?', 'crm_contacts', 'c', [id]),
    await count('SELECT company_id FROM crm_deal_companies WHERE deal_id = ?', 'crm_companies', 'co', [id]),
  ];
}
