/**
 * Notifications — data layer for the global notification system.
 * Scoped first for Track (mentions, assignments, status changes, comments).
 */
import { getDb } from './db';
import type { NotificationRow } from './db';

export type NotificationType = 'mention' | 'assigned' | 'status_change' | 'comment' | 'subtask' | 'relation' | 'chat_message' | 'email_activity' | 'crm_quote';

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
    .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)) as NotificationRow[];
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId)) as { c: number } | undefined;
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
}): Promise<void> {
  const { issue, projectName, actor, oldStatus, newStatus } = args;
  const recipients = new Set<string>();
  if (issue.assignee_id) recipients.add(issue.assignee_id);
  if (issue.creator_id) recipients.add(issue.creator_id);
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

// Mention parsing: @email@domain.com and @Some Name (up to 3 capitalized words).
const EMAIL_MENTION_RE = /@[\w.-]+@[\w.-]+\.\w{2,}/g;
const NAME_MENTION_RE = /@[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2}/g;

export async function createIssueCommentNotifications(args: {
  issue: IssueSummary;
  projectName: string;
  actor: Actor;
  body: string;
  members: Array<{ id: string; email: string; name: string | null }>;
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

  // Notify assignee and creator about the new comment (avoid duplicates).
  const recipients = new Set<string>();
  if (issue.assignee_id) recipients.add(issue.assignee_id);
  if (issue.creator_id) recipients.add(issue.creator_id);
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
