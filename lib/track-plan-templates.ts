/**
 * Track — templates de projects (los "project templates" de Linear). Un
 * template se guarda desde un project: resumen, descripción, prioridad, ícono,
 * teams, labels, milestones (con su distancia en días al inicio del project) e
 * issues (título, descripción, prioridad, estimación, labels, milestone y
 * padre). Un project nuevo creado desde el template recibe todo eso: los
 * milestones con fecha si el project tiene inicio y los issues en su team.
 *
 * Por workspace, como los projects. Al guardar solo entran los issues que ve
 * quien guarda (lib/track-access) y al aplicar los teams pasan por el mismo
 * filtro, así un template nunca saca nada de un team privado.
 */
import { getDb } from './db';
import { createIssue } from './track-data';
import { createPlanMilestone, getPlan, scopeWhere, inScope, planningClosed, type TrackPlanRow, type WorkspaceScope } from './track-plans';
import { trackVisibleSql } from './track-access';

export const TEMPLATE_MAX_ISSUES = 100;
export const TEMPLATE_MAX_MILESTONES = 50;

export interface PlanTemplateIssue {
  title: string;
  description: string;
  priority: string;
  estimate: number | null;
  labels: Array<{ id?: string; name: string; color?: string }>;
  /** Índice en `milestones`, o null. */
  milestone: number | null;
  /** Índice del padre en `issues`, o null. */
  parent: number | null;
}

export interface PlanTemplateData {
  summary: string;
  description: string;
  priority: string;
  icon: string | null;
  teamIds: string[];
  labelIds: string[];
  milestones: Array<{ name: string; description: string; offsetDays: number | null }>;
  issues: PlanTemplateIssue[];
}

