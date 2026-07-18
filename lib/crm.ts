/**
 * CRM — capa de queries (server-only).
 * Sigue el patrón de lib/links.ts: getDb() singleton, WHERE builders,
 * paginación con clamp, ids crypto.randomUUID(), timestamps UTC.
 */
import {
  getDb,
  type CrmActivityRow,
  type CrmCompanyRow,
  type CrmContactRow,
  type CrmCustomFieldRow,
  type CrmDealRow,
  type CrmListRow,
  type CrmPipelineRow,
  type CrmSavedViewRow,
  type CrmStageRow,
} from './db';

// ---------- Constantes ----------

export const LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'mql',
  'sql',
  'opportunity',
  'customer',
  'evangelist',
] as const;
export const LEAD_STATUSES = [
  'new',
  'open',
  'in_progress',
  'open_deal',
  'unqualified',
  'connected',
  'bad_timing',
] as const;
export const SOURCES = ['organic', 'referral', 'ads', 'social', 'email', 'event', 'other'] as const;
export const ACTIVITY_TYPES = ['note', 'task', 'call', 'meeting', 'email'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type Source = (typeof SOURCES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];

// ---------- Helpers ----------

/** Timestamp UTC 'YYYY-MM-DD HH:MM:SS' (mismo formato que datetime('now')). */
function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Inicio y fin del día de hoy (UTC) en formato de la DB. */
function todayRange(): { start: string; end: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { start: `${day} 00:00:00`, end: `${day} 23:59:59` };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Parsea la columna custom (JSON object) sin romper ante datos corruptos. */
export function parseCustom(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonObject(json: string | null): Record<string, unknown> {
  return parseCustom(json);
}

/**
 * Convierte un objeto camelCase (solo claves presentes y !== undefined) en
 * pares [columna, valor] listos para un UPDATE. `custom` se serializa a JSON.
 */
function toColumnValues(
  cols: Record<string, string>,
  data: Record<string, unknown>,
): Array<[string, string | number | null]> {
  const out: Array<[string, string | number | null]> = [];
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in data)) continue;
    const v = data[key];
    if (v === undefined) continue;
    if (key === 'custom') out.push([col, JSON.stringify(v ?? {})]);
    else out.push([col, v as string | number | null]);
  }
  return out;
}

// ============================================================
// CONTACTS
// ============================================================

export interface ContactFilter {
  q?: string;
  lifecycle?: string;
  leadStatus?: string;
  source?: string;
  companyId?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'email';
  page?: number;
  pageSize?: number;
}

export type ContactListRow = CrmContactRow & { company_name: string | null };

function buildContactWhere(
  userId: string,
  f: ContactFilter,
): { where: string; args: Array<string | number> } {
  const where: string[] = ['c.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(
      `(c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')`,
    );
    args.push(like, like, like);
  }
  if (f.lifecycle) {
    where.push('c.lifecycle_stage = ?');
    args.push(f.lifecycle);
  }
  if (f.leadStatus) {
    where.push('c.lead_status = ?');
    args.push(f.leadStatus);
  }
  if (f.source) {
    where.push('c.source = ?');
    args.push(f.source);
  }
  if (f.companyId) {
    where.push('c.company_id = ?');
    args.push(f.companyId);
  }
  return { where: where.join(' AND '), args };
}

const CONTACT_ORDER: Record<NonNullable<ContactFilter['sort']>, string> = {
  newest: 'c.created_at DESC, c.id',
  oldest: 'c.created_at ASC, c.id',
  name: "c.first_name COLLATE NOCASE ASC, c.last_name COLLATE NOCASE ASC, c.id",
  email: "c.email COLLATE NOCASE ASC, c.id",
};

export function listContacts(
  userId: string,
  f: ContactFilter,
): { rows: ContactListRow[]; total: number } {
  const db = getDb();
  const { where, args } = buildContactWhere(userId, f);
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM crm_contacts c WHERE ${where}`).get(...args) as {
      c: number;
    }
  ).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const order = CONTACT_ORDER[f.sort ?? 'newest'];
  const rows = db
    .prepare(
      `SELECT c.*, co.name AS company_name
       FROM crm_contacts c
       LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE ${where}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize) as ContactListRow[];
  return { rows, total };
}

export type ContactDealRow = CrmDealRow & { stage_name: string; pipeline_name: string };

export interface ContactDetail {
  contact: CrmContactRow;
  company: CrmCompanyRow | null;
  deals: ContactDealRow[];
  lists: CrmListRow[];
}

export function getContact(userId: string, id: string): ContactDetail | null {
  const db = getDb();
  const contact = db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(id, userId) as CrmContactRow | undefined;
  if (!contact) return null;
  const company = contact.company_id
    ? (db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(contact.company_id) as
        | CrmCompanyRow
        | undefined) ?? null
    : null;
  const deals = db
    .prepare(
      `SELECT d.*, s.name AS stage_name, p.name AS pipeline_name
       FROM crm_deals d
       JOIN crm_deal_contacts dc ON dc.deal_id = d.id
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       LEFT JOIN crm_pipelines p ON p.id = d.pipeline_id
       WHERE dc.contact_id = ? AND d.user_id = ?
       ORDER BY d.created_at DESC`,
    )
    .all(id, userId) as ContactDealRow[];
  const lists = db
    .prepare(
      `SELECT l.* FROM crm_lists l
       JOIN crm_list_members m ON m.list_id = l.id
       WHERE m.contact_id = ? AND l.user_id = ?
       ORDER BY l.name ASC`,
    )
    .all(id, userId) as CrmListRow[];
  return { contact, company, deals, lists };
}

export interface ContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  leadStatus?: string;
  source?: string;
  companyId?: string | null;
  custom?: Record<string, unknown>;
}

const CONTACT_COLS: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  jobTitle: 'job_title',
  website: 'website',
  city: 'city',
  country: 'country',
  lifecycleStage: 'lifecycle_stage',
  leadStatus: 'lead_status',
  source: 'source',
  companyId: 'company_id',
  custom: 'custom',
};

export function createContact(userId: string, data: ContactInput): CrmContactRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO crm_contacts
       (id, user_id, first_name, last_name, email, phone, job_title, website, city, country,
        lifecycle_stage, lead_status, source, company_id, custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    data.firstName ?? '',
    data.lastName ?? '',
    data.email ?? '',
    data.phone ?? '',
    data.jobTitle ?? '',
    data.website ?? '',
    data.city ?? '',
    data.country ?? '',
    data.lifecycleStage ?? 'lead',
    data.leadStatus ?? 'new',
    data.source ?? '',
    data.companyId ?? null,
    JSON.stringify(data.custom ?? {}),
  );
  return db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id) as CrmContactRow;
}

