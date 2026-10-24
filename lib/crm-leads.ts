/**
 * CRM — objeto Lead separado del contacto (como los leads de HubSpot Sales
 * Hub). Server-only.
 *
 * Un lead es una oportunidad de prospección todavía no calificada: tiene
 * owner, etapa del pipeline de leads (crm_lead_stages, con tipo abierto,
 * calificado o descalificado), contacto y empresa asociados, fuente, campos
 * propios (entidad 'leads') y su timeline. Calificado, se convierte en deal
 * (el deal hereda contacto, empresa, owner y fuente). El lifecycle y el lead
 * status del contacto siguen como estaban: son otra cosa.
 */
import { getDb, type CrmLeadRow, type CrmLeadStageRow, type Db } from './db';
import { createDeal, listPipelinesWithStages } from './crm';
import { assertRefs, CrmRefError } from './crm-refs';
import { ownerScopeSql, type OwnerScope } from './crm-visibility';
import { SOURCES } from './crm-constants';

export const LEAD_STAGE_KINDS = ['open', 'qualified', 'disqualified'] as const;
export type LeadStageKind = (typeof LEAD_STAGE_KINDS)[number];

/** Etapas con las que arranca un workspace (las de HubSpot). */
export const DEFAULT_LEAD_STAGES: Array<{ key: string; kind: LeadStageKind }> = [
  { key: 'new', kind: 'open' },
  { key: 'attempting', kind: 'open' },
  { key: 'connected', kind: 'open' },
  { key: 'qualified', kind: 'qualified' },
  { key: 'disqualified', kind: 'disqualified' },
];

const DEFAULT_NAMES: Record<string, string> = {
  new: 'New',
  attempting: 'Attempting',
  connected: 'Connected',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
};

export const LEAD_SOURCES = SOURCES;

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// ---------- Etapas ----------

/**
 * Etapas del workspace; la primera vez siembra las de HubSpot con `names`
 * (traducidas por la página que las pide) o en inglés.
 */
export async function ensureLeadStages(
  workspaceId: string,
  names: Partial<Record<string, string>> = {},
  db: Db = getDb(),
): Promise<CrmLeadStageRow[]> {
  const rows = await listLeadStages(workspaceId, db);
  if (rows.length) return rows;
  for (const [i, s] of DEFAULT_LEAD_STAGES.entries()) {
    // id determinístico: dos requests a la vez no siembran dos veces.
    await db
      .prepare('INSERT OR IGNORE INTO crm_lead_stages (id, user_id, name, position, kind) VALUES (?, ?, ?, ?, ?)')
      .run(`${workspaceId}:lead:${s.key}`, workspaceId, names[s.key] || DEFAULT_NAMES[s.key], i, s.kind);
  }
  return listLeadStages(workspaceId, db);
}

export async function listLeadStages(workspaceId: string, db: Db = getDb()): Promise<CrmLeadStageRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_lead_stages WHERE user_id = ? ORDER BY position ASC, name ASC')
    .all(workspaceId)) as CrmLeadStageRow[];
}

async function getStage(workspaceId: string, id: string, db: Db): Promise<CrmLeadStageRow | null> {
  return ((await db.prepare('SELECT * FROM crm_lead_stages WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmLeadStageRow
    | undefined) ?? null;
}

export async function createLeadStage(
  workspaceId: string,
  data: { name: string; kind?: LeadStageKind },
  db: Db = getDb(),
): Promise<CrmLeadStageRow> {
  await ensureLeadStages(workspaceId, {}, db);
  const max = (await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM crm_lead_stages WHERE user_id = ?')
    .get(workspaceId)) as { m: number };
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_lead_stages (id, user_id, name, position, kind) VALUES (?, ?, ?, ?, ?)')
    .run(id, workspaceId, data.name, max.m + 1, data.kind ?? 'open');
  return (await getStage(workspaceId, id, db))!;
}

export async function updateLeadStage(
  workspaceId: string,
  id: string,
  data: { name?: string; kind?: LeadStageKind; position?: number },
  db: Db = getDb(),
): Promise<CrmLeadStageRow | null> {
  if (!(await getStage(workspaceId, id, db))) return null;
  const sets: Array<[string, string | number]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.kind !== undefined) sets.push(['kind', data.kind]);
  if (data.position !== undefined) sets.push(['position', data.position]);
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_lead_stages SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...sets.map(([, v]) => v), id);
  }
  return getStage(workspaceId, id, db);
}

