/**
 * Track — triage como Linear: ajustes por proyecto (responsable de turno que
 * rota, SLAs por prioridad, modo de las sugerencias de IA), reglas que fijan
 * propiedades al entrar un issue a triage, y snooze de la cola.
 *
 * onIssueEnteredTriage corre desde createIssue (lib/track-data.ts) para todo
 * issue que entra a la cola, venga de la API, Chat, Flow, GitHub o Agents.
 * Server-only.
 */
import { listOwnerSpacePeople } from './workspace';
import { after } from 'next/server';
import { getDb } from './db';
import type { TrackIssueWithStatus } from './track-data';
import { createNotification } from './notifications';
import { parseIssueLabels, projectWorkspaceId } from './track-labels';
import {
  currentTriageOwner,
  normalizeAiModes,
  normalizeSlaHours,
  planTriageRules,
  RULE_FIELDS,
  TRACK_PRIORITIES,
  type AiSuggestionKind,
  type AiSuggestionMode,
  type RuleActions,
  type RuleCondition,
  type TrackPriority,
  type TriageOwnerAction,
  type TriageOwnerRotation,
  type TriageRule,
  type TriageSettings,
} from './track-triage-shared';

function nowIso(): string {
  return new Date().toISOString();
}

export class TriageError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

// ---------- Ajustes ----------

interface SettingsRow {
  project_id: string;
  owner_ids: string;
  owner_rotation: TriageOwnerRotation;
  owner_action: TriageOwnerAction;
  owner_anchor: string;
  sla_enabled: number;
  sla_hours: string;
  ai_modes: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSettings(projectId: string, row: SettingsRow | undefined): TriageSettings {
  const ids = parseJson<unknown>(row?.owner_ids, []);
  return {
    projectId,
    ownerIds: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
    ownerRotation: row?.owner_rotation === 'daily' ? 'daily' : 'weekly',
    ownerAction: row?.owner_action === 'notify' || row?.owner_action === 'assign' ? row.owner_action : 'off',
    ownerAnchor: row?.owner_anchor || new Date().toISOString().slice(0, 10),
    slaEnabled: Boolean(row?.sla_enabled),
    slaHours: normalizeSlaHours(parseJson(row?.sla_hours, {})),
    aiModes: normalizeAiModes(parseJson(row?.ai_modes, {})),
  };
}

export async function getTriageSettings(projectId: string): Promise<TriageSettings> {
  const row = (await getDb().prepare('SELECT * FROM track_triage_settings WHERE project_id = ?').get(projectId)) as
    | SettingsRow
    | undefined;
  return toSettings(projectId, row);
}

export interface TriageSettingsPatch {
  ownerIds?: string[];
  ownerRotation?: TriageOwnerRotation;
  ownerAction?: TriageOwnerAction;
  ownerAnchor?: string;
  slaEnabled?: boolean;
  slaHours?: Partial<Record<TrackPriority, number | null>>;
  aiModes?: Partial<Record<AiSuggestionKind, AiSuggestionMode>>;
}

/** Miembros del proyecto (ids) para validar responsables y asignados. */
export async function projectMemberIds(projectId: string): Promise<Set<string>> {
  const project = (await getDb().prepare('SELECT team_id, owner_id FROM track_projects WHERE id = ?').get(projectId)) as
    | { team_id: string | null; owner_id: string | null }
    | undefined;
  if (!project) return new Set();
  if (!project.team_id) {
    if (!project.owner_id) return new Set();
    return new Set((await listOwnerSpacePeople(project.owner_id)).map((p) => p.id));
  }
  const rows = (await getDb()
    .prepare(
      `SELECT user_id FROM team_members WHERE team_id = ?
       UNION SELECT owner_id AS user_id FROM teams WHERE id = ?`,
    )
    .all(project.team_id, project.team_id)) as Array<{ user_id: string }>;
  const ids = new Set(rows.map((r) => r.user_id));
  if (project.owner_id) ids.add(project.owner_id);
  return ids;
}

export async function updateTriageSettings(projectId: string, patch: TriageSettingsPatch): Promise<TriageSettings> {
  const current = await getTriageSettings(projectId);
  const next: TriageSettings = { ...current };
  if (patch.ownerIds) {
    const members = await projectMemberIds(projectId);
    const ids = [...new Set(patch.ownerIds)];
    if (ids.some((id) => !members.has(id))) throw new TriageError('invalid_member');
    next.ownerIds = ids.slice(0, 50);
  }
  if (patch.ownerRotation) next.ownerRotation = patch.ownerRotation;
  if (patch.ownerAction) next.ownerAction = patch.ownerAction;
  if (patch.ownerAnchor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.ownerAnchor)) throw new TriageError('invalid_date');
    next.ownerAnchor = patch.ownerAnchor;
  }
  if (patch.slaEnabled !== undefined) next.slaEnabled = patch.slaEnabled;
  if (patch.slaHours) next.slaHours = normalizeSlaHours({ ...current.slaHours, ...patch.slaHours });
  if (patch.aiModes) next.aiModes = normalizeAiModes({ ...current.aiModes, ...patch.aiModes });
  await getDb()
    .prepare(
      `INSERT INTO track_triage_settings (project_id, owner_ids, owner_rotation, owner_action, owner_anchor, sla_enabled, sla_hours, ai_modes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET owner_ids = excluded.owner_ids, owner_rotation = excluded.owner_rotation,
         owner_action = excluded.owner_action, owner_anchor = excluded.owner_anchor, sla_enabled = excluded.sla_enabled,
         sla_hours = excluded.sla_hours, ai_modes = excluded.ai_modes, updated_at = excluded.updated_at`,
    )
    .run(
      projectId,
      JSON.stringify(next.ownerIds),
      next.ownerRotation,
      next.ownerAction,
      next.ownerAnchor,
      next.slaEnabled ? 1 : 0,
      JSON.stringify(next.slaHours),
      JSON.stringify(next.aiModes),
      nowIso(),
    );
  // Cambió la duración o se prendió/apagó: los issues abiertos recalculan su SLA.
  if (patch.slaEnabled !== undefined || patch.slaHours) {
    const { resyncProjectSlas } = await import('./track-sla');
    await resyncProjectSlas(projectId).catch(() => undefined);
  }
  return next;
}