export function updateContact(
  userId: string,
  id: string,
  data: ContactInput,
): CrmContactRow | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets = toColumnValues(CONTACT_COLS, data as Record<string, unknown>);
  const setSql = sets.map(([c]) => `${c} = ?`).join(', ');
  db.prepare(
    `UPDATE crm_contacts SET ${setSql ? `${setSql}, ` : ''}updated_at = ? WHERE id = ?`,
  ).run(...sets.map(([, v]) => v), now(), id);
  return db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id) as CrmContactRow;
}

export function deleteContact(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM crm_contacts WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}

export interface DuplicateGroup {
  email: string;
  contacts: CrmContactRow[];
}

/** Grupos de contactos que comparten lower(email) (email no vacío, count > 1). */
export function findDuplicateContacts(userId: string): DuplicateGroup[] {
  const db = getDb();
  const groups = db
    .prepare(
      `SELECT lower(email) AS lemail, COUNT(*) AS c
       FROM crm_contacts
       WHERE user_id = ? AND email != ''
       GROUP BY lemail
       HAVING c > 1
       ORDER BY c DESC`,
    )
    .all(userId) as Array<{ lemail: string; c: number }>;
  return groups.map((g) => ({
    email: g.lemail,
    contacts: db
      .prepare(
        'SELECT * FROM crm_contacts WHERE user_id = ? AND lower(email) = ? ORDER BY created_at ASC',
      )
      .all(userId, g.lemail) as CrmContactRow[],
  }));
}

/**
 * Merge: mueve todo lo del contacto `dropId` a `keepId` y borra `dropId`.
 * Transacción única. Devuelve el contacto conservado, o null si falta alguno.
 */
export function mergeContacts(
  userId: string,
  keepId: string,
  dropId: string,
): CrmContactRow | null {
  const db = getDb();
  if (keepId === dropId) return null;
  const keep = db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(keepId, userId) as CrmContactRow | undefined;
  const drop = db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(dropId, userId) as CrmContactRow | undefined;
  if (!keep || !drop) return null;

  const tx = db.transaction(() => {
    if (!keep.company_id && drop.company_id) {
      db.prepare('UPDATE crm_contacts SET company_id = ?, updated_at = ? WHERE id = ?').run(
        drop.company_id,
        now(),
        keepId,
      );
    }
    // Deals: migra los vínculos; si el keep ya estaba en el deal, descarta el dupe.
    db.prepare('UPDATE OR IGNORE crm_deal_contacts SET contact_id = ? WHERE contact_id = ?').run(
      keepId,
      dropId,
    );
    db.prepare('DELETE FROM crm_deal_contacts WHERE contact_id = ?').run(dropId);
    // Activities.
    db.prepare('UPDATE crm_activities SET contact_id = ?, updated_at = ? WHERE contact_id = ?').run(
      keepId,
      now(),
      dropId,
    );
    // Listas estáticas.
    db.prepare('UPDATE OR IGNORE crm_list_members SET contact_id = ? WHERE contact_id = ?').run(
      keepId,
      dropId,
    );
    db.prepare('DELETE FROM crm_list_members WHERE contact_id = ?').run(dropId);
    // Borra el contacto descartado.
    db.prepare('DELETE FROM crm_contacts WHERE id = ?').run(dropId);
  });
  tx();
  return db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(keepId) as CrmContactRow;
}

export function bulkUpdateContacts(
  userId: string,
  ids: string[],
  patch: { lifecycleStage?: string },
): number {
  if (!ids.length || !patch.lifecycleStage) return 0;
  const ph = ids.map(() => '?').join(',');
  return getDb()
    .prepare(
      `UPDATE crm_contacts SET lifecycle_stage = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph})`,
    )
    .run(patch.lifecycleStage, now(), userId, ...ids).changes;
}

export function bulkDeleteContacts(userId: string, ids: string[]): number {
  if (!ids.length) return 0;
  const ph = ids.map(() => '?').join(',');
  return getDb()
    .prepare(`DELETE FROM crm_contacts WHERE user_id = ? AND id IN (${ph})`)
    .run(userId, ...ids).changes;
}

// ============================================================
// COMPANIES
// ============================================================

export interface CompanyFilter {
  q?: string;
  industry?: string;
  lifecycle?: string;
  sort?: 'newest' | 'oldest' | 'name';
  page?: number;
  pageSize?: number;
}

export type CompanyListRow = CrmCompanyRow & { contact_count: number };

export function listCompanies(
  userId: string,
  f: CompanyFilter,
): { rows: CompanyListRow[]; total: number } {
  const db = getDb();
  const where: string[] = ['co.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(co.name LIKE ? ESCAPE '\\' OR co.domain LIKE ? ESCAPE '\\')`);
    args.push(like, like);
  }
  if (f.industry) {
    where.push('co.industry = ?');
    args.push(f.industry);
  }
  if (f.lifecycle) {
    where.push('co.lifecycle_stage = ?');
    args.push(f.lifecycle);
  }
  const whereSql = where.join(' AND ');
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM crm_companies co WHERE ${whereSql}`).get(...args) as {
      c: number;
    }
  ).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const order =
    f.sort === 'oldest'
      ? 'co.created_at ASC, co.id'
      : f.sort === 'name'
        ? 'co.name COLLATE NOCASE ASC, co.id'
        : 'co.created_at DESC, co.id';
  const rows = db
    .prepare(
      `SELECT co.*,
         (SELECT COUNT(*) FROM crm_contacts ct WHERE ct.company_id = co.id) AS contact_count
       FROM crm_companies co
       WHERE ${whereSql}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize) as CompanyListRow[];
  return { rows, total };
}

export interface CompanyDetail {
  company: CrmCompanyRow;
  contacts: CrmContactRow[];
  deals: CrmDealRow[];
}

export function getCompany(userId: string, id: string): CompanyDetail | null {
  const db = getDb();
  const company = db
    .prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?')
    .get(id, userId) as CrmCompanyRow | undefined;
  if (!company) return null;
  const contacts = db
    .prepare(
      'SELECT * FROM crm_contacts WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC',
    )
    .all(id, userId) as CrmContactRow[];
  // Deals de la empresa = deals vinculados a contactos de la empresa.
  const deals = db
    .prepare(
      `SELECT DISTINCT d.* FROM crm_deals d
       JOIN crm_deal_contacts dc ON dc.deal_id = d.id
       JOIN crm_contacts c ON c.id = dc.contact_id
       WHERE c.company_id = ? AND d.user_id = ?
       ORDER BY d.created_at DESC`,
    )
    .all(id, userId) as CrmDealRow[];
  return { company, contacts, deals };
}

export interface CompanyInput {
  name?: string;
  domain?: string;
  industry?: string;
  employees?: number | null;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  custom?: Record<string, unknown>;
}

const COMPANY_COLS: Record<string, string> = {
  name: 'name',
  domain: 'domain',
  industry: 'industry',
  employees: 'employees',
  phone: 'phone',
  website: 'website',
  city: 'city',
  country: 'country',
  lifecycleStage: 'lifecycle_stage',
  custom: 'custom',
};