export type DeleteLeadStageResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_empty' | 'last' };

export async function deleteLeadStage(workspaceId: string, id: string, db: Db = getDb()): Promise<DeleteLeadStageResult> {
  if (!(await getStage(workspaceId, id, db))) return { ok: false, reason: 'not_found' };
  const used = await db.prepare('SELECT 1 FROM crm_leads WHERE stage_id = ? AND user_id = ? LIMIT 1').get(id, workspaceId);
  if (used) return { ok: false, reason: 'not_empty' };
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM crm_lead_stages WHERE user_id = ?').get(workspaceId)) as { n: number };
  if (count.n <= 1) return { ok: false, reason: 'last' };
  await db.prepare('DELETE FROM crm_lead_stages WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return { ok: true };
}

// ---------- Leads ----------

export type LeadListRow = CrmLeadRow & {
  stage_name: string | null;
  stage_kind: LeadStageKind | null;
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
  company_domain: string | null;
  owner_name: string | null;
  deal_name: string | null;
  last_activity_at: string | null;
};

const LEAD_SELECT = `
  SELECT l.*, s.name AS stage_name, s.kind AS stage_kind,
    NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name, c.email AS contact_email,
    co.name AS company_name, co.domain AS company_domain, u.name AS owner_name, d.name AS deal_name,
    (SELECT MAX(CASE WHEN a.type = 'task' THEN a.done_at ELSE a.created_at END) FROM crm_activities a WHERE a.lead_id = l.id) AS last_activity_at
  FROM crm_leads l
  LEFT JOIN crm_lead_stages s ON s.id = l.stage_id
  LEFT JOIN crm_contacts c ON c.id = l.contact_id
  LEFT JOIN crm_companies co ON co.id = l.company_id
  LEFT JOIN users u ON u.id = l.owner_id
  LEFT JOIN crm_deals d ON d.id = l.deal_id
`;

export interface LeadFilter {
  q?: string;
  stageId?: string;
  /** Solo abiertos (sin convertir ni descalificar). */
  status?: 'open' | 'qualified' | 'disqualified';
  owner?: string;
  contactId?: string;
  companyId?: string;
  ownerScope?: OwnerScope;
  sort?: 'newest' | 'oldest' | 'name' | 'last_activity';
  page?: number;
  pageSize?: number;
}

const LEAD_ORDER: Record<NonNullable<LeadFilter['sort']>, string> = {
  newest: 'l.created_at DESC, l.id',
  oldest: 'l.created_at ASC, l.id',
  name: 'l.name COLLATE NOCASE ASC, l.id',
  last_activity: 'last_activity_at IS NULL, last_activity_at DESC, l.created_at DESC',
};

function leadWhere(workspaceId: string, f: LeadFilter): { where: string; args: Array<string | number> } {
  const where: string[] = ['l.user_id = ?'];
  const args: Array<string | number> = [workspaceId];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(
      `(l.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR co.name LIKE ? ESCAPE '\\'
        OR (COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE ? ESCAPE '\\')`,
    );
    args.push(like, like, like, like);
  }
  if (f.stageId) {
    where.push('l.stage_id = ?');
    args.push(f.stageId);
  }
  if (f.status) {
    where.push('s.kind = ?');
    args.push(f.status);
  }
  if (f.owner) {
    where.push('l.owner_id = ?');
    args.push(f.owner);
  }
  if (f.contactId) {
    where.push('l.contact_id = ?');
    args.push(f.contactId);
  }
  if (f.companyId) {
    where.push('l.company_id = ?');
    args.push(f.companyId);
  }
  const scope = ownerScopeSql('l', f.ownerScope);
  if (scope.sql) {
    where.push(scope.sql);
    args.push(...scope.args);
  }
  return { where: where.join(' AND '), args };
}

