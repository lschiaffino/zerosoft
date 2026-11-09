/**
 * Inbox: cuentas, chats, mensajes, carpetas, snippets y envíos programados.
 * Server-only. Cada función recibe `owner` (el id real de la persona) y todas
 * las consultas filtran por él: no hay forma de pedir datos de otra persona,
 * tampoco siendo admin del workspace.
 */
import { randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db';
import { open, seal } from '../secret-box';
import { canMoveFolder, depthOf, descendantIds, MAX_FOLDER_DEPTH, rollupUnread, siblingOrder } from './folder-tree';
import {
  InboxError,
  LIMITS,
  WAITING_AFTER_MS,
  cleanShortcut,
  parseRule,
  previewOf,
  type AccountStatus,
  type FolderDto,
  type FolderRule,
  type InboxAccountDto,
  type InboxChannel,
  type InboxView,
  type MessageDto,
  type ScheduledDto,
  type ScheduledStatus,
  type SnippetDto,
  type ThreadDto,
  type ThreadKind,
} from './types';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  owner_id: string;
  kind: InboxChannel;
  provider: string;
  label: string;
  address: string;
  status: AccountStatus;
  config: string;
  webhook_secret: string;
  sync_cursor: string;
  sync_claimed_until: string | null;
  last_sync_at: string | null;
  error: string;
  created_at: string;
  updated_at: string;
}

/** Credenciales de la cuenta, descifradas. */
export function readAccountConfig<T extends Record<string, unknown>>(row: Pick<AccountRow, 'config'>): Partial<T> {
  const plain = open(row.config);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

export async function writeAccountConfig(id: string, config: Record<string, unknown>): Promise<void> {
  await getDb().prepare('UPDATE inbox_accounts SET config = ?, updated_at = ? WHERE id = ?').run(seal(JSON.stringify(config)), nowIso(), id);
}

export function accountDto(r: AccountRow): InboxAccountDto {
  let backfilling = false;
  try {
    const c = r.sync_cursor ? (JSON.parse(r.sync_cursor) as { phase?: string }) : null;
    backfilling = r.kind === 'whatsapp' && r.provider === 'managed' && !!c?.phase && c.phase !== 'done';
  } catch {
    backfilling = false;
  }
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    address: r.address,
    status: r.status,
    error: r.error,
    lastSyncAt: r.last_sync_at,
    backfilling,
  };
}

export async function listAccounts(owner: string): Promise<AccountRow[]> {
  return (await getDb().prepare('SELECT * FROM inbox_accounts WHERE owner_id = ? ORDER BY kind DESC, created_at').all(owner)) as unknown as AccountRow[];
}

export async function getAccount(owner: string, id: string): Promise<AccountRow> {
  const row = (await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ? AND owner_id = ?').get(id, owner)) as AccountRow | undefined;
  if (!row) throw new InboxError('not_found', 404);
  return row;
}

/** Solo para el webhook y el cron (sin dueño a mano): nunca se expone por API. */
export async function getAccountById(id: string): Promise<AccountRow | null> {
  return ((await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ?').get(id)) as AccountRow | undefined) ?? null;
}

export async function createAccount(owner: string, input: { kind: InboxChannel; provider: string; label?: string; address?: string }): Promise<AccountRow> {
  const id = newId('iba');
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, webhook_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?, ?, ?)`,
    )
    .run(id, owner, input.kind, input.provider, (input.label ?? '').slice(0, 80), (input.address ?? '').slice(0, 200), randomBytes(24).toString('hex'), now, now);
  return getAccount(owner, id);
}

export async function setAccountState(id: string, patch: Partial<Pick<AccountRow, 'status' | 'address' | 'error' | 'provider' | 'label' | 'sync_cursor' | 'last_sync_at'>>): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  await getDb()
    .prepare(`UPDATE inbox_accounts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | null), nowIso(), id);
}

