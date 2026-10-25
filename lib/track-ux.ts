/**
 * Track — datos de la tanda de UX estilo Linear: vistas de equipo y
 * favoritas, reacciones e hilos en comentarios, presencia en el issue,
 * firmas para refrescar en vivo y referencias a issues (#ID) con su estado.
 */
import { getDb } from './db';
import type { TrackIssueViewRow } from './schema/types';
import type { IssueSort } from './track-views';

function nowIso() {
  return new Date().toISOString();
}

function scope(teamId: string | null, ownerId: string): { where: string; arg: string } {
  return teamId
    ? { where: 'p.team_id = ?', arg: teamId }
    : { where: '(p.team_id IS NULL AND p.owner_id = ?)', arg: ownerId };
}

// ---------- Vistas ----------

export interface TrackSavedView {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  view_type: 'list' | 'board' | 'calendar' | 'gantt';
  filters: Record<string, unknown>;
  sort: IssueSort;
  columns: string[] | null;
  is_default: boolean;
  shared: boolean;
  favorite: boolean;
  owner_name: string | null;
  /** Solo en la lista de favoritas del sidebar. */
  project_name?: string;
  project_icon?: string | null;
  created_at: string;
  updated_at: string;
}

type ViewRow = TrackIssueViewRow & {
  favorite: number;
  owner_name: string | null;
  owner_email: string | null;
  project_name?: string;
  project_icon?: string | null;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toView(row: ViewRow, userId: string): TrackSavedView {
  return {
    id: row.id,
    project_id: row.project_id,
    user_id: row.user_id,
    name: row.name,
    view_type: row.view_type,
    filters: parseJson(row.filters, {}),
    sort: row.sort as IssueSort,
    columns: row.columns ? parseJson<string[]>(row.columns, []) : null,
    // El "por defecto" es de quien creó la vista.
    is_default: row.is_default === 1 && row.user_id === userId,
    shared: row.shared === 1,
    favorite: row.favorite > 0,
    owner_name: row.owner_name ?? row.owner_email,
    ...(row.project_name !== undefined ? { project_name: row.project_name, project_icon: row.project_icon ?? null } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const VIEW_SELECT = `
  SELECT v.*, u.name AS owner_name, u.email AS owner_email,
    (SELECT COUNT(*) FROM track_view_favorites f WHERE f.view_id = v.id AND f.user_id = ?) AS favorite
  FROM track_issue_views v
  JOIN users u ON u.id = v.user_id`;

/** Vistas del proyecto que ve la persona: las suyas y las de equipo. */
export async function listProjectViews(projectId: string, userId: string): Promise<TrackSavedView[]> {
  const rows = (await getDb()
    .prepare(
      `${VIEW_SELECT}
       WHERE v.project_id = ? AND (v.user_id = ? OR v.shared = 1)
       ORDER BY (v.user_id = ? AND v.is_default = 1) DESC, v.shared ASC, v.name ASC`,
    )
    .all(userId, projectId, userId, userId)) as ViewRow[];
  return rows.map((r) => toView(r, userId));
}

export async function getSavedView(id: string, userId: string): Promise<TrackSavedView | undefined> {
  const row = (await getDb().prepare(`${VIEW_SELECT} WHERE v.id = ?`).get(userId, id)) as ViewRow | undefined;
  return row ? toView(row, userId) : undefined;
}

/** La persona puede abrir la vista: es suya o es de equipo (el acceso al proyecto se mira aparte). */
export function canSeeView(view: Pick<TrackSavedView, 'user_id' | 'shared'>, userId: string): boolean {
  return view.user_id === userId || view.shared;
}

export async function setViewShared(id: string, shared: boolean): Promise<void> {
  await getDb()
    .prepare('UPDATE track_issue_views SET shared = ?, updated_at = ? WHERE id = ?')
    .run(shared ? 1 : 0, nowIso(), id);
}

export async function setViewFavorite(viewId: string, userId: string, favorite: boolean): Promise<void> {
  const db = getDb();
  if (favorite) {
    await db
      .prepare('INSERT OR IGNORE INTO track_view_favorites (view_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(viewId, userId, nowIso());
  } else {
    await db.prepare('DELETE FROM track_view_favorites WHERE view_id = ? AND user_id = ?').run(viewId, userId);
  }
}

/** Favoritas de la persona en proyectos del workspace (para el sidebar). */
export async function listFavoriteViews(teamId: string | null, ownerId: string, userId: string): Promise<TrackSavedView[]> {
  const s = scope(teamId, ownerId);
  const rows = (await getDb()
    .prepare(
      `SELECT v.*, u.name AS owner_name, u.email AS owner_email, 1 AS favorite,
         p.name AS project_name, p.icon AS project_icon
       FROM track_view_favorites f
       JOIN track_issue_views v ON v.id = f.view_id
       JOIN users u ON u.id = v.user_id
       JOIN track_projects p ON p.id = v.project_id
       WHERE f.user_id = ? AND ${s.where} AND p.status = 'active' AND (v.user_id = ? OR v.shared = 1)
       ORDER BY f.created_at ASC
       LIMIT 50`,
    )
    .all(userId, s.arg, userId)) as ViewRow[];
  return rows.map((r) => toView(r, userId));
}

// ---------- Reacciones ----------

/** Emojis que ofrece el selector (los mismos de los comentarios de Board). */
export const TRACK_REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '😕', '👀', '🚀'] as const;

export function isAllowedReaction(emoji: string): boolean {
  return (TRACK_REACTIONS as readonly string[]).includes(emoji);
}

export interface CommentReaction {
  comment_id: string;
  emoji: string;
  user_id: string;
  user_name: string | null;
}

export async function listIssueReactions(issueId: string): Promise<CommentReaction[]> {
  return (await getDb()
    .prepare(
      `SELECT r.comment_id, r.emoji, r.user_id, COALESCE(u.name, u.email) AS user_name
       FROM track_comment_reactions r
       JOIN track_issue_comments c ON c.id = r.comment_id
       JOIN users u ON u.id = r.user_id
       WHERE c.issue_id = ?
       ORDER BY r.created_at ASC`,
    )
    .all(issueId)) as CommentReaction[];
}

/** Pone o saca la reacción de la persona; devuelve si quedó puesta. */
export async function toggleReaction(commentId: string, userId: string, emoji: string): Promise<boolean> {
  const db = getDb();
  const del = await db
    .prepare('DELETE FROM track_comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?')
    .run(commentId, userId, emoji);
  if (del.changes > 0) return false;
  await db
    .prepare('INSERT OR IGNORE INTO track_comment_reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
    .run(commentId, userId, emoji, nowIso());
  return true;
}

export async function getComment(
  issueId: string,
  commentId: string,
): Promise<{ id: string; user_id: string; parent_id: string | null } | undefined> {
  return (await getDb()
    .prepare('SELECT id, user_id, parent_id FROM track_issue_comments WHERE id = ? AND issue_id = ?')
    .get(commentId, issueId)) as { id: string; user_id: string; parent_id: string | null } | undefined;
}

/** Resuelve o reabre un hilo (siempre sobre el comentario raíz). */
export async function setThreadResolved(commentId: string, userId: string, resolved: boolean): Promise<void> {
  await getDb()
    .prepare('UPDATE track_issue_comments SET resolved_at = ?, resolved_by = ? WHERE id = ? AND parent_id IS NULL')
    .run(resolved ? nowIso() : null, resolved ? userId : null, commentId);
}

// ---------- Presencia ----------

const PRESENCE_WINDOW_S = 30;

export async function touchPresence(issueId: string, userId: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_issue_presence (issue_id, user_id, seen_at) VALUES (?, ?, ?)
       ON CONFLICT (issue_id, user_id) DO UPDATE SET seen_at = excluded.seen_at`,
    )
    .run(issueId, userId, nowIso());
}

export async function leavePresence(issueId: string, userId: string): Promise<void> {
  await getDb().prepare('DELETE FROM track_issue_presence WHERE issue_id = ? AND user_id = ?').run(issueId, userId);
}

export interface PresenceViewer {
  id: string;
  name: string;
}

/** Otras personas con el issue abierto en los últimos 30 s. */
export async function listPresence(issueId: string, exceptUserId: string): Promise<PresenceViewer[]> {
  const since = new Date(Date.now() - PRESENCE_WINDOW_S * 1000).toISOString();
  return (await getDb()
    .prepare(
      `SELECT u.id, COALESCE(u.name, u.email) AS name
       FROM track_issue_presence p JOIN users u ON u.id = p.user_id
       WHERE p.issue_id = ? AND p.user_id != ? AND p.seen_at >= ?
       ORDER BY p.seen_at DESC LIMIT 10`,
    )
    .all(issueId, exceptUserId, since)) as PresenceViewer[];
}

// ---------- Firmas para refrescar en vivo ----------

/**
 * Firma barata de los issues de un proyecto (o del workspace): cambia cuando
 * se crea, edita o borra un issue. El cliente sondea y recarga si cambió.
 */
export async function projectSignature(projectId: string): Promise<string> {
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n, MAX(updated_at) AS u, (SELECT COUNT(*) FROM track_issues WHERE project_id = ? AND triage = 1) AS t
       FROM track_issues WHERE project_id = ?`,
    )
    .get(projectId, projectId)) as { n: number; u: string | null; t: number };
  return `${row.n}:${row.u ?? ''}:${row.t}`;
}

export async function workspaceSignature(teamId: string | null, ownerId: string): Promise<string> {
  const s = scope(teamId, ownerId);
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n, MAX(i.updated_at) AS u
       FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE ${s.where}`,
    )
    .get(s.arg)) as { n: number; u: string | null };
  return `${row.n}:${row.u ?? ''}`;
}

/** Firma del issue abierto: el issue, sus sub-issues, actividad, comentarios, reacciones y adjuntos. */
export async function issueSignature(issueId: string): Promise<string> {
  const row = (await getDb()
    .prepare(
      `SELECT
         (SELECT updated_at FROM track_issues WHERE id = ?) AS u,
         (SELECT COUNT(*) || '/' || COALESCE(MAX(updated_at), '') || '/' || COALESCE(SUM(COALESCE(sub_order, 0)), 0)
            FROM track_issues WHERE parent_id = ?) AS ch,
         (SELECT COUNT(*) || '/' || COALESCE(MAX(created_at), '') FROM track_issue_activities WHERE issue_id = ?) AS a,
         (SELECT COUNT(*) || '/' || COALESCE(MAX(COALESCE(updated_at, created_at)), '') || '/' || COALESCE(MAX(resolved_at), '') || '/' || COUNT(resolved_at)
            FROM track_issue_comments WHERE issue_id = ?) AS c,
         (SELECT COUNT(*) || '/' || COALESCE(MAX(r.created_at), '')
            FROM track_comment_reactions r JOIN track_issue_comments c ON c.id = r.comment_id WHERE c.issue_id = ?) AS r,
         (SELECT COUNT(*) FROM track_issue_attachments WHERE issue_id = ?) AS f,
         (SELECT COUNT(*) FROM track_issue_relations WHERE issue_id = ? OR related_issue_id = ?) AS rel`,
    )
    .get(issueId, issueId, issueId, issueId, issueId, issueId, issueId, issueId)) as Record<string, string | number | null>;
  if (row.u == null) return 'gone';
  return [row.u, row.ch, row.a, row.c, row.r, row.f, row.rel].join('|');
}

// ---------- Referencias a issues ----------

export interface IssueRef {
  id: string;
  identifier: string;
  title: string;
  status_name: string | null;
  status_color: string | null;
  status_category: string | null;
}

/** Identificadores (ZER-12) e ids → issue con su estado, solo del workspace de la persona. */
export async function resolveIssueRefs(
  refs: string[],
  teamId: string | null,
  ownerId: string,
): Promise<IssueRef[]> {
  const list = Array.from(new Set(refs.map((r) => r.trim()).filter((r) => r && r.length <= 80))).slice(0, 50);
  if (list.length === 0) return [];
  const s = scope(teamId, ownerId);
  const ph = list.map(() => '?').join(', ');
  return (await getDb()
    .prepare(
      `SELECT i.id, i.identifier, i.title, st.name AS status_name, st.color AS status_color, st.category AS status_category
       FROM track_issues i
       JOIN track_projects p ON p.id = i.project_id
       LEFT JOIN track_statuses st ON st.id = i.status_id
       WHERE ${s.where} AND (i.identifier IN (${ph}) OR i.id IN (${ph}))`,
    )
    .all(s.arg, ...list, ...list)) as IssueRef[];
}
