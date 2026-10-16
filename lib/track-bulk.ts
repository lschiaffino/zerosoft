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
  deleteIssueTree,
  getIssue,
  getProject,
  listProjectMembers,
  listProjectTriageIssues,
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

export type IssueRefError = 'invalid_status' | 'invalid_cycle' | 'invalid_assignee' | 'invalid_parent';

/**
 * Valida las referencias de un payload de issue contra su proyecto: el status
 * y el cycle tienen que ser del mismo proyecto, el assignee un miembro del
 * proyecto y el parent un issue del mismo workspace que no genere un ciclo
 * (el issue no puede quedar colgado de sí mismo ni de un descendiente).
 * Devuelve el primer error o null. `issueId` es el issue que se edita (no se
 * pasa al crear). `members` cachea los miembros por proyecto entre llamadas.
 */
export async function validateIssueRefs(
  project: TrackProjectRow,
  refs: { statusId?: string | null; cycleId?: string | null; assigneeId?: string | null; parentId?: string | null },
  opts: { ownerId: string; issueId?: string; members?: Map<string, Set<string>> },
): Promise<IssueRefError | null> {
  const db = getDb();
  if (refs.statusId) {
    const ok = await db
      .prepare('SELECT id FROM track_statuses WHERE id = ? AND project_id = ?')
      .get(refs.statusId, project.id);
    if (!ok) return 'invalid_status';
  }
  if (refs.cycleId) {
    const ok = await db
      .prepare('SELECT id FROM track_cycles WHERE id = ? AND project_id = ?')
      .get(refs.cycleId, project.id);
    if (!ok) return 'invalid_cycle';
  }
  if (refs.assigneeId) {
    const members = opts.members ?? new Map<string, Set<string>>();
    if (!members.has(project.id)) {
      const list = await listProjectMembers(project.id, opts.ownerId);
      members.set(project.id, new Set(list.map((m) => m.id)));
    }
    if (!members.get(project.id)!.has(refs.assigneeId)) return 'invalid_assignee';
  }
  if (refs.parentId) {
    if (refs.parentId === opts.issueId) return 'invalid_parent';
    const parent = await getIssue(refs.parentId);
    const parentProject = parent
      ? parent.project_id === project.id
        ? project
        : await getProject(parent.project_id)
      : undefined;
    if (!parent || !parentProject || projectWorkspaceId(parentProject) !== projectWorkspaceId(project)) {
      return 'invalid_parent';
    }
    if (opts.issueId) {
      // Subir por la cadena de padres: si aparece el issue editado, sería un ciclo.
      const seen = new Set<string>();
      let current: string | null = parent.parent_id;
      while (current && !seen.has(current)) {
        if (current === opts.issueId) return 'invalid_parent';
        seen.add(current);
        const row = (await db.prepare('SELECT parent_id FROM track_issues WHERE id = ?').get(current)) as
          | { parent_id: string | null }
          | undefined;
        current = row?.parent_id ?? null;
      }
    }
  }
  return null;
}

export async function bulkEditIssues(payload: BulkIssuesPayload, scope: Scope): Promise<BulkResult> {
  const result: BulkResult = { updated: [], skipped: [] };
  const projects = new Map<string, TrackProjectRow | null>();
  const members = new Map<string, Set<string>>();
  const ids = Array.from(new Set(payload.issueIds));
  // Subtasks que ya se borraron junto con un padre seleccionado.
  const deleted = new Set<string>();

  for (const id of ids) {
    if (deleted.has(id)) {
      result.updated.push(id);
      continue;
    }
    const found = await accessible(id, scope, projects);
    if (!found) {
      result.skipped.push({ id, reason: 'not_found' });
      continue;
    }
    const { issue, project } = found;

    if (payload.action === 'delete') {
      for (const gone of await deleteIssueTree(issue.id)) deleted.add(gone);
      result.updated.push(issue.id);
      continue;
    }

    const p = payload.patch;
    const invalid = await validateIssueRefs(project, p, { ownerId: scope.ownerId, members });
    if (invalid) {
      result.skipped.push({ id, reason: invalid });
      continue;
    }
    const patch: IssueUpdatePayload = {};
    if (p.statusId !== undefined) patch.statusId = p.statusId;
    if (p.cycleId !== undefined) patch.cycleId = p.cycleId;
    if (p.assigneeId !== undefined) patch.assigneeId = p.assigneeId;
    if (p.priority !== undefined) patch.priority = p.priority;
    if (p.addLabelIds?.length || p.removeLabelIds?.length) {
      const ws = projectWorkspaceId(project);
      const add = ws ? await labelsByIds(ws, p.addLabelIds ?? []) : [];
      // Labels borrados o de otro workspace: no se cuenta como actualizado.
      if (p.addLabelIds?.length && add.length === 0) {
        result.skipped.push({ id, reason: 'invalid_label' });
        continue;
      }
      const remove = new Set(p.removeLabelIds ?? []);
      const current = parseIssueLabels(issue.labels).filter((l) => !remove.has(l.id));
      const kept = current.length;
      for (const l of add) if (!current.some((c) => c.id === l.id)) current.push(l);
      // Si el label nuevo no entra (tope de 10) no se recorta en silencio
      // contándolo como actualizado: se informa como salteado.
      if (current.length > 10 && current.length > kept) {
        result.skipped.push({ id, reason: 'too_many_labels' });
        continue;
      }
      patch.labels = current.slice(0, 10);
    }
    await updateIssue(issue.id, patch, scope.actorId);
    result.updated.push(issue.id);
  }
  return result;
}