/** Borra la cuenta con sus chats, mensajes y envíos (cascade). */
export async function deleteAccountRow(owner: string, id: string): Promise<void> {
  await getDb().prepare('DELETE FROM inbox_accounts WHERE id = ? AND owner_id = ?').run(id, owner);
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export interface ThreadRow {
  id: string;
  owner_id: string;
  account_id: string;
  channel: InboxChannel;
  kind: ThreadKind;
  external_id: string;
  title: string;
  handle: string;
  preview: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_from_me: number;
  unread: number;
  pinned_at: string | null;
  done_at: string | null;
  snoozed_until: string | null;
  woke_at: string | null;
  woke_reason: string;
  follow_up_at: string | null;
  follow_up_since: string | null;
  muted_until: string | null;
  draft: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export async function getThreadRow(owner: string, id: string): Promise<ThreadRow> {
  const row = (await getDb().prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ?').get(id, owner)) as ThreadRow | undefined;
  if (!row) throw new InboxError('not_found', 404);
  return row;
}

export async function findThread(accountId: string, externalId: string): Promise<ThreadRow | null> {
  return ((await getDb().prepare('SELECT * FROM inbox_threads WHERE account_id = ? AND external_id = ?').get(accountId, externalId)) as ThreadRow | undefined) ?? null;
}

/** Busca o crea el chat de una cuenta. El título solo se pisa si viene uno y el actual está vacío o `forceTitle`. */
export async function upsertThread(
  account: Pick<AccountRow, 'id' | 'owner_id' | 'kind'>,
  input: { externalId: string; kind: ThreadKind; title?: string; handle?: string; forceTitle?: boolean },
): Promise<ThreadRow> {
  const db = getDb();
  const now = nowIso();
  const title = (input.title ?? '').trim().slice(0, 200);
  await db
    .prepare(
      `INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id, external_id) DO NOTHING`,
    )
    .run(newId('ibt'), account.owner_id, account.id, account.kind, input.kind, input.externalId.slice(0, 300), title, (input.handle ?? '').slice(0, 200), now, now);
  const row = (await findThread(account.id, input.externalId.slice(0, 300)))!;
  if (title && (input.forceTitle || !row.title) && row.title !== title) {
    await db.prepare('UPDATE inbox_threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now, row.id);
    row.title = title;
  }
  if (input.handle && !row.handle) {
    await db.prepare('UPDATE inbox_threads SET handle = ? WHERE id = ?').run(input.handle.slice(0, 200), row.id);
    row.handle = input.handle;
  }
  return row;
}

export interface NewMessage {
  externalId: string;
  fromMe: boolean;
  senderName?: string;
  senderHandle?: string;
  subject?: string;
  body: string;
  emailTo?: string;
  emailCc?: string;
  emailMessageId?: string;
  mediaType?: string;
  mediaName?: string;
  mediaRef?: string;
  replyTo?: string;
  status?: string;
  sentAt?: string;
  /** Mensaje viejo (historial o importación): no cuenta como no leído ni saca el chat de Hecho. */
  history?: boolean;
  /** Ya leído en el proveedor (Gmail sin UNREAD). */
  read?: boolean;
}

/**
 * Guarda un mensaje (sin duplicar: único por chat + id del proveedor) y
 * actualiza el chat: vista previa, no leídos y, si llega uno nuevo de la otra
 * persona, el chat vuelve a la bandeja (sale de Hecho) y se cancela el
 * "recordame si no contesta" (contestó). Devuelve false si ya estaba.
 */
export async function addMessage(thread: ThreadRow, m: NewMessage): Promise<boolean> {
  const db = getDb();
  const sentAt = validIso(m.sentAt) ?? nowIso();
  const res = await db
    .prepare(
      `INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, sender_name, sender_handle, subject, body, email_to, email_cc,
         email_message_id, media_type, media_name, media_ref, reply_to, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (thread_id, external_id) DO NOTHING`,
    )
    .run(
      newId('ibm'),
      thread.owner_id,
      thread.id,
      m.externalId.slice(0, 300),
      m.fromMe ? 1 : 0,
      (m.senderName ?? '').slice(0, 200),
      (m.senderHandle ?? '').slice(0, 200),
      (m.subject ?? '').slice(0, 500),
      m.body.slice(0, 100_000),
      (m.emailTo ?? '').slice(0, 2000),
      (m.emailCc ?? '').slice(0, 2000),
      (m.emailMessageId ?? '').slice(0, 500),
      (m.mediaType ?? '').slice(0, 40),
      (m.mediaName ?? '').slice(0, 300),
      (m.mediaRef ?? '').slice(0, 4000),
      (m.replyTo ?? '').slice(0, 300),
      (m.status ?? '').slice(0, 20),
      sentAt,
      nowIso(),
    );
  if (res.changes === 0) return false;
  const preview = previewOf(m.subject ? `${m.subject} · ${m.body}` : m.body, m.mediaType);
  const newer = !thread.last_message_at || sentAt >= thread.last_message_at;
  const unreadInc = !m.fromMe && !m.history && !m.read ? 1 : 0;
  await db
    .prepare(
      `UPDATE inbox_threads SET
         preview = CASE WHEN ? THEN ? ELSE preview END,
         last_from_me = CASE WHEN ? THEN ? ELSE last_from_me END,
         last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at < ? THEN ? ELSE last_message_at END,
         last_inbound_at = CASE WHEN ? = 0 AND (last_inbound_at IS NULL OR last_inbound_at < ?) THEN ? ELSE last_inbound_at END,
         last_outbound_at = CASE WHEN ? = 1 AND (last_outbound_at IS NULL OR last_outbound_at < ?) THEN ? ELSE last_outbound_at END,
         unread = CASE WHEN ? = 1 THEN 0 ELSE unread + ? END,
         done_at = CASE WHEN ? = 1 THEN NULL ELSE done_at END,
         snoozed_until = CASE WHEN ? = 1 THEN NULL ELSE snoozed_until END,
         follow_up_at = CASE WHEN ? = 1 THEN NULL ELSE follow_up_at END,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      newer ? 1 : 0,
      preview,
      newer ? 1 : 0,
      m.fromMe ? 1 : 0,
      sentAt,
      sentAt,
      m.fromMe ? 1 : 0,
      sentAt,
      sentAt,
      m.fromMe ? 1 : 0,
      sentAt,
      sentAt,
      // Un mensaje mío en vivo (desde el teléfono o desde acá) deja el chat leído.
      m.fromMe && !m.history ? 1 : 0,
      unreadInc,
      // Llega algo nuevo de la otra persona: vuelve a la bandeja.
      !m.fromMe && !m.history && newer ? 1 : 0,
      !m.fromMe && !m.history && newer ? 1 : 0,
      !m.fromMe && !m.history ? 1 : 0,
      nowIso(),
      thread.id,
    );
  if (newer) {
    thread.last_message_at = sentAt;
    thread.preview = preview;
    thread.last_from_me = m.fromMe ? 1 : 0;
  }
  return true;
}

function validIso(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function likeArg(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Condición SQL de la regla de una carpeta (sobre el alias t). */
function ruleSql(rule: FolderRule | null): { sql: string; args: string[] } | null {
  if (!rule) return null;
  const parts: string[] = [];
  const args: string[] = [];
  if (rule.channel) {
    parts.push('t.channel = ?');
    args.push(rule.channel);
  }
  if (rule.kind) {
    parts.push('t.kind = ?');
    args.push(rule.kind);
  }
  if (rule.from) {
    parts.push("(t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\')");
    args.push(likeArg(rule.from), likeArg(rule.from));
  }
  return parts.length ? { sql: parts.join(' AND '), args } : null;
}

export interface ListOptions {
  view?: InboxView;
  folderId?: string;
  q?: string;
  limit?: number;
  now?: Date;
}

/**
 * Chats de una vista o carpeta, fijados primero y después por último
 * mensaje. Con búsqueda, mira en todas las vistas (también Hecho) y en el
 * texto de los mensajes.
 */
export async function listThreads(owner: string, opts: ListOptions = {}): Promise<ThreadDto[]> {
  const now = opts.now ?? new Date();
  const nowS = now.toISOString();
  const where: string[] = ['t.owner_id = ?'];
  const args: Array<string | number> = [owner];
  const q = (opts.q ?? '').trim().slice(0, LIMITS.searchQuery);
  const view = opts.view ?? 'inbox';
  const active = '(t.done_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?))';
  if (q) {
    where.push(
      `(t.title LIKE ? ESCAPE '\\' OR t.handle LIKE ? ESCAPE '\\' OR t.preview LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM inbox_messages m WHERE m.thread_id = t.id AND (m.body LIKE ? ESCAPE '\\' OR m.subject LIKE ? ESCAPE '\\')))`,
    );
    const l = likeArg(q);
    args.push(l, l, l, l, l);
  }
  if (opts.folderId) {
    const folder = await getFolderRow(owner, opts.folderId);
    // La carpeta muestra también lo de sus subcarpetas (como sus no leídos).
    const all = (await getDb().prepare('SELECT * FROM inbox_folders WHERE owner_id = ?').all(owner)) as unknown as FolderRow[];
    const tree = all.map((f) => ({ id: f.id, parentId: f.parent_id, position: f.position }));
    const ids = [folder.id, ...descendantIds(tree, folder.id)];
    const rules = all.filter((f) => ids.includes(f.id)).map((f) => ruleSql(parseRuleText(f.rule))).filter((r): r is NonNullable<typeof r> => r !== null);
    where.push(
      `(t.id IN (SELECT thread_id FROM inbox_thread_folders WHERE folder_id IN (${ids.map(() => '?').join(', ')}))${rules.map((r) => ` OR (${r.sql})`).join('')})`,
    );
    args.push(...ids, ...rules.flatMap((r) => r.args));
    if (!q) {
      where.push(active);
      args.push(nowS);
    }
  } else if (!q) {
    switch (view) {
      case 'inbox':
        where.push(active);
        args.push(nowS);
        break;
      case 'unread':
        where.push(active, 't.unread > 0');
        args.push(nowS);
        break;
      case 'reply':
        where.push(active, 't.last_from_me = 0', "t.kind <> 'group'", 't.last_message_at IS NOT NULL');
        args.push(nowS);
        break;
      case 'waiting':
        where.push(active, 't.last_from_me = 1', 't.last_outbound_at < ?');
        args.push(nowS, new Date(now.getTime() - WAITING_AFTER_MS).toISOString());
        break;
      case 'whatsapp':
        where.push(active, "t.channel = 'whatsapp'");
        args.push(nowS);
        break;
      case 'email':
        where.push(active, "t.channel = 'gmail'");
        args.push(nowS);
        break;
      case 'groups':
        where.push(active, "t.kind = 'group'");
        args.push(nowS);
        break;
      case 'pinned':
        where.push('t.pinned_at IS NOT NULL');
        break;
      case 'snoozed':
        where.push('t.snoozed_until > ?');
        args.push(nowS);
        break;
      case 'scheduled':
        where.push("EXISTS (SELECT 1 FROM inbox_scheduled s WHERE s.thread_id = t.id AND s.status IN ('pending','failed','missed'))");
        break;
      case 'done':
        where.push('t.done_at IS NOT NULL');
        break;
    }
  }
  const order =
    view === 'snoozed' && !q && !opts.folderId
      ? 't.snoozed_until ASC'
      : view === 'done' && !q && !opts.folderId
        ? 't.done_at DESC'
        : // Los chats sin mensajes (los que trae el historial de WhatsApp antes que sus mensajes) van al final.
          '(t.pinned_at IS NOT NULL) DESC, (t.last_message_at IS NULL) ASC, COALESCE(t.last_message_at, t.created_at) DESC';
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 1000);
  const rows = (await getDb()
    .prepare(
      `SELECT t.*,
         (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids,
         (SELECT COUNT(*) FROM inbox_scheduled s WHERE s.thread_id = t.id AND s.status IN ('pending','failed','missed')) AS scheduled_count
       FROM inbox_threads t WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`,
    )
    .all(...args)) as Array<ThreadRow & { folder_ids: string | null; scheduled_count: number }>;
  return rows.map((r) => threadDto(r, now));
}

export function threadDto(r: ThreadRow & { folder_ids?: string | null; scheduled_count?: number }, now = new Date()): ThreadDto {
  const snoozed = r.snoozed_until && r.snoozed_until > now.toISOString() ? r.snoozed_until : null;
  return {
    id: r.id,
    accountId: r.account_id,
    channel: r.channel,
    kind: r.kind,
    title: r.title || r.handle || r.external_id.replace(/@.*/, ''),
    handle: r.handle,
    preview: r.preview,
    lastMessageAt: r.last_message_at,
    lastFromMe: r.last_from_me === 1,
    unread: Number(r.unread),
    pinned: !!r.pinned_at,
    done: !!r.done_at,
    snoozedUntil: snoozed,
    woke: r.woke_at && (r.woke_reason === 'snooze' || r.woke_reason === 'followup') ? r.woke_reason : '',
    followUpAt: r.follow_up_at,
    mutedUntil: r.muted_until && r.muted_until > now.toISOString() ? r.muted_until : null,
    draft: r.draft,
    folderIds: r.folder_ids ? String(r.folder_ids).split(',') : [],
    scheduledCount: Number(r.scheduled_count ?? 0),
  };
}

export async function getThread(owner: string, id: string): Promise<ThreadDto> {
  const r = (await getDb()
    .prepare(
      `SELECT t.*,
         (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids,
         (SELECT COUNT(*) FROM inbox_scheduled s WHERE s.thread_id = t.id AND s.status IN ('pending','failed','missed')) AS scheduled_count
       FROM inbox_threads t WHERE t.id = ? AND t.owner_id = ?`,
    )
    .get(id, owner)) as (ThreadRow & { folder_ids: string | null; scheduled_count: number }) | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return threadDto(r);
}

interface MessageRow {
  id: string;
  from_me: number;
  sender_name: string;
  sender_handle: string;
  subject: string;
  body: string;
  email_to: string;
  media_type: string;
  media_name: string;
  media_ref: string;
  status: string;
  edited: number;
  revoked_at: string | null;
  sent_at: string;
}

function messageDto(r: MessageRow): MessageDto {
  return {
    id: r.id,
    fromMe: r.from_me === 1,
    senderName: r.sender_name,
    senderHandle: r.sender_handle,
    subject: r.subject,
    body: r.body,
    emailTo: r.email_to,
    mediaType: r.media_type,
    mediaName: r.media_name,
    hasMedia: !!r.media_ref,
    status: r.status,
    edited: r.edited === 1,
    revoked: !!r.revoked_at,
    sentAt: r.sent_at,
  };
}

/** Los últimos `limit` mensajes (o los anteriores a `before`), en orden cronológico. */
export async function listMessages(owner: string, threadId: string, opts: { before?: string; limit?: number } = {}): Promise<{ messages: MessageDto[]; more: boolean }> {
  await getThreadRow(owner, threadId);
  const limit = Math.min(Math.max(opts.limit ?? 150, 1), 500);
  const before = validIso(opts.before);
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM inbox_messages WHERE thread_id = ? AND owner_id = ? ${before ? 'AND sent_at < ?' : ''} ORDER BY sent_at DESC, created_at DESC LIMIT ?`,
    )
    .all(...(before ? [threadId, owner, before, limit + 1] : [threadId, owner, limit + 1]))) as unknown as MessageRow[];
  const more = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map(messageDto), more };
}

export async function getMessageRow(owner: string, id: string): Promise<MessageRow & { thread_id: string; external_id: string }> {
  const r = (await getDb().prepare('SELECT * FROM inbox_messages WHERE id = ? AND owner_id = ?').get(id, owner)) as
    | (MessageRow & { thread_id: string; external_id: string })
    | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}

export type ThreadAction =
  | { action: 'done' }
  | { action: 'undone' }
  | { action: 'read' }
  | { action: 'unread' }
  | { action: 'pin' }
  | { action: 'unpin' }
  | { action: 'snooze'; until: string }
  | { action: 'unsnooze' }
  | { action: 'followUp'; at: string }
  | { action: 'clearFollowUp' }
  | { action: 'mute'; until: string | null }
  | { action: 'addFolder'; folderId: string }
  | { action: 'removeFolder'; folderId: string }
  | { action: 'seen' };

function futureIso(raw: string, now: Date): string {
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t <= now.getTime() + 30_000) throw new InboxError('date_in_past', 400);
  if (t > now.getTime() + 3 * 365 * 86_400_000) throw new InboxError('invalid_input', 400);
  return new Date(t).toISOString();
}

/** Una acción sobre uno o varios chats (todos de la persona; los ajenos se ignoran). Devuelve los ids que cambiaron. */
export async function applyThreadAction(owner: string, ids: string[], a: ThreadAction, now = new Date()): Promise<string[]> {
  const db = getDb();
  const nowS = nowIso(now);
  if (a.action === 'addFolder' || a.action === 'removeFolder') await getFolderRow(owner, a.folderId);
  const asked = [...new Set(ids)].slice(0, 500);
  if (!asked.length) return [];
  // Solo los chats de la persona: los ids ajenos se ignoran en silencio.
  const owned = (await db
    .prepare(`SELECT id FROM inbox_threads WHERE owner_id = ? AND id IN (${asked.map(() => '?').join(',')})`)
    .all(owner, ...asked)) as Array<{ id: string }>;
  const unique = owned.map((r) => r.id);
  if (!unique.length) return [];
  let sql: string;
  let extra: Array<string | number | null> = [];
  switch (a.action) {
    case 'done':
      sql = 'done_at = ?, snoozed_until = NULL, woke_at = NULL, woke_reason = \'\', unread = 0';
      extra = [nowS];
      break;
    case 'undone':
      sql = 'done_at = NULL';
      break;
    case 'read':
      sql = 'unread = 0';
      break;
    case 'unread':
      sql = 'unread = CASE WHEN unread = 0 THEN 1 ELSE unread END';
      break;
    case 'pin':
      sql = 'pinned_at = COALESCE(pinned_at, ?)';
      extra = [nowS];
      break;
    case 'unpin':
      sql = 'pinned_at = NULL';
      break;
    case 'snooze':
      sql = 'snoozed_until = ?, done_at = NULL, woke_at = NULL, woke_reason = \'\'';
      extra = [futureIso(a.until, now)];
      break;
    case 'unsnooze':
      sql = 'snoozed_until = NULL';
      break;
    case 'followUp':
      sql = 'follow_up_at = ?, follow_up_since = ?';
      extra = [futureIso(a.at, now), nowS];
      break;
    case 'clearFollowUp':
      sql = 'follow_up_at = NULL, follow_up_since = NULL';
      break;
    case 'mute':
      sql = 'muted_until = ?';
      extra = [a.until === null ? null : futureIso(a.until, now)];
      break;
    case 'seen':
      sql = "woke_at = NULL, woke_reason = '', unread = 0";
      break;
    case 'addFolder': {
      for (const id of unique) {
        await db
          .prepare('INSERT OR IGNORE INTO inbox_thread_folders (thread_id, folder_id) SELECT id, ? FROM inbox_threads WHERE id = ? AND owner_id = ?')
          .run(a.folderId, id, owner);
      }
      return unique;
    }
    case 'removeFolder': {
      for (const id of unique) {
        await db
          .prepare('DELETE FROM inbox_thread_folders WHERE folder_id = ? AND thread_id IN (SELECT id FROM inbox_threads WHERE id = ? AND owner_id = ?)')
          .run(a.folderId, id, owner);
      }
      return unique;
    }
  }
  const marks = unique.map(() => '?').join(',');
  await db.prepare(`UPDATE inbox_threads SET ${sql}, updated_at = ? WHERE owner_id = ? AND id IN (${marks})`).run(...extra, nowS, owner, ...unique);
  return unique;
}

export async function saveDraft(owner: string, threadId: string, text: string): Promise<void> {
  const res = await getDb()
    .prepare('UPDATE inbox_threads SET draft = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(text.slice(0, LIMITS.draft), nowIso(), threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function saveNotes(owner: string, threadId: string, text: string): Promise<void> {
  const res = await getDb()
    .prepare('UPDATE inbox_threads SET notes = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(text.slice(0, LIMITS.notes), nowIso(), threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function renameThread(owner: string, threadId: string, title: string): Promise<void> {
  const clean = title.trim().slice(0, 200);
  if (!clean) throw new InboxError('invalid_input', 400);
  const res = await getDb().prepare('UPDATE inbox_threads SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(clean, nowIso(), threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

/** Borra el chat de Inbox (no de WhatsApp ni de Gmail): mensajes guardados, carpetas y programados. */
export async function deleteThread(owner: string, threadId: string): Promise<void> {
  const res = await getDb().prepare('DELETE FROM inbox_threads WHERE id = ? AND owner_id = ?').run(threadId, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

/** Contadores de la barra: no leídos de la bandeja, por responder, pospuestos, programados y por carpeta. */
export async function inboxCounts(owner: string, now = new Date()): Promise<Record<string, number>> {
  const nowS = now.toISOString();
  const r = (await getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN done_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?) AND unread > 0 THEN 1 ELSE 0 END) AS inbox,
         SUM(CASE WHEN done_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?) AND last_from_me = 0 AND kind <> 'group' AND last_message_at IS NOT NULL THEN 1 ELSE 0 END) AS reply,
         SUM(CASE WHEN snoozed_until > ? THEN 1 ELSE 0 END) AS snoozed
       FROM inbox_threads WHERE owner_id = ?`,
    )
    .get(nowS, nowS, nowS, owner)) as { inbox: number | null; reply: number | null; snoozed: number | null } | undefined;
  const s = (await getDb()
    .prepare("SELECT COUNT(*) AS n FROM inbox_scheduled WHERE owner_id = ? AND status IN ('pending','failed','missed')")
    .get(owner)) as { n: number };
  return { inbox: Number(r?.inbox ?? 0), reply: Number(r?.reply ?? 0), snoozed: Number(r?.snoozed ?? 0), scheduled: Number(s.n) };
}

// ---------------------------------------------------------------------------
// Carpetas (splits)
// ---------------------------------------------------------------------------

interface FolderRow {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  parent_id: string | null;
  rule: string;
}

function parseRuleText(raw: string): FolderRule | null {
  if (!raw) return null;
  try {
    return parseRule(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function getFolderRow(owner: string, id: string): Promise<FolderRow> {
  const r = (await getDb().prepare('SELECT * FROM inbox_folders WHERE id = ? AND owner_id = ?').get(id, owner)) as FolderRow | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}

export async function listFolders(owner: string, now = new Date()): Promise<FolderDto[]> {
  const db = getDb();
  const rows = (await db.prepare('SELECT * FROM inbox_folders WHERE owner_id = ? ORDER BY position, created_at').all(owner)) as unknown as FolderRow[];
  if (!rows.length) return [];
  const nowS = now.toISOString();
  // Chats sin leer de cada carpeta (a mano o por regla); después suben a los padres sin repetir.
  const own = new Map<string, Set<string>>();
  const manual = (await db
    .prepare(
      `SELECT tf.folder_id, t.id FROM inbox_thread_folders tf JOIN inbox_threads t ON t.id = tf.thread_id
       WHERE t.owner_id = ? AND t.done_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?) AND t.unread > 0`,
    )
    .all(owner, nowS)) as Array<{ folder_id: string; id: string }>;
  for (const r of manual) own.set(r.folder_id, new Set([...(own.get(r.folder_id) ?? []), r.id]));
  for (const f of rows) {
    const rs = ruleSql(parseRuleText(f.rule));
    if (!rs) continue;
    const hits = (await db
      .prepare(`SELECT t.id FROM inbox_threads t WHERE t.owner_id = ? AND t.done_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?) AND t.unread > 0 AND (${rs.sql}) LIMIT 1000`)
      .all(owner, nowS, ...rs.args)) as Array<{ id: string }>;
    own.set(f.id, new Set([...(own.get(f.id) ?? []), ...hits.map((h) => h.id)]));
  }
  const tree = rows.map((f) => ({ id: f.id, parentId: f.parent_id, position: f.position }));
  const total = rollupUnread(tree, own);
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    icon: f.icon,
    position: f.position,
    parentId: f.parent_id,
    rule: parseRuleText(f.rule),
    count: total.get(f.id) ?? 0,
    ownCount: own.get(f.id)?.size ?? 0,
  }));
}

async function folderTree(owner: string) {
  const rows = (await getDb().prepare('SELECT id, parent_id, position FROM inbox_folders WHERE owner_id = ?').all(owner)) as Array<{ id: string; parent_id: string | null; position: number }>;
  return rows.map((r) => ({ id: r.id, parentId: r.parent_id, position: Number(r.position) }));
}

export interface FolderInput {
  name?: string;
  color?: string;
  icon?: string;
  parentId?: string | null;
  rule?: FolderRule | null;
}

function cleanColor(c: string | undefined): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '';
}

export async function createFolder(owner: string, input: FolderInput): Promise<FolderDto> {
  const name = (input.name ?? '').trim().slice(0, LIMITS.folderName);
  if (!name) throw new InboxError('invalid_input', 400);
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxp FROM inbox_folders WHERE owner_id = ?').get(owner)) as { n: number; maxp: number };
  if (Number(count.n) >= LIMITS.folders) throw new InboxError('too_many', 400);
  if (input.parentId) {
    await getFolderRow(owner, input.parentId);
    if (depthOf(await folderTree(owner), input.parentId) + 1 > MAX_FOLDER_DEPTH) throw new InboxError('too_deep', 400);
  }
  const id = newId('ibf');
  const now = nowIso();
  await db
    .prepare('INSERT INTO inbox_folders (id, owner_id, name, color, icon, position, parent_id, rule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, cleanColor(input.color), (input.icon ?? '').slice(0, 8), Number(count.maxp) + 1, input.parentId ?? null, input.rule ? JSON.stringify(input.rule) : '', now, now);
  return (await listFolders(owner)).find((f) => f.id === id)!;
}

export async function updateFolder(owner: string, id: string, input: FolderInput & { position?: number }): Promise<void> {
  const f = await getFolderRow(owner, id);
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, LIMITS.folderName);
    if (!name) throw new InboxError('invalid_input', 400);
    sets.push('name = ?');
    args.push(name);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    args.push(cleanColor(input.color));
  }
  if (input.icon !== undefined) {
    sets.push('icon = ?');
    args.push(input.icon.slice(0, 8));
  }
  if (input.rule !== undefined) {
    sets.push('rule = ?');
    args.push(input.rule ? JSON.stringify(input.rule) : '');
  }
  if (input.position !== undefined) {
    sets.push('position = ?');
    args.push(Math.max(0, Math.floor(input.position)));
  }
  if (input.parentId !== undefined && input.parentId !== f.parent_id) {
    // Ni dentro de sí misma, ni de sus subcarpetas, ni más hondo que el tope.
    const check = canMoveFolder(await folderTree(owner), f.id, input.parentId);
    if (check !== 'ok') throw new InboxError(check, 400);
    sets.push('parent_id = ?');
    args.push(input.parentId);
  }
  if (!sets.length) return;
  await db.prepare(`UPDATE inbox_folders SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).run(...args, nowIso(), id, owner);
}

export async function reorderFolders(owner: string, ids: string[]): Promise<void> {
  const db = getDb();
  let i = 0;
  for (const id of ids.slice(0, LIMITS.folders)) {
    await db.prepare('UPDATE inbox_folders SET position = ? WHERE id = ? AND owner_id = ?').run(i++, id, owner);
  }
}

/**
 * Mueve una carpeta: dentro de `parentId` (null = primer nivel), antes de
 * `beforeId` (null = al final). Reordena a los hermanos del destino.
 */
export async function moveFolder(owner: string, id: string, parentId: string | null, beforeId: string | null): Promise<void> {
  const f = await getFolderRow(owner, id);
  const tree = await folderTree(owner);
  const check = canMoveFolder(tree, id, parentId);
  if (check !== 'ok') throw new InboxError(check, 400);
  if (beforeId && !tree.some((x) => x.id === beforeId && (x.parentId ?? null) === parentId)) beforeId = null;
  const db = getDb();
  const now = nowIso();
  if ((f.parent_id ?? null) !== parentId) await db.prepare('UPDATE inbox_folders SET parent_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(parentId, now, id, owner);
  const moved = tree.map((x) => (x.id === id ? { ...x, parentId } : x));
  for (const [sid, pos] of siblingOrder(moved, id, parentId, beforeId)) {
    await db.prepare('UPDATE inbox_folders SET position = ? WHERE id = ? AND owner_id = ? AND position <> ?').run(pos, sid, owner, pos);
  }
}

/** Las subcarpetas suben un nivel; los chats no se borran. */
export async function deleteFolder(owner: string, id: string): Promise<void> {
  const f = await getFolderRow(owner, id);
  const db = getDb();
  await db.prepare('UPDATE inbox_folders SET parent_id = ? WHERE parent_id = ? AND owner_id = ?').run(f.parent_id, id, owner);
  await db.prepare('DELETE FROM inbox_folders WHERE id = ? AND owner_id = ?').run(id, owner);
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export async function listSnippets(owner: string): Promise<SnippetDto[]> {
  const rows = (await getDb().prepare('SELECT id, shortcut, title, body FROM inbox_snippets WHERE owner_id = ? ORDER BY title COLLATE NOCASE').all(owner)) as unknown as SnippetDto[];
  return rows.map((r) => ({ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body }));
}

export async function createSnippet(owner: string, input: { title: string; body: string; shortcut?: string }): Promise<SnippetDto> {
  const title = input.title.trim().slice(0, LIMITS.snippetTitle);
  const body = input.body.slice(0, LIMITS.snippetBody);
  if (!title || !body.trim()) throw new InboxError('invalid_input', 400);
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM inbox_snippets WHERE owner_id = ?').get(owner)) as { n: number };
  if (Number(n.n) >= LIMITS.snippets) throw new InboxError('too_many', 400);
  const id = newId('ibs');
  const now = nowIso();
  const shortcut = cleanShortcut(input.shortcut ?? '');
  await db.prepare('INSERT INTO inbox_snippets (id, owner_id, shortcut, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, owner, shortcut, title, body, now, now);
  return { id, shortcut, title, body };
}

export async function updateSnippet(owner: string, id: string, input: { title?: string; body?: string; shortcut?: string }): Promise<void> {
  const sets: string[] = [];
  const args: string[] = [];
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, LIMITS.snippetTitle);
    if (!t) throw new InboxError('invalid_input', 400);
    sets.push('title = ?');
    args.push(t);
  }
  if (input.body !== undefined) {
    if (!input.body.trim()) throw new InboxError('invalid_input', 400);
    sets.push('body = ?');
    args.push(input.body.slice(0, LIMITS.snippetBody));
  }
  if (input.shortcut !== undefined) {
    sets.push('shortcut = ?');
    args.push(cleanShortcut(input.shortcut));
  }
  if (!sets.length) return;
  const res = await getDb().prepare(`UPDATE inbox_snippets SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).run(...args, nowIso(), id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function deleteSnippet(owner: string, id: string): Promise<void> {
  const res = await getDb().prepare('DELETE FROM inbox_snippets WHERE id = ? AND owner_id = ?').run(id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

// ---------------------------------------------------------------------------
// Envíos programados
// ---------------------------------------------------------------------------

interface ScheduledRow {
  id: string;
  owner_id: string;
  thread_id: string;
  body: string;
  send_at: string;
  status: ScheduledStatus;
  error: string;
}

export async function listScheduled(owner: string, threadId?: string): Promise<ScheduledDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.*, t.title AS thread_title, t.handle AS thread_handle, t.channel AS channel FROM inbox_scheduled s JOIN inbox_threads t ON t.id = s.thread_id
       WHERE s.owner_id = ? ${threadId ? 'AND s.thread_id = ?' : ''} AND s.status IN ('pending','sending','failed','missed')
       ORDER BY s.send_at LIMIT 500`,
    )
    .all(...(threadId ? [owner, threadId] : [owner]))) as Array<ScheduledRow & { thread_title: string; thread_handle: string; channel: InboxChannel }>;
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    threadTitle: r.thread_title || r.thread_handle,
    channel: r.channel,
    body: r.body,
    sendAt: r.send_at,
    status: r.status,
    error: r.error,
  }));
}

