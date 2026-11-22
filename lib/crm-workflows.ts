/**
 * CRM Workflows — motor de automatizaciones con triggers y acciones.
 * Server-only.
 */
import { localized } from './notification-copy';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createNotification } from './notifications';
import { safeFetch } from './safe-fetch';
import { sendEmail } from './email';
import { crossesThreshold } from './crm-scoring-schema';
import { randomBytes } from 'node:crypto';
import { open, seal } from './secret-box';
import { signPayload } from './webhooks';
import { normalizeRole, roleAtLeast, type TeamRole } from './teams';
import { ownerScopeFor, canSeeEntity, type OwnerScope } from './crm-visibility';
import { hiddenFieldsFor, redactCustomJson } from './crm-field-perms';
import { visibleRecordIds } from './crm-record-scope';
import {
  BRANCH_OPS,
  MAX_ENROLLMENTS_PER_DAY,
  MAX_RUN_STEPS,
  STUCK_RUN_MINUTES,
  addMinutes,
  dbTime,
  delayMinutes,
  parseWorkflowSettings,
  pickRotation,
  propertyChangeMatches,
  safeWebhookHeaders,
  triggerValueCondition,
  webhookBody,
  type EnrollCondition,
  type WorkflowSettings,
} from './crm-workflow-rules';
import {
  createActivity,
  createDeal,
  addListMembers,
  removeListMember,
  updateContact,
  updateCompany,
  updateDeal,
  type ActivityType,
} from './crm';
import {
  ensureMigrated,
  getClient,
  getDb,
  txDb,
  type CrmWorkflowRow,
  type CrmWorkflowTriggerRow,
  type CrmWorkflowActionRow,
  type CrmWorkflowRunRow,
  type CrmEmailRow,
  type Db,
} from './db';

// ---------- Tipos públicos ----------