export function createCompany(userId: string, data: CompanyInput): CrmCompanyRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO crm_companies
       (id, user_id, name, domain, industry, employees, phone, website, city, country, lifecycle_stage, custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    data.name ?? '',
    data.domain ?? '',
    data.industry ?? '',
    data.employees ?? null,
    data.phone ?? '',
    data.website ?? '',
    data.city ?? '',
    data.country ?? '',
    data.lifecycleStage ?? 'lead',
    JSON.stringify(data.custom ?? {}),
  );
  return db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(id) as CrmCompanyRow;
}

export function updateCompany(
  userId: string,
  id: string,
  data: CompanyInput,
): CrmCompanyRow | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM crm_companies WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets = toColumnValues(COMPANY_COLS, data as Record<string, unknown>);
  const setSql = sets.map(([c]) => `${c} = ?`).join(', ');
  db.prepare(
    `UPDATE crm_companies SET ${setSql ? `${setSql}, ` : ''}updated_at = ? WHERE id = ?`,
  ).run(...sets.map(([, v]) => v), now(), id);
  return db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(id) as CrmCompanyRow;
}

export function deleteCompany(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM crm_companies WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}

// ============================================================
// PIPELINES & STAGES
// ============================================================

export interface PipelineWithStages extends CrmPipelineRow {
  stages: CrmStageRow[];
}

export function listPipelinesWithStages(userId: string): PipelineWithStages[] {
  const db = getDb();
  const pipelines = db
    .prepare('SELECT * FROM crm_pipelines WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(userId) as CrmPipelineRow[];
  const stageStmt = db.prepare(
    'SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC',
  );
  return pipelines.map((p) => ({ ...p, stages: stageStmt.all(p.id) as CrmStageRow[] }));
}

function getOwnedPipeline(userId: string, id: string): CrmPipelineRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM crm_pipelines WHERE id = ? AND user_id = ?')
      .get(id, userId) as CrmPipelineRow | undefined) ?? null
  );
}

/** Stage cuyo pipeline pertenece al usuario (las stages no tienen user_id propio). */
function getOwnedStage(userId: string, id: string): CrmStageRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT s.* FROM crm_stages s
         JOIN crm_pipelines p ON p.id = s.pipeline_id
         WHERE s.id = ? AND p.user_id = ?`,
      )
      .get(id, userId) as CrmStageRow | undefined) ?? null
  );
}

export function createPipeline(userId: string, name: string): CrmPipelineRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const maxPos = (
    db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM crm_pipelines WHERE user_id = ?').get(userId) as {
      m: number;
    }
  ).m;
  db.prepare('INSERT INTO crm_pipelines (id, user_id, name, position) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    name,
    maxPos + 1,
  );
  return db.prepare('SELECT * FROM crm_pipelines WHERE id = ?').get(id) as CrmPipelineRow;
}

export function renamePipeline(
  userId: string,
  id: string,
  name: string,
): CrmPipelineRow | null {
  const db = getDb();
  if (!getOwnedPipeline(userId, id)) return null;
  db.prepare('UPDATE crm_pipelines SET name = ? WHERE id = ?').run(name, id);
  return db.prepare('SELECT * FROM crm_pipelines WHERE id = ?').get(id) as CrmPipelineRow;
}

export type DeletePipelineResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_empty' };

/** Solo borra pipelines sin deals (las stages caen en cascada). */
export function deletePipeline(userId: string, id: string): DeletePipelineResult {
  const db = getDb();
  if (!getOwnedPipeline(userId, id)) return { ok: false, reason: 'not_found' };
  const dealCount = (
    db.prepare('SELECT COUNT(*) AS c FROM crm_deals WHERE pipeline_id = ? AND user_id = ?').get(
      id,
      userId,
    ) as { c: number }
  ).c;
  if (dealCount > 0) return { ok: false, reason: 'not_empty' };
  db.prepare('DELETE FROM crm_pipelines WHERE id = ?').run(id);
  return { ok: true };
}

export function createStage(
  userId: string,
  pipelineId: string,
  data: { name: string; probability?: number },
): CrmStageRow | null {
  const db = getDb();
  if (!getOwnedPipeline(userId, pipelineId)) return null;
  const id = crypto.randomUUID();
  const maxPos = (
    db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM crm_stages WHERE pipeline_id = ?')
      .get(pipelineId) as { m: number }
  ).m;
  db.prepare(
    'INSERT INTO crm_stages (id, pipeline_id, name, probability, position) VALUES (?, ?, ?, ?, ?)',
  ).run(id, pipelineId, data.name, data.probability ?? 0, maxPos + 1);
  return db.prepare('SELECT * FROM crm_stages WHERE id = ?').get(id) as CrmStageRow;
}

export function updateStage(
  userId: string,
  id: string,
  data: { name?: string; probability?: number; isWon?: boolean; isLost?: boolean },
): CrmStageRow | null {
  const db = getDb();
  if (!getOwnedStage(userId, id)) return null;
  const sets: Array<[string, string | number]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.probability !== undefined) sets.push(['probability', data.probability]);
  if (data.isWon !== undefined) sets.push(['is_won', data.isWon ? 1 : 0]);
  if (data.isLost !== undefined) sets.push(['is_lost', data.isLost ? 1 : 0]);
  if (sets.length) {
    db.prepare(`UPDATE crm_stages SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...sets.map(([, v]) => v),
      id,
    );
  }
  return db.prepare('SELECT * FROM crm_stages WHERE id = ?').get(id) as CrmStageRow;
}

export type DeleteStageResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_empty' };

/** Solo borra stages sin deals. */
export function deleteStage(userId: string, id: string): DeleteStageResult {
  const db = getDb();
  if (!getOwnedStage(userId, id)) return { ok: false, reason: 'not_found' };
  const dealCount = (
    db.prepare('SELECT COUNT(*) AS c FROM crm_deals WHERE stage_id = ? AND user_id = ?').get(
      id,
      userId,
    ) as { c: number }
  ).c;
  if (dealCount > 0) return { ok: false, reason: 'not_empty' };
  db.prepare('DELETE FROM crm_stages WHERE id = ?').run(id);
  return { ok: true };
}

/** Reordena stages: position = índice en el array recibido. */
export function reorderStages(userId: string, pipelineId: string, stageIds: string[]): boolean {
  const db = getDb();
  if (!getOwnedPipeline(userId, pipelineId)) return false;
  const stmt = db.prepare('UPDATE crm_stages SET position = ? WHERE id = ? AND pipeline_id = ?');
  const tx = db.transaction(() => {
    stageIds.forEach((stageId, i) => {
      stmt.run(i, stageId, pipelineId);
    });
  });
  tx();
  return true;
}

// ============================================================
// DEALS
// ============================================================

export interface DealFilter {
  pipelineId: string;
  q?: string;
  stageId?: string;
  priority?: string;
  sort?: 'newest' | 'oldest' | 'amount' | 'close_date';
  page?: number;
  pageSize?: number;
}