export interface TrackPlanTemplateRow {
  id: string;
  team_id: string | null;
  owner_id: string | null;
  name: string;
  description: string;
  data: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanTemplateSummary {
  id: string;
  name: string;
  description: string;
  milestones: number;
  issues: number;
  /** Teams que trae (los issues van al primero que vea quien crea el project). */
  teams: number;
  /** Algún milestone tiene fecha (relativa al inicio del project). */
  datedMilestones: boolean;
  created_by: string | null;
  created_by_name: string | null;
  updated_at: string;
}

const EMPTY: PlanTemplateData = { summary: '', description: '', priority: 'none', icon: null, teamIds: [], labelIds: [], milestones: [], issues: [] };

export function parseTemplateData(raw: string): PlanTemplateData {
  try {
    const d = JSON.parse(raw) as Partial<PlanTemplateData>;
    return {
      ...EMPTY,
      ...d,
      teamIds: Array.isArray(d.teamIds) ? d.teamIds : [],
      labelIds: Array.isArray(d.labelIds) ? d.labelIds : [],
      milestones: Array.isArray(d.milestones) ? d.milestones : [],
      issues: Array.isArray(d.issues) ? d.issues : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Días entre dos fechas (YYYY-MM-DD o ISO), redondeado. */
export function dayOffset(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** La fecha `offset` días después de `start` (YYYY-MM-DD). */
export function addDays(start: string, offset: number): string {
  const d = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listPlanTemplates(scope: WorkspaceScope): Promise<PlanTemplateSummary[]> {
  if (await planningClosed(scope)) return [];
  const s = scopeWhere(scope, 't');
  const rows = (await getDb()
    .prepare(
      `SELECT t.*, u.name AS created_by_name FROM track_plan_templates t LEFT JOIN users u ON u.id = t.created_by
       WHERE ${s.where} ORDER BY t.name COLLATE NOCASE ASC LIMIT 200`,
    )
    .all(s.arg)) as Array<TrackPlanTemplateRow & { created_by_name: string | null }>;
  return rows.map((r) => {
    const d = parseTemplateData(r.data);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      milestones: d.milestones.length,
      issues: d.issues.length,
      teams: d.teamIds.length,
      datedMilestones: d.milestones.some((m) => m.offsetDays !== null),
      created_by: r.created_by,
      created_by_name: r.created_by_name,
      updated_at: r.updated_at,
    };
  });
}

export async function getAccessiblePlanTemplate(id: string, scope: WorkspaceScope): Promise<TrackPlanTemplateRow | undefined> {
  const row = (await getDb().prepare('SELECT * FROM track_plan_templates WHERE id = ?').get(id)) as TrackPlanTemplateRow | undefined;
  if (!row || !inScope(row, scope)) return undefined;
  return (await planningClosed(scope)) ? undefined : row;
}

/** Lo que el template toma del project: lo que ve quien lo guarda. */
export async function captureTemplateData(plan: TrackPlanRow, actorId: string): Promise<PlanTemplateData> {
  const db = getDb();
  const vis = trackVisibleSql('p', actorId);
  const teams = (await db
    .prepare(`SELECT pt.project_id AS id FROM track_plan_teams pt JOIN track_projects p ON p.id = pt.project_id WHERE pt.plan_id = ? AND ${vis.sql}`)
    .all(plan.id, ...vis.args)) as Array<{ id: string }>;
  const labels = (await db.prepare('SELECT label_id FROM track_plan_labels WHERE plan_id = ?').all(plan.id)) as Array<{ label_id: string }>;
  const ms = (await db
    .prepare('SELECT id, name, description, target_date FROM track_plan_milestones WHERE plan_id = ? ORDER BY position ASC, created_at ASC LIMIT ?')
    .all(plan.id, TEMPLATE_MAX_MILESTONES)) as Array<{ id: string; name: string; description: string | null; target_date: string | null }>;
  const base = plan.start_date ?? plan.created_at.slice(0, 10);
  const rawIssues = (await db
    .prepare(
      `SELECT i.id, i.title, i.description, i.priority, i.estimate, i.labels, i.plan_milestone_id, i.parent_id
       FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.plan_id = ? AND i.triage = 0 AND i.archived_at IS NULL AND COALESCE(s.category, '') NOT IN ('cancelled', 'duplicate')
         AND ${vis.sql}
       ORDER BY i.created_at ASC, i.id ASC LIMIT ?`,
    )
    .all(plan.id, ...vis.args, TEMPLATE_MAX_ISSUES)) as Array<{
    id: string;
    title: string;
    description: string | null;
    priority: string;
    estimate: number | null;
    labels: string | null;
    plan_milestone_id: string | null;
    parent_id: string | null;
  }>;
  const msIndex = new Map(ms.map((m, i) => [m.id, i]));
  const issues = topoSort(rawIssues);
  const issueIndex = new Map(issues.map((it, i) => [it.id, i]));
  const parseLabels = (raw: string | null) => {
    try {
      const arr = JSON.parse(raw ?? '[]') as Array<{ id?: string; name?: string; color?: string }>;
      return arr.filter((l) => l && l.name).map((l) => ({ id: l.id, name: String(l.name), color: l.color }));
    } catch {
      return [];
    }
  };
  return {
    summary: plan.summary ?? '',
    description: plan.description ?? '',
    priority: plan.priority ?? 'none',
    icon: plan.icon ?? null,
    teamIds: teams.map((t) => t.id),
    labelIds: labels.map((l) => l.label_id),
    milestones: ms.map((m) => ({
      name: m.name,
      description: m.description ?? '',
      offsetDays: m.target_date ? dayOffset(base, m.target_date) : null,
    })),
    issues: issues.map((it) => ({
      title: it.title,
      description: it.description ?? '',
      priority: it.priority,
      estimate: it.estimate,
      labels: parseLabels(it.labels),
      milestone: it.plan_milestone_id ? (msIndex.get(it.plan_milestone_id) ?? null) : null,
      parent: it.parent_id ? (issueIndex.get(it.parent_id) ?? null) : null,
    })),
  };
}

/** Padres antes que hijos (a cualquier profundidad), sin perder el orden de creación entre hermanos. */
export function topoSort<T extends { id: string; parent_id: string | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const done = new Set<string>();
  const visit = (r: T, depth = 0) => {
    if (done.has(r.id) || depth > 50) return;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent && !done.has(parent.id)) visit(parent, depth + 1);
    if (done.has(r.id)) return;
    done.add(r.id);
    out.push(r);
  };
  for (const r of rows) visit(r);
  return out;
}

export async function createPlanTemplateFromPlan(
  plan: TrackPlanRow,
  scope: WorkspaceScope,
  actorId: string,
  input: { name: string; description?: string },
): Promise<TrackPlanTemplateRow> {
  const data = await captureTemplateData(plan, actorId);
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO track_plan_templates (id, team_id, owner_id, name, description, data, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, scope.teamId, scope.ownerId, input.name.trim(), input.description?.trim() ?? '', JSON.stringify(data), actorId, now, now);
  return (await getAccessiblePlanTemplate(id, scope)) as TrackPlanTemplateRow;
}

export async function updatePlanTemplate(id: string, patch: { name?: string; description?: string }): Promise<void> {
  const sets: string[] = [];
  const args: string[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    args.push(patch.description.trim());
  }
  if (!sets.length) return;
  await getDb()
    .prepare(`UPDATE track_plan_templates SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...args, nowIso(), id);
}

export async function deletePlanTemplate(id: string): Promise<void> {
  await getDb().prepare('DELETE FROM track_plan_templates WHERE id = ?').run(id);
}

/**
 * Valores del template para crear el project: lo que el formulario no eligió
 * (descripción, resumen, prioridad, ícono, teams, labels) sale del template.
 */
export function templateDefaults(data: PlanTemplateData) {
  return {
    summary: data.summary || undefined,
    description: data.description || undefined,
    priority: data.priority,
    icon: data.icon || undefined,
    teamIds: data.teamIds,
    labelIds: data.labelIds,
  };
}

/**
 * Crea en el project los milestones y los issues del template. Los issues van
 * al primer team del project que ve quien lo crea; sin team, no se crean (y se
 * avisa cuántos quedaron afuera).
 */
export async function applyTemplateToPlan(
  planId: string,
  data: PlanTemplateData,
  actorId: string,
): Promise<{ milestones: number; issues: number; skippedIssues: number }> {
  const db = getDb();
  const plan = await getPlan(planId);
  if (!plan) return { milestones: 0, issues: 0, skippedIssues: data.issues.length };
  const base = plan.start_date ?? null;
  const msIds: string[] = [];
  for (const m of data.milestones.slice(0, TEMPLATE_MAX_MILESTONES)) {
    msIds.push(
      await createPlanMilestone(planId, actorId, {
        name: m.name,
        description: m.description,
        targetDate: base && m.offsetDays !== null ? addDays(base, m.offsetDays) : null,
      }),
    );
  }
  const vis = trackVisibleSql('p', actorId);
  const team = (await db
    .prepare(
      `SELECT pt.project_id AS id FROM track_plan_teams pt JOIN track_projects p ON p.id = pt.project_id
       WHERE pt.plan_id = ? AND ${vis.sql} ORDER BY p.name COLLATE NOCASE ASC LIMIT 1`,
    )
    .get(planId, ...vis.args)) as { id: string } | undefined;
  if (!team) return { milestones: msIds.length, issues: 0, skippedIssues: data.issues.length };
  const created: string[] = [];
  const issues = data.issues.slice(0, TEMPLATE_MAX_ISSUES);
  for (let i = 0; i < issues.length; i++) {
    const it = issues[i];
    // Padres primero (captureTemplateData los ordena así): el padre ya existe.
    const parentId = it.parent !== null && it.parent < i ? created[it.parent] : undefined;
    const row = await createIssue(
      team.id,
      actorId,
      {
        title: it.title,
        description: it.description || undefined,
        priority: (['urgent', 'high', 'medium', 'low', 'none'].includes(it.priority) ? it.priority : 'none') as 'none',
        estimate: it.estimate ?? undefined,
        labels: it.labels.length ? it.labels : undefined,
        planId,
        planMilestoneId: it.milestone !== null ? msIds[it.milestone] : undefined,
        parentId,
      },
      { source: 'app' },
    );
    created.push(row.id);
  }
  return { milestones: msIds.length, issues: created.length, skippedIssues: 0 };
}