export const TRIGGER_TYPES = [
  'contact_created',
  'contact_updated',
  'company_created',
  'company_updated',
  'deal_created',
  'deal_updated',
  'deal_stage_changed',
  'deal_won',
  'deal_lost',
  'task_due',
  'email_received',
  'email_opened',
  'email_clicked',
  'meeting_booked',
  'quote_accepted',
  'form_submitted',
  'score_changed',
  'manual',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const ACTION_TYPES = [
  'send_email',
  'create_task',
  'create_activity',
  'update_field',
  'add_to_list',
  'webhook',
  'notify_user',
  'enroll_in_sequence',
  'run_flow',
  'branch',
  'ai_step',
  'delay',
  'rotate_owner',
  'create_deal',
  'remove_from_list',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Disparadores "registro actualizado": aceptan una propiedad (y un valor) en la config. */
export const PROPERTY_TRIGGERS: readonly TriggerType[] = ['contact_updated', 'company_updated', 'deal_updated'];

export interface WorkflowTriggerInput {
  id?: string;
  type: TriggerType;
  config?: Record<string, unknown>;
  position?: number;
}

export interface WorkflowActionInput {
  id?: string;
  type: ActionType;
  config?: Record<string, unknown>;
  position?: number;
}

export interface WorkflowInput {
  name: string;
  enabled?: boolean;
  triggers: WorkflowTriggerInput[];
  actions: WorkflowActionInput[];
  settings?: Partial<WorkflowSettings>;
}

export interface WorkflowTrigger {
  id: string;
  type: TriggerType;
  config: Record<string, unknown>;
  position: number;
}

export interface WorkflowAction {
  id: string;
  type: ActionType;
  config: Record<string, unknown>;
  position: number;
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  settings: WorkflowSettings;
  triggers: WorkflowTrigger[];
  actions: WorkflowAction[];
}

export interface WorkflowEvent {
  type: TriggerType;
  entity: 'contact' | 'company' | 'deal' | 'task' | 'email';
  entityId: string;
  payload?: Record<string, unknown>;
}

// ---------- Helpers ----------

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function parseJsonObject(json: string | null): Record<string, unknown> {
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

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function toDbBool(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

/**
 * Fila → Workflow con las columnas una por una: el secreto del webhook y el
 * cursor de rotación nunca salen (antes se copiaba la fila entera).
 */
function rowToWorkflow(row: CrmWorkflowRow): Workflow {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    settings: parseWorkflowSettings(row.settings ?? '{}'),
    triggers: [],
    actions: [],
  };
}

/** Ajustes a guardar: lo que vino encima de lo que había (o de los de un workflow nuevo). */
function settingsJson(base: WorkflowSettings, patch: Partial<WorkflowSettings> | undefined): string {
  const merged = parseWorkflowSettings({ ...base, ...(patch ?? {}) });
  return JSON.stringify(merged);
}

/** Posiciones 0..n-1 en el orden pedido: la espera reanuda por posición y no puede haber repetidas. */
function ordered<T extends { position?: number }>(items: T[]): T[] {
  return items
    .map((x, i) => ({ x, k: x.position ?? i, i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(({ x }) => x);
}

// ---------- Data layer ----------

export async function listWorkflows(userId: string): Promise<Workflow[]> {
  const db = getDb();
  const rows = (await db
    .prepare('SELECT * FROM crm_workflows WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)) as CrmWorkflowRow[];

  const triggerRows = (await db
    .prepare(
      `SELECT * FROM crm_workflow_triggers
       WHERE workflow_id IN (SELECT id FROM crm_workflows WHERE user_id = ?)
       ORDER BY workflow_id, position ASC`,
    )
    .all(userId)) as CrmWorkflowTriggerRow[];

  const actionRows = (await db
    .prepare(
      `SELECT * FROM crm_workflow_actions
       WHERE workflow_id IN (SELECT id FROM crm_workflows WHERE user_id = ?)
       ORDER BY workflow_id, position ASC`,
    )
    .all(userId)) as CrmWorkflowActionRow[];

  const triggersByWorkflow = new Map<string, WorkflowTrigger[]>();
  const actionsByWorkflow = new Map<string, WorkflowAction[]>();

  for (const t of triggerRows) {
    const list = triggersByWorkflow.get(t.workflow_id) ?? [];
    list.push({ id: t.id, type: t.type as TriggerType, config: parseJsonObject(t.config), position: t.position });
    triggersByWorkflow.set(t.workflow_id, list);
  }
  for (const a of actionRows) {
    const list = actionsByWorkflow.get(a.workflow_id) ?? [];
    list.push({ id: a.id, type: a.type as ActionType, config: parseJsonObject(a.config), position: a.position });
    actionsByWorkflow.set(a.workflow_id, list);
  }

  return rows.map((row) => ({
    ...rowToWorkflow(row),
    triggers: triggersByWorkflow.get(row.id) ?? [],
    actions: actionsByWorkflow.get(row.id) ?? [],
  }));
}

export async function getWorkflow(userId: string, id: string): Promise<Workflow | null> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM crm_workflows WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmWorkflowRow | undefined;
  if (!row) return null;

  const triggerRows = (await db
    .prepare('SELECT * FROM crm_workflow_triggers WHERE workflow_id = ? ORDER BY position ASC')
    .all(id)) as CrmWorkflowTriggerRow[];
  const actionRows = (await db
    .prepare('SELECT * FROM crm_workflow_actions WHERE workflow_id = ? ORDER BY position ASC')
    .all(id)) as CrmWorkflowActionRow[];

  return {
    ...rowToWorkflow(row),
    triggers: triggerRows.map((t) => ({
      id: t.id,
      type: t.type as TriggerType,
      config: parseJsonObject(t.config),
      position: t.position,
    })),
    actions: actionRows.map((a) => ({
      id: a.id,
      type: a.type as ActionType,
      config: parseJsonObject(a.config),
      position: a.position,
    })),
  };
}

export async function createWorkflow(userId: string, data: WorkflowInput, actorId?: string): Promise<Workflow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    await tdb
      .prepare(
        'INSERT INTO crm_workflows (id, user_id, name, enabled, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, data.name, toDbBool(data.enabled ?? true), settingsJson(parseWorkflowSettings({}), data.settings), ts, ts);

    const insTrigger = tdb.prepare(
      'INSERT INTO crm_workflow_triggers (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [i, t] of ordered(data.triggers).entries()) {
      await insTrigger.run(
        crypto.randomUUID(),
        id,
        t.type,
        JSON.stringify(t.config ?? {}),
        i,
      );
    }

    const insAction = tdb.prepare(
      'INSERT INTO crm_workflow_actions (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [i, a] of ordered(data.actions).entries()) {
      await insAction.run(
        crypto.randomUUID(),
        id,
        a.type,
        JSON.stringify(a.config ?? {}),
        i,
      );
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  if (actorId) {
    // Autores (130): sirven para pausar sus workflows con webhooks si sale del workspace.
    await getDb().prepare('UPDATE crm_workflows SET created_by = ?, updated_by = ? WHERE id = ?').run(actorId, actorId, id).catch(() => undefined);
  }
  return (await getWorkflow(userId, id))!;
}

export async function updateWorkflow(
  userId: string,
  id: string,
  data: Partial<WorkflowInput>,
  actorId?: string,
): Promise<Workflow | null> {
  const db = getDb();
  const existing = (await db
    .prepare('SELECT id, settings FROM crm_workflows WHERE id = ? AND user_id = ?')
    .get(id, userId)) as { id: string; settings: string | null } | undefined;
  if (!existing) return null;

  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    if (data.name !== undefined || data.enabled !== undefined || data.settings !== undefined) {
      const sets: Array<[string, string | number]> = [];
      if (data.name !== undefined) sets.push(['name', data.name]);
      if (data.enabled !== undefined) sets.push(['enabled', toDbBool(data.enabled)]);
      if (data.settings !== undefined) sets.push(['settings', settingsJson(parseWorkflowSettings(existing.settings ?? '{}'), data.settings)]);
      sets.push(['updated_at', now()]);
      await tdb
        .prepare(`UPDATE crm_workflows SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...sets.map(([, v]) => v), id);
    }

    if (data.triggers) {
      await tdb.prepare('DELETE FROM crm_workflow_triggers WHERE workflow_id = ?').run(id);
      const insTrigger = tdb.prepare(
        'INSERT INTO crm_workflow_triggers (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
      );
      for (const [i, t] of ordered(data.triggers).entries()) {
        await insTrigger.run(
          crypto.randomUUID(),
          id,
          t.type,
          JSON.stringify(t.config ?? {}),
          i,
        );
      }
    }

    if (data.actions) {
      await tdb.prepare('DELETE FROM crm_workflow_actions WHERE workflow_id = ?').run(id);
      const insAction = tdb.prepare(
        'INSERT INTO crm_workflow_actions (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
      );
      for (const [i, a] of ordered(data.actions).entries()) {
        await insAction.run(
          crypto.randomUUID(),
          id,
          a.type,
          JSON.stringify(a.config ?? {}),
          i,
        );
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  if (actorId) {
    // Autores (130): sirven para pausar sus workflows con webhooks si sale del workspace.
    await getDb().prepare('UPDATE crm_workflows SET updated_by = ?, created_by = COALESCE(created_by, ?) WHERE id = ?').run(actorId, actorId, id).catch(() => undefined);
  }
  return getWorkflow(userId, id);
}

export async function deleteWorkflow(userId: string, id: string): Promise<boolean> {
  return (
    (await getDb().prepare('DELETE FROM crm_workflows WHERE id = ? AND user_id = ?').run(id, userId))
      .changes > 0
  );
}

export async function toggleWorkflow(
  userId: string,
  id: string,
  enabled: boolean,
): Promise<Workflow | null> {
  const db = getDb();
  const existing = (await db
    .prepare('SELECT id FROM crm_workflows WHERE id = ? AND user_id = ?')
    .get(id, userId)) as { id: string } | undefined;
  if (!existing) return null;
  await db
    .prepare('UPDATE crm_workflows SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(toDbBool(enabled), now(), id);
  return getWorkflow(userId, id);
}

export async function listWorkflowRuns(
  userId: string,
  workflowId?: string,
  limit = 50,
): Promise<CrmWorkflowRunRow[]> {
  const db = getDb();
  const where = workflowId ? 'WHERE r.user_id = ? AND r.workflow_id = ?' : 'WHERE r.user_id = ?';
  const args: Array<string | number> = workflowId ? [userId, workflowId] : [userId];
  return (await db
    .prepare(
      `SELECT r.* FROM crm_workflow_runs r
       ${where}
       ORDER BY r.started_at DESC, r.rowid DESC
       LIMIT ?`,
    )
    .all(...args, Math.min(Math.max(limit, 1), 200))) as CrmWorkflowRunRow[];
}

// ---------- Historial de inscripciones (lo que ve cada persona) ----------

type RecordEntity = 'contact' | 'company' | 'deal';
const RECORD_TABLE: Record<RecordEntity, 'crm_contacts' | 'crm_companies' | 'crm_deals'> = {
  contact: 'crm_contacts',
  company: 'crm_companies',
  deal: 'crm_deals',
};

function isRecordEntity(v: string): v is RecordEntity {
  return v === 'contact' || v === 'company' || v === 'deal';
}

/** Una inscripción como la ve la UI: sin la salida de las acciones (valores, textos de IA, respuestas). */
export interface WorkflowRunView {
  id: string;
  status: CrmWorkflowRunRow['status'];
  started_at: string;
  finished_at: string | null;
  resume_at: string | null;
  ok: number;
  total: number;
  record: { entity: RecordEntity; id: string; label: string } | null;
}

function runCounts(output: string | null): { ok: number; total: number } {
  try {
    const parsed = JSON.parse(output || '{}') as { results?: Array<{ ok?: boolean }> };
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return { ok: results.filter((r) => r.ok).length, total: results.length };
  } catch {
    return { ok: 0, total: 0 };
  }
}

async function recordLabels(workspaceId: string, entity: RecordEntity, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  const sql =
    entity === 'contact'
      ? `SELECT id, COALESCE(NULLIF(trim(first_name || ' ' || last_name), ''), email) AS label FROM crm_contacts WHERE user_id = ? AND id IN (${ph})`
      : `SELECT id, name AS label FROM ${RECORD_TABLE[entity]} WHERE user_id = ? AND id IN (${ph})`;
  const rows = (await getDb().prepare(sql).all(workspaceId, ...ids)) as Array<{ id: string; label: string | null }>;
  for (const r of rows) out.set(r.id, r.label ?? '');
  return out;
}

/**
 * Inscripciones de un workflow para la página del workflow. Con `scope`
 * (un miembro que no ve todo) solo salen las de registros que esa persona
 * ve, más las corridas manuales sin registro: nada de tareas o emails de
 * otros. Nunca sale la salida de las acciones.
 */
export async function listWorkflowRunViews(
  workspaceId: string,
  workflowId: string,
  scope: OwnerScope | undefined,
  limit = 20,
): Promise<WorkflowRunView[]> {
  const rows = await listWorkflowRuns(workspaceId, workflowId, scope ? 200 : limit);
  const byEntity: Record<RecordEntity, string[]> = { contact: [], company: [], deal: [] };
  for (const r of rows) if (isRecordEntity(r.trigger_entity) && r.trigger_entity_id) byEntity[r.trigger_entity].push(r.trigger_entity_id);
  const visible: Record<RecordEntity, Set<string>> = { contact: new Set(), company: new Set(), deal: new Set() };
  const labels: Record<RecordEntity, Map<string, string>> = { contact: new Map(), company: new Map(), deal: new Map() };
  for (const e of ['contact', 'company', 'deal'] as const) {
    visible[e] = await visibleRecordIds(workspaceId, RECORD_TABLE[e], byEntity[e], scope);
    labels[e] = await recordLabels(workspaceId, e, [...visible[e]]);
  }
  const out: WorkflowRunView[] = [];
  for (const r of rows) {
    const entity = r.trigger_entity;
    const hasRecord = isRecordEntity(entity) && !!r.trigger_entity_id;
    const seen = hasRecord && visible[entity as RecordEntity].has(r.trigger_entity_id);
    // Sin registro visible: un miembro con alcance no ve la corrida (salvo una manual, que no tiene registro).
    if (scope && !seen && r.trigger_entity_id) continue;
    out.push({
      id: r.id,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at,
      resume_at: r.status === 'waiting' ? r.resume_at ?? null : null,
      ...runCounts(r.output),
      record: seen ? { entity: entity as RecordEntity, id: r.trigger_entity_id, label: labels[entity as RecordEntity].get(r.trigger_entity_id) ?? '' } : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface RecordEnrollment {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: CrmWorkflowRunRow['status'];
  started_at: string;
  finished_at: string | null;
  resume_at: string | null;
}

/**
 * Historial de inscripciones de un registro (la ficha). Quien llama ya
 * comprobó que la persona ve el registro; acá solo salen el nombre del
 * workflow, el estado y las fechas.
 */
export async function listRecordEnrollments(
  workspaceId: string,
  entity: RecordEntity,
  recordId: string,
  limit = 20,
): Promise<RecordEnrollment[]> {
  return (await getDb()
    .prepare(
      `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.status, r.started_at, r.finished_at,
         CASE WHEN r.status = 'waiting' THEN r.resume_at END AS resume_at
       FROM crm_workflow_runs r JOIN crm_workflows w ON w.id = r.workflow_id AND w.user_id = r.user_id
       WHERE r.user_id = ? AND r.trigger_entity = ? AND r.trigger_entity_id = ?
       ORDER BY r.started_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(workspaceId, entity, recordId, Math.min(Math.max(limit, 1), 100))) as RecordEnrollment[];
}

/** Secreto de firma del webhook del workflow (lo crea la primera vez). Solo para owner/admin. */
export async function workflowWebhookSecret(workspaceId: string, workflowId: string): Promise<string | null> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT webhook_secret FROM crm_workflows WHERE id = ? AND user_id = ?')
    .get(workflowId, workspaceId)) as { webhook_secret: string | null } | undefined;
  if (!row) return null;
  // open devuelve '' si no se puede descifrar (otra clave): entonces se genera uno nuevo.
  const current = open(row.webhook_secret);
  if (current) return current;
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  // Compare-and-set: si dos corridas lo crean a la vez, gana una y las dos firman con ese.
  await db
    .prepare('UPDATE crm_workflows SET webhook_secret = ? WHERE id = ? AND user_id = ? AND webhook_secret IS ?')
    .run(seal(secret), workflowId, workspaceId, row.webhook_secret ?? null);
  const again = (await db.prepare('SELECT webhook_secret FROM crm_workflows WHERE id = ?').get(workflowId)) as
    | { webhook_secret: string | null }
    | undefined;
  return open(again?.webhook_secret) || secret;
}

/** Rol de una persona en el workspace (null si ya no es parte o es invitada). */
async function workspacePersonRole(workspaceId: string, personId: string): Promise<TeamRole | null> {
  if (personId === workspaceId) return 'owner';
  const row = (await getDb()
    .prepare(
      `SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest' LIMIT 1`,
    )
    .get(workspaceId, personId)) as { role: string } | undefined;
  return row ? normalizeRole(row.role) : null;
}

// ---------- Contexto y utilidades de acciones ----------

interface ContactCtx {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company_id: string | null;
  owner_id?: string | null;
  custom?: string;
}
interface CompanyCtx {
  id: string;
  name: string;
  domain?: string;
  owner_id?: string | null;
  custom?: string;
}
interface DealCtx {
  id: string;
  name: string;
  amount: number;
  currency: string;
  stage_id?: string;
  pipeline_id?: string;
  owner_id?: string | null;
  custom?: string;
}

interface ActionContext {
  contact?: ContactCtx | null;
  company?: CompanyCtx | null;
  deal?: DealCtx | null;
}

async function loadContext(userId: string, event: WorkflowEvent): Promise<ActionContext> {
  const ctx: ActionContext = {};
  if (event.entity === 'contact') {
    ctx.contact = (await getDb()
      .prepare('SELECT id, first_name, last_name, email, company_id, owner_id, custom FROM crm_contacts WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as ActionContext['contact'];
    if (ctx.contact?.company_id) {
      ctx.company = (await getDb()
        .prepare('SELECT id, name, domain, owner_id, custom FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(ctx.contact.company_id, userId)) as ActionContext['company'];
    }
  } else if (event.entity === 'company') {
    ctx.company = (await getDb()
      .prepare('SELECT id, name, domain, owner_id, custom FROM crm_companies WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as ActionContext['company'];
    ctx.contact = (await getDb()
      .prepare(
        'SELECT id, first_name, last_name, email, company_id, owner_id, custom FROM crm_contacts WHERE company_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1',
      )
      .get(event.entityId, userId)) as ActionContext['contact'];
  } else if (event.entity === 'deal') {
    ctx.deal = (await getDb()
      .prepare('SELECT id, name, amount, currency, stage_id, pipeline_id, owner_id, custom FROM crm_deals WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as ActionContext['deal'];
    ctx.contact = (await getDb()
      .prepare(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.company_id, c.owner_id, c.custom
         FROM crm_contacts c
         JOIN crm_deal_contacts dc ON dc.contact_id = c.id
         WHERE dc.deal_id = ? AND c.user_id = ?
         ORDER BY dc.rowid ASC LIMIT 1`,
      )
      .get(event.entityId, userId)) as ActionContext['contact'];
    // La empresa primaria del deal; si no tiene, la del contacto.
    const primary = (await getDb()
      .prepare('SELECT company_id FROM crm_deal_companies WHERE deal_id = ? AND is_primary = 1 LIMIT 1')
      .get(event.entityId)) as { company_id: string } | undefined;
    const companyId = primary?.company_id ?? ctx.contact?.company_id;
    if (companyId) {
      ctx.company = (await getDb()
        .prepare('SELECT id, name, domain, owner_id, custom FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(companyId, userId)) as ActionContext['company'];
    }
  } else if (event.entity === 'task') {
    const task = (await getDb()
      .prepare('SELECT contact_id, company_id, deal_id FROM crm_activities WHERE id = ? AND user_id = ? AND type = \'task\'')
      .get(event.entityId, userId)) as { contact_id: string | null; company_id: string | null; deal_id: string | null } | undefined;
    if (task?.contact_id) {
      ctx.contact = (await getDb()
        .prepare('SELECT id, first_name, last_name, email, company_id, owner_id, custom FROM crm_contacts WHERE id = ? AND user_id = ?')
        .get(task.contact_id, userId)) as ActionContext['contact'];
    }
    if (task?.company_id) {
      ctx.company = (await getDb()
        .prepare('SELECT id, name, domain, owner_id, custom FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(task.company_id, userId)) as ActionContext['company'];
    }
    if (task?.deal_id) {
      ctx.deal = (await getDb()
        .prepare('SELECT id, name, amount, currency, stage_id, pipeline_id, owner_id, custom FROM crm_deals WHERE id = ? AND user_id = ?')
        .get(task.deal_id, userId)) as ActionContext['deal'];
    }
  } else if (event.entity === 'email') {
    const email = (await getDb()
      .prepare('SELECT contact_id FROM crm_emails WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as { contact_id: string } | undefined;
    if (email?.contact_id) {
      ctx.contact = (await getDb()
        .prepare('SELECT id, first_name, last_name, email, company_id, owner_id, custom FROM crm_contacts WHERE id = ? AND user_id = ?')
        .get(email.contact_id, userId)) as ActionContext['contact'];
      if (ctx.contact?.company_id) {
        ctx.company = (await getDb()
          .prepare('SELECT id, name, domain, owner_id, custom FROM crm_companies WHERE id = ? AND user_id = ?')
          .get(ctx.contact.company_id, userId)) as ActionContext['company'];
      }
    }
  }
  return ctx;
}

function renderTemplate(template: string, ctx: ActionContext): string {
  const contact = ctx.contact ?? { first_name: '', last_name: '', email: '' };
  const company = ctx.company ?? { name: '' };
  const deal = ctx.deal ?? { name: '', amount: 0, currency: 'USD' };
  const fullName = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.email || '';

  const vars: Record<string, string> = {
    'contact.firstName': contact.first_name ?? '',
    'contact.lastName': contact.last_name ?? '',
    'contact.fullName': fullName,
    'contact.email': contact.email ?? '',
    'company.name': company.name ?? '',
    'deal.name': deal.name ?? '',
    'deal.amount': String(deal.amount ?? 0),
    'deal.currency': deal.currency ?? 'USD',
  };

  return template.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_match, key: string) => {
    const k = key.trim();
    if (k in vars) return vars[k];
    // Propiedades custom: {{contact.custom.<key>}}, {{company.custom.<key>}}, {{deal.custom.<key>}}.
    const m = /^(contact|company|deal)\.custom\.(\w+)$/.exec(k);
    if (m) {
      const record = ctx[m[1] as 'contact' | 'company' | 'deal'];
      const value = parseJsonObject(record?.custom ?? null)[m[2]];
      return value === undefined || value === null ? '' : String(value);
    }
    return '';
  });
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

async function resolveContactIdForEvent(userId: string, event: WorkflowEvent): Promise<string | null> {
  if (event.entity === 'contact') return event.entityId;
  if (event.entity === 'deal') {
    const row = (await getDb()
      .prepare(
        `SELECT dc.contact_id FROM crm_deal_contacts dc
         JOIN crm_deals d ON d.id = dc.deal_id
         WHERE dc.deal_id = ? AND d.user_id = ? ORDER BY dc.rowid ASC LIMIT 1`,
      )
      .get(event.entityId, userId)) as { contact_id: string } | undefined;
    return row?.contact_id ?? null;
  }
  if (event.entity === 'company') {
    const row = (await getDb()
      .prepare(
        'SELECT id FROM crm_contacts WHERE company_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1',
      )
      .get(event.entityId, userId)) as { id: string } | undefined;
    return row?.id ?? null;
  }
  if (event.entity === 'task') {
    const row = (await getDb()
      .prepare('SELECT contact_id FROM crm_activities WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as { contact_id: string | null } | undefined;
    return row?.contact_id ?? null;
  }
  if (event.entity === 'email') {
    const row = (await getDb()
      .prepare('SELECT contact_id FROM crm_emails WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as { contact_id: string } | undefined;
    return row?.contact_id ?? null;
  }
  return null;
}

/**
 * Nombre de campo de la UI ("lifecycle_stage" o "lifecycleStage") al de las
 * funciones de lib/crm (camelCase). Antes el snake_case del ejemplo del
 * editor se ignoraba sin avisar.
 */
export function apiFieldKey(field: string): string {
  return field.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

// ---------- Ejecución de acciones ----------

interface ActionResult {
  ok: boolean;
  type: ActionType;
  result?: unknown;
  error?: string;
}

/**
 * Registro principal del evento: el del evento si es contacto, empresa o
 * deal; para tareas y emails, el deal, el contacto o la empresa asociados.
 * Con `prefer` (config de la acción) el de ese tipo, si el evento lo trae.
 */
function primaryRecord(event: WorkflowEvent, ctx: ActionContext, prefer: string): { entity: RecordEntity; id: string } | null {
  const byEntity: Record<RecordEntity, string | undefined> = {
    contact: event.entity === 'contact' ? event.entityId : ctx.contact?.id,
    company: event.entity === 'company' ? event.entityId : ctx.company?.id,
    deal: event.entity === 'deal' ? event.entityId : ctx.deal?.id,
  };
  if (isRecordEntity(prefer) && byEntity[prefer]) return { entity: prefer, id: byEntity[prefer]! };
  if (isRecordEntity(event.entity) && event.entityId) return { entity: event.entity, id: event.entityId };
  for (const e of ['deal', 'contact', 'company'] as const) if (byEntity[e]) return { entity: e, id: byEntity[e]! };
  return null;
}

const FIELD_ENTITY_OF: Record<RecordEntity, 'contacts' | 'companies' | 'deals'> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
};

/** Campos propios con una regla "oculto" para alguien del workspace: nunca salen por webhook. */
async function hiddenForAnyone(workspaceId: string): Promise<Record<RecordEntity, Set<string>>> {
  const rows = (await getDb()
    .prepare(
      `SELECT f.entity, f.name FROM crm_field_permissions p JOIN crm_custom_fields f ON f.id = p.field_id
       WHERE p.user_id = ? AND f.user_id = ? AND p.access = 'hidden'`,
    )
    .all(workspaceId, workspaceId)) as Array<{ entity: string; name: string }>;
  const out: Record<RecordEntity, Set<string>> = { contact: new Set(), company: new Set(), deal: new Set() };
  for (const r of rows) {
    const e = (Object.keys(FIELD_ENTITY_OF) as RecordEntity[]).find((k) => FIELD_ENTITY_OF[k] === r.entity);
    if (e) out[e].add(r.name);
  }
  return out;
}

/**
 * El contexto como lo puede ver una persona: los registros que no ve
 * quedan afuera y los campos que tiene ocultos se sacan del custom. Así un
 * aviso con {{company.custom.x}} no le muestra nada que la ficha no le muestre.
 */
async function contextFor(workspaceId: string, personId: string, role: TeamRole, ctx: ActionContext): Promise<ActionContext | null> {
  const viewer = { workspaceId, personId, role };
  const scope = await ownerScopeFor(viewer);
  const out: ActionContext = {};
  for (const e of ['contact', 'company', 'deal'] as const) {
    const rec = ctx[e];
    if (!rec) continue;
    if (scope && !(await canSeeEntity(workspaceId, e, rec.id, scope))) continue;
    const hidden = await hiddenFieldsFor(viewer, FIELD_ENTITY_OF[e]);
    (out as Record<string, unknown>)[e] = { ...rec, custom: redactCustomJson(rec.custom ?? '{}', hidden) };
  }
  return out;
}

const RECORD_HREF: Record<RecordEntity, string> = { contact: 'contacts', company: 'companies', deal: 'deals' };

/**
 * Aviso interno: al dueño del workspace (como antes), al owner del registro
 * o a personas elegidas. Cada persona lo recibe solo si ve el registro del
 * evento, y el texto se arma con lo que esa persona puede ver.
 */
async function notifyRecipients(
  userId: string,
  workflowId: string,
  cfg: Record<string, unknown>,
  event: WorkflowEvent,
  ctx: ActionContext,
): Promise<ActionResult> {
  const message = safeString(cfg.message);
  const mode = safeString(cfg.recipients) || 'workspace';
  const record = primaryRecord(event, ctx, '');
  let people: string[] = [];
  if (mode === 'owner') {
    if (record) {
      const row = (await getDb()
        .prepare(`SELECT owner_id FROM ${RECORD_TABLE[record.entity]} WHERE id = ? AND user_id = ?`)
        .get(record.id, userId)) as { owner_id: string | null } | undefined;
      if (row?.owner_id) people = [row.owner_id];
    }
  } else if (mode === 'people') {
    people = Array.isArray(cfg.userIds) ? (cfg.userIds as unknown[]).map(safeString).filter(Boolean) : [];
  } else {
    people = [userId];
  }
  people = [...new Set(people)].slice(0, 25);
  let sent = 0;
  let skipped = 0;
  for (const personId of people) {
    const role = await workspacePersonRole(userId, personId);
    if (!role) {
      skipped++;
      continue;
    }
    const unrestricted = roleAtLeast(role, 'admin') || personId === userId;
    if (!unrestricted && record) {
      const scope = await ownerScopeFor({ workspaceId: userId, personId, role });
      if (scope && !(await canSeeEntity(userId, record.entity, record.id, scope))) {
        skipped++;
        continue;
      }
    }
    const view = unrestricted ? ctx : await contextFor(userId, personId, role, ctx);
    await createNotification({
      userId: personId,
      type: 'assigned',
      title: localized('workflowNotification'),
      body: renderTemplate(message, view ?? {}),
      sourceType: 'workflow',
      sourceId: workflowId,
      href: record ? `/app/crm/${RECORD_HREF[record.entity]}/${record.id}` : `/app/crm/workflows/${workflowId}`,
    });
    sent++;
  }
  if (!sent && people.length) return { ok: false, type: 'notify_user', error: 'no_recipient', result: { skipped } };
  return { ok: true, type: 'notify_user', result: { sent, skipped } };
}

async function executeAction(
  userId: string,
  workflowId: string,
  runId: string,
  action: WorkflowAction,
  event: WorkflowEvent,
  ctx: ActionContext,
): Promise<ActionResult> {
  const cfg = action.config;
  try {
    switch (action.type) {
      case 'send_email': {
        const toRaw = safeString(cfg.to);
        const subjectTemplate = safeString(cfg.subject);
        const bodyTemplate = safeString(cfg.body);
        // 'contact' = email del contacto; un email literal; o una plantilla
        // como {{contact.custom.billing_email}} que se resuelve con el contexto.
        let toEmail = toRaw === 'contact' ? ctx.contact?.email ?? '' : renderTemplate(toRaw, ctx).trim();
        if (!EMAIL_RE.test(toEmail)) toEmail = '';
        if (!toEmail) {
          return { ok: false, type: action.type, error: 'missing_recipient' };
        }
        const subject = renderTemplate(subjectTemplate, ctx);
        const text = renderTemplate(bodyTemplate, ctx);
        const res = await sendEmail({ to: toEmail, subject, text });
        return { ok: res.ok, type: action.type, result: res, error: res.error };
      }
      case 'create_task': {
        const subject = safeString(cfg.subject);
        const dueInDays = typeof cfg.dueInDays === 'number' ? cfg.dueInDays : 1;
        const dueAt = new Date();
        dueAt.setDate(dueAt.getDate() + dueInDays);
        const pad = (n: number) => String(n).padStart(2, '0');
        const dueAtStr = `${dueAt.getUTCFullYear()}-${pad(dueAt.getUTCMonth() + 1)}-${pad(dueAt.getUTCDate())} 00:00:00`;
        const task = await createActivity(userId, {
          type: 'task',
          subject,
          body: '',
          dueAt: dueAtStr,
          ownerId: typeof cfg.ownerId === 'string' ? cfg.ownerId : undefined,
          contactId: event.entity === 'contact' ? event.entityId : ctx.contact?.id ?? null,
          companyId: event.entity === 'company' ? event.entityId : ctx.contact?.company_id ?? null,
          dealId: event.entity === 'deal' ? event.entityId : null,
        });
        return { ok: true, type: action.type, result: { activityId: task.id } };
      }
      case 'create_activity': {
        const type = safeString(cfg.type) as ActivityType;
        const subject = safeString(cfg.subject);
        const body = safeString(cfg.body);
        const activity = await createActivity(userId, {
          type: type || 'note',
          subject,
          body,
          contactId: event.entity === 'contact' ? event.entityId : ctx.contact?.id ?? null,
          companyId: event.entity === 'company' ? event.entityId : ctx.contact?.company_id ?? null,
          dealId: event.entity === 'deal' ? event.entityId : null,
        });
        return { ok: true, type: action.type, result: { activityId: activity.id } };
      }
      case 'update_field': {
        const entity = safeString(cfg.entity) as 'contact' | 'company' | 'deal';
        const field = safeString(cfg.field);
        const value = cfg.value;
        if (!field) return { ok: false, type: action.type, error: 'missing_field' };
        const targetId =
          entity === event.entity
            ? event.entityId
            : entity === 'contact'
              ? ctx.contact?.id
              : entity === 'company'
                ? ctx.company?.id
                : entity === 'deal'
                  ? ctx.deal?.id
                  : undefined;
        if (!targetId) return { ok: false, type: action.type, error: 'missing_target' };

        if (field.startsWith('custom.')) {
          const customKey = field.slice(7);
          const row = (await getDb()
            .prepare(`SELECT custom FROM crm_${entity === 'company' ? 'companies' : `${entity}s`} WHERE id = ? AND user_id = ?`)
            .get(targetId, userId)) as { custom: string } | undefined;
          const custom = parseJsonObject(row?.custom ?? '{}');
          custom[customKey] = value;
          const updater =
            entity === 'contact'
              ? updateContact
              : entity === 'company'
                ? updateCompany
                : updateDeal;
          await updater(userId, targetId, { custom }, undefined, '');
        } else {
          const payload: Record<string, unknown> = { [apiFieldKey(field)]: value };
          const updater =
            entity === 'contact'
              ? updateContact
              : entity === 'company'
                ? updateCompany
                : updateDeal;
          await updater(userId, targetId, payload, undefined, '');
        }
        return { ok: true, type: action.type, result: { entity, field, value } };
      }
      case 'add_to_list': {
        const listId = safeString(cfg.listId);
        if (!listId) return { ok: false, type: action.type, error: 'missing_list' };
        const contactId = await resolveContactIdForEvent(userId, event);
        if (!contactId) return { ok: false, type: action.type, error: 'missing_contact' };
        const added = await addListMembers(userId, listId, [contactId]);
        return { ok: true, type: action.type, result: { added } };
      }
      case 'webhook': {
        const url = safeString(cfg.url);
        const methodRaw = safeString(cfg.method).toUpperCase() || 'POST';
        const method = ['POST', 'PUT', 'PATCH', 'GET'].includes(methodRaw) ? methodRaw : 'POST';
        if (!url) return { ok: false, type: action.type, error: 'missing_url' };
        // Sin los campos que alguien del workspace tiene ocultos, y firmado
        // como los webhooks de la API (zerosoft-signature: t=…,v1=HMAC).
        const body = webhookBody({
          workflowId,
          runId,
          event,
          records: {
            contact: ctx.contact as Record<string, unknown> | null | undefined,
            company: ctx.company as Record<string, unknown> | null | undefined,
            deal: ctx.deal as Record<string, unknown> | null | undefined,
          },
          hidden: await hiddenForAnyone(userId),
        });
        const secret = await workflowWebhookSecret(userId, workflowId);
        const headers: Record<string, string> = { ...safeWebhookHeaders(cfg.headers) };
        if (secret) headers['zerosoft-signature'] = signPayload(secret, body);
        const res = await safeFetch(url, method === 'GET' ? { method, headers } : { method, headers, body });
        return { ok: res.ok, type: action.type, result: { status: res.status } };
      }
      case 'notify_user':
        return await notifyRecipients(userId, workflowId, cfg, event, ctx);
      case 'delay':
        // Lo maneja el runner (deja la corrida esperando).
        return { ok: true, type: action.type };
      case 'rotate_owner': {
        const target = primaryRecord(event, ctx, safeString(cfg.entity));
        if (!target) return { ok: false, type: action.type, error: 'missing_target' };
        const pool = Array.isArray(cfg.ownerIds) ? (cfg.ownerIds as unknown[]).map(safeString).filter(Boolean) : [];
        const members: string[] = [];
        for (const p of [...new Set(pool)]) if (await workspacePersonRole(userId, p)) members.push(p);
        if (!members.length) return { ok: false, type: action.type, error: 'empty_pool' };
        const current = (await getDb()
          .prepare(`SELECT owner_id FROM ${RECORD_TABLE[target.entity]} WHERE id = ? AND user_id = ?`)
          .get(target.id, userId)) as { owner_id: string | null } | undefined;
        if (!current) return { ok: false, type: action.type, error: 'missing_target' };
        if (cfg.onlyUnowned === true && current.owner_id) return { ok: true, type: action.type, result: { skipped: 'owned' } };
        const { unavailablePeople } = await import('./crm-assignment');
        const away = await unavailablePeople(userId);
        let owner: string | null = null;
        // Cursor con compare-and-set: dos inscripciones a la vez no se llevan a la misma persona.
        for (let attempt = 0; attempt < 5 && !owner; attempt++) {
          const row = (await getDb().prepare('SELECT rr_cursor FROM crm_workflows WHERE id = ?').get(workflowId)) as
            | { rr_cursor: number | null }
            | undefined;
          const cursor = Number(row?.rr_cursor ?? 0);
          const pick = pickRotation(members, cursor, away);
          if (!pick) return { ok: false, type: action.type, error: 'nobody_available' };
          const moved = await getDb()
            .prepare('UPDATE crm_workflows SET rr_cursor = ? WHERE id = ? AND rr_cursor = ?')
            .run(pick.next, workflowId, cursor);
          if (moved.changes > 0) owner = pick.owner;
        }
        if (!owner) return { ok: false, type: action.type, error: 'busy' };
        const updater = target.entity === 'contact' ? updateContact : target.entity === 'company' ? updateCompany : updateDeal;
        await updater(userId, target.id, { ownerId: owner }, undefined, '');
        return { ok: true, type: action.type, result: { entity: target.entity, ownerId: owner } };
      }
      case 'create_deal': {
        const pipelineId = safeString(cfg.pipelineId);
        const stageId = safeString(cfg.stageId);
        const name = renderTemplate(safeString(cfg.name), ctx).trim().slice(0, 300);
        if (!name || !pipelineId || !stageId) return { ok: false, type: action.type, error: 'missing_field' };
        const amount = Number(cfg.amount);
        const source = primaryRecord(event, ctx, '');
        const ownerRow = source
          ? ((await getDb()
              .prepare(`SELECT owner_id FROM ${RECORD_TABLE[source.entity]} WHERE id = ? AND user_id = ?`)
              .get(source.id, userId)) as { owner_id: string | null } | undefined)
          : undefined;
        const res = await createDeal(userId, {
          name,
          pipelineId,
          stageId,
          amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
          ownerId: ownerRow?.owner_id ?? undefined,
          contactIds: ctx.contact?.id ? [ctx.contact.id] : [],
          companyId: ctx.company?.id ?? null,
        });
        if (!res.ok) return { ok: false, type: action.type, error: res.reason };
        return { ok: true, type: action.type, result: { dealId: res.deal.id } };
      }
      case 'remove_from_list': {
        const listId = safeString(cfg.listId);
        if (!listId) return { ok: false, type: action.type, error: 'missing_list' };
        const contactId = await resolveContactIdForEvent(userId, event);
        if (!contactId) return { ok: false, type: action.type, error: 'missing_contact' };
        const removed = await removeListMember(userId, listId, contactId);
        return { ok: true, type: action.type, result: { removed } };
      }
      case 'enroll_in_sequence': {
        const sequenceId = safeString(cfg.sequenceId);
        if (!sequenceId) return { ok: false, type: action.type, error: 'missing_sequence' };
        const contactId = await resolveContactIdForEvent(userId, event);
        if (!contactId) return { ok: false, type: action.type, error: 'missing_contact' };
        const { enrollContacts, defaultSenderFor } = await import('./crm-sequences');
        const senderId = safeString(cfg.senderId) || (await defaultSenderFor(userId, sequenceId, contactId));
        const res = await enrollContacts(userId, { sequenceId, contactIds: [contactId], senderId, enrolledBy: null });
        if (!res.ok) return { ok: false, type: action.type, error: res.error };
        if (!res.enrolled.length) return { ok: false, type: action.type, error: res.skipped[0]?.reason ?? 'not_enrolled' };
        return { ok: true, type: action.type, result: { enrolled: res.enrolled } };
      }
      case 'run_flow': {
        const flowId = safeString(cfg.flowId);
        if (!flowId) return { ok: false, type: action.type, error: 'missing_flow' };
        const { getFlowRow, enqueueRun, kickFlowWorker } = await import('./flow');
        const flow = await getFlowRow(userId, flowId);
        if (!flow) return { ok: false, type: action.type, error: 'flow_not_found' };
        const runId = await enqueueRun(flow, 'manual', {
          crm: { workflowId, event: { type: event.type, entity: event.entity, entityId: event.entityId, payload: event.payload ?? {} } },
          contact: ctx.contact ?? null,
          company: ctx.company ?? null,
          deal: ctx.deal ?? null,
        });
        if (!runId) return { ok: false, type: action.type, error: 'rate_limited' };
        kickFlowWorker();
        return { ok: true, type: action.type, result: { runId } };
      }
      case 'branch': {
        // Lo evalúa el runner (evaluateBranch); acá no hace nada.
        return { ok: true, type: action.type };
      }
      case 'ai_step': {
        // Paso de IA (lib/crm-ai.ts): corre un prompt, el resumen o el score
        // sobre el registro del evento y escribe el resultado en una nota o
        // un campo (por las mismas funciones que la UI, con historial).
        const { parseAiStepConfig, runAiStep } = await import('./crm-ai');
        const stepCfg = parseAiStepConfig(cfg);
        const entity: 'contact' | 'company' | 'deal' | null =
          event.entity === 'contact' || event.entity === 'company' || event.entity === 'deal'
            ? event.entity
            : ctx.deal?.id
              ? 'deal'
              : ctx.contact?.id
                ? 'contact'
                : null;
        const recordId =
          entity === event.entity ? event.entityId : entity === 'deal' ? ctx.deal?.id : entity === 'contact' ? ctx.contact?.id : undefined;
        if (!entity || !recordId) return { ok: false, type: action.type, error: 'missing_target' };
        const out = await runAiStep(userId, stepCfg, { entity, id: recordId });
        if (stepCfg.mode !== 'prompt') return { ok: true, type: action.type, result: { mode: stepCfg.mode, text: out.text.slice(0, 500) } };
        if (stepCfg.output === 'field') {
          if (!stepCfg.field) return { ok: false, type: action.type, error: 'missing_field' };
          const updater = entity === 'contact' ? updateContact : entity === 'company' ? updateCompany : updateDeal;
          if (stepCfg.field.startsWith('custom.')) {
            const row = (await getDb()
              .prepare(`SELECT custom FROM crm_${entity === 'company' ? 'companies' : `${entity}s`} WHERE id = ? AND user_id = ?`)
              .get(recordId, userId)) as { custom: string } | undefined;
            const custom = parseJsonObject(row?.custom ?? '{}');
            custom[stepCfg.field.slice(7)] = out.text;
            await updater(userId, recordId, { custom }, undefined, '');
          } else {
            await updater(userId, recordId, { [apiFieldKey(stepCfg.field)]: out.text.slice(0, 500) }, undefined, '');
          }
          return { ok: true, type: action.type, result: { field: stepCfg.field, text: out.text.slice(0, 500) } };
        }
        const note = await createActivity(userId, {
          type: 'note',
          subject: 'AI',
          body: out.text.slice(0, 5000),
          contactId: entity === 'contact' ? recordId : ctx.contact?.id ?? null,
          companyId: entity === 'company' ? recordId : ctx.contact?.company_id ?? null,
          dealId: entity === 'deal' ? recordId : null,
        });
        return { ok: true, type: action.type, result: { activityId: note.id, text: out.text.slice(0, 500) } };
      }
      default:
        return { ok: false, type: action.type, error: 'unknown_action' };
    }
  } catch (err) {
    return {
      ok: false,
      type: action.type,
      error: err instanceof Error ? err.message : 'action_error',
    };
  }
}

// ---------- Matching de triggers ----------

function triggerMatches(trigger: WorkflowTrigger, event: WorkflowEvent): boolean {
  if (trigger.type !== event.type) return false;
  if (event.type === 'deal_stage_changed') {
    const cfg = trigger.config;
    const from = safeString(cfg.fromStageId);
    const to = safeString(cfg.toStageId);
    const oldStage = safeString(event.payload?.oldStageId);
    const newStage = safeString(event.payload?.newStageId);
    if (from && from !== oldStage) return false;
    if (to && to !== newStage) return false;
  }
  if (event.type === 'form_submitted') {
    const formId = safeString(trigger.config.formId);
    if (formId && formId !== safeString(event.payload?.formId)) return false;
  }
  if (event.type === 'score_changed') {
    // Score elegido en el disparador; sin elegir, el principal (los workflows de antes).
    const wanted = safeString(trigger.config.scoreId);
    if (wanted ? wanted !== safeString(event.payload?.scoreId) : event.payload?.primary === false) return false;
    const raw = trigger.config.threshold;
    const threshold = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    const dir = safeString(trigger.config.direction);
    const direction = dir === 'down' || dir === 'any' ? dir : 'up';
    if (
      !crossesThreshold(
        Number(event.payload?.oldScore ?? 0),
        Number(event.payload?.newScore ?? 0),
        threshold !== null && Number.isFinite(threshold) ? threshold : null,
        direction,
      )
    ) {
      return false;
    }
  }
  // "Propiedad cambiada": registro actualizado con una propiedad elegida.
  if (PROPERTY_TRIGGERS.includes(event.type) && !propertyChangeMatches(trigger.config, event.payload)) return false;
  return true;
}

// ---------- If/else (acción branch) ----------

/**
 * Evalúa la condición de una acción `branch` sobre una propiedad del registro
 * (contacto, empresa o deal del evento; custom con 'custom.<key>').
 */
export async function evaluateBranch(
  userId: string,
  cfg: Record<string, unknown>,
  event: WorkflowEvent,
  ctx: ActionContext,
): Promise<boolean> {
  const entity = (safeString(cfg.entity) || 'contact') as 'contact' | 'company' | 'deal';
  const field = safeString(cfg.field);
  const op = (BRANCH_OPS as readonly string[]).includes(safeString(cfg.op)) ? safeString(cfg.op) : 'equals';
  const expected = safeString(cfg.value).trim().toLowerCase();
  const id =
    entity === event.entity ? event.entityId : entity === 'contact' ? ctx.contact?.id : entity === 'company' ? ctx.company?.id : ctx.deal?.id;
  if (!id || !field) return false;
  const table = entity === 'contact' ? 'crm_contacts' : entity === 'company' ? 'crm_companies' : 'crm_deals';
  const row = (await getDb().prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId)) as
    | Record<string, unknown>
    | undefined;
  if (!row) return false;
  let actualRaw: unknown;
  if (field.startsWith('custom.')) actualRaw = parseJsonObject((row.custom as string) ?? '{}')[field.slice(7)];
  else {
    const col = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    actualRaw = /^[a-z_]+$/.test(col) ? row[col] : undefined;
  }
  const actual = actualRaw === undefined || actualRaw === null ? '' : String(actualRaw).trim().toLowerCase();
  switch (op) {
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return expected !== '' && actual.includes(expected);
    case 'gt':
    case 'lt': {
      const a = Number(actual);
      const b = Number(expected);
      if (actual === '' || Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === 'gt' ? a > b : a < b;
    }
    case 'is_set':
      return actual !== '';
    case 'is_not_set':
      return actual === '';
    default:
      return actual === expected;
  }
}

// ---------- Runner ----------

/** Estado de una inscripción entre una espera y la siguiente acción. */
interface RunState {
  event: WorkflowEvent;
  branch: boolean | null;
  results: ActionResult[];
}

/**
 * ¿Cumple el registro todos los filtros de inscripción (y el "valor nuevo"
 * del disparador)? Las condiciones se evalúan con las mismas reglas que si/si no.
 */
async function meetsConditions(userId: string, conditions: EnrollCondition[], event: WorkflowEvent, ctx: ActionContext): Promise<boolean> {
  for (const c of conditions) {
    if (!(await evaluateBranch(userId, c as unknown as Record<string, unknown>, event, ctx).catch(() => false))) return false;
  }
  return true;
}

/**
 * Inscribe el registro del evento en el workflow con una sola sentencia
 * (compare-and-set), así dos eventos a la vez no lo inscriben dos veces:
 * - nunca mientras el registro tiene una inscripción activa (esperando o
 *   corriendo hace menos de STUCK_RUN_MINUTES);
 * - sin reinscripción, nunca si ya estuvo inscripto;
 * - con reinscripción, hasta MAX_ENROLLMENTS_PER_DAY veces en 24 horas.
 * Las corridas manuales (sin registro) no pasan por acá.
 */
async function enroll(userId: string, workflow: Workflow, event: WorkflowEvent): Promise<string | null> {
  const runId = crypto.randomUUID();
  const at = new Date();
  const stuck = dbTime(addMinutes(at, -STUCK_RUN_MINUTES));
  const dayAgo = dbTime(addMinutes(at, -24 * 60));
  const same = 'workflow_id = ? AND trigger_entity = ? AND trigger_entity_id = ?';
  const key = [workflow.id, event.entity, event.entityId];
  const res = await getDb()
    .prepare(
      `INSERT INTO crm_workflow_runs
       (id, workflow_id, user_id, trigger_entity, trigger_entity_id, trigger_type, status, output, started_at)
       SELECT ?, ?, ?, ?, ?, ?, 'running', '{}', ?
       WHERE NOT EXISTS (SELECT 1 FROM crm_workflow_runs WHERE ${same}
                         AND (status = 'waiting' OR (status IN ('running', 'pending') AND started_at > ?)))
         AND (? = 1 OR NOT EXISTS (SELECT 1 FROM crm_workflow_runs WHERE ${same}))
         AND (SELECT COUNT(*) FROM crm_workflow_runs WHERE ${same} AND started_at > ?) < ?`,
    )
    .run(
      runId,
      workflow.id,
      userId,
      event.entity,
      event.entityId,
      event.type,
      dbTime(at),
      ...key,
      stuck,
      workflow.settings.reenroll ? 1 : 0,
      ...key,
      ...key,
      dayAgo,
      MAX_ENROLLMENTS_PER_DAY,
    );
  return res.changes > 0 ? runId : null;
}

/**
 * Corre las acciones desde `fromPosition`. Una espera deja la corrida en
 * 'waiting' con la próxima posición y el estado; el cron la retoma
 * (resumeWaitingWorkflowRuns). Tope de MAX_RUN_STEPS acciones por
 * inscripción, contando las de antes de cada espera.
 */
async function executeRun(
  userId: string,
  workflow: Workflow,
  runId: string,
  ctx: ActionContext,
  fromPosition: number,
  state: RunState,
  stepsBefore: number,
): Promise<void> {
  const db = getDb();
  const { event } = state;
  const results = [...state.results];
  let failed = results.some((r) => !r.ok);
  let steps = stepsBefore;
  // If/else: una acción `branch` evalúa su condición; las acciones siguientes
  // con config.when = 'yes' | 'no' corren solo en esa rama (las demás siempre).
  let branch = state.branch;
  const actions = [...workflow.actions].sort((a, b) => a.position - b.position).filter((a) => a.position >= fromPosition);
  for (const [i, action] of actions.entries()) {
    if (steps >= MAX_RUN_STEPS) {
      results.push({ ok: false, type: action.type, error: 'step_cap' });
      failed = true;
      break;
    }
    steps++;
    if (action.type === 'branch') {
      branch = await evaluateBranch(userId, action.config, event, ctx).catch(() => false);
      results.push({ ok: true, type: action.type, result: { branch: branch ? 'yes' : 'no' } });
      continue;
    }
    const when = safeString(action.config.when);
    if ((when === 'yes' || when === 'no') && branch !== null && (when === 'yes') !== branch) {
      results.push({ ok: true, type: action.type, result: { skipped: true } });
      continue;
    }
    if (action.type === 'delay') {
      const minutes = delayMinutes(action.config);
      if (minutes === null) {
        results.push({ ok: false, type: action.type, error: 'invalid_delay' });
        failed = true;
        continue;
      }
      results.push({ ok: true, type: action.type, result: { minutes } });
      const next = actions[i + 1];
      if (!next) continue;
      const nextState: RunState = { event, branch, results };
      await db
        .prepare(
          `UPDATE crm_workflow_runs SET status = 'waiting', resume_at = ?, next_position = ?, state = ?, steps = ?, output = ?
           WHERE id = ?`,
        )
        .run(dbTime(addMinutes(new Date(), minutes)), next.position, JSON.stringify(nextState), steps, JSON.stringify({ event, results }), runId);
      return;
    }
    const result = await executeAction(userId, workflow.id, runId, action, event, ctx);
    results.push(result);
    if (!result.ok) failed = true;
  }

  await db
    .prepare(
      `UPDATE crm_workflow_runs SET status = ?, output = ?, finished_at = ?, resume_at = NULL, next_position = NULL, state = '{}', steps = ?
       WHERE id = ?`,
    )
    .run(failed ? 'failed' : 'done', JSON.stringify({ event, results }), now(), steps, runId);
}

async function runSingleWorkflow(userId: string, workflow: Workflow, event: WorkflowEvent, ctx: ActionContext): Promise<void> {
  let runId: string | null;
  if (event.entityId) {
    runId = await enroll(userId, workflow, event);
    if (!runId) return;
  } else {
    runId = crypto.randomUUID();
    await getDb()
      .prepare(
        `INSERT INTO crm_workflow_runs
         (id, workflow_id, user_id, trigger_entity, trigger_entity_id, trigger_type, status, output, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', '{}', ?)`,
      )
      .run(runId, workflow.id, userId, event.entity, event.entityId, event.type, now());
  }
  await executeRun(userId, workflow, runId, ctx, 0, { event, branch: null, results: [] }, 0);
}

/**
 * Cadena de ejecución: una acción (p. ej. update_field) puede disparar otro
 * evento y con él más workflows. Se corta un workflow que ya corrió en la
 * cadena (evita loops A→A y A→B→A) y cualquier cadena más profunda que
 * MAX_CHAIN_DEPTH.
 */
const MAX_CHAIN_DEPTH = 3;
const chain = new AsyncLocalStorage<{ depth: number; seen: ReadonlySet<string> }>();

export async function runWorkflowsForEvent(userId: string, event: WorkflowEvent): Promise<void> {
  const parent = chain.getStore();
  if (parent && parent.depth >= MAX_CHAIN_DEPTH) return;
  const db = getDb();
  const rows = (await db
    .prepare('SELECT * FROM crm_workflows WHERE user_id = ? AND enabled = 1')
    .all(userId)) as CrmWorkflowRow[];
  if (!rows.length) return;

  const triggerRows = (await db
    .prepare(
      `SELECT * FROM crm_workflow_triggers WHERE workflow_id IN (${rows.map(() => '?').join(',')})`,
    )
    .all(...rows.map((r) => r.id))) as CrmWorkflowTriggerRow[];

  const triggerGroups = new Map<string, WorkflowTrigger[]>();
  for (const t of triggerRows) {
    const list = triggerGroups.get(t.workflow_id) ?? [];
    list.push({
      id: t.id,
      type: t.type as TriggerType,
      config: parseJsonObject(t.config),
      position: t.position,
    });
    triggerGroups.set(t.workflow_id, list);
  }

  const workflows: Workflow[] = rows.map((row) => ({
    ...rowToWorkflow(row),
    triggers: triggerGroups.get(row.id) ?? [],
    actions: [],
  }));

  const actionRows = (await db
    .prepare(
      `SELECT * FROM crm_workflow_actions WHERE workflow_id IN (${rows.map(() => '?').join(',')}) ORDER BY position ASC`,
    )
    .all(...rows.map((r) => r.id))) as CrmWorkflowActionRow[];

  const actionGroups = new Map<string, WorkflowAction[]>();
  for (const a of actionRows) {
    const list = actionGroups.get(a.workflow_id) ?? [];
    list.push({
      id: a.id,
      type: a.type as ActionType,
      config: parseJsonObject(a.config),
      position: a.position,
    });
    actionGroups.set(a.workflow_id, list);
  }
  for (const wf of workflows) {
    wf.actions = actionGroups.get(wf.id) ?? [];
  }

  const candidates = workflows.filter((wf) => !parent?.seen.has(wf.id) && wf.triggers.some((t) => triggerMatches(t, event)));
  if (!candidates.length) return;
  const ctx = await loadContext(userId, event);

  // Filtros de inscripción (AND) y, si el disparador pide un valor nuevo, que
  // alguno de los disparadores que coinciden lo cumpla.
  const matching: Workflow[] = [];
  for (const wf of candidates) {
    const triggers = wf.triggers.filter((t) => triggerMatches(t, event));
    let triggerOk = false;
    for (const t of triggers) {
      const cond = PROPERTY_TRIGGERS.includes(t.type) ? triggerValueCondition(event.entity, t.config) : null;
      if (!cond || (await meetsConditions(userId, [cond], event, ctx))) {
        triggerOk = true;
        break;
      }
    }
    if (triggerOk && (await meetsConditions(userId, wf.settings.filters, event, ctx))) matching.push(wf);
  }

  await Promise.all(
    matching.map((wf) =>
      chain
        .run({ depth: (parent?.depth ?? 0) + 1, seen: new Set([...(parent?.seen ?? []), wf.id]) }, () =>
          runSingleWorkflow(userId, wf, event, ctx),
        )
        .catch(() => null),
    ),
  );
}

/** Ejecución manual desde la UI: corre solo este workflow (sin registro asociado). */
export async function runWorkflowManually(userId: string, workflow: Workflow): Promise<void> {
  const event: WorkflowEvent = { type: 'manual', entity: 'deal', entityId: '' };
  await chain.run({ depth: 1, seen: new Set([workflow.id]) }, () => runSingleWorkflow(userId, workflow, event, {}));
}

/**
 * Cron de cada minuto: retoma las inscripciones cuya espera venció, solo de
 * workflows prendidos. Un workflow apagado deja sus inscripciones esperando
 * con su estado y siguen cuando se vuelve a prender. Claim por fila
 * (status 'waiting' → 'running' con compare-and-set): dos crons a la vez no
 * corren la misma.
 */
export async function resumeWaitingWorkflowRuns(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ resumed: number }> {
  const db = getDb();
  const start = Date.now();
  const at = dbTime(new Date());
  const rows = (await db
    .prepare(
      `SELECT r.id, r.user_id, r.workflow_id, r.next_position, r.state, r.steps FROM crm_workflow_runs r
       JOIN crm_workflows w ON w.id = r.workflow_id AND w.user_id = r.user_id AND w.enabled = 1
       WHERE r.status = 'waiting' AND r.resume_at <= ?
       ORDER BY r.resume_at ASC LIMIT ?`,
    )
    .all(at, Math.min(Math.max(opts.limit ?? 50, 1), 500))) as Array<{
    id: string;
    user_id: string;
    workflow_id: string;
    next_position: number | null;
    state: string;
    steps: number | null;
  }>;
  let resumed = 0;
  for (const row of rows) {
    if (opts.budgetMs && Date.now() - start > opts.budgetMs) break;
    const claim = await db
      .prepare("UPDATE crm_workflow_runs SET status = 'running' WHERE id = ? AND status = 'waiting' AND resume_at <= ?")
      .run(row.id, at);
    if (!claim.changes) continue;
    try {
      const workflow = await getWorkflow(row.user_id, row.workflow_id);
      if (!workflow?.enabled) {
        // Lo apagaron entre la lectura y el claim: vuelve a esperar sin perder nada.
        await db.prepare("UPDATE crm_workflow_runs SET status = 'waiting' WHERE id = ? AND status = 'running'").run(row.id);
        continue;
      }
      const parsed = parseJsonObject(row.state);
      const event = parsed.event as WorkflowEvent | undefined;
      if (!event || !event.type) throw new Error('bad_state');
      const state: RunState = {
        event,
        branch: typeof parsed.branch === 'boolean' ? parsed.branch : null,
        results: Array.isArray(parsed.results) ? (parsed.results as ActionResult[]) : [],
      };
      // Si el registro ya no existe (borrado o en la papelera), la inscripción termina.
      if (isRecordEntity(event.entity) && event.entityId) {
        const exists = await db.prepare(`SELECT 1 FROM ${RECORD_TABLE[event.entity]} WHERE id = ? AND user_id = ?`).get(event.entityId, row.user_id);
        if (!exists) {
          await db
            .prepare("UPDATE crm_workflow_runs SET status = 'done', finished_at = ?, resume_at = NULL, next_position = NULL, state = '{}' WHERE id = ?")
            .run(now(), row.id);
          continue;
        }
      }
      const ctx = await loadContext(row.user_id, event);
      await chain.run({ depth: 1, seen: new Set([workflow.id]) }, () =>
        executeRun(row.user_id, workflow, row.id, ctx, Number(row.next_position ?? 0), state, Number(row.steps ?? 0)),
      );
      resumed++;
    } catch {
      await db
        .prepare("UPDATE crm_workflow_runs SET status = 'failed', finished_at = ?, resume_at = NULL WHERE id = ? AND status = 'running'")
        .run(now(), row.id)
        .catch(() => null);
    }
  }
  return { resumed };
}

// ---------- Emails transaccionales desde el CRM ----------

export interface SendCrmEmailInput {
  recordType: 'contact' | 'company' | 'deal';
  recordId: string;
  to: string;
  subject: string;
  body: string;
  fromEmail: string;
}

async function resolveContactIdForEmail(
  userId: string,
  recordType: 'contact' | 'company' | 'deal',
  recordId: string,
): Promise<string | null> {
  if (recordType === 'contact') {
    const row = await getDb()
      .prepare('SELECT 1 FROM crm_contacts WHERE id = ? AND user_id = ?')
      .get(recordId, userId);
    return row ? recordId : null;
  }
  if (recordType === 'deal') {
    const row = (await getDb()
      .prepare(
        `SELECT dc.contact_id FROM crm_deal_contacts dc
         JOIN crm_deals d ON d.id = dc.deal_id
         WHERE dc.deal_id = ? AND d.user_id = ? ORDER BY dc.rowid ASC LIMIT 1`,
      )
      .get(recordId, userId)) as { contact_id: string } | undefined;
    return row?.contact_id ?? null;
  }
  // company
  const row = (await getDb()
    .prepare(
      'SELECT id FROM crm_contacts WHERE company_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(recordId, userId)) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function sendCrmEmailAndSave(
  userId: string,
  input: SendCrmEmailInput & { senderId: string; tracking?: boolean; threadId?: string | null; inReplyTo?: string | null },
): Promise<{ ok: boolean; email?: CrmEmailRow; via?: 'gmail' | 'outlook' | 'system'; error?: string }> {
  const { recordType, recordId, to, subject, body, fromEmail } = input;
  if (!to) return { ok: false, error: 'missing_recipient' };

  const contactId = await resolveContactIdForEmail(userId, recordType, recordId);
  if (!contactId) return { ok: false, error: 'missing_contact' };

  const { sendCrmEmail } = await import('./crm-email');
  const res = await sendCrmEmail(userId, {
    senderId: input.senderId,
    senderEmail: fromEmail,
    contactId,
    to,
    subject,
    body,
    tracking: input.tracking,
    threadId: input.threadId ?? null,
    inReplyTo: input.inReplyTo ?? null,
    dealId: recordType === 'deal' ? recordId : null,
    companyId: recordType === 'company' ? recordId : null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, email: res.email, via: res.via };
}
