/**
 * Track — suscripción a issues.
 *
 * Quien crea un issue, quien queda asignado y quien comenta se suscribe solo.
 * Cualquiera del workspace puede suscribirse o darse de baja a mano; la baja
 * queda guardada (subscribed = 0) y una nueva acción no lo vuelve a suscribir.
 * Los issues de antes de esta tabla no tienen filas: su creador y su asignado
 * cuentan como suscriptos salvo que se den de baja.
 *
 * Los avisos (comentarios, cambios de status y del issue) van a la bandeja de
 * Track de los suscriptos, nunca a quien hizo el cambio.
 */
import { ownerSpaceSql } from './workspace';
import { getDb } from './db';
import { trackVisibleExpr } from './track-access';

function nowIso(): string {
  return new Date().toISOString();
}

/** Suscribe sin pisar una baja explícita. Ignora ids vacíos o repetidos. */
export async function autoSubscribe(issueId: string, userIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const db = getDb();
  const now = nowIso();
  for (const userId of ids) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO track_issue_subscriptions (issue_id, user_id, subscribed, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      )
      .run(issueId, userId, now, now);
  }
}

/** Suscribirse o darse de baja a mano. */
export async function setIssueSubscription(issueId: string, userId: string, subscribed: boolean): Promise<void> {
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO track_issue_subscriptions (issue_id, user_id, subscribed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (issue_id, user_id) DO UPDATE SET subscribed = excluded.subscribed, updated_at = excluded.updated_at`,
    )
    .run(issueId, userId, subscribed ? 1 : 0, now, now);
}

/**
 * Suscriptos vigentes del issue que todavía tienen acceso al proyecto (miembros
 * del equipo, o el dueño si es personal): filas activas más creador y
 * asignado sin baja explícita.
 */
export async function listIssueSubscriberIds(issueId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `WITH issue AS (
         SELECT i.id, i.project_id, i.creator_id, i.assignee_id, p.team_id, p.owner_id
         FROM track_issues i JOIN track_projects p ON p.id = i.project_id
         WHERE i.id = ?
       ),
       candidates(user_id) AS (
         SELECT user_id FROM track_issue_subscriptions WHERE issue_id = (SELECT id FROM issue) AND subscribed = 1
         UNION
         SELECT creator_id FROM issue
         UNION
         SELECT assignee_id FROM issue
       )
       SELECT c.user_id FROM candidates c, issue
       WHERE c.user_id IS NOT NULL
         AND c.user_id NOT IN (
           SELECT user_id FROM track_issue_subscriptions WHERE issue_id = issue.id AND subscribed = 0
         )
         AND (
           (issue.team_id IS NULL AND ${ownerSpaceSql('issue.owner_id', 'c.user_id')} AND EXISTS (
             SELECT 1 FROM track_projects op WHERE op.id = issue.project_id AND ${trackVisibleExpr('op', 'c.user_id')}
           ))
           OR (issue.team_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM team_members m WHERE m.team_id = issue.team_id AND m.user_id = c.user_id
           ) AND EXISTS (
             SELECT 1 FROM track_projects vp WHERE vp.id = issue.project_id AND ${trackVisibleExpr('vp', 'c.user_id')}
           ))
         )
       ORDER BY c.user_id`,
    )
    .all(issueId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** ¿La persona recibe los avisos del issue? */
export async function isSubscribedToIssue(issueId: string, userId: string): Promise<boolean> {
  return (await listIssueSubscriberIds(issueId)).includes(userId);
}
