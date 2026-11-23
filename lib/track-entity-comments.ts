/**
 * Hilos de comentarios en projects (track_plans) e iniciativas, con el mismo
 * componente que los issues (IssueActivityTimeline): respuestas de un nivel,
 * resolver, editar y borrar los propios, reacciones y @menciones.
 *
 * Acceso: quien ve el project o la iniciativa (persona del workspace que no
 * es invitada de Track; lib/track-plans getAccessiblePlan). Lo valida
 * lib/track-entity-comments-http.ts antes de llamar acá.
 */
import { getDb } from './db';
import { createNotification, EMAIL_MENTION_RE, NAME_MENTION_RE } from './notifications';
import { isAllowedReaction, type CommentReaction } from './track-ux';
import { planRecipients } from './track-plans';
import { canUseApp } from './workspace';
import type { TrackIssueActivityWithAuthor } from './track-data';

export type CommentEntityType = 'plan' | 'initiative';

export interface CommentEntity {
  type: CommentEntityType;
  id: string;
  name: string;
  team_id: string | null;
  owner_id: string | null;
  lead_id: string | null;
}

interface EntityCommentRow {
  id: string;
  plan_id: string | null;
  initiative_id: string | null;
  user_id: string;
  body: string;
  parent_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export type EntityMutation<T> = { ok: true; value: T } | { ok: false; reason: 'not_found' | 'forbidden' };

/** Columna del padre: plan_id o initiative_id (nunca viene del pedido). */
function col(type: CommentEntityType): 'plan_id' | 'initiative_id' {
  return type === 'plan' ? 'plan_id' : 'initiative_id';
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Link al hilo (el project o la iniciativa, en su resumen). */
export function entityHref(e: Pick<CommentEntity, 'type' | 'id'>): string {
  return e.type === 'plan' ? `/app/track/projects/${e.id}#comments` : `/app/track/initiatives/${e.id}#comments`;
}

/**
 * Los comentarios con la forma de la actividad de un issue (type 'comment' y
 * meta con commentId, body, parentId, resolvedAt…), así los muestra el mismo
 * componente.
 */
export async function listEntityThread(type: CommentEntityType, entityId: string): Promise<{ rows: TrackIssueActivityWithAuthor[]; reactions: CommentReaction[] }> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT c.id, ? AS issue_id, c.user_id, 'comment' AS type,
         json_object('commentId', c.id, 'body', c.body, 'editedAt', c.updated_at, 'parentId', c.parent_id,
           'resolvedAt', c.resolved_at, 'resolvedBy', (SELECT COALESCE(rb.name, rb.email) FROM users rb WHERE rb.id = c.resolved_by)) AS meta,
         c.created_at, u.name AS user_name, u.email AS user_email
       FROM track_entity_comments c JOIN users u ON u.id = c.user_id
       WHERE c.${col(type)} = ?
       ORDER BY c.created_at DESC
       LIMIT 1000`,
    )
    .all(entityId, entityId)) as TrackIssueActivityWithAuthor[];
  // Los 1000 más nuevos, en orden.
  rows.reverse();
  const reactions = (await db
    .prepare(
      `SELECT r.comment_id, r.emoji, r.user_id, COALESCE(u.name, u.email) AS user_name
       FROM track_entity_comment_reactions r
       JOIN track_entity_comments c ON c.id = r.comment_id
       JOIN users u ON u.id = r.user_id
       WHERE c.${col(type)} = ?
       ORDER BY r.created_at ASC
       LIMIT 5000`,
    )
    .all(entityId)) as CommentReaction[];
  return { rows, reactions };
}

async function getEntityComment(e: Pick<CommentEntity, 'type' | 'id'>, commentId: string): Promise<EntityCommentRow | undefined> {
  return (await getDb()
    .prepare(`SELECT * FROM track_entity_comments WHERE id = ? AND ${col(e.type)} = ?`)
    .get(commentId, e.id)) as EntityCommentRow | undefined;
}

/**
 * Quienes pueden leer el hilo y ser mencionados: en un workspace de equipo,
 * sus personas que usan Track (no las invitadas del workspace ni las de
 * Track); en un workspace personal, solo su dueña. Una consulta.
 */
export async function audience(e: CommentEntity): Promise<Array<{ id: string; name: string | null; email: string }>> {
  const db = getDb();
  if (!e.team_id) {
    return (await db.prepare('SELECT id, name, email FROM users WHERE id = ?').all(e.owner_id ?? '')) as Array<{ id: string; name: string | null; email: string }>;
  }
  const rows = (await db
    .prepare(
      `SELECT u.id, u.name, u.email, m.role, m.apps FROM team_members m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ? AND m.role != 'guest'
          AND NOT EXISTS (SELECT 1 FROM track_guests g WHERE g.workspace_id = ? AND g.email = lower(u.email))
        UNION
       SELECT u.id, u.name, u.email, 'owner' AS role, '*' AS apps FROM teams t JOIN users u ON u.id = t.owner_id WHERE t.id = ?
        ORDER BY 2, 3`,
    )
    .all(e.team_id, e.team_id, e.team_id)) as Array<{ id: string; name: string | null; email: string; role: string; apps: string | null }>;
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string | null; email: string }> = [];
  for (const r of rows) {
    if (seen.has(r.id) || !canUseApp({ role: r.role, apps: r.apps }, 'track')) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.name, email: r.email });
  }
  return out;
}

export async function createEntityComment(
  e: CommentEntity,
  userId: string,
  payload: { body: string; parentId?: string },
): Promise<EntityCommentRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const body = payload.body.trim();
  // Un nivel de respuestas, como en los issues; un padre de otro hilo se ignora.
  let parentId: string | null = null;
  if (payload.parentId) {
    const parent = await getEntityComment(e, payload.parentId);
    parentId = parent ? (parent.parent_id ?? parent.id) : null;
  }
  await db
    .prepare(
      `INSERT INTO track_entity_comments (id, ${col(e.type)}, user_id, body, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, e.id, userId, body, parentId, nowIso());
  // Responder reabre el hilo.
  if (parentId) {
    await db.prepare(`UPDATE track_entity_comments SET resolved_at = NULL, resolved_by = NULL WHERE id = ? AND ${col(e.type)} = ?`).run(parentId, e.id);
  }
  await notifyComment(e, userId, body, parentId).catch(() => undefined);
  return (await getEntityComment(e, id)) as EntityCommentRow;
}

/**
 * Avisos: las menciones (solo a quienes pueden ver el hilo) y, para el resto,
 * a quienes siguen el project (lead, miembros, seguidores) o al lead de la
 * iniciativa, y a quienes ya comentaron en el hilo.
 */
async function notifyComment(e: CommentEntity, actorId: string, body: string, parentId: string | null): Promise<void> {
  const db = getDb();
  const people = await audience(e);
  const allowed = new Map(people.map((p) => [p.id, p]));
  const actor = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(actorId)) as { name: string | null; email: string } | undefined;
  const actorName = actor?.name || actor?.email || '';
  const sourceType = e.type === 'plan' ? 'track_plan' : 'track_initiative';
  const meta = { ...(e.type === 'plan' ? { planId: e.id, planName: e.name } : { initiativeId: e.id, initiativeName: e.name }), actorName, actorId, kind: 'comment' };
  const notified = new Set<string>([actorId]);
  // Un aviso que falla no frena a los demás.
  const send = (n: Parameters<typeof createNotification>[0]) => createNotification(n).catch(() => undefined);