// ---------- Triage ----------

export async function listTriageIssues(projectId: string): Promise<TrackIssueWithStatus[]> {
  return listProjectTriageIssues(projectId, 200);
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
 * Busca un issue por identifier (sin distinguir mayúsculas) en cualquier
 * proyecto del workspace al que pertenece `projectId`. Si hay más de uno
 * con ese identifier devuelve undefined.
 */
export async function findWorkspaceIssueByIdentifier(
  projectId: string,
  identifier: string,
): Promise<TrackIssueWithStatus | undefined> {
  const project = await getProject(projectId);
  const ws = project ? projectWorkspaceId(project) : null;
  if (!ws) return undefined;
  const rows = (await getDb()
    .prepare(
      `SELECT i.id FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE COALESCE(p.team_id, p.owner_id) = ? AND UPPER(i.identifier) = ? LIMIT 2`,
    )
    .all(ws, identifier.trim().toUpperCase())) as Array<{ id: string }>;
  // Datos viejos pueden tener el mismo identifier en dos proyectos (un slug
  // reusado): ante la ambigüedad no se elige uno cualquiera.
  return rows.length === 1 ? getIssue(rows[0].id) : undefined;
}

/**
 * Saca el issue de triage de forma atómica. Devuelve false si otro request ya
 * lo resolvió (la copia que leyó el llamador puede estar vieja).
 */
async function claimTriage(issueId: string): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE track_issues SET triage = 0, updated_at = datetime('now') WHERE id = ? AND triage = 1")
    .run(issueId);
  return res.changes > 0;
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
    if (!(await claimTriage(issue.id))) return { ok: false, reason: 'not_in_triage' };
    if (statusId && statusId !== issue.status_id) await updateIssue(issue.id, { statusId }, actorId);
    return { ok: true, issue: (await getIssue(issue.id)) as TrackIssueWithStatus };
  }

  const cancelled = await firstStatusOf(issue.project_id, 'cancelled');
  if (!cancelled) return { ok: false, reason: 'no_cancelled_status' };

  if (action.action === 'duplicate') {
    const original = action.duplicateOfId
      ? await getIssue(action.duplicateOfId)
      : action.duplicateOfIdentifier
        ? await findWorkspaceIssueByIdentifier(issue.project_id, action.duplicateOfIdentifier)
        : undefined;
    if (original?.id === issue.id) return { ok: false, reason: 'invalid_duplicate' };
    const [a, b] = await Promise.all([
      getProject(issue.project_id),
      original ? getProject(original.project_id) : Promise.resolve(undefined),
    ]);
    if (!original || original.triage || !a || !b || projectWorkspaceId(a) !== projectWorkspaceId(b)) {
      return { ok: false, reason: 'invalid_duplicate' };
    }
    if (!(await claimTriage(issue.id))) return { ok: false, reason: 'not_in_triage' };
    await createIssueRelation(issue.id, actorId, original.id, 'duplicates').catch(() => undefined);
    await updateIssue(issue.id, { statusId: cancelled }, actorId);
    return { ok: true, issue: (await getIssue(issue.id)) as TrackIssueWithStatus };
  }

  if (!(await claimTriage(issue.id))) return { ok: false, reason: 'not_in_triage' };
  await updateIssue(issue.id, { statusId: cancelled }, actorId);
  return { ok: true, issue: (await getIssue(issue.id)) as TrackIssueWithStatus };
}