export type DealListRow = CrmDealRow & { stage_name: string | null };

const DEAL_ORDER: Record<NonNullable<DealFilter['sort']>, string> = {
  newest: 'd.created_at DESC, d.id',
  oldest: 'd.created_at ASC, d.id',
  amount: 'd.amount DESC, d.id',
  close_date: "d.close_date IS NULL, d.close_date ASC, d.id",
};

export function listDeals(
  userId: string,
  f: DealFilter,
): { rows: DealListRow[]; total: number } {
  const db = getDb();
  const where: string[] = ['d.user_id = ?', 'd.pipeline_id = ?'];
  const args: Array<string | number> = [userId, f.pipelineId];
  if (f.q) {
    where.push(`d.name LIKE ? ESCAPE '\\'`);
    args.push(`%${escapeLike(f.q)}%`);
  }
  if (f.stageId) {
    where.push('d.stage_id = ?');
    args.push(f.stageId);
  }
  if (f.priority) {
    where.push('d.priority = ?');
    args.push(f.priority);
  }
  const whereSql = where.join(' AND ');
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM crm_deals d WHERE ${whereSql}`).get(...args) as {
      c: number;
    }
  ).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS stage_name
       FROM crm_deals d
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE ${whereSql}
       ORDER BY ${DEAL_ORDER[f.sort ?? 'newest']}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize) as DealListRow[];
  return { rows, total };
}

export interface BoardDeal extends CrmDealRow {
  contact_id: string | null;
  contact_name: string | null;
  company_name: string | null;
}

export interface BoardStage {
  stage: CrmStageRow;
  deals: BoardDeal[];
  count: number;
  amount: number;
}

/** Columnas del kanban: stages ordenados con sus deals (orden position). */
export function listDealsForBoard(userId: string, pipelineId: string): BoardStage[] {
  const db = getDb();
  const stages = db
    .prepare('SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC')
    .all(pipelineId) as CrmStageRow[];
  const deals = db
    .prepare(
      `SELECT d.*,
         c.id AS contact_id,
         NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name,
         co.name AS company_name
       FROM crm_deals d
       LEFT JOIN crm_contacts c ON c.id = (
         SELECT dc.contact_id FROM crm_deal_contacts dc WHERE dc.deal_id = d.id ORDER BY dc.rowid LIMIT 1
       )
       LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE d.user_id = ? AND d.pipeline_id = ?
       ORDER BY d.position ASC`,
    )
    .all(userId, pipelineId) as BoardDeal[];
  return stages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stage_id === stage.id);
    return {
      stage,
      deals: stageDeals,
      count: stageDeals.length,
      amount: stageDeals.reduce((s, d) => s + d.amount, 0),
    };
  });
}

export interface DealDetail {
  deal: CrmDealRow;
  stage: CrmStageRow | null;
  pipeline: CrmPipelineRow | null;
  contacts: CrmContactRow[];
  company: CrmCompanyRow | null;
}

export function getDeal(userId: string, id: string): DealDetail | null {
  const db = getDb();
  const deal = db
    .prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(id, userId) as CrmDealRow | undefined;
  if (!deal) return null;
  const stage =
    (db.prepare('SELECT * FROM crm_stages WHERE id = ?').get(deal.stage_id) as
      | CrmStageRow
      | undefined) ?? null;
  const pipeline =
    (db.prepare('SELECT * FROM crm_pipelines WHERE id = ?').get(deal.pipeline_id) as
      | CrmPipelineRow
      | undefined) ?? null;
  const contacts = db
    .prepare(
      `SELECT c.* FROM crm_contacts c
       JOIN crm_deal_contacts dc ON dc.contact_id = c.id
       WHERE dc.deal_id = ?
       ORDER BY dc.rowid ASC`,
    )
    .all(id) as CrmContactRow[];
  // Empresa del deal = la del contacto primario (primero vinculado).
  const company =
    contacts.length && contacts[0].company_id
      ? (db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(contacts[0].company_id) as
          | CrmCompanyRow
          | undefined) ?? null
      : null;
  return { deal, stage, pipeline, contacts, company };
}

export interface DealInput {
  pipelineId?: string;
  stageId?: string;
  name?: string;
  amount?: number;
  currency?: string;
  closeDate?: string | null;
  priority?: string;
  source?: string;
  description?: string;
  lostReason?: string;
  custom?: Record<string, unknown>;
  contactIds?: string[];
}

export type CreateDealResult =
  | { ok: true; deal: CrmDealRow }
  | { ok: false; reason: 'invalid_pipeline' | 'invalid_stage' };

function stageInPipeline(stageId: string, pipelineId: string): CrmStageRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM crm_stages WHERE id = ? AND pipeline_id = ?')
      .get(stageId, pipelineId) as CrmStageRow | undefined) ?? null
  );
}

function setDealContacts(dealId: string, contactIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM crm_deal_contacts WHERE deal_id = ?').run(dealId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)',
  );
  for (const contactId of contactIds) insert.run(dealId, contactId);
}

export function createDeal(userId: string, data: DealInput): CreateDealResult {
  const db = getDb();
  if (!data.pipelineId || !getOwnedPipeline(userId, data.pipelineId)) {
    return { ok: false, reason: 'invalid_pipeline' };
  }
  if (!data.stageId || !stageInPipeline(data.stageId, data.pipelineId)) {
    return { ok: false, reason: 'invalid_stage' };
  }
  const id = crypto.randomUUID();
  const maxPos = (
    db
      .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM crm_deals WHERE stage_id = ?')
      .get(data.stageId) as { m: number }
  ).m;
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO crm_deals
         (id, user_id, pipeline_id, stage_id, name, amount, currency, close_date, priority,
          source, description, lost_reason, position, custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      data.pipelineId!,
      data.stageId!,
      data.name ?? '',
      data.amount ?? 0,
      data.currency ?? 'USD',
      data.closeDate ?? null,
      data.priority ?? 'medium',
      data.source ?? '',
      data.description ?? '',
      data.lostReason ?? '',
      maxPos + 1024,
      JSON.stringify(data.custom ?? {}),
      ts,
      ts,
    );
    if (data.contactIds?.length) setDealContacts(id, data.contactIds);
  });
  tx();
  return { ok: true, deal: db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(id) as CrmDealRow };
}

const DEAL_COLS: Record<string, string> = {
  name: 'name',
  amount: 'amount',
  currency: 'currency',
  closeDate: 'close_date',
  priority: 'priority',
  source: 'source',
  description: 'description',
  lostReason: 'lost_reason',
  custom: 'custom',
};

export function updateDeal(userId: string, id: string, data: DealInput): CrmDealRow | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets = toColumnValues(DEAL_COLS, data as Record<string, unknown>);
  const setSql = sets.map(([c]) => `${c} = ?`).join(', ');
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE crm_deals SET ${setSql ? `${setSql}, ` : ''}updated_at = ? WHERE id = ?`,
    ).run(...sets.map(([, v]) => v), now(), id);
    if (data.contactIds) setDealContacts(id, data.contactIds);
  });
  tx();
  return db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(id) as CrmDealRow;
}