  const mentioned = new Set<string>();
  for (const m of body.matchAll(EMAIL_MENTION_RE)) {
    const email = m[0].slice(1).toLowerCase();
    const p = people.find((x) => x.email.toLowerCase() === email);
    if (p) mentioned.add(p.id);
  }
  for (const m of body.matchAll(NAME_MENTION_RE)) {
    const name = m[0].slice(1).trim().toLowerCase();
    const p = people.find((x) => x.name?.toLowerCase() === name);
    if (p) mentioned.add(p.id);
  }
  for (const uid of mentioned) {
    if (notified.has(uid)) continue;
    notified.add(uid);
    await send({
      userId: uid,
      type: 'mention',
      title: `${actorName} mentioned you in ${e.name}`,
      body: body.slice(0, 280),
      href: entityHref(e),
      sourceType,
      sourceId: e.id,
      meta,
    });
  }

  const followers = new Set<string>(e.type === 'plan' ? await planRecipients(e.id) : e.lead_id ? [e.lead_id] : []);
  const thread = (await db
    .prepare(`SELECT DISTINCT user_id FROM track_entity_comments WHERE ${col(e.type)} = ? AND (id = ? OR parent_id = ?)`)
    .all(e.id, parentId ?? '', parentId ?? '')) as Array<{ user_id: string }>;
  for (const t of thread) followers.add(t.user_id);
  for (const uid of followers) {
    if (notified.has(uid) || !allowed.has(uid)) continue;
    notified.add(uid);
    await send({
      userId: uid,
      type: 'comment',
      title: `${actorName} commented on ${e.name}`,
      body: body.slice(0, 280),
      href: entityHref(e),
      sourceType,
      sourceId: e.id,
      meta,
    });
  }
}

