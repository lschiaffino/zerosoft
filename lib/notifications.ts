/**
 * Notifications — data layer for the global notification system.
 * Scoped first for Track (mentions, assignments, status changes, comments).
 */
import { getDb } from './db';
import type { NotificationRow } from './db';

export type NotificationType = 'mention' | 'assigned' | 'status_change' | 'issue_update' | 'comment' | 'subtask' | 'relation' | 'chat_message' | 'email_activity' | 'crm_quote' | 'crm_form' | 'crm_lead' | 'crm_approval' | 'crm_document' | 'crm_video' | 'roadmap_status' | 'note_reminder' | 'track_reminder' | 'docs_reminder';

export interface NotificationCreatePayload {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  sourceType: string;
  sourceId: string;
  meta?: Record<string, unknown>;
}

export interface NotificationListOptions {
  unreadOnly?: boolean;
  type?: NotificationType | NotificationType[];
  limit?: number;
  page?: number;
  /** true = solo los pospuestos que todavía no vencieron; por defecto se ocultan. */
  snoozed?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
}

export async function createNotification(payload: NotificationCreatePayload): Promise<NotificationRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, href, read_at, source_type, source_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      payload.userId,
      payload.type,
      payload.title,
      payload.body ?? null,
      payload.href ?? null,
      null,
      payload.sourceType,
      payload.sourceId,
      JSON.stringify(payload.meta ?? {}),
      now,
    );
  return (await db.prepare('SELECT * FROM notifications WHERE id = ?').get(id)) as NotificationRow;
}