export function deleteDeal(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM crm_deals WHERE id = ? AND user_id = ?').run(id, userId).changes >
    0
  );
}

export type MoveDealResult =
  | { ok: true; deal: CrmDealRow }
  | { ok: false; reason: 'not_found' | 'invalid_stage' };

/**
 * Mueve un deal a otro stage del mismo pipeline.
 * - position: mediana entre vecinos; al final max+1024; al principio min/2.
 * - Semántica de cierre: stage is_won → closed_at=now y lost_reason='';
 *   stage is_lost → closed_at=now (lost_reason solo si vino lostReason);
 *   stage abierto → closed_at=NULL y lost_reason=''.
 */
export function moveDeal(
  userId: string,
  id: string,
  stageId: string,
  beforeId?: string | null,
  lostReason?: string,
): MoveDealResult {
  const db = getDb();
  const deal = db
    .prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(id, userId) as CrmDealRow | undefined;
  if (!deal) return { ok: false, reason: 'not_found' };
  const stage = stageInPipeline(stageId, deal.pipeline_id);
  if (!stage) return { ok: false, reason: 'invalid_stage' };

  // Vecinos en el stage destino (sin el deal que se mueve), ordenados por position.
  const siblings = db
    .prepare('SELECT id, position FROM crm_deals WHERE stage_id = ? AND id != ? ORDER BY position ASC')
    .all(stageId, id) as Array<{ id: string; position: number }>;

  let position: number;
  const beforeIdx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  if (beforeIdx > 0) {
    position = (siblings[beforeIdx - 1].position + siblings[beforeIdx].position) / 2;
  } else if (beforeIdx === 0) {
    position = siblings[0].position / 2;
  } else {
    // Al final (o beforeId inválido → se interpreta como append).
    position = siblings.length ? siblings[siblings.length - 1].position + 1024 : 1024;
  }

  const ts = now();
  let closedAt: string | null;
  let newLostReason: string;
  if (stage.is_won) {
    closedAt = ts;
    newLostReason = '';
  } else if (stage.is_lost) {
    closedAt = ts;
    newLostReason = lostReason !== undefined ? lostReason : deal.lost_reason;
  } else {
    closedAt = null;
    newLostReason = '';
  }

  db.prepare(
    `UPDATE crm_deals
     SET stage_id = ?, position = ?, closed_at = ?, lost_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).run(stageId, position, closedAt, newLostReason, ts, id);
  return { ok: true, deal: db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(id) as CrmDealRow };
}

// ============================================================
// ACTIVITIES
// ============================================================

export interface ActivityInput {
  type?: ActivityType;
  subject?: string;
  body?: string;
  dueAt?: string | null;
  direction?: string;
  outcome?: string;
  durationMin?: number | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export type ActivityListRow = CrmActivityRow & {
  contact_name: string | null;
  company_name: string | null;
  deal_name: string | null;
};

const ACTIVITY_SELECT = `
  SELECT a.*,
    NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name,
    co.name AS company_name,
    d.name AS deal_name
  FROM crm_activities a
  LEFT JOIN crm_contacts c ON c.id = a.contact_id
  LEFT JOIN crm_companies co ON co.id = a.company_id
  LEFT JOIN crm_deals d ON d.id = a.deal_id
`;

export function createActivity(userId: string, data: ActivityInput): CrmActivityRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO crm_activities
       (id, user_id, type, subject, body, due_at, direction, outcome, duration_min,
        contact_id, company_id, deal_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    data.type ?? 'note',
    data.subject ?? '',
    data.body ?? '',
    data.dueAt ?? null,
    data.direction ?? '',
    data.outcome ?? '',
    data.durationMin ?? null,
    data.contactId ?? null,
    data.companyId ?? null,
    data.dealId ?? null,
    ts,
    ts,
  );
  return db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(id) as CrmActivityRow;
}

export function updateActivity(
  userId: string,
  id: string,
  data: ActivityInput & { done?: boolean },
): CrmActivityRow | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(id, userId) as CrmActivityRow | undefined;
  if (!existing) return null;

  const sets: Array<[string, string | number | null]> = [];
  if (data.type !== undefined) sets.push(['type', data.type]);
  if (data.subject !== undefined) sets.push(['subject', data.subject]);
  if (data.body !== undefined) sets.push(['body', data.body]);
  if (data.dueAt !== undefined) sets.push(['due_at', data.dueAt]);
  if (data.direction !== undefined) sets.push(['direction', data.direction]);
  if (data.outcome !== undefined) sets.push(['outcome', data.outcome]);
  if (data.durationMin !== undefined) sets.push(['duration_min', data.durationMin]);
  if (data.contactId !== undefined) sets.push(['contact_id', data.contactId]);
  if (data.companyId !== undefined) sets.push(['company_id', data.companyId]);
  if (data.dealId !== undefined) sets.push(['deal_id', data.dealId]);
  if (data.done !== undefined) {
    sets.push(['done', data.done ? 1 : 0]);
    // done → done_at=now; undone → done_at NULL.
    sets.push(['done_at', data.done ? now() : null]);
  }
  sets.push(['updated_at', now()]);
  db.prepare(
    `UPDATE crm_activities SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
  ).run(...sets.map(([, v]) => v), id);
  return db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(id) as CrmActivityRow;
}

export function deleteActivity(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM crm_activities WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}

export interface TimelineFilter {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  type?: ActivityType;
  limit?: number;
}

/** Timeline de un registro (contacto, empresa o deal), más reciente primero. */
export function listTimeline(userId: string, f: TimelineFilter): ActivityListRow[] {
  const db = getDb();
  const where: string[] = ['a.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.contactId) {
    where.push('a.contact_id = ?');
    args.push(f.contactId);
  }
  if (f.companyId) {
    where.push('a.company_id = ?');
    args.push(f.companyId);
  }
  if (f.dealId) {
    where.push('a.deal_id = ?');
    args.push(f.dealId);
  }
  if (f.type) {
    where.push('a.type = ?');
    args.push(f.type);
  }
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  return db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(a.due_at, a.created_at) DESC, a.created_at DESC
       LIMIT ?`,
    )
    .all(...args, limit) as ActivityListRow[];
}

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'done';

export function listTasks(userId: string, bucket: TaskBucket): ActivityListRow[] {
  const db = getDb();
  const { start, end } = todayRange();
  let cond: string;
  const args: Array<string | number> = [userId];
  switch (bucket) {
    case 'overdue':
      cond = 'a.done = 0 AND a.due_at IS NOT NULL AND a.due_at < ?';
      args.push(start);
      break;
    case 'today':
      cond = 'a.done = 0 AND a.due_at >= ? AND a.due_at <= ?';
      args.push(start, end);
      break;
    case 'upcoming':
      cond = 'a.done = 0 AND (a.due_at IS NULL OR a.due_at > ?)';
      args.push(end);
      break;
    case 'done':
      cond = 'a.done = 1';
      break;
  }
  const order =
    bucket === 'done'
      ? 'a.done_at DESC, a.updated_at DESC'
      : 'a.due_at IS NULL, a.due_at ASC, a.created_at DESC';
  return db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = ? AND a.type = 'task' AND ${cond}
       ORDER BY ${order}`,
    )
    .all(...args) as ActivityListRow[];
}