/** Solo quien lo escribió edita o borra su comentario. */
async function own(e: CommentEntity, commentId: string, userId: string): Promise<EntityMutation<EntityCommentRow>> {
  const row = await getEntityComment(e, commentId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.user_id !== userId) return { ok: false, reason: 'forbidden' };
  return { ok: true, value: row };
}

export async function updateEntityComment(e: CommentEntity, commentId: string, userId: string, body: string): Promise<EntityMutation<EntityCommentRow>> {
  const mine = await own(e, commentId, userId);
  if (!mine.ok) return mine;
  const text = body.trim();
  await getDb().prepare('UPDATE track_entity_comments SET body = ?, updated_at = ? WHERE id = ? AND body != ?').run(text, nowIso(), commentId, text);
  return { ok: true, value: (await getEntityComment(e, commentId)) as EntityCommentRow };
}

/** Borrar la raíz de un hilo borra sus respuestas (como en los issues). */
export async function deleteEntityComment(e: CommentEntity, commentId: string, userId: string): Promise<EntityMutation<null>> {
  const mine = await own(e, commentId, userId);
  if (!mine.ok) return mine;
  // Las respuestas se van con la raíz (parent_id ON DELETE CASCADE).
  await getDb().prepare(`DELETE FROM track_entity_comments WHERE id = ? AND ${col(e.type)} = ?`).run(commentId, e.id);
  return { ok: true, value: null };
}

/** Resolver o reabrir un hilo (cualquiera que lo ve, como en los issues). Solo la raíz. */
export async function resolveEntityComment(e: CommentEntity, commentId: string, userId: string, resolved: boolean): Promise<boolean> {
  const row = await getEntityComment(e, commentId);
  if (!row || row.parent_id) return false;
  await getDb()
    .prepare('UPDATE track_entity_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?')
    .run(resolved ? nowIso() : null, resolved ? userId : null, commentId);
  return true;
}

/** Pone o saca una reacción. null si el comentario no es del hilo o el emoji no vale. */
export async function toggleEntityReaction(e: CommentEntity, commentId: string, userId: string, emoji: string): Promise<boolean | null> {
  if (!isAllowedReaction(emoji)) return null;
  if (!(await getEntityComment(e, commentId))) return null;
  const db = getDb();
  const res = await db.prepare('DELETE FROM track_entity_comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?').run(commentId, userId, emoji);
  if (res.changes > 0) return false;
  await db
    .prepare('INSERT OR IGNORE INTO track_entity_comment_reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
    .run(commentId, userId, emoji, nowIso());
  return true;
}