export async function listLeads(
  workspaceId: string,
  f: LeadFilter = {},
  db: Db = getDb(),
): Promise<{ rows: LeadListRow[]; total: number }> {
  const { where, args } = leadWhere(workspaceId, f);
  const total = ((await db
    .prepare(
      `SELECT COUNT(*) AS n FROM crm_leads l
       LEFT JOIN crm_lead_stages s ON s.id = l.stage_id
       LEFT JOIN crm_contacts c ON c.id = l.contact_id
       LEFT JOIN crm_companies co ON co.id = l.company_id
       WHERE ${where}`,
    )
    .get(...args)) as { n: number }).n;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const rows = (await db
    .prepare(`${LEAD_SELECT} WHERE ${where} ORDER BY ${LEAD_ORDER[f.sort ?? 'newest'] ?? LEAD_ORDER.newest} LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize)) as LeadListRow[];
  return { rows, total };
}

export interface LeadBoardStage extends CrmLeadStageRow {
  leads: LeadListRow[];
  count: number;
}

/** Board por etapa (hasta 100 leads por columna, por posición). */
export async function listLeadsForBoard(
  workspaceId: string,
  f: Pick<LeadFilter, 'q' | 'owner' | 'ownerScope'> = {},
  db: Db = getDb(),
): Promise<LeadBoardStage[]> {
  const stages = await ensureLeadStages(workspaceId, {}, db);
  return Promise.all(
    stages.map(async (s) => {
      const { where, args } = leadWhere(workspaceId, { ...f, stageId: s.id });
      const leads = (await db
        .prepare(`${LEAD_SELECT} WHERE ${where} ORDER BY l.position ASC, l.created_at DESC LIMIT 100`)
        .all(...args)) as LeadListRow[];
      const count = ((await db
        .prepare(
          `SELECT COUNT(*) AS n FROM crm_leads l LEFT JOIN crm_lead_stages s ON s.id = l.stage_id
           LEFT JOIN crm_contacts c ON c.id = l.contact_id LEFT JOIN crm_companies co ON co.id = l.company_id WHERE ${where}`,
        )
        .get(...args)) as { n: number }).n;
      return { ...s, leads, count };
    }),
  );
}

export async function getLead(workspaceId: string, id: string, db: Db = getDb()): Promise<LeadListRow | null> {
  return ((await db.prepare(`${LEAD_SELECT} WHERE l.id = ? AND l.user_id = ?`).get(id, workspaceId)) as
    | LeadListRow
    | undefined) ?? null;
}

export interface LeadInput {
  name?: string;
  ownerId?: string | null;
  stageId?: string;
  contactId?: string | null;
  companyId?: string | null;
  source?: string;
  disqualifyReason?: string;
  custom?: Record<string, unknown>;
}

/** Nombre por defecto: el del contacto, o el de la empresa. */
async function defaultName(workspaceId: string, data: LeadInput, db: Db): Promise<string> {
  if (data.contactId) {
    const c = (await db
      .prepare('SELECT first_name, last_name, email FROM crm_contacts WHERE id = ? AND user_id = ?')
      .get(data.contactId, workspaceId)) as { first_name: string; last_name: string; email: string } | undefined;
    const n = c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email : '';
    if (n) return n;
  }
  if (data.companyId) {
    const co = (await db.prepare('SELECT name FROM crm_companies WHERE id = ? AND user_id = ?').get(data.companyId, workspaceId)) as
      | { name: string }
      | undefined;
    if (co?.name) return co.name;
  }
  return '';
}

export async function createLead(workspaceId: string, data: LeadInput, db: Db = getDb()): Promise<CrmLeadRow> {
  await assertRefs(workspaceId, { contactId: data.contactId, companyId: data.companyId, ownerId: data.ownerId }, db);
  const stages = await ensureLeadStages(workspaceId, {}, db);
  let stageId = data.stageId;
  if (stageId && !stages.some((s) => s.id === stageId)) throw new CrmRefError('invalid_stage');
  stageId ??= (stages.find((s) => s.kind === 'open') ?? stages[0]).id;
  const name = (data.name ?? '').trim() || (await defaultName(workspaceId, data, db));
  if (!name) throw new CrmRefError('missing_name');
  const id = crypto.randomUUID();
  const ts = now();
  const min = (await db
    .prepare('SELECT COALESCE(MIN(position), 0) AS m FROM crm_leads WHERE stage_id = ?')
    .get(stageId)) as { m: number };
  await db
    .prepare(
      `INSERT INTO crm_leads (id, user_id, owner_id, name, stage_id, position, contact_id, company_id, source, custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      data.ownerId ?? null,
      name,
      stageId,
      min.m - 1,
      data.contactId ?? null,
      data.companyId ?? null,
      data.source ?? '',
      JSON.stringify(data.custom ?? {}),
      ts,
      ts,
    );
  return (await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id)) as CrmLeadRow;
}

export async function updateLead(
  workspaceId: string,
  id: string,
  data: LeadInput & { position?: number },
  db: Db = getDb(),
): Promise<CrmLeadRow | null> {
  const existing = (await db.prepare('SELECT * FROM crm_leads WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmLeadRow
    | undefined;
  if (!existing) return null;
  await assertRefs(workspaceId, { contactId: data.contactId, companyId: data.companyId, ownerId: data.ownerId }, db);
  if (data.stageId && !(await getStage(workspaceId, data.stageId, db))) throw new CrmRefError('invalid_stage');
  const sets: Array<[string, string | number | null]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.ownerId !== undefined) sets.push(['owner_id', data.ownerId]);
  if (data.stageId !== undefined) sets.push(['stage_id', data.stageId]);
  if (data.contactId !== undefined) sets.push(['contact_id', data.contactId]);
  if (data.companyId !== undefined) sets.push(['company_id', data.companyId]);
  if (data.source !== undefined) sets.push(['source', data.source]);
  if (data.disqualifyReason !== undefined) sets.push(['disqualify_reason', data.disqualifyReason]);
  if (data.custom !== undefined) sets.push(['custom', JSON.stringify(data.custom)]);
  if (data.position !== undefined) sets.push(['position', data.position]);
  else if (data.stageId !== undefined && data.stageId !== existing.stage_id) {
    // Cambio de etapa sin posición: arriba de la columna nueva.
    const min = (await db
      .prepare('SELECT COALESCE(MIN(position), 0) AS m FROM crm_leads WHERE stage_id = ?')
      .get(data.stageId)) as { m: number };
    sets.push(['position', min.m - 1]);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_leads SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), now(), id);
  }
  return (await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id)) as CrmLeadRow;
}