// ============================================================
// LISTS
// ============================================================

/** Filtro JSON de una lista dinámica (subset de ContactFilter). */
export interface ListFilterJson {
  q?: string;
  lifecycle?: string;
  leadStatus?: string;
  source?: string;
}

function parseListFilter(json: string): ListFilterJson {
  const raw = parseJsonObject(json);
  const out: ListFilterJson = {};
  if (typeof raw.q === 'string') out.q = raw.q;
  if (typeof raw.lifecycle === 'string') out.lifecycle = raw.lifecycle;
  if (typeof raw.leadStatus === 'string') out.leadStatus = raw.leadStatus;
  if (typeof raw.source === 'string') out.source = raw.source;
  return out;
}

function countDynamicList(userId: string, filter: ListFilterJson): number {
  const { where, args } = buildContactWhere(userId, filter);
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM crm_contacts c WHERE ${where}`)
      .get(...args) as { c: number }
  ).c;
}

export interface ListWithCount extends CrmListRow {
  memberCount: number;
}

export function listLists(userId: string): ListWithCount[] {
  const db = getDb();
  const lists = db
    .prepare('SELECT * FROM crm_lists WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId) as CrmListRow[];
  const countStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM crm_list_members WHERE list_id = ?',
  );
  return lists.map((list) => ({
    ...list,
    memberCount:
      list.kind === 'dynamic'
        ? countDynamicList(userId, parseListFilter(list.filter))
        : (countStmt.get(list.id) as { c: number }).c,
  }));
}

export interface ListDetail {
  list: CrmListRow;
  members: ContactListRow[];
  memberCount: number;
}

export function getList(userId: string, id: string): ListDetail | null {
  const db = getDb();
  const list = db
    .prepare('SELECT * FROM crm_lists WHERE id = ? AND user_id = ?')
    .get(id, userId) as CrmListRow | undefined;
  if (!list) return null;
  if (list.kind === 'dynamic') {
    // Evalúa el filtro con el mismo WHERE builder de listContacts.
    const { where, args } = buildContactWhere(userId, parseListFilter(list.filter));
    const members = db
      .prepare(
        `SELECT c.*, co.name AS company_name
         FROM crm_contacts c
         LEFT JOIN crm_companies co ON co.id = c.company_id
         WHERE ${where}
         ORDER BY ${CONTACT_ORDER.newest}
         LIMIT 500`,
      )
      .all(...args) as ContactListRow[];
    return { list, members, memberCount: members.length };
  }
  const members = db
    .prepare(
      `SELECT c.*, co.name AS company_name
       FROM crm_contacts c
       JOIN crm_list_members m ON m.contact_id = c.id
       LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE m.list_id = ?
       ORDER BY c.created_at DESC`,
    )
    .all(id) as ContactListRow[];
  return { list, members, memberCount: members.length };
}

export interface ListInput {
  name?: string;
  entity?: string;
  kind?: 'static' | 'dynamic';
  filter?: ListFilterJson;
}

export function createList(userId: string, data: ListInput): CrmListRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO crm_lists (id, user_id, name, entity, kind, filter) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    userId,
    data.name ?? '',
    data.entity ?? 'contacts',
    data.kind ?? 'static',
    JSON.stringify(data.filter ?? {}),
  );
  return db.prepare('SELECT * FROM crm_lists WHERE id = ?').get(id) as CrmListRow;
}

export function updateList(userId: string, id: string, data: ListInput): CrmListRow | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM crm_lists WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets: Array<[string, string]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.entity !== undefined) sets.push(['entity', data.entity]);
  if (data.kind !== undefined) sets.push(['kind', data.kind]);
  if (data.filter !== undefined) sets.push(['filter', JSON.stringify(data.filter)]);
  if (sets.length) {
    db.prepare(`UPDATE crm_lists SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...sets.map(([, v]) => v),
      id,
    );
  }
  return db.prepare('SELECT * FROM crm_lists WHERE id = ?').get(id) as CrmListRow;
}

export function deleteList(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM crm_lists WHERE id = ? AND user_id = ?').run(id, userId).changes >
    0
  );
}

export function addListMembers(listId: string, contactIds: string[]): number {
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO crm_list_members (list_id, contact_id) VALUES (?, ?)',
  );
  let added = 0;
  const tx = db.transaction(() => {
    for (const contactId of contactIds) added += insert.run(listId, contactId).changes;
  });
  tx();
  return added;
}

export function removeListMember(listId: string, contactId: string): boolean {
  return (
    getDb()
      .prepare('DELETE FROM crm_list_members WHERE list_id = ? AND contact_id = ?')
      .run(listId, contactId).changes > 0
  );
}

// ============================================================
// SAVED VIEWS
// ============================================================

export function listSavedViews(userId: string, entity: string): CrmSavedViewRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM crm_saved_views WHERE user_id = ? AND entity = ? ORDER BY created_at ASC',
    )
    .all(userId, entity) as CrmSavedViewRow[];
}

export function createSavedView(
  userId: string,
  data: { entity: string; name: string; query?: Record<string, unknown> },
): CrmSavedViewRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO crm_saved_views (id, user_id, entity, name, query) VALUES (?, ?, ?, ?, ?)',
  ).run(id, userId, data.entity, data.name, JSON.stringify(data.query ?? {}));
  return db.prepare('SELECT * FROM crm_saved_views WHERE id = ?').get(id) as CrmSavedViewRow;
}

export function deleteSavedView(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM crm_saved_views WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}

// ============================================================
// CUSTOM FIELDS
// ============================================================

export function listCustomFields(userId: string, entity?: string): CrmCustomFieldRow[] {
  const db = getDb();
  if (entity) {
    return db
      .prepare(
        'SELECT * FROM crm_custom_fields WHERE user_id = ? AND entity = ? ORDER BY position ASC, label ASC',
      )
      .all(userId, entity) as CrmCustomFieldRow[];
  }
  return db
    .prepare('SELECT * FROM crm_custom_fields WHERE user_id = ? ORDER BY entity ASC, position ASC')
    .all(userId) as CrmCustomFieldRow[];
}

export interface CustomFieldInput {
  entity?: string;
  name?: string;
  label?: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options?: string[];
  position?: number;
}