export async function createScheduled(owner: string, threadId: string, body: string, sendAt: string, now = new Date()): Promise<ScheduledDto> {
  await getThreadRow(owner, threadId);
  const text = body.trim().slice(0, LIMITS.message);
  if (!text) throw new InboxError('invalid_input', 400);
  const at = futureIso(sendAt, now);
  const id = newId('ibq');
  const nowS = nowIso(now);
  await getDb()
    .prepare("INSERT INTO inbox_scheduled (id, owner_id, thread_id, body, send_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
    .run(id, owner, threadId, text, at, nowS, nowS);
  return (await listScheduled(owner, threadId)).find((s) => s.id === id)!;
}

export async function updateScheduled(owner: string, id: string, input: { body?: string; sendAt?: string }, now = new Date()): Promise<void> {
  const sets: string[] = ["status = 'pending'", "error = ''"];
  const args: string[] = [];
  if (input.body !== undefined) {
    const text = input.body.trim().slice(0, LIMITS.message);
    if (!text) throw new InboxError('invalid_input', 400);
    sets.push('body = ?');
    args.push(text);
  }
  if (input.sendAt !== undefined) {
    sets.push('send_at = ?');
    args.push(futureIso(input.sendAt, now));
  }
  const res = await getDb()
    .prepare(`UPDATE inbox_scheduled SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('pending','failed','missed')`)
    .run(...args, nowIso(now), id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

export async function cancelScheduled(owner: string, id: string): Promise<void> {
  const res = await getDb()
    .prepare("UPDATE inbox_scheduled SET status = 'cancelled', updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('pending','failed','missed')")
    .run(nowIso(), id, owner);
  if (res.changes === 0) throw new InboxError('not_found', 404);
}

/**
 * Reclama un programado para mandarlo (compare-and-set: dos corridas nunca
 * mandan el mismo). `force` lo manda aunque no haya llegado la hora (Enviar ya).
 */
export async function claimScheduled(id: string, now: Date, force = false): Promise<ScheduledRow | null> {
  const nowS = nowIso(now);
  const res = await getDb()
    .prepare(
      `UPDATE inbox_scheduled SET status = 'sending', claimed_until = ?, updated_at = ?
       WHERE id = ? AND ${force ? "status IN ('pending','failed','missed')" : "status = 'pending' AND send_at <= ?"}`,
    )
    .run(...(force ? [new Date(now.getTime() + 5 * 60_000).toISOString(), nowS, id] : [new Date(now.getTime() + 5 * 60_000).toISOString(), nowS, id, nowS]));
  if (res.changes === 0) return null;
  return ((await getDb().prepare('SELECT * FROM inbox_scheduled WHERE id = ?').get(id)) as ScheduledRow | undefined) ?? null;
}

export async function finishScheduled(id: string, ok: boolean, error = ''): Promise<void> {
  const now = nowIso();
  await getDb()
    .prepare(`UPDATE inbox_scheduled SET status = ?, error = ?, sent_at = ?, claimed_until = NULL, updated_at = ? WHERE id = ?`)
    .run(ok ? 'sent' : 'failed', error.slice(0, 200), ok ? now : null, now, id);
}

export async function getScheduledOwned(owner: string, id: string): Promise<ScheduledRow> {
  const r = (await getDb().prepare('SELECT * FROM inbox_scheduled WHERE id = ? AND owner_id = ?').get(id, owner)) as ScheduledRow | undefined;
  if (!r) throw new InboxError('not_found', 404);
  return r;
}
