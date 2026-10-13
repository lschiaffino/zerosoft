/**
 * Track — edición masiva y triage.
 *
 * Edición masiva: cada issue se valida contra el workspace del usuario (los
 * ajenos se saltean como not_found) y los valores dependientes del proyecto
 * (status, cycle, assignee) contra el proyecto de cada issue. Se aplica con
 * updateIssue para conservar actividad y notificaciones.
 *
 * Triage: los issues creados desde afuera con triage activo quedan con
 * triage = 1, fuera de las listas, hasta que alguien los acepta (con un
 * status), los rechaza (pasan a cancelado) o los marca como duplicados.
 */
import { getDb } from './db';
import type { TrackProjectRow } from './db';
import {
  canAccessTrackProject,
  createIssueRelation,
  deleteIssue,
  getIssue,
  getProject,
  listProjectMembers,
  updateIssue,
  type TrackIssueWithStatus,
} from './track-data';
import { labelsByIds, parseIssueLabels, projectWorkspaceId } from './track-labels';
import type { BulkIssuesPayload, IssueUpdatePayload, TriageActionPayload } from './track-schema';

export interface BulkResult {
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
}

interface Scope {
  teamId: string | null;
  ownerId: string;
  actorId: string;
}

async function accessible(
  issueId: string,
  scope: Scope,
  cache: Map<string, TrackProjectRow | null>,
): Promise<{ issue: TrackIssueWithStatus; project: TrackProjectRow } | null> {
  const issue = await getIssue(issueId);
  if (!issue) return null;
  if (!cache.has(issue.project_id)) {
    const p = await getProject(issue.project_id);
    cache.set(issue.project_id, p && canAccessTrackProject(p, scope.teamId, scope.ownerId) ? p : null);
  }
  const project = cache.get(issue.project_id);
  return project ? { issue, project } : null;
}

export async function bulkEditIssues(payload: BulkIssuesPayload, scope: Scope): Promise<BulkResult> {
  const db = getDb();
  const result: BulkResult = { updated: [], skipped: [] };
  const projects = new Map<string, TrackProjectRow | null>();
  const members = new Map<string, Set<string>>();
  const ids = Array.from(new Set(payload.issueIds));

  for (const id of ids) {
    const found = await accessible(id, scope, projects);
    if (!found) {
      result.skipped.push({ id, reason: 'not_found' });
      continue;
    }
    const { issue, project } = found;

    if (payload.action === 'delete') {
      await deleteIssue(issue.id);
      result.updated.push(issue.id);
      continue;
    }

    const p = payload.patch;
    const patch: IssueUpdatePayload = {};
    if (p.statusId !== undefined) {
      const ok = await db
        .prepare('SELECT id FROM track_statuses WHERE id = ? AND project_id = ?')
        .get(p.statusId, issue.project_id);
      if (!ok) {
        result.skipped.push({ id, reason: 'invalid_status' });
        continue;
      }
      patch.statusId = p.statusId;
    }
    if (p.cycleId !== undefined) {
      if (p.cycleId !== null) {
        const ok = await db
          .prepare('SELECT id FROM track_cycles WHERE id = ? AND project_id = ?')
          .get(p.cycleId, issue.project_id);
        if (!ok) {
          result.skipped.push({ id, reason: 'invalid_cycle' });
          continue;
        }
      }
      patch.cycleId = p.cycleId;
    }
    if (p.assigneeId !== undefined) {
      if (p.assigneeId !== null) {
        if (!members.has(project.id)) {
          const list = await listProjectMembers(project.id, scope.ownerId);
          members.set(project.id, new Set(list.map((m) => m.id)));
        }
        if (!members.get(project.id)!.has(p.assigneeId)) {
          result.skipped.push({ id, reason: 'invalid_assignee' });
          continue;
        }
      }
      patch.assigneeId = p.assigneeId;
    }
    if (p.priority !== undefined) patch.priority = p.priority;
    if (p.addLabelIds?.length || p.removeLabelIds?.length) {
      const ws = projectWorkspaceId(project);
      const add = ws ? await labelsByIds(ws, p.addLabelIds ?? []) : [];
      const remove = new Set(p.removeLabelIds ?? []);
      const current = parseIssueLabels(issue.labels).filter((l) => !remove.has(l.id));
      for (const l of add) if (!current.some((c) => c.id === l.id)) current.push(l);
      patch.labels = current.slice(0, 10);
    }
    await updateIssue(issue.id, patch, scope.actorId);
    result.updated.push(issue.id);
  }
  return result;
}