export function createCustomField(userId: string, data: CustomFieldInput): CrmCustomFieldRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO crm_custom_fields (id, user_id, entity, name, label, type, options, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    data.entity ?? 'contacts',
    data.name ?? '',
    data.label ?? '',
    data.type ?? 'text',
    JSON.stringify(data.options ?? []),
    data.position ?? 0,
  );
  return db.prepare('SELECT * FROM crm_custom_fields WHERE id = ?').get(id) as CrmCustomFieldRow;
}

export function updateCustomField(
  userId: string,
  id: string,
  data: CustomFieldInput,
): CrmCustomFieldRow | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM crm_custom_fields WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets: Array<[string, string | number]> = [];
  if (data.entity !== undefined) sets.push(['entity', data.entity]);
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.label !== undefined) sets.push(['label', data.label]);
  if (data.type !== undefined) sets.push(['type', data.type]);
  if (data.options !== undefined) sets.push(['options', JSON.stringify(data.options)]);
  if (data.position !== undefined) sets.push(['position', data.position]);
  if (sets.length) {
    db.prepare(
      `UPDATE crm_custom_fields SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ).run(...sets.map(([, v]) => v), id);
  }
  return db.prepare('SELECT * FROM crm_custom_fields WHERE id = ?').get(id) as CrmCustomFieldRow;
}

export function deleteCustomField(userId: string, id: string): boolean {
  return (
    getDb()
      .prepare('DELETE FROM crm_custom_fields WHERE id = ? AND user_id = ?')
      .run(id, userId).changes > 0
  );
}

// ============================================================
// IMPORT / EXPORT
// ============================================================

export interface MappedContactRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  leadStatus?: string;
  source?: string;
}

export interface MappedCompanyRow {
  name?: string;
  domain?: string;
  industry?: string;
  employees?: number | null;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
}

export type ImportMode = 'skip' | 'update';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function recordImport(
  userId: string,
  entity: string,
  result: ImportResult,
): void {
  getDb()
    .prepare(
      `INSERT INTO crm_imports (id, user_id, entity, total, created, updated, skipped, errors)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      userId,
      entity,
      result.total,
      result.created,
      result.updated,
      result.skipped,
      JSON.stringify(result.errors),
    );
}

/**
 * Importa contactos con dedupe por lower(email).
 * - email existente → mode 'update' actualiza los campos provistos; mode 'skip' lo salta.
 * - email vacío → siempre crea (no hay clave para deduplicar).
 * - email inválido → no se importa; queda en errors.
 * Todo en una transacción; graba el resumen en crm_imports.
 */
export function importContacts(
  userId: string,
  rows: MappedContactRow[],
  mode: ImportMode,
): ImportResult {
  const db = getDb();
  const result: ImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const findByEmail = db.prepare(
    'SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = lower(?) LIMIT 1',
  );

  const tx = db.transaction(() => {
    rows.forEach((row, i) => {
      const email = (row.email ?? '').trim();
      if (email && !EMAIL_RE.test(email)) {
        result.errors.push(`Row ${i + 1}: invalid email "${email}"`);
        return;
      }
      const existing = email ? (findByEmail.get(userId, email) as { id: string } | undefined) : undefined;
      if (existing) {
        if (mode === 'skip') {
          result.skipped++;
        } else {
          updateContact(userId, existing.id, { ...row, email });
          result.updated++;
        }
        return;
      }
      createContact(userId, { ...row, email });
      result.created++;
    });
    recordImport(userId, 'contacts', result);
  });
  tx();
  return result;
}

/** Importa empresas con dedupe por lower(domain). Misma semántica que importContacts. */
export function importCompanies(
  userId: string,
  rows: MappedCompanyRow[],
  mode: ImportMode,
): ImportResult {
  const db = getDb();
  const result: ImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const findByDomain = db.prepare(
    `SELECT id FROM crm_companies WHERE user_id = ? AND domain != '' AND lower(domain) = lower(?) LIMIT 1`,
  );

  const tx = db.transaction(() => {
    rows.forEach((row, i) => {
      if (!(row.name ?? '').trim() && !(row.domain ?? '').trim()) {
        result.errors.push(`Row ${i + 1}: missing name and domain`);
        return;
      }
      const domain = (row.domain ?? '').trim();
      const existing = domain
        ? (findByDomain.get(userId, domain) as { id: string } | undefined)
        : undefined;
      if (existing) {
        if (mode === 'skip') {
          result.skipped++;
        } else {
          updateCompany(userId, existing.id, { ...row, domain });
          result.updated++;
        }
        return;
      }
      createCompany(userId, { ...row, domain });
      result.created++;
    });
    recordImport(userId, 'companies', result);
  });
  tx();
  return result;
}

export type ExportEntity = 'contacts' | 'companies' | 'deals' | 'activities';

