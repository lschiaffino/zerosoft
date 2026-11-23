/**
 * Track — Releases, como en Linear: una versión de un team (nombre, versión,
 * fecha objetivo y estado planned / in_progress / released) con sus issues,
 * su avance y notas generadas de los títulos (editables).
 *
 * Un release es de un team y se ve con las mismas reglas que el team (privados
 * e invitados, lib/track-access): quien no ve el team no ve el release ni sus
 * issues. Un issue va en un release de su propio team, uno a la vez
 * (track_issues.release_id); mover el issue de team lo saca del release.
 *
 * Entran solos los issues de un PR vinculado que se mergea (GitHub), al
 * release en curso del team (el primero "in progress"; si no hay, el
 * "planned" con la fecha más cercana) que tenga esa opción prendida.
 */
import { getDb } from './db';
import type { TrackProjectRow } from './db';
import { canAccessTrackProject, getIssue, getProject, projectScope, updateIssue, type TrackIssueWithStatus } from './track-data';
export { generateReleaseNotes, type NotesLabels } from './track-release-notes';

export const RELEASE_STATUSES = ['planned', 'in_progress', 'released'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export interface TrackRelease {
  id: string;
  project_id: string;
  name: string;
  version: string;
  target_date: string | null;
  status: ReleaseStatus;
  released_at: string | null;
  /** null = notas generadas de los títulos. */
  notes: string | null;
  auto_github: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackReleaseWithProgress extends TrackRelease {
  team_name: string;
  team_key: string;
  total: number;
  done: number;
  cancelled: number;
}

export class ReleaseError extends Error {
  constructor(
    public code: 'not_found' | 'invalid_team' | 'invalid_issue' | 'invalid_release',
    public status: number,
  ) {
    super(code);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

const PROGRESS_SQL = `
  (SELECT COUNT(*) FROM track_issues i WHERE i.release_id = r.id) AS total,
  (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id WHERE i.release_id = r.id AND s.category = 'done') AS done,
  (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id WHERE i.release_id = r.id AND s.category = 'cancelled') AS cancelled`;

/** Avance como Linear: terminados sobre lo que no se canceló (0 a 100). */
export function releaseProgress(r: Pick<TrackReleaseWithProgress, 'total' | 'done' | 'cancelled'>): number {
  const scope = Number(r.total) - Number(r.cancelled);
  return scope > 0 ? Math.round((Number(r.done) / scope) * 100) : 0;
}

/** Releases de los teams que la persona ve en el workspace (o de uno). */
export async function listReleases(
  teamId: string | null,
  ownerId: string,
  opts: { projectId?: string; status?: ReleaseStatus } = {},
): Promise<TrackReleaseWithProgress[]> {
  const scope = await projectScope(teamId, ownerId, 'p');
  const where = [scope.where];
  const args: Array<string> = [...scope.args];
  if (opts.projectId) {
    where.push('r.project_id = ?');
    args.push(opts.projectId);
  }
  if (opts.status) {
    where.push('r.status = ?');
    args.push(opts.status);
  }
  return (await getDb()
    .prepare(
      `SELECT r.*, p.name AS team_name, p.slug AS team_key, ${PROGRESS_SQL}
       FROM track_releases r JOIN track_projects p ON p.id = r.project_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE r.status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
         CASE WHEN r.status = 'released' THEN r.released_at END DESC,
         r.target_date IS NULL, r.target_date ASC, r.created_at DESC
       LIMIT 500`,
    )
    .all(...args)) as TrackReleaseWithProgress[];
}

export async function getRelease(id: string): Promise<TrackRelease | undefined> {
  return (await getDb().prepare('SELECT * FROM track_releases WHERE id = ?').get(id)) as TrackRelease | undefined;
}

/** El release, si la persona ve su team en este workspace; si no, undefined (404, sin decir si existe). */
export async function getAccessibleRelease(
  id: string,
  teamId: string | null,
  ownerId: string,
): Promise<{ release: TrackReleaseWithProgress; project: TrackProjectRow } | undefined> {
  const release = (await getDb()
    .prepare(`SELECT r.*, p.name AS team_name, p.slug AS team_key, ${PROGRESS_SQL} FROM track_releases r JOIN track_projects p ON p.id = r.project_id WHERE r.id = ?`)
    .get(id)) as TrackReleaseWithProgress | undefined;
  if (!release) return undefined;
  const project = await getProject(release.project_id);
  if (!project || !(await canAccessTrackProject(project, teamId, ownerId))) return undefined;
  return { release, project };
}

export interface ReleaseInput {
  name?: string;
  version?: string;
  targetDate?: string | null;
  status?: ReleaseStatus;
  /** null vuelve a las notas generadas. */
  notes?: string | null;
  autoGithub?: boolean;
}

export async function createRelease(projectId: string, actorId: string, input: ReleaseInput & { name: string }): Promise<TrackRelease> {
  const id = crypto.randomUUID();
  const now = nowIso();
  const status = input.status ?? 'planned';
  await getDb()
    .prepare(
      `INSERT INTO track_releases (id, project_id, name, version, target_date, status, released_at, notes, auto_github, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      input.name.trim(),
      (input.version ?? '').trim(),
      input.targetDate ?? null,
      status,
      status === 'released' ? now : null,
      input.notes ?? null,
      input.autoGithub === false ? 0 : 1,
      actorId,
      now,
      now,
    );
  return (await getRelease(id)) as TrackRelease;
}

export async function updateRelease(id: string, input: ReleaseInput): Promise<TrackRelease | undefined> {
  const existing = await getRelease(id);
  if (!existing) return undefined;
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  if (input.name !== undefined) {
    fields.push('name = ?');
    args.push(input.name.trim());
  }
  if (input.version !== undefined) {
    fields.push('version = ?');
    args.push(input.version.trim());
  }
  if (input.targetDate !== undefined) {
    fields.push('target_date = ?');
    args.push(input.targetDate);
  }
  if (input.status !== undefined && input.status !== existing.status) {
    fields.push('status = ?', 'released_at = ?');
    args.push(input.status, input.status === 'released' ? nowIso() : null);
  }
  if (input.notes !== undefined) {
    fields.push('notes = ?');
    args.push(input.notes === null ? null : input.notes);
  }
  if (input.autoGithub !== undefined) {
    fields.push('auto_github = ?');
    args.push(input.autoGithub ? 1 : 0);
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  args.push(nowIso());
  await getDb().prepare(`UPDATE track_releases SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
  return getRelease(id);
}

/** Borra el release; sus issues quedan sin release. */
export async function deleteRelease(id: string): Promise<boolean> {
  const db = getDb();
  await db.prepare("UPDATE track_issues SET release_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE release_id = ?").run(id);
  const res = await db.prepare('DELETE FROM track_releases WHERE id = ?').run(id);
  return res.changes > 0;
}

/** Issues del release (todos los del team del release: quien ve el release los ve). */
export async function listReleaseIssues(releaseId: string): Promise<TrackIssueWithStatus[]> {
  const { issueSelect } = await import('./track-data');
  return (await getDb()
    .prepare(`${issueSelect('WHERE i.release_id = ?')} ORDER BY i.created_at ASC LIMIT 1000`)
    .all(releaseId)) as TrackIssueWithStatus[];
}

/**
 * Suma o saca issues del release. Solo issues del mismo team del release que
 * la persona ve; los demás se informan como salteados.
 */
export async function setReleaseIssues(
  release: TrackRelease,
  issueIds: string[],
  attach: boolean,
  actorId: string,
): Promise<{ updated: string[]; skipped: string[] }> {
  const out = { updated: [] as string[], skipped: [] as string[] };
  for (const id of Array.from(new Set(issueIds)).slice(0, 200)) {
    const issue = await getIssue(id);
    if (!issue || issue.project_id !== release.project_id) {
      out.skipped.push(id);
      continue;
    }
    if (!attach && issue.release_id !== release.id) {
      out.skipped.push(id);
      continue;
    }
    await updateIssue(id, { releaseId: attach ? release.id : null }, actorId);
    out.updated.push(id);
  }
  return out;
}

/**
 * Un PR vinculado se mergeó: el issue entra al release en curso de su team
 * (si no tiene uno y el release acepta los de GitHub). Devuelve el release.
 */
export async function attachMergedIssue(issueId: string, actorId: string): Promise<string | null> {
  const issue = await getIssue(issueId);
  if (!issue || issue.release_id) return null;
  const target = (await getDb()
    .prepare(
      `SELECT id FROM track_releases
       WHERE project_id = ? AND auto_github = 1 AND status IN ('in_progress', 'planned')
       ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, target_date IS NULL, target_date ASC, created_at ASC
       LIMIT 1`,
    )
    .get(issue.project_id)) as { id: string } | undefined;
  if (!target) return null;
  // Compare-and-set: dos entregas del mismo merge no lo suman dos veces.
  const res = await getDb()
    .prepare("UPDATE track_issues SET release_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND release_id IS NULL")
    .run(target.id, issueId);
  if (res.changes === 0) return null;
  const { createIssueActivity } = await import('./track-data');
  const name = ((await getDb().prepare('SELECT name, version FROM track_releases WHERE id = ?').get(target.id)) as { name: string; version: string } | undefined);
  await createIssueActivity(issueId, actorId, 'cycle_change', {
    field: 'release',
    from: '',
    to: [name?.name, name?.version].filter(Boolean).join(' '),
    via: 'github',
  });
  return target.id;
}

/** Releases de un team para los selectores (el issue, la paleta, filtros), los abiertos primero. */
export async function listTeamReleaseOptions(projectId: string): Promise<Array<{ id: string; name: string; version: string; status: ReleaseStatus; project_id: string }>> {
  return (await getDb()
    .prepare(
      `SELECT id, name, version, status, project_id FROM track_releases WHERE project_id = ?
       ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, target_date IS NULL, target_date ASC, created_at DESC LIMIT 200`,
    )
    .all(projectId)) as Array<{ id: string; name: string; version: string; status: ReleaseStatus; project_id: string }>;
}