// ---------- Triage ----------

export async function listTriageIssues(projectId: string): Promise<TrackIssueWithStatus[]> {
  const rows = (await getDb()
    .prepare('SELECT id FROM track_issues WHERE project_id = ? AND triage = 1 ORDER BY created_at DESC LIMIT 200')
    .all(projectId)) as Array<{ id: string }>;
  const out: TrackIssueWithStatus[] = [];
  for (const r of rows) {
    const issue = await getIssue(r.id);
    if (issue) out.push(issue);
  }
  return out;
}

export async function countTriage(projectId: string): Promise<number> {
  return (
    (await getDb()
      .prepare('SELECT COUNT(*) AS c FROM track_issues WHERE project_id = ? AND triage = 1')
      .get(projectId)) as { c: number }
  ).c;
}

export type TriageResult =
  | { ok: true; issue: TrackIssueWithStatus }
  | { ok: false; reason: 'not_in_triage' | 'invalid_status' | 'invalid_duplicate' | 'no_cancelled_status' };

async function firstStatusOf(projectId: string, category: string): Promise<string | null> {
  const row = (await getDb()
    .prepare('SELECT id FROM track_statuses WHERE project_id = ? AND category = ? ORDER BY position ASC LIMIT 1')
    .get(projectId, category)) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Resuelve un issue en triage. El llamador ya validó que el issue es del
 * workspace del usuario. Para duplicate, el original tiene que ser del mismo
 * workspace y no estar en triage.
 */
export async function resolveTriage(
  issue: TrackIssueWithStatus,
  action: TriageActionPayload,
  actorId: string,
): Promise<TriageResult> {
  if (!issue.triage) return { ok: false, reason: 'not_in_triage' };
  const db = getDb();

  if (action.action === 'accept') {
    let statusId = action.statusId ?? null;
    if (statusId) {
      const ok = await db
        .prepare('SELECT id FROM track_statuses WHERE id = ? AND project_id = ?')
        .get(statusId, issue.project_id);
      if (!ok) return { ok: false, reason: 'invalid_status' };
    } else {
      statusId = (await firstStatusOf(issue.project_id, 'todo')) ?? issue.status_id;
    }
    await db.prepare("UPDATE track_issues SET triage = 0, updated_at = datetime('now') WHERE id = ?").run(issue.id);
    if (statusId && statusId !== issue.status_id) await updateIssue(issue.id, { statusId }, actorId);
    return { ok: true, issue: (await getIssue(issue.id)) as TrackIssueWithStatus };
  }

  const cancelled = await firstStatusOf(issue.project_id, 'cancelled');
  if (!cancelled) return { ok: false, reason: 'no_cancelled_status' };

  if (action.action === 'duplicate') {
    if (action.duplicateOfId === issue.id) return { ok: false, reason: 'invalid_duplicate' };
    const original = await getIssue(action.duplicateOfId);
    const [a, b] = await Promise.all([
      getProject(issue.project_id),
      original ? getProject(original.project_id) : Promise.resolve(undefined),
    ]);
    if (!original || original.triage || !a || !b || projectWorkspaceId(a) !== projectWorkspaceId(b)) {
      return { ok: false, reason: 'invalid_duplicate' };
    }
    await db.prepare("UPDATE track_issues SET triage = 0, updated_at = datetime('now') WHERE id = ?").run(issue.id);
    await createIssueRelation(issue.id, actorId, original.id, 'duplicates').catch(() => undefined);
    await updateIssue(issue.id, { statusId: cancelled }, actorId);
    return { ok: true, issue: (await getIssue(issue.id)) as TrackIssueWithStatus };
  }

  await db.prepare("UPDATE track_issues SET triage = 0, updated_at = datetime('now') WHERE id = ?").run(issue.id);
  await updateIssue(issue.id, { statusId: cancelled }, actorId);
  return { ok: true, issue: (await getIssue(issue.id)) as TrackIssueWithStatus };
}