export async function deleteLead(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const ok = (await db.prepare('DELETE FROM crm_leads WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
  if (ok) await db.prepare('DELETE FROM crm_activities WHERE user_id = ? AND lead_id = ?').run(workspaceId, id);
  return ok;
}

export interface ConvertLeadInput {
  pipelineId?: string;
  stageId?: string;
  dealName?: string;
  amount?: number;
  currency?: string;
  closeDate?: string | null;
}

export type ConvertLeadResult =
  | { ok: true; dealId: string }
  | { ok: false; reason: 'not_found' | 'already_converted' | 'invalid_pipeline' | 'invalid_stage' };

/**
 * Convierte el lead en deal: el deal lleva contacto, empresa, owner y fuente
 * del lead, y el lead queda calificado con el link al deal.
 */
export async function convertLead(
  workspaceId: string,
  id: string,
  data: ConvertLeadInput = {},
  db: Db = getDb(),
): Promise<ConvertLeadResult> {
  const lead = (await db.prepare('SELECT * FROM crm_leads WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmLeadRow
    | undefined;
  if (!lead) return { ok: false, reason: 'not_found' };
  if (lead.deal_id) return { ok: false, reason: 'already_converted' };
  let pipelineId = data.pipelineId;
  let stageId = data.stageId;
  if (!pipelineId || !stageId) {
    const pipelines = await listPipelinesWithStages(workspaceId);
    const p = pipelines.find((x) => x.id === pipelineId) ?? pipelines[0];
    if (!p) return { ok: false, reason: 'invalid_pipeline' };
    pipelineId = p.id;
    stageId ??= p.stages.find((s) => !s.is_won && !s.is_lost)?.id ?? p.stages[0]?.id;
  }
  const source = (LEAD_SOURCES as readonly string[]).includes(lead.source) ? lead.source : undefined;
  const res = await createDeal(workspaceId, {
    pipelineId,
    stageId,
    name: (data.dealName ?? '').trim() || lead.name,
    amount: data.amount ?? 0,
    currency: data.currency,
    closeDate: data.closeDate ?? null,
    ownerId: lead.owner_id,
    source,
    contactIds: lead.contact_id ? [lead.contact_id] : [],
    companyId: lead.company_id,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const stages = await ensureLeadStages(workspaceId, {}, db);
  const qualified = stages.find((s) => s.kind === 'qualified');
  await db
    .prepare(`UPDATE crm_leads SET deal_id = ?, converted_at = ?, stage_id = ?, updated_at = ? WHERE id = ?`)
    .run(res.deal.id, now(), qualified?.id ?? lead.stage_id, now(), id);
  return { ok: true, dealId: res.deal.id };
}

/** Cmd+K: leads por nombre, contacto o empresa. */
export async function searchLeads(workspaceId: string, q: string, ownerScope?: OwnerScope, limit = 8): Promise<LeadListRow[]> {
  return (await listLeads(workspaceId, { q, ownerScope, pageSize: limit })).rows;
}