// ---------- Reglas ----------

interface RuleRow {
  id: string;
  project_id: string;
  name: string;
  position: number;
  enabled: number;
  conditions: string;
  actions: string;
  created_at: string;
  updated_at: string;
}

function toRule(row: RuleRow): TriageRule {
  const conditions = parseJson<unknown>(row.conditions, []);
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    position: row.position,
    enabled: Boolean(row.enabled),
    conditions: Array.isArray(conditions) ? (conditions as RuleCondition[]) : [],
    actions: parseJson<RuleActions>(row.actions, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTriageRules(projectId: string): Promise<TriageRule[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM track_triage_rules WHERE project_id = ? ORDER BY position ASC, created_at ASC')
    .all(projectId)) as RuleRow[];
  return rows.map(toRule);
}

export async function getTriageRule(id: string): Promise<TriageRule | null> {
  const row = (await getDb().prepare('SELECT * FROM track_triage_rules WHERE id = ?').get(id)) as RuleRow | undefined;
  return row ? toRule(row) : null;
}

export interface TriageRuleInput {
  name?: string;
  enabled?: boolean;
  position?: number;
  conditions?: RuleCondition[];
  actions?: RuleActions;
}

function cleanConditions(raw: RuleCondition[]): RuleCondition[] {
  return raw
    .filter((c) => (RULE_FIELDS as readonly string[]).includes(c.field) && ['is', 'is_not', 'contains'].includes(c.op))
    .map((c): RuleCondition => ({
      field: c.field,
      op: c.field === 'text' || c.field === 'customer' ? (c.op === 'is_not' ? 'is_not' : 'contains') : c.op === 'is_not' ? 'is_not' : 'is',
      values: [...new Set(c.values.map((v) => v.trim()).filter(Boolean))].slice(0, 20),
    }))
    .slice(0, 10);
}

/** Valida que asignado, labels, estado y cycle sean del proyecto/workspace. */
async function cleanActions(projectId: string, raw: RuleActions): Promise<RuleActions> {
  const db = getDb();
  const out: RuleActions = {};
  if (raw.priority) {
    if (!TRACK_PRIORITIES.includes(raw.priority)) throw new TriageError('invalid_priority');
    out.priority = raw.priority;
  }
  if (raw.assigneeId) {
    if (!(await projectMemberIds(projectId)).has(raw.assigneeId)) throw new TriageError('invalid_member');
    out.assigneeId = raw.assigneeId;
  }
  if (raw.acceptStatusId) {
    const ok = await db.prepare('SELECT id FROM track_statuses WHERE id = ? AND project_id = ?').get(raw.acceptStatusId, projectId);
    if (!ok) throw new TriageError('invalid_status');
    out.acceptStatusId = raw.acceptStatusId;
  }
  if (raw.cycleId) {
    const ok = await db.prepare('SELECT id FROM track_cycles WHERE id = ? AND project_id = ?').get(raw.cycleId, projectId);
    if (!ok) throw new TriageError('invalid_cycle');
    out.cycleId = raw.cycleId;
  }
  if (raw.labelIds?.length) {
    const project = (await db.prepare('SELECT team_id, owner_id FROM track_projects WHERE id = ?').get(projectId)) as
      | { team_id: string | null; owner_id: string | null }
      | undefined;
    const ws = project ? projectWorkspaceId(project) : null;
    const ids = [...new Set(raw.labelIds)].slice(0, 10);
    const ph = ids.map(() => '?').join(', ');
    const found = (await db
      .prepare(`SELECT id FROM track_labels WHERE workspace_id = ? AND id IN (${ph})`)
      .all(ws ?? '', ...ids)) as Array<{ id: string }>;
    if (found.length !== ids.length) throw new TriageError('invalid_label');
    out.labelIds = ids;
  }
  return out;
}

export async function createTriageRule(projectId: string, input: TriageRuleInput, userId: string): Promise<TriageRule> {
  const name = (input.name ?? '').trim().slice(0, 120);
  if (!name) throw new TriageError('missing_name');
  const conditions = cleanConditions(input.conditions ?? []);
  const actions = await cleanActions(projectId, input.actions ?? {});
  if (Object.keys(actions).length === 0) throw new TriageError('missing_action');
  const db = getDb();
  const max = (await db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM track_triage_rules WHERE project_id = ?').get(projectId)) as {
    p: number;
  };
  const id = crypto.randomUUID();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO track_triage_rules (id, project_id, name, position, enabled, conditions, actions, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, name, Number(max.p) + 1, input.enabled === false ? 0 : 1, JSON.stringify(conditions), JSON.stringify(actions), userId, ts, ts);
  return (await getTriageRule(id)) as TriageRule;
}

export async function updateTriageRule(rule: TriageRule, input: TriageRuleInput): Promise<TriageRule> {
  const fields: string[] = [];
  const args: Array<string | number> = [];
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new TriageError('missing_name');
    fields.push('name = ?');
    args.push(name);
  }
  if (input.enabled !== undefined) {
    fields.push('enabled = ?');
    args.push(input.enabled ? 1 : 0);
  }
  if (input.conditions) {
    fields.push('conditions = ?');
    args.push(JSON.stringify(cleanConditions(input.conditions)));
  }
  if (input.actions) {
    const actions = await cleanActions(rule.projectId, input.actions);
    if (Object.keys(actions).length === 0) throw new TriageError('missing_action');
    fields.push('actions = ?');
    args.push(JSON.stringify(actions));
  }
  const db = getDb();
  if (input.position !== undefined && input.position !== rule.position) {
    // Mover arriba/abajo: se reordena toda la lista para que las posiciones queden 0..n.
    const rules = (await listTriageRules(rule.projectId)).filter((r) => r.id !== rule.id);
    const at = Math.max(0, Math.min(rules.length, Math.round(input.position)));
    rules.splice(at, 0, rule);
    for (let i = 0; i < rules.length; i++) {
      await db.prepare('UPDATE track_triage_rules SET position = ? WHERE id = ?').run(i, rules[i].id);
    }
  }
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso(), rule.id);
    await db.prepare(`UPDATE track_triage_rules SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }
  return (await getTriageRule(rule.id)) as TriageRule;
}

export async function deleteTriageRule(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_triage_rules WHERE id = ?').run(id);
  return res.changes > 0;
}

// ---------- Snooze ----------

/** Pospone un issue de la cola (oculto para todos hasta `until`). null lo vuelve a mostrar. */
export async function snoozeTriageIssue(issueId: string, until: string | null, userId: string): Promise<void> {
  const db = getDb();
  if (!until) {
    await db.prepare('DELETE FROM track_triage_snoozes WHERE issue_id = ?').run(issueId);
    return;
  }
  await db
    .prepare(
      `INSERT INTO track_triage_snoozes (issue_id, until, user_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(issue_id) DO UPDATE SET until = excluded.until, user_id = excluded.user_id`,
    )
    .run(issueId, until, userId, nowIso());
}

export async function listTriageSnoozes(projectId: string): Promise<Map<string, string>> {
  const rows = (await getDb()
    .prepare(
      `SELECT z.issue_id, z.until FROM track_triage_snoozes z JOIN track_issues i ON i.id = z.issue_id
       WHERE i.project_id = ? AND i.triage = 1 AND z.until > ?`,
    )
    .all(projectId, nowIso())) as Array<{ issue_id: string; until: string }>;
  return new Map(rows.map((r) => [r.issue_id, r.until]));
}

// ---------- Entrada a triage ----------

async function requestCustomers(issueId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.customer_name, r.customer_email, c.name AS company_name, c.domain AS company_domain
       FROM track_customer_requests r LEFT JOIN crm_companies c ON c.id = r.company_id WHERE r.issue_id = ?`,
    )
    .all(issueId)) as Array<{ customer_name: string; customer_email: string; company_name: string | null; company_domain: string | null }>;
  return rows.flatMap((r) => [r.customer_name, r.customer_email, r.company_name ?? '', r.company_domain ?? ''].filter(Boolean));
}

