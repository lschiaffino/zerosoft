/**
 * Track — Insights (como Linear): lee los issues del workspace con los
 * filtros pedidos y los agrega con lib/track-planning-core (aggregateInsight).
 * Inicio y fin salen de la actividad: el primer paso a un status "in
 * progress" y el último cierre como done.
 */
import { getDb } from './db';
import { scopeWhere, type WorkspaceScope } from './track-plans';
import { labelIdLike } from './track-views';
import { aggregateInsight, type InsightIssue, type InsightResult, type StatusCategory } from './track-planning-core';
import type { InsightFilters, InsightQuery } from './track-planning-schema';

const MAX_ISSUES = 5000;

function inClause(n: number): string {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

/** Une filtros del dashboard y del widget: cada lista se intersecta, las fechas se ajustan. */
export function mergeFilters(base: InsightFilters = {}, extra: InsightFilters = {}): InsightFilters {
  const both = <T>(a?: T[], b?: T[]): T[] | undefined => {
    if (a?.length && b?.length) return a.filter((x) => b.includes(x));
    return a?.length ? a : b?.length ? b : undefined;
  };
  const maxDay = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : a ?? b);
  const minDay = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : a ?? b);
  return {
    teamIds: both(base.teamIds, extra.teamIds),
    planIds: both(base.planIds, extra.planIds),
    labelIds: both(base.labelIds, extra.labelIds),
    assigneeIds: both(base.assigneeIds, extra.assigneeIds),
    cycleIds: both(base.cycleIds, extra.cycleIds),
    statusTypes: both(base.statusTypes, extra.statusTypes),
    createdAfter: maxDay(base.createdAfter, extra.createdAfter),
    createdBefore: minDay(base.createdBefore, extra.createdBefore),
    includeArchived: Boolean(base.includeArchived || extra.includeArchived),
  };
}

export async function loadInsightIssues(scope: WorkspaceScope, filters: InsightFilters): Promise<InsightIssue[]> {
  const s = scopeWhere(scope, 'p');
  const where = [s.where, "p.status = 'active'", 'i.triage = 0'];
  const args: Array<string | number> = [s.arg];
  if (!filters.includeArchived) where.push('i.archived_at IS NULL');
  const list = (col: string, ids?: string[]) => {
    if (!ids?.length) return;
    where.push(`${col} IN ${inClause(ids.length)}`);
    args.push(...ids);
  };
  list('i.project_id', filters.teamIds);
  list('i.plan_id', filters.planIds);
  list('i.assignee_id', filters.assigneeIds);
  list('i.cycle_id', filters.cycleIds);
  list('s.category', filters.statusTypes);
  if (filters.labelIds?.length) {
    where.push(`(${filters.labelIds.map(() => "i.labels LIKE ? ESCAPE '\\'").join(' OR ')})`);
    args.push(...filters.labelIds.map(labelIdLike));
  }
  if (filters.createdAfter) {
    where.push('substr(i.created_at, 1, 10) >= ?');
    args.push(filters.createdAfter);
  }
  if (filters.createdBefore) {
    where.push('substr(i.created_at, 1, 10) <= ?');
    args.push(filters.createdBefore);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT i.id, i.identifier, i.title, i.project_id, p.name AS project_name, s.name AS status_name, s.category,
         i.priority, i.assignee_id, u.name AS assignee_name, u.email AS assignee_email, i.labels, i.plan_id, pl.name AS plan_name,
         i.cycle_id, c.name AS cycle_name, i.estimate, i.created_at, i.updated_at,
         (SELECT MIN(a.created_at) FROM track_issue_activities a WHERE a.issue_id = i.id AND a.type = 'status_change'
            AND json_extract(a.meta, '$.toCategory') = 'in_progress') AS started_at,
         (SELECT MAX(a.created_at) FROM track_issue_activities a WHERE a.issue_id = i.id AND a.type = 'closed'
            AND json_extract(a.meta, '$.category') = 'done') AS completed_at
       FROM track_issues i
       JOIN track_projects p ON p.id = i.project_id
       LEFT JOIN track_statuses s ON s.id = i.status_id
       LEFT JOIN users u ON u.id = i.assignee_id
       LEFT JOIN track_plans pl ON pl.id = i.plan_id
       LEFT JOIN track_cycles c ON c.id = i.cycle_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.created_at DESC LIMIT ${MAX_ISSUES}`,
    )
    .all(...args)) as Array<{
    id: string;
    identifier: string;
    title: string;
    project_id: string;
    project_name: string;
    status_name: string | null;
    category: StatusCategory | null;
    priority: string;
    assignee_id: string | null;
    assignee_name: string | null;
    assignee_email: string | null;
    labels: string;
    plan_id: string | null;
    plan_name: string | null;
    cycle_id: string | null;
    cycle_name: string | null;
    estimate: number | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
  }>;
  const iso = (v: string) => (v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
  return rows.map((r) => {
    let labels: Array<{ id: string; name: string }> = [];
    try {
      const parsed = JSON.parse(r.labels || '[]') as Array<{ id?: string; name?: string }>;
      labels = parsed.filter((l) => l && l.id).map((l) => ({ id: String(l.id), name: String(l.name ?? '') }));
    } catch {
      labels = [];
    }
    // Issues cerrados antes de que existiera la actividad 'closed': su última edición.
    const completedAt = r.category === 'done' ? (r.completed_at ?? r.updated_at) : null;
    return {
      id: r.id,
      identifier: r.identifier,
      title: r.title,
      projectId: r.project_id,
      projectName: r.project_name,
      statusName: r.status_name,
      category: r.category,
      priority: r.priority,
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_name || r.assignee_email,
      labels,
      planId: r.plan_id,
      planName: r.plan_name,
      cycleId: r.cycle_id,
      cycleName: r.cycle_name,
      estimate: r.estimate,
      createdAt: iso(r.created_at),
      startedAt: r.started_at ? iso(r.started_at) : null,
      completedAt: completedAt ? iso(completedAt) : null,
    };
  });
}

export async function runInsight(scope: WorkspaceScope, query: InsightQuery, now: Date = new Date()): Promise<InsightResult> {
  const issues = await loadInsightIssues(scope, query.filters ?? {});
  return aggregateInsight(issues, query, now);
}