/** Todas las filas del usuario para export (sin auth extra: lo maneja la ruta). */
export function exportRows(
  userId: string,
  entity: ExportEntity,
): Array<CrmContactRow | CrmCompanyRow | CrmDealRow | CrmActivityRow> {
  const db = getDb();
  switch (entity) {
    case 'contacts':
      return db
        .prepare('SELECT * FROM crm_contacts WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as CrmContactRow[];
    case 'companies':
      return db
        .prepare('SELECT * FROM crm_companies WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as CrmCompanyRow[];
    case 'deals':
      return db
        .prepare('SELECT * FROM crm_deals WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as CrmDealRow[];
    case 'activities':
      return db
        .prepare('SELECT * FROM crm_activities WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as CrmActivityRow[];
  }
}

// ============================================================
// OVERVIEW / REPORTS
// ============================================================

export interface FunnelStage {
  id: string;
  name: string;
  probability: number;
  is_won: 0 | 1;
  is_lost: 0 | 1;
  count: number;
  amount: number;
}

export interface WonLostMonth {
  month: string; // 'YYYY-MM'
  won: number;
  lost: number;
}

export interface CrmOverview {
  totalContacts: number;
  openDealsCount: number;
  openDealsAmount: number;
  forecastWeighted: number;
  wonThisMonth: { count: number; amount: number };
  tasksDueToday: number;
  funnel: FunnelStage[];
  wonLostByMonth: WonLostMonth[];
  recentActivities: ActivityListRow[];
  upcomingTasks: ActivityListRow[];
}

function defaultPipelineId(userId: string): string | null {
  const row = getDb()
    .prepare('SELECT id FROM crm_pipelines WHERE user_id = ? ORDER BY position ASC LIMIT 1')
    .get(userId) as { id: string } | undefined;
  return row?.id ?? null;
}

function funnelForPipeline(userId: string, pipelineId: string | null): FunnelStage[] {
  if (!pipelineId) return [];
  return getDb()
    .prepare(
      `SELECT s.id, s.name, s.probability, s.is_won, s.is_lost,
         COUNT(d.id) AS count, COALESCE(SUM(d.amount), 0) AS amount
       FROM crm_stages s
       LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ?
       WHERE s.pipeline_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC`,
    )
    .all(userId, pipelineId) as FunnelStage[];
}

/** Últimos 6 meses (incluido el actual) con conteo de deals won/lost por closed_at. */
function wonLostByMonth(userId: string): WonLostMonth[] {
  const db = getDb();
  const months: string[] = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(
      `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  const rows = db
    .prepare(
      `SELECT substr(d.closed_at, 1, 7) AS month,
         SUM(CASE WHEN s.is_won = 1 THEN 1 ELSE 0 END) AS won,
         SUM(CASE WHEN s.is_lost = 1 THEN 1 ELSE 0 END) AS lost
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND d.closed_at IS NOT NULL AND substr(d.closed_at, 1, 7) >= ?
       GROUP BY month`,
    )
    .all(userId, months[0]) as Array<{ month: string; won: number; lost: number }>;
  const map = new Map(rows.map((r) => [r.month, r]));
  return months.map((month) => ({
    month,
    won: map.get(month)?.won ?? 0,
    lost: map.get(month)?.lost ?? 0,
  }));
}

export function getCrmOverview(userId: string): CrmOverview {
  const db = getDb();
  const { start, end } = todayRange();
  const month = start.slice(0, 7);

  const totalContacts = (
    db.prepare('SELECT COUNT(*) AS c FROM crm_contacts WHERE user_id = ?').get(userId) as {
      c: number;
    }
  ).c;

  const open = db
    .prepare(
      'SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS a FROM crm_deals WHERE user_id = ? AND closed_at IS NULL',
    )
    .get(userId) as { c: number; a: number };

  const forecastWeighted = (
    db
      .prepare(
        `SELECT COALESCE(SUM(d.amount * s.probability / 100.0), 0) AS f
         FROM crm_deals d
         JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND d.closed_at IS NULL`,
      )
      .get(userId) as { f: number }
  ).f;

  const wonThisMonth = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(d.amount), 0) AS a
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND s.is_won = 1 AND substr(d.closed_at, 1, 7) = ?`,
    )
    .get(userId, month) as { c: number; a: number };

  const tasksDueToday = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM crm_activities
         WHERE user_id = ? AND type = 'task' AND done = 0 AND due_at >= ? AND due_at <= ?`,
      )
      .get(userId, start, end) as { c: number }
  ).c;

  const recentActivities = db
    .prepare(`${ACTIVITY_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 8`)
    .all(userId) as ActivityListRow[];

  const upcomingTasks = db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = ? AND a.type = 'task' AND a.done = 0
       ORDER BY a.due_at IS NULL, a.due_at ASC, a.created_at DESC
       LIMIT 6`,
    )
    .all(userId) as ActivityListRow[];

  return {
    totalContacts,
    openDealsCount: open.c,
    openDealsAmount: open.a,
    forecastWeighted,
    wonThisMonth: { count: wonThisMonth.c, amount: wonThisMonth.a },
    tasksDueToday,
    funnel: funnelForPipeline(userId, defaultPipelineId(userId)),
    wonLostByMonth: wonLostByMonth(userId),
    recentActivities,
    upcomingTasks,
  };
}

export interface CrmReports {
  funnel: FunnelStage[];
  forecastByStage: Array<{
    id: string;
    name: string;
    probability: number;
    count: number;
    amount: number;
    forecast: number;
  }>;
  wonLostByMonth: WonLostMonth[];
  dealsBySource: Array<{ source: string; count: number; amount: number }>;
  contactsByLifecycle: Array<{ lifecycle: string; count: number }>;
  activitiesByType: Array<{ type: string; count: number }>;
  avgDaysToClose: number | null;
}

export function getCrmReports(userId: string): CrmReports {
  const db = getDb();
  const pipelineId = defaultPipelineId(userId);

  const forecastByStage = pipelineId
    ? (db
        .prepare(
          `SELECT s.id, s.name, s.probability,
             COUNT(d.id) AS count,
             COALESCE(SUM(d.amount), 0) AS amount,
             COALESCE(SUM(d.amount * s.probability / 100.0), 0) AS forecast
           FROM crm_stages s
           LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ? AND d.closed_at IS NULL
           WHERE s.pipeline_id = ?
           GROUP BY s.id
           ORDER BY s.position ASC`,
        )
        .all(userId, pipelineId) as CrmReports['forecastByStage'])
    : [];

  const dealsBySource = db
    .prepare(
      `SELECT COALESCE(NULLIF(source, ''), 'other') AS source,
         COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
       FROM crm_deals
       WHERE user_id = ?
       GROUP BY source
       ORDER BY amount DESC`,
    )
    .all(userId) as CrmReports['dealsBySource'];

  const contactsByLifecycle = db
    .prepare(
      `SELECT lifecycle_stage AS lifecycle, COUNT(*) AS count
       FROM crm_contacts
       WHERE user_id = ?
       GROUP BY lifecycle_stage
       ORDER BY count DESC`,
    )
    .all(userId) as CrmReports['contactsByLifecycle'];

  const activitiesByType = db
    .prepare(
      `SELECT type, COUNT(*) AS count
       FROM crm_activities
       WHERE user_id = ?
       GROUP BY type
       ORDER BY count DESC`,
    )
    .all(userId) as CrmReports['activitiesByType'];

  const avg = db
    .prepare(
      `SELECT AVG(julianday(d.closed_at) - julianday(d.created_at)) AS days
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at IS NOT NULL`,
    )
    .get(userId) as { days: number | null };

  return {
    funnel: funnelForPipeline(userId, pipelineId),
    forecastByStage,
    wonLostByMonth: wonLostByMonth(userId),
    dealsBySource,
    contactsByLifecycle,
    activitiesByType,
    avgDaysToClose: avg.days === null ? null : Math.round(avg.days * 10) / 10,
  };
}

// ============================================================
// SEARCH
// ============================================================

export interface SearchResults {
  contacts: CrmContactRow[];
  companies: CrmCompanyRow[];
  deals: CrmDealRow[];
}

/** Búsqueda global: top 5 por entidad. */
export function searchAll(userId: string, q: string): SearchResults {
  const db = getDb();
  const like = `%${escapeLike(q)}%`;
  const contacts = db
    .prepare(
      `SELECT * FROM crm_contacts
       WHERE user_id = ? AND (first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
       ORDER BY created_at DESC
       LIMIT 5`,
    )
    .all(userId, like, like, like) as CrmContactRow[];
  const companies = db
    .prepare(
      `SELECT * FROM crm_companies
       WHERE user_id = ? AND (name LIKE ? ESCAPE '\\' OR domain LIKE ? ESCAPE '\\')
       ORDER BY created_at DESC
       LIMIT 5`,
    )
    .all(userId, like, like) as CrmCompanyRow[];
  const deals = db
    .prepare(
      `SELECT * FROM crm_deals
       WHERE user_id = ? AND name LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC
       LIMIT 5`,
    )
    .all(userId, like) as CrmDealRow[];
  return { contacts, companies, deals };
}
