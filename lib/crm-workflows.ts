/**
 * CRM Workflows — motor de automatizaciones con triggers y acciones.
 * Server-only.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createNotification } from './notifications';
import { safeFetch } from './safe-fetch';
import { sendEmail } from './email';
import { crossesThreshold } from './crm-scoring-schema';
import {
  createActivity,
  getContact,
  getDeal,
  getCompany,
  addListMembers,
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
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

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

function rowToWorkflow(row: CrmWorkflowRow): Workflow {
  return {
    ...row,
    enabled: row.enabled === 1,
    triggers: [],
    actions: [],
  };
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

export async function createWorkflow(userId: string, data: WorkflowInput): Promise<Workflow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    await tdb
      .prepare(
        'INSERT INTO crm_workflows (id, user_id, name, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, data.name, toDbBool(data.enabled ?? true), ts, ts);

    const insTrigger = tdb.prepare(
      'INSERT INTO crm_workflow_triggers (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [i, t] of data.triggers.entries()) {
      await insTrigger.run(
        crypto.randomUUID(),
        id,
        t.type,
        JSON.stringify(t.config ?? {}),
        t.position ?? i,
      );
    }

    const insAction = tdb.prepare(
      'INSERT INTO crm_workflow_actions (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [i, a] of data.actions.entries()) {
      await insAction.run(
        crypto.randomUUID(),
        id,
        a.type,
        JSON.stringify(a.config ?? {}),
        a.position ?? i,
      );
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return (await getWorkflow(userId, id))!;
}

export async function updateWorkflow(
  userId: string,
  id: string,
  data: Partial<WorkflowInput>,
): Promise<Workflow | null> {
  const db = getDb();
  const existing = (await db
    .prepare('SELECT id FROM crm_workflows WHERE id = ? AND user_id = ?')
    .get(id, userId)) as { id: string } | undefined;
  if (!existing) return null;

  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    if (data.name !== undefined || data.enabled !== undefined) {
      const sets: Array<[string, string | number]> = [];
      if (data.name !== undefined) sets.push(['name', data.name]);
      if (data.enabled !== undefined) sets.push(['enabled', toDbBool(data.enabled)]);
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
      for (const [i, t] of data.triggers.entries()) {
        await insTrigger.run(
          crypto.randomUUID(),
          id,
          t.type,
          JSON.stringify(t.config ?? {}),
          t.position ?? i,
        );
      }
    }

    if (data.actions) {
      await tdb.prepare('DELETE FROM crm_workflow_actions WHERE workflow_id = ?').run(id);
      const insAction = tdb.prepare(
        'INSERT INTO crm_workflow_actions (id, workflow_id, type, config, position) VALUES (?, ?, ?, ?, ?)',
      );
      for (const [i, a] of data.actions.entries()) {
        await insAction.run(
          crypto.randomUUID(),
          id,
          a.type,
          JSON.stringify(a.config ?? {}),
          a.position ?? i,
        );
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
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
       ORDER BY r.started_at DESC
       LIMIT ?`,
    )
    .all(...args, Math.min(Math.max(limit, 1), 200))) as CrmWorkflowRunRow[];
}

// ---------- Contexto y utilidades de acciones ----------

interface ActionContext {
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    company_id: string | null;
    custom?: string;
  } | null;
  company?: { id: string; name: string; custom?: string } | null;
  deal?: { id: string; name: string; amount: number; currency: string; custom?: string } | null;
}

async function loadContext(userId: string, event: WorkflowEvent): Promise<ActionContext> {
  const ctx: ActionContext = {};
  if (event.entity === 'contact') {
    ctx.contact = (await getDb()
      .prepare('SELECT id, first_name, last_name, email, company_id, custom FROM crm_contacts WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as ActionContext['contact'];
    if (ctx.contact?.company_id) {
      ctx.company = (await getDb()
        .prepare('SELECT id, name, custom FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(ctx.contact.company_id, userId)) as ActionContext['company'];
    }
  } else if (event.entity === 'company') {
    ctx.company = (await getDb()
      .prepare('SELECT id, name, custom FROM crm_companies WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as ActionContext['company'];
    ctx.contact = (await getDb()
      .prepare(
        'SELECT id, first_name, last_name, email, company_id, custom FROM crm_contacts WHERE company_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1',
      )
      .get(event.entityId, userId)) as ActionContext['contact'];
  } else if (event.entity === 'deal') {
    ctx.deal = (await getDb()
      .prepare('SELECT id, name, amount, currency, custom FROM crm_deals WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as ActionContext['deal'];
    ctx.contact = (await getDb()
      .prepare(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.company_id, c.custom
         FROM crm_contacts c
         JOIN crm_deal_contacts dc ON dc.contact_id = c.id
         WHERE dc.deal_id = ? AND c.user_id = ?
         ORDER BY dc.rowid ASC LIMIT 1`,
      )
      .get(event.entityId, userId)) as ActionContext['contact'];
    if (ctx.contact?.company_id) {
      ctx.company = (await getDb()
        .prepare('SELECT id, name, custom FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(ctx.contact.company_id, userId)) as ActionContext['company'];
    }
  } else if (event.entity === 'task') {
    const task = (await getDb()
      .prepare('SELECT contact_id, company_id, deal_id FROM crm_activities WHERE id = ? AND user_id = ? AND type = \'task\'')
      .get(event.entityId, userId)) as { contact_id: string | null; company_id: string | null; deal_id: string | null } | undefined;
    if (task?.contact_id) {
      ctx.contact = (await getDb()
        .prepare('SELECT id, first_name, last_name, email, company_id, custom FROM crm_contacts WHERE id = ? AND user_id = ?')
        .get(task.contact_id, userId)) as ActionContext['contact'];
    }
    if (task?.company_id) {
      ctx.company = (await getDb()
        .prepare('SELECT id, name, custom FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(task.company_id, userId)) as ActionContext['company'];
    }
    if (task?.deal_id) {
      ctx.deal = (await getDb()
        .prepare('SELECT id, name, amount, currency, custom FROM crm_deals WHERE id = ? AND user_id = ?')
        .get(task.deal_id, userId)) as ActionContext['deal'];
    }
  } else if (event.entity === 'email') {
    const email = (await getDb()
      .prepare('SELECT contact_id FROM crm_emails WHERE id = ? AND user_id = ?')
      .get(event.entityId, userId)) as { contact_id: string } | undefined;
    if (email?.contact_id) {
      ctx.contact = (await getDb()
        .prepare('SELECT id, first_name, last_name, email, company_id, custom FROM crm_contacts WHERE id = ? AND user_id = ?')
        .get(email.contact_id, userId)) as ActionContext['contact'];
      if (ctx.contact?.company_id) {
        ctx.company = (await getDb()
          .prepare('SELECT id, name, custom FROM crm_companies WHERE id = ? AND user_id = ?')
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

async function executeAction(
  userId: string,
  workflowId: string,
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
        const method = safeString(cfg.method) || 'POST';
        const headers =
          cfg.headers && typeof cfg.headers === 'object'
            ? (cfg.headers as Record<string, string>)
            : { 'content-type': 'application/json' };
        if (!url) return { ok: false, type: action.type, error: 'missing_url' };
        const res = await safeFetch(url, {
          method,
          headers,
          body: JSON.stringify({ event, context: ctx }),
        });
        return { ok: res.ok, type: action.type, result: { status: res.status } };
      }
      case 'notify_user': {
        const message = safeString(cfg.message);
        await createNotification({
          userId,
          type: 'assigned',
          title: 'Workflow notification',
          body: renderTemplate(message, ctx),
          sourceType: 'workflow',
          sourceId: workflowId,
          href: `/app/crm/workflows/${workflowId}`,
        });
        return { ok: true, type: action.type };
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
  return true;
}

// ---------- If/else (acción branch) ----------

const BRANCH_OPS = ['equals', 'not_equals', 'contains', 'gt', 'lt', 'is_set', 'is_not_set'] as const;

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

async function runSingleWorkflow(
  userId: string,
  workflow: Workflow,
  event: WorkflowEvent,
): Promise<void> {
  const runId = crypto.randomUUID();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO crm_workflow_runs
       (id, workflow_id, user_id, trigger_entity, trigger_entity_id, status, output, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, workflow.id, userId, event.entity, event.entityId, 'running', '{}', now());

  const ctx = await loadContext(userId, event);
  const results: ActionResult[] = [];
  let failed = false;

  // If/else: una acción `branch` evalúa su condición; las acciones siguientes
  // con config.when = 'yes' | 'no' corren solo en esa rama (las demás siempre).
  let branch: boolean | null = null;
  for (const action of workflow.actions.sort((a, b) => a.position - b.position)) {
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
    const result = await executeAction(userId, workflow.id, action, event, ctx);
    results.push(result);
    if (!result.ok) failed = true;
  }

  const output = {
    event,
    results,
  };

  await db
    .prepare(
      `UPDATE crm_workflow_runs SET status = ?, output = ?, finished_at = ? WHERE id = ?`,
    )
    .run(failed ? 'failed' : 'done', JSON.stringify(output), now(), runId);
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

  const matching = workflows.filter(
    (wf) => !parent?.seen.has(wf.id) && wf.triggers.some((t) => triggerMatches(t, event)),
  );

  await Promise.all(
    matching.map((wf) =>
      chain
        .run({ depth: (parent?.depth ?? 0) + 1, seen: new Set([...(parent?.seen ?? []), wf.id]) }, () =>
          runSingleWorkflow(userId, wf, event),
        )
        .catch(() => null),
    ),
  );
}

/** Ejecución manual desde la UI: corre solo este workflow (sin registro asociado). */
export async function runWorkflowManually(userId: string, workflow: Workflow): Promise<void> {
  await chain.run({ depth: 1, seen: new Set([workflow.id]) }, () =>
    runSingleWorkflow(userId, workflow, { type: 'manual', entity: 'deal', entityId: '' }),
  );
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
): Promise<{ ok: boolean; email?: CrmEmailRow; via?: 'gmail' | 'system'; error?: string }> {
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