export async function listNotifications(
  userId: string,
  options: NotificationListOptions = {},
): Promise<NotificationRow[]> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const conditions: string[] = ['user_id = ?'];
  const args: Array<string | number> = [userId];

  if (options.unreadOnly) {
    conditions.push('read_at IS NULL');
  }

  // Pospuestos: no aparecen hasta que vence el plazo; al volver se ordenan por
  // ese momento (quedan arriba, como uno nuevo).
  const now = nowIso();
  if (options.snoozed) {
    conditions.push('snoozed_until IS NOT NULL AND snoozed_until > ?');
  } else {
    conditions.push('(snoozed_until IS NULL OR snoozed_until <= ?)');
  }
  args.push(now);

  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    if (types.length > 0) {
      conditions.push(`type IN ${inClause(types.length)}`);
      args.push(...types);
    }
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (page - 1) * limit;

  return (await db
    .prepare(
      `SELECT * FROM notifications ${where}
       ORDER BY ${options.snoozed ? 'snoozed_until ASC' : 'COALESCE(snoozed_until, created_at) DESC'} LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)) as NotificationRow[];
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const db = getDb();
  const row = (await db
    .prepare(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)',
    )
    .get(userId, nowIso())) as { c: number } | undefined;
  return row?.c ?? 0;
}

export async function markNotificationRead(id: string, userId: string): Promise<boolean> {
  const db = getDb();
  const res = await db
    .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
    .run(nowIso(), id, userId);
  return res.changes > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const db = getDb();
  await db
    .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .run(nowIso(), userId);
}

/** Hasta cuánto en el futuro se puede posponer un aviso. */
export const SNOOZE_MAX_AHEAD_MS = 365 * 86_400_000;

/**
 * Pospone un aviso hasta `until` (vuelve como sin leer) o, con null, lo trae
 * de vuelta ya. Devuelve false si el aviso no es de la persona o la fecha no
 * sirve (pasada o a más de un año).
 */
export async function snoozeNotification(id: string, userId: string, until: string | null, now = new Date()): Promise<boolean> {
  const db = getDb();
  if (until === null) {
    const res = await db.prepare('UPDATE notifications SET snoozed_until = NULL WHERE id = ? AND user_id = ?').run(id, userId);
    return res.changes > 0;
  }
  const at = new Date(until);
  if (!Number.isFinite(at.getTime())) return false;
  if (at.getTime() <= now.getTime() || at.getTime() > now.getTime() + SNOOZE_MAX_AHEAD_MS) return false;
  const res = await db
    .prepare('UPDATE notifications SET snoozed_until = ?, read_at = NULL WHERE id = ? AND user_id = ?')
    .run(at.toISOString(), id, userId);
  return res.changes > 0;
}

export async function deleteNotification(id: string, userId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

export async function dismissOldNotifications(userId: string, days = 30): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const res = await db.prepare('DELETE FROM notifications WHERE user_id = ? AND created_at < ?').run(userId, cutoff);
  return res.changes ?? 0;
}

// ---------- Track notification helpers ----------

type Actor = { id: string; email: string; name: string | null };

type IssueSummary = {
  id: string;
  project_id: string;
  identifier: string;
  title: string;
  assignee_id: string | null;
  creator_id: string;
};

function issueHref(issueId: string): string {
  return `/app/track/issues/${issueId}`;
}

function actorName(actor: Actor): string {
  return actor.name ?? actor.email;
}

export async function createIssueAssignedNotification(args: {
  issue: IssueSummary;
  projectName: string;
  actor: Actor;
  assigneeId: string;
}): Promise<void> {
  const { issue, projectName, actor, assigneeId } = args;
  if (assigneeId === actor.id) return;

  await createNotification({
    userId: assigneeId,
    type: 'assigned',
    title: `${actorName(actor)} assigned you ${issue.identifier}`,
    body: issue.title,
    href: issueHref(issue.id),
    sourceType: 'track_issue',
    sourceId: issue.id,
    meta: {
      issueIdentifier: issue.identifier,
      projectName,
      actorName: actorName(actor),
      actorId: actor.id,
    },
  });
}

export async function createIssueStatusChangedNotifications(args: {
  issue: IssueSummary;
  projectName: string;
  actor: Actor;
  oldStatus: string;
  newStatus: string;
  /** Suscriptos del issue; sin esto, asignado y creador. */
  recipients?: string[];
}): Promise<void> {
  const { issue, projectName, actor, oldStatus, newStatus } = args;
  const recipients = new Set<string>(args.recipients ?? [issue.assignee_id, issue.creator_id].filter(Boolean) as string[]);
  recipients.delete(actor.id);

  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'status_change',
      title: `${issue.identifier}: status changed to ${newStatus || '—'}`,
      body: `${actorName(actor)} changed status from ${oldStatus || '—'} to ${newStatus || '—'}`,
      href: issueHref(issue.id),
      sourceType: 'track_issue',
      sourceId: issue.id,
      meta: {
        issueIdentifier: issue.identifier,
        projectName,
        actorName: actorName(actor),
        actorId: actor.id,
        oldStatus,
        newStatus,
      },
    });
  }
}

/**
 * Otros cambios del issue (título, descripción, prioridad, fecha, cycle,
 * estimación, asignado) para los suscriptos. `changes` son claves cortas
 * (title, description, priority…) que la bandeja traduce.
 */
export async function createIssueUpdatedNotifications(args: {
  issue: IssueSummary;
  projectName: string;
  actor: Actor;
  changes: string[];
  recipients: string[];
}): Promise<void> {
  const { issue, projectName, actor, changes } = args;
  if (changes.length === 0) return;
  const recipients = new Set(args.recipients);
  recipients.delete(actor.id);
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'issue_update',
      title: `${actorName(actor)} updated ${issue.identifier}`,
      body: issue.title,
      href: issueHref(issue.id),
      sourceType: 'track_issue',
      sourceId: issue.id,
      meta: {
        issueIdentifier: issue.identifier,
        projectName,
        actorName: actorName(actor),
        actorId: actor.id,
        changes: changes.join(','),
      },
    });
  }
}

// ---------- Docs notification helpers ----------

export async function createDocsMentionNotification(args: {
  pageId: string;
  pageTitle: string;
  actor: Actor;
  mentionedUserId: string;
}): Promise<void> {
  const { pageId, pageTitle, actor, mentionedUserId } = args;
  if (mentionedUserId === actor.id) return;

  await createNotification({
    userId: mentionedUserId,
    type: 'mention',
    title: `${actorName(actor)} mentioned you in ${pageTitle || 'Untitled'}`,
    href: `/app/docs/${pageId}`,
    sourceType: 'docs_page',
    sourceId: pageId,
    meta: {
      pageTitle,
      actorName: actorName(actor),
      actorId: actor.id,
    },
  });
}

/**
 * Comentario nuevo en una página de Docs: avisa a los @mencionados y, si es
 * una respuesta, a quienes participan del hilo. Cada persona recibe un solo
 * aviso (la mención gana) y nunca quien escribe. Quien llama ya filtró a los
 * que pueden abrir la página.
 */
export async function createDocsCommentNotifications(args: {
  pageId: string;
  pageTitle: string;
  commentId: string;
  actor: Actor;
  body: string;
  mentioned: string[];
  /** Participantes del hilo (solo en respuestas). */
  threadParticipants: string[];
}): Promise<string[]> {
  const { pageId, pageTitle, commentId, actor, body, mentioned, threadParticipants } = args;
  const title = pageTitle || 'Untitled';
  const notified = new Set<string>([actor.id]);
  const meta = { pageTitle: title, actorName: actorName(actor), actorId: actor.id, commentId };
  const sent: string[] = [];
  for (const userId of mentioned) {
    if (notified.has(userId)) continue;
    notified.add(userId);
    sent.push(userId);
    await createNotification({
      userId,
      type: 'mention',
      title: `${actorName(actor)} mentioned you in a comment on ${title}`,
      body: body.slice(0, 140),
      href: `/app/docs/${pageId}`,
      sourceType: 'docs_comment',
      sourceId: pageId,
      meta,
    });
  }
  for (const userId of threadParticipants) {
    if (notified.has(userId)) continue;
    notified.add(userId);
    sent.push(userId);
    await createNotification({
      userId,
      type: 'comment',
      title: `${actorName(actor)} replied to a comment on ${title}`,
      body: body.slice(0, 140),
      href: `/app/docs/${pageId}`,
      sourceType: 'docs_comment',
      sourceId: pageId,
      meta: { ...meta, reply: true },
    });
  }
  return sent;
}

/** Una página de Docs se compartió con la persona. */
export async function createDocsShareNotification(args: {
  pageId: string;
  actor: Actor;
  targetUserId: string;
}): Promise<void> {
  const { pageId, actor, targetUserId } = args;
  if (targetUserId === actor.id) return;
  const page = (await getDb().prepare('SELECT title FROM docs_pages WHERE id = ?').get(pageId)) as
    | { title: string }
    | undefined;
  const title = page?.title || 'Untitled';
  await createNotification({
    userId: targetUserId,
    type: 'comment',
    title: `${actorName(actor)} shared ${title} with you`,
    href: `/app/docs/${pageId}`,
    sourceType: 'docs_page',
    sourceId: pageId,
    meta: { pageTitle: title, actorName: actorName(actor), actorId: actor.id, shared: true },
  });
}

/** @mención en una nota interna de una conversación de Chat. */
export async function createChatNoteMentionNotification(args: {
  conversationId: string;
  actor: Actor;
  mentionedUserId: string;
  body: string;
}): Promise<void> {
  const { conversationId, actor, mentionedUserId, body } = args;
  if (mentionedUserId === actor.id) return;
  await createNotification({
    userId: mentionedUserId,
    type: 'mention',
    title: `${actorName(actor)} mentioned you in a conversation note`,
    body: body.slice(0, 140),
    href: `/app/chat/inbox/${conversationId}`,
    sourceType: 'chat_conversation',
    sourceId: conversationId,
    meta: { actorName: actorName(actor), actorId: actor.id, note: true },
  });
}

// Mention parsing: @email@domain.com and @Some Name (up to 3 capitalized words).
const EMAIL_MENTION_RE = /@[\w.-]+@[\w.-]+\.\w{2,}/g;
const NAME_MENTION_RE = /@[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2}/g;

export async function createIssueCommentNotifications(args: {
  issue: IssueSummary;
  projectName: string;
  actor: Actor;
  body: string;
  members: Array<{ id: string; email: string; name: string | null }>;
  /** Suscriptos del issue; sin esto, asignado y creador. */
  recipients?: string[];
}): Promise<void> {
  const { issue, projectName, actor, body, members } = args;
  const notified = new Set<string>();

  // Email mentions.
  const emailMatches = [...body.matchAll(EMAIL_MENTION_RE)].map((m) => m[0].slice(1).toLowerCase());
  for (const email of emailMatches) {
    const user = members.find((m) => m.email.toLowerCase() === email);
    if (user && user.id !== actor.id && !notified.has(user.id)) {
      notified.add(user.id);
      await createNotification({
        userId: user.id,
        type: 'mention',
        title: `${actorName(actor)} mentioned you in ${issue.identifier}`,
        body: issue.title,
        href: issueHref(issue.id),
        sourceType: 'track_comment',
        sourceId: issue.id,
        meta: {
          issueIdentifier: issue.identifier,
          projectName,
          actorName: actorName(actor),
          actorId: actor.id,
        },
      });
    }
  }

  // Name mentions.
  const nameMatches = [...body.matchAll(NAME_MENTION_RE)].map((m) => m[0].slice(1).trim());
  for (const name of nameMatches) {
    const user = members.find((m) => m.name?.toLowerCase() === name.toLowerCase());
    if (user && user.id !== actor.id && !notified.has(user.id)) {
      notified.add(user.id);
      await createNotification({
        userId: user.id,
        type: 'mention',
        title: `${actorName(actor)} mentioned you in ${issue.identifier}`,
        body: issue.title,
        href: issueHref(issue.id),
        sourceType: 'track_comment',
        sourceId: issue.id,
        meta: {
          issueIdentifier: issue.identifier,
          projectName,
          actorName: actorName(actor),
          actorId: actor.id,
        },
      });
    }
  }

  // Los suscriptos (o asignado y creador) se enteran del comentario; quien
  // ya recibió la mención no recibe un segundo aviso.
  const recipients = new Set<string>(args.recipients ?? [issue.assignee_id, issue.creator_id].filter(Boolean) as string[]);
  recipients.delete(actor.id);

  for (const userId of recipients) {
    if (notified.has(userId)) continue;
    notified.add(userId);
    await createNotification({
      userId,
      type: 'comment',
      title: `${actorName(actor)} commented on ${issue.identifier}`,
      body: issue.title,
      href: issueHref(issue.id),
      sourceType: 'track_comment',
      sourceId: issue.id,
      meta: {
        issueIdentifier: issue.identifier,
        projectName,
        actorName: actorName(actor),
        actorId: actor.id,
      },
    });
  }
}