function descriptionText(raw: string): string {
  try {
    const blocks = JSON.parse(raw) as Array<{ text?: string }>;
    return Array.isArray(blocks) ? blocks.map((b) => b.text ?? '').join('\n') : '';
  } catch {
    return raw;
  }
}

export interface TriageEntryResult {
  matched: Array<{ id: string; name: string }>;
  ownerId: string | null;
}

/**
 * Un issue entró a la cola: aplica las reglas (de arriba a abajo), avisa o
 * asigna al responsable de turno y, si hay sugerencias de IA en modo "auto",
 * las pide en segundo plano. Devuelve el issue actualizado.
 */
export async function onIssueEnteredTriage(issue: TrackIssueWithStatus): Promise<TrackIssueWithStatus> {
  const { updateIssue, getIssue, getProject } = await import('./track-data');
  const { claimTriage } = await import('./track-bulk');
  const [rules, settings, project] = await Promise.all([
    listTriageRules(issue.project_id),
    getTriageSettings(issue.project_id),
    getProject(issue.project_id),
  ]);
  if (!project) return issue;
  const subject = {
    source: issue.source ?? 'api',
    title: issue.title,
    description: descriptionText(issue.description),
    priority: issue.priority,
    labelIds: parseIssueLabels(issue.labels).map((l) => l.id),
    customers: await requestCustomers(issue.id),
  };
  const plan = planTriageRules(rules, subject);
  const actor = issue.creator_id;
  if (plan.matched.length > 0) {
    const a = plan.actions;
    const via = { source: 'triage' as const, author: plan.matched.map((m) => m.name).join(', ').slice(0, 200) };
    const payload: Parameters<typeof updateIssue>[1] = {};
    if (a.priority && a.priority !== issue.priority) payload.priority = a.priority;
    if (a.assigneeId && a.assigneeId !== issue.assignee_id) payload.assigneeId = a.assigneeId;
    if (a.cycleId && a.cycleId !== issue.cycle_id) payload.cycleId = a.cycleId;
    if (a.labelIds?.length) {
      const current = parseIssueLabels(issue.labels).map((l) => ({ id: l.id }));
      const merged = [...current, ...a.labelIds.filter((id) => !current.some((c) => c.id === id)).map((id) => ({ id }))];
      if (merged.length !== current.length) payload.labels = merged.slice(0, 10);
    }
    if (Object.keys(payload).length > 0) await updateIssue(issue.id, payload, actor, { via });
    if (a.acceptStatusId && (await claimTriage(issue.id))) {
      await updateIssue(issue.id, { statusId: a.acceptStatusId }, actor, { via });
    }
  }

  // Responsable de turno: solo si el issue sigue en triage.
  let current = (await getIssue(issue.id)) ?? issue;
  const ownerId = settings.ownerAction !== 'off' ? currentTriageOwner(settings) : null;
  if (ownerId && current.triage === 1) {
    if (settings.ownerAction === 'assign' && !current.assignee_id) {
      await updateIssue(issue.id, { assigneeId: ownerId }, actor, { via: { source: 'triage', author: 'Triage' } });
      current = (await getIssue(issue.id)) ?? current;
    } else if (settings.ownerAction === 'notify' || current.assignee_id) {
      await createNotification({
        userId: ownerId,
        type: 'issue_update',
        title: `${current.identifier} is waiting for triage`,
        body: current.title,
        href: `/app/track/issues/${current.id}`,
        sourceType: 'track_triage',
        sourceId: current.id,
        meta: { issueIdentifier: current.identifier, projectName: project.name, kind: 'triage_owner' },
      }).catch(() => undefined);
    }
  }

  // Sugerencias de IA con alguna propiedad en "auto": en segundo plano (no frena la creación).
  const anyAuto = Object.values(settings.aiModes).some((m) => m === 'auto');
  if (anyAuto && current.triage === 1) {
    const job = async () => {
      const { generateTriageSuggestions } = await import('./track-ai');
      await generateTriageSuggestions(issue.id, { autoApply: true }).catch(() => undefined);
    };
    try {
      after(job);
    } catch {
      void job().catch(() => {});
    }
  }
  return current;
}
