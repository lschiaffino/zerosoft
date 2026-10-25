/**
 * Talk: lo que rodea a los mensajes. Guardados ("Más tarde"), recordatorios,
 * borradores, mensajes programados, presencia y estado, preferencias de
 * aviso, archivos, búsqueda y webhooks entrantes. Server-only.
 */
import { getDb } from './db';
import { sha256 } from './api-auth';
import { likeContains } from './track-views';
import { emojiFromName } from './talk-emoji';
import { parseTalkSearch, hasSearchCriteria } from './talk-search';
import {
  TalkError,
  canManageChannel,
  emitTalkEvent,
  listTalkPeople,
  nowIso,
  readableChannel,
  readableMessage,
  toMessageDtos,
  writableChannel,
  type TalkActor,
  type TalkChannelKind,
  type TalkFileDto,
  type TalkMessageDto,
  type TalkMessageRow,
} from './talk';

const inList = (n: number) => Array.from({ length: n }, () => '?').join(', ');

// ---------- Guardados y recordatorios ----------

export async function setSaved(actor: TalkActor, messageId: string, saved: boolean): Promise<void> {
  const found = await readableMessage(actor, messageId);
  if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
  const db = getDb();
  if (saved) {
    await db
      .prepare(
        `INSERT INTO talk_saved (user_id, message_id, workspace_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, message_id) DO UPDATE SET done_at = NULL`,
      )
      .run(actor.personId, messageId, actor.workspaceId, nowIso());
  } else {
    await db.prepare('DELETE FROM talk_saved WHERE user_id = ? AND message_id = ?').run(actor.personId, messageId);
  }
  await emitTalkEvent(actor.workspaceId, 'saved', { userId: actor.personId, payload: { id: messageId, refresh: true } });
}

export async function completeSaved(actor: TalkActor, messageId: string, done: boolean): Promise<void> {
  await getDb()
    .prepare('UPDATE talk_saved SET done_at = ? WHERE user_id = ? AND message_id = ?')
    .run(done ? nowIso() : null, actor.personId, messageId);
  await emitTalkEvent(actor.workspaceId, 'saved', { userId: actor.personId, payload: { id: messageId } });
}

export interface TalkReminderDto {
  id: string;
  text: string;
  remindAt: string;
  sentAt: string | null;
  message: TalkMessageDto | null;
}

export async function createReminder(actor: TalkActor, input: { messageId?: string | null; text?: string; remindAt: string }): Promise<TalkReminderDto> {
  const at = new Date(input.remindAt);
  if (Number.isNaN(at.getTime())) throw new TalkError('invalid_time');
  if (at.getTime() < Date.now() - 60_000 || at.getTime() > Date.now() + 366 * 86_400_000) throw new TalkError('invalid_time');
  let message: TalkMessageRow | null = null;
  if (input.messageId) {
    const found = await readableMessage(actor, input.messageId);
    if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
    message = found.message;
  }
  const text = (input.text ?? '').trim().slice(0, 500);
  if (!message && !text) throw new TalkError('empty_reminder');
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO talk_reminders (id, workspace_id, user_id, message_id, text, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, actor.personId, message?.id ?? null, text, at.toISOString(), nowIso());
  // Un recordatorio de un mensaje también lo deja en "Más tarde".
  if (message) await setSaved(actor, message.id, true);
  else await emitTalkEvent(actor.workspaceId, 'saved', { userId: actor.personId, payload: { reminder: id } });
  return { id, text, remindAt: at.toISOString(), sentAt: null, message: message ? (await toMessageDtos(actor, [message]))[0] : null };
}

export async function deleteReminder(actor: TalkActor, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM talk_reminders WHERE id = ? AND user_id = ? AND workspace_id = ?').run(id, actor.personId, actor.workspaceId);
  if (res.changes) await emitTalkEvent(actor.workspaceId, 'saved', { userId: actor.personId, payload: { reminder: id } });
  return res.changes > 0;
}

export interface LaterItem {
  message: TalkMessageDto | null;
  channel: { id: string; name: string; kind: TalkChannelKind } | null;
  savedAt: string | null;
  done: boolean;
  reminder: { id: string; text: string; remindAt: string; sentAt: string | null } | null;
}

/** "Más tarde": guardados (en curso o completados) y recordatorios. */
export async function listLater(actor: TalkActor, view: 'open' | 'done' = 'open'): Promise<LaterItem[]> {
  const db = getDb();
  const saved = (await db
    .prepare(
      `SELECT m.*, s.created_at AS s_at, s.done_at AS s_done, c.name AS c_name, c.kind AS c_kind,
         (SELECT r.id FROM talk_reminders r WHERE r.user_id = s.user_id AND r.message_id = m.id ORDER BY r.remind_at DESC LIMIT 1) AS r_id
       FROM talk_saved s JOIN talk_messages m ON m.id = s.message_id JOIN talk_channels c ON c.id = m.channel_id
       WHERE s.user_id = ? AND s.workspace_id = ? AND ${view === 'done' ? 's.done_at IS NOT NULL' : 's.done_at IS NULL'}
         AND (c.kind = 'public' OR EXISTS (SELECT 1 FROM talk_members tm WHERE tm.channel_id = c.id AND tm.user_id = s.user_id))
       ORDER BY s.created_at DESC LIMIT 200`,
    )
    .all(actor.personId, actor.workspaceId)) as Array<TalkMessageRow & { s_at: string; s_done: string | null; c_name: string; c_kind: TalkChannelKind; r_id: string | null }>;
  const reminders = (await db
    .prepare('SELECT * FROM talk_reminders WHERE user_id = ? AND workspace_id = ? ORDER BY remind_at ASC LIMIT 200')
    .all(actor.personId, actor.workspaceId)) as Array<{ id: string; message_id: string | null; text: string; remind_at: string; sent_at: string | null }>;
  const remById = new Map(reminders.map((r) => [r.id, r]));
  const dtos = await toMessageDtos(actor, saved);
  const items: LaterItem[] = saved.map((s, i) => {
    const r = s.r_id ? remById.get(s.r_id) : undefined;
    return {
      message: dtos[i],
      channel: { id: s.channel_id, name: s.c_name, kind: s.c_kind },
      savedAt: s.s_at,
      done: !!s.s_done,
      reminder: r ? { id: r.id, text: r.text, remindAt: r.remind_at, sentAt: r.sent_at } : null,
    };
  });
  if (view === 'open') {
    // Recordatorios sueltos (/remind) que no son de un mensaje guardado.
    for (const r of reminders) {
      if (r.message_id) continue;
      items.push({ message: null, channel: null, savedAt: null, done: false, reminder: { id: r.id, text: r.text, remindAt: r.remind_at, sentAt: r.sent_at } });
    }
  }
  return items;
}

// ---------- Borradores ----------

export async function saveDraft(actor: TalkActor, channelId: string, parentId: string | null, body: string): Promise<void> {
  const access = await readableChannel(actor, channelId);
  if (!access?.member) throw new TalkError('not_found', 404);
  const db = getDb();
  if (!body.trim()) {
    await db.prepare('DELETE FROM talk_drafts WHERE user_id = ? AND channel_id = ? AND parent_id = ?').run(actor.personId, channelId, parentId ?? '');
    return;
  }
  await db
    .prepare(
      `INSERT INTO talk_drafts (user_id, channel_id, parent_id, body, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, channel_id, parent_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    )
    .run(actor.personId, channelId, parentId ?? '', body.slice(0, 12_000), nowIso());
}

export interface TalkDraftDto {
  channelId: string;
  parentId: string | null;
  body: string;
  updatedAt: string;
  channel: { name: string; kind: TalkChannelKind };
}

export async function listDrafts(actor: TalkActor): Promise<TalkDraftDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT d.*, c.name AS c_name, c.kind AS c_kind FROM talk_drafts d JOIN talk_channels c ON c.id = d.channel_id
       JOIN talk_members m ON m.channel_id = c.id AND m.user_id = d.user_id
       WHERE d.user_id = ? AND c.workspace_id = ? ORDER BY d.updated_at DESC LIMIT 200`,
    )
    .all(actor.personId, actor.workspaceId)) as Array<{ channel_id: string; parent_id: string; body: string; updated_at: string; c_name: string; c_kind: TalkChannelKind }>;
  return rows.map((r) => ({ channelId: r.channel_id, parentId: r.parent_id || null, body: r.body, updatedAt: r.updated_at, channel: { name: r.c_name, kind: r.c_kind } }));
}

// ---------- Programados ----------

export interface TalkScheduledDto {
  id: string;
  channelId: string;
  parentId: string | null;
  body: string;
  sendAt: string;
  status: string;
  error: string | null;
  channel: { name: string; kind: TalkChannelKind };
}

export async function scheduleMessage(actor: TalkActor, input: { channelId: string; parentId?: string | null; body: string; sendAt: string; fileIds?: string[] }): Promise<TalkScheduledDto> {
  await writableChannel(actor, input.channelId);
  const at = new Date(input.sendAt);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 30_000 || at.getTime() > Date.now() + 120 * 86_400_000) throw new TalkError('invalid_time');
  if (!input.body.trim() && !input.fileIds?.length) throw new TalkError('empty_message');
  if (input.body.length > 12_000) throw new TalkError('message_too_long');
  const id = crypto.randomUUID();
  const db = getDb();
  await db
    .prepare('INSERT INTO talk_scheduled (id, workspace_id, user_id, channel_id, parent_id, body, files, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, actor.personId, input.channelId, input.parentId ?? null, input.body, JSON.stringify(input.fileIds ?? []), at.toISOString(), nowIso());
  await db.prepare('DELETE FROM talk_drafts WHERE user_id = ? AND channel_id = ? AND parent_id = ?').run(actor.personId, input.channelId, input.parentId ?? '');
  return (await listScheduled(actor)).find((s) => s.id === id)!;
}

export async function listScheduled(actor: TalkActor): Promise<TalkScheduledDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.*, c.name AS c_name, c.kind AS c_kind FROM talk_scheduled s JOIN talk_channels c ON c.id = s.channel_id
       WHERE s.user_id = ? AND s.workspace_id = ? AND s.status IN ('pending', 'failed') ORDER BY s.send_at ASC LIMIT 200`,
    )
    .all(actor.personId, actor.workspaceId)) as Array<{ id: string; channel_id: string; parent_id: string | null; body: string; send_at: string; status: string; error: string | null; c_name: string; c_kind: TalkChannelKind }>;
  return rows.map((r) => ({ id: r.id, channelId: r.channel_id, parentId: r.parent_id, body: r.body, sendAt: r.send_at, status: r.status, error: r.error, channel: { name: r.c_name, kind: r.c_kind } }));
}

export async function updateScheduled(actor: TalkActor, id: string, input: { body?: string; sendAt?: string }): Promise<boolean> {
  const db = getDb();
  if (input.sendAt !== undefined) {
    const at = new Date(input.sendAt);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 30_000) throw new TalkError('invalid_time');
    input.sendAt = at.toISOString();
  }
  const res = await db
    .prepare(
      "UPDATE talk_scheduled SET body = COALESCE(?, body), send_at = COALESCE(?, send_at), status = 'pending', error = NULL WHERE id = ? AND user_id = ? AND workspace_id = ? AND status IN ('pending', 'failed')",
    )
    .run(input.body ?? null, input.sendAt ?? null, id, actor.personId, actor.workspaceId);
  return res.changes > 0;
}

export async function cancelScheduled(actor: TalkActor, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE talk_scheduled SET status = 'cancelled' WHERE id = ? AND user_id = ? AND workspace_id = ? AND status IN ('pending', 'failed')")
    .run(id, actor.personId, actor.workspaceId);
  return res.changes > 0;
}

// ---------- Presencia y estado ----------

export const ACTIVE_MS = 3 * 60_000;

export interface TalkPresenceDto {
  userId: string;
  active: boolean;
  away: boolean;
  statusEmoji: string;
  statusText: string;
  statusExpiresAt: string | null;
  dndUntil: string | null;
  lastSeenAt: string | null;
}

function toPresence(r: { user_id: string; last_seen_at: string | null; away: number; status_emoji: string; status_text: string; status_expires_at: string | null; dnd_until: string | null }, now = Date.now()): TalkPresenceDto {
  const expired = !!r.status_expires_at && new Date(r.status_expires_at).getTime() <= now;
  const active = !r.away && !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() < ACTIVE_MS;
  return {
    userId: r.user_id,
    active,
    away: !!r.away,
    statusEmoji: expired ? '' : r.status_emoji,
    statusText: expired ? '' : r.status_text,
    statusExpiresAt: expired ? null : r.status_expires_at,
    dndUntil: r.dnd_until && new Date(r.dnd_until).getTime() > now ? r.dnd_until : null,
    lastSeenAt: r.last_seen_at,
  };
}

export async function listPresence(workspaceId: string): Promise<TalkPresenceDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM talk_presence WHERE workspace_id = ?').all(workspaceId)) as Parameters<typeof toPresence>[0][];
  return rows.map((r) => toPresence(r));
}

/** Latido de la pestaña abierta. Avisa el cambio de ausente → activo. */
/** Último latido escrito por persona (en memoria): varias pestañas no escriben más de uno por ventana. */
const lastBeat = new Map<string, number>();
const BEAT_EVERY_MS = 45_000;

export async function heartbeat(actor: TalkActor, opts: { force?: boolean } = {}): Promise<void> {
  const key = `${actor.workspaceId}|${actor.personId}`;
  const t = Date.now();
  if (!opts.force && t - (lastBeat.get(key) ?? 0) < BEAT_EVERY_MS) return;
  lastBeat.set(key, t);
  if (lastBeat.size > 5000) lastBeat.clear();
  const db = getDb();
  const now = nowIso();
  const prev = (await db.prepare('SELECT * FROM talk_presence WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId)) as Parameters<typeof toPresence>[0] | undefined;
  await db
    .prepare(
      `INSERT INTO talk_presence (workspace_id, user_id, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .run(actor.workspaceId, actor.personId, now);
  if (!prev || !toPresence(prev).active) {
    const row = { ...(prev ?? { user_id: actor.personId, away: 0, status_emoji: '', status_text: '', status_expires_at: null, dnd_until: null }), last_seen_at: now };
    await emitTalkEvent(actor.workspaceId, 'presence', { actorId: actor.personId, payload: { userId: actor.personId, presence: toPresence(row) } });
  }
}

export async function setStatus(
  actor: TalkActor,
  input: { emoji?: string; text?: string; expiresAt?: string | null; away?: boolean; dndUntil?: string | null },
): Promise<TalkPresenceDto> {
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO talk_presence (workspace_id, user_id, last_seen_at) VALUES (?, ?, ?)').run(actor.workspaceId, actor.personId, nowIso());
  if (input.emoji !== undefined || input.text !== undefined || input.expiresAt !== undefined) {
    const exp = input.expiresAt ? new Date(input.expiresAt) : null;
    if (exp && Number.isNaN(exp.getTime())) throw new TalkError('invalid_time');
    await db
      .prepare('UPDATE talk_presence SET status_emoji = ?, status_text = ?, status_expires_at = ? WHERE workspace_id = ? AND user_id = ?')
      .run((input.emoji ?? '').slice(0, 16), (input.text ?? '').slice(0, 100), exp ? exp.toISOString() : null, actor.workspaceId, actor.personId);
  }
  if (input.away !== undefined) await db.prepare('UPDATE talk_presence SET away = ? WHERE workspace_id = ? AND user_id = ?').run(input.away ? 1 : 0, actor.workspaceId, actor.personId);
  if (input.dndUntil !== undefined) {
    const until = input.dndUntil ? new Date(input.dndUntil) : null;
    if (until && Number.isNaN(until.getTime())) throw new TalkError('invalid_time');
    await db.prepare('UPDATE talk_presence SET dnd_until = ? WHERE workspace_id = ? AND user_id = ?').run(until ? until.toISOString() : null, actor.workspaceId, actor.personId);
  }
  const row = (await db.prepare('SELECT * FROM talk_presence WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId)) as Parameters<typeof toPresence>[0];
  const dto = toPresence(row);
  await emitTalkEvent(actor.workspaceId, 'presence', { actorId: actor.personId, payload: { userId: actor.personId, presence: dto } });
  return dto;
}

// ---------- Preferencias ----------

export interface TalkPrefs {
  notify: 'all' | 'mentions' | 'none';
  email: 'mentions' | 'off';
  keywords: string;
}

export async function getPrefs(workspaceId: string, userId: string): Promise<TalkPrefs> {
  const row = (await getDb().prepare('SELECT notify, email, keywords FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId)) as TalkPrefs | undefined;
  return row ?? { notify: 'mentions', email: 'mentions', keywords: '' };
}

export async function setPrefs(actor: TalkActor, input: Partial<TalkPrefs>): Promise<TalkPrefs> {
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO talk_prefs (workspace_id, user_id) VALUES (?, ?)').run(actor.workspaceId, actor.personId);
  if (input.notify) await db.prepare('UPDATE talk_prefs SET notify = ? WHERE workspace_id = ? AND user_id = ?').run(input.notify, actor.workspaceId, actor.personId);
  if (input.email) await db.prepare('UPDATE talk_prefs SET email = ? WHERE workspace_id = ? AND user_id = ?').run(input.email, actor.workspaceId, actor.personId);
  if (input.keywords !== undefined) {
    const kw = input.keywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20)
      .join(', ');
    await db.prepare('UPDATE talk_prefs SET keywords = ? WHERE workspace_id = ? AND user_id = ?').run(kw, actor.workspaceId, actor.personId);
  }
  return getPrefs(actor.workspaceId, actor.personId);
}

// ---------- Archivos ----------

export async function addFile(actor: TalkActor, channelId: string, file: { url: string; name: string; mime: string; size: number }): Promise<TalkFileDto> {
  await writableChannel(actor, channelId);
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO talk_files (id, workspace_id, channel_id, user_id, url, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, channelId, actor.personId, file.url, file.name.slice(0, 200), file.mime, file.size, nowIso());
  return { id, name: file.name, mime: file.mime, size: file.size, url: `/api/talk/files/${id}` };
}

/** Un archivo si su canal es legible (los sueltos, sin mensaje, solo para quien lo subió). */
export async function readableFile(actor: TalkActor, id: string): Promise<{ url: string; name: string; mime: string } | null> {
  const row = (await getDb().prepare('SELECT * FROM talk_files WHERE id = ? AND workspace_id = ?').get(id, actor.workspaceId)) as
    | { url: string; name: string; mime: string; channel_id: string; user_id: string; message_id: string | null }
    | undefined;
  if (!row) return null;
  if (!row.message_id && row.user_id !== actor.personId) return null;
  if (!(await readableChannel(actor, row.channel_id))) return null;
  return { url: row.url, name: row.name, mime: row.mime };
}

/** Archivo subido y no enviado: quien lo subió lo puede descartar. */
export async function discardFile(actor: TalkActor, id: string): Promise<string | null> {
  const row = (await getDb()
    .prepare('SELECT url FROM talk_files WHERE id = ? AND workspace_id = ? AND user_id = ? AND message_id IS NULL')
    .get(id, actor.workspaceId, actor.personId)) as { url: string } | undefined;
  if (!row) return null;
  await getDb().prepare('DELETE FROM talk_files WHERE id = ?').run(id);
  return row.url;
}

export interface TalkFileListItem extends TalkFileDto {
  channelId: string;
  channelName: string;
  channelKind: TalkChannelKind;
  messageId: string;
  userId: string;
  createdAt: string;
}

/** Explorador de archivos: los compartidos en lo que puedo leer. */
export async function listFiles(actor: TalkActor, opts: { channelId?: string | null; q?: string; kind?: 'image' | 'document' | 'all'; limit?: number } = {}): Promise<TalkFileListItem[]> {
  const where = [
    'f.workspace_id = ?',
    'f.message_id IS NOT NULL',
    "(c.kind = 'public' OR EXISTS (SELECT 1 FROM talk_members tm WHERE tm.channel_id = c.id AND tm.user_id = ?))",
  ];
  const args: Array<string | number> = [actor.workspaceId, actor.personId];
  if (opts.channelId) {
    where.push('f.channel_id = ?');
    args.push(opts.channelId);
  }
  if (opts.q?.trim()) {
    where.push("f.name LIKE ? ESCAPE '\\'");
    args.push(likeContains(opts.q.trim()));
  }
  if (opts.kind === 'image') where.push("f.mime LIKE 'image/%'");
  if (opts.kind === 'document') where.push("f.mime NOT LIKE 'image/%'");
  const rows = (await getDb()
    .prepare(
      `SELECT f.*, c.name AS c_name, c.kind AS c_kind FROM talk_files f JOIN talk_channels c ON c.id = f.channel_id
       WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT ?`,
    )
    .all(...args, Math.min(opts.limit ?? 100, 200))) as Array<{ id: string; name: string; mime: string; size: number; channel_id: string; c_name: string; c_kind: TalkChannelKind; message_id: string; user_id: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: Number(r.size),
    url: `/api/talk/files/${r.id}`,
    channelId: r.channel_id,
    channelName: r.c_name,
    channelKind: r.c_kind,
    messageId: r.message_id,
    userId: r.user_id,
    createdAt: r.created_at,
  }));
}

// ---------- Búsqueda ----------

export interface TalkSearchResult {
  message: TalkMessageDto;
  channel: { id: string; name: string; kind: TalkChannelKind };
}

export async function searchMessages(actor: TalkActor, raw: string, limit = 50): Promise<{ results: TalkSearchResult[]; channels: Array<{ id: string; name: string; kind: TalkChannelKind }> }> {
  const q = parseTalkSearch(raw);
  if (!hasSearchCriteria(q)) return { results: [], channels: [] };
  const db = getDb();
  const people = await listTalkPeople(actor.workspaceId);
  const findPeople = (names: string[]) => {
    const ids: string[] = [];
    for (const n of names) {
      const v = n.toLowerCase();
      if (v === 'me' || v === 'yo' || v === 'eu' || v === 'mí' || v === 'mi') {
        ids.push(actor.personId);
        continue;
      }
      for (const p of people) {
        if (p.name.toLowerCase() === v || p.email.toLowerCase() === v || p.email.toLowerCase().split('@')[0] === v || p.name.toLowerCase().split(' ')[0] === v) ids.push(p.id);
      }
    }
    return [...new Set(ids)];
  };
  const where = [
    'm.workspace_id = ?',
    'm.deleted_at IS NULL',
    "(c.kind = 'public' OR EXISTS (SELECT 1 FROM talk_members tm WHERE tm.channel_id = c.id AND tm.user_id = ?))",
  ];
  const args: Array<string | number> = [actor.workspaceId, actor.personId];
  const impossible = () => where.push('0');
  const channelIds = async (names: string[]) => {
    const ids: string[] = [];
    for (const n of names) {
      if (n.startsWith('@')) {
        // in:@persona → el DM con esa persona.
        for (const pid of findPeople([n.slice(1)])) {
          const key = [...new Set([actor.personId, pid])].sort().join(',');
          const row = (await db.prepare('SELECT id FROM talk_channels WHERE workspace_id = ? AND dm_key = ?').get(actor.workspaceId, key)) as { id: string } | undefined;
          if (row) ids.push(row.id);
        }
      } else {
        const rows = (await db
          .prepare("SELECT id FROM talk_channels WHERE workspace_id = ? AND kind IN ('public', 'private') AND name = ?")
          .all(actor.workspaceId, n.toLowerCase())) as Array<{ id: string }>;
        ids.push(...rows.map((r) => r.id));
      }
    }
    return ids;
  };
  // Texto: índice FTS5 (palabras y prefijos, sin tildes); si la base no lo tiene, LIKE.
  const ftsQuery = q.terms
    .map((term) => term.replace(/"/g, ' ').trim())
    .filter(Boolean)
    .map((term) => (/\s/.test(term) ? `"${term}"` : `"${term}"*`))
    .join(' ');
  const textWhere: string[] = [];
  const textArgs: Array<string | number> = [];
  const likeWhere: string[] = [];
  const likeArgs: Array<string | number> = [];
  for (const term of q.terms) {
    likeWhere.push("m.body LIKE ? ESCAPE '\\'");
    likeArgs.push(likeContains(term));
  }
  if (ftsQuery) {
    textWhere.push('m.rowid IN (SELECT rowid FROM talk_messages_fts WHERE talk_messages_fts MATCH ?)');
    textArgs.push(ftsQuery);
  }
  for (const term of q.excludes) {
    where.push("m.body NOT LIKE ? ESCAPE '\\'");
    args.push(likeContains(term));
  }
  if (q.in.length) {
    const ids = await channelIds(q.in);
    if (!ids.length) impossible();
    else {
      where.push(`m.channel_id IN (${inList(ids.length)})`);
      args.push(...ids);
    }
  }
  if (q.notIn.length) {
    const ids = await channelIds(q.notIn);
    if (ids.length) {
      where.push(`m.channel_id NOT IN (${inList(ids.length)})`);
      args.push(...ids);
    }
  }
  if (q.from.length) {
    const ids = findPeople(q.from);
    if (!ids.length) impossible();
    else {
      where.push(`m.user_id IN (${inList(ids.length)})`);
      args.push(...ids);
    }
  }
  if (q.notFrom.length) {
    const ids = findPeople(q.notFrom);
    if (ids.length) {
      where.push(`(m.user_id IS NULL OR m.user_id NOT IN (${inList(ids.length)}))`);
      args.push(...ids);
    }
  }
  for (const h of q.has) {
    if (h === 'link') where.push("(m.body LIKE '%http://%' OR m.body LIKE '%https://%')");
    if (h === 'file') where.push('EXISTS (SELECT 1 FROM talk_files f WHERE f.message_id = m.id)');
    if (h === 'pin') where.push('m.pinned_at IS NOT NULL');
    if (h === 'reaction') where.push('EXISTS (SELECT 1 FROM talk_reactions r WHERE r.message_id = m.id)');
  }
  for (const e of q.hasEmoji) {
    where.push('EXISTS (SELECT 1 FROM talk_reactions r WHERE r.message_id = m.id AND r.emoji = ?)');
    args.push(emojiFromName(e) ?? e);
  }
  if (q.is.includes('saved')) {
    where.push('EXISTS (SELECT 1 FROM talk_saved s WHERE s.message_id = m.id AND s.user_id = ?)');
    args.push(actor.personId);
  }
  if (q.is.includes('thread')) where.push('(m.parent_id IS NOT NULL OR m.reply_count > 0)');
  if (q.after) {
    where.push('m.created_at >= ?');
    args.push(q.after);
  }
  if (q.before) {
    where.push('m.created_at < ?');
    args.push(q.before);
  }
  const run = (extraWhere: string[], extraArgs: Array<string | number>) =>
    db
      .prepare(
        `SELECT m.*, c.name AS c_name, c.kind AS c_kind FROM talk_messages m JOIN talk_channels c ON c.id = m.channel_id
         WHERE ${[...where, ...extraWhere].join(' AND ')} ORDER BY m.created_at DESC LIMIT ?`,
      )
      .all(...args, ...extraArgs, Math.min(limit, 100)) as Promise<Array<TalkMessageRow & { c_name: string; c_kind: TalkChannelKind }>>;
  let rows: Array<TalkMessageRow & { c_name: string; c_kind: TalkChannelKind }>;
  try {
    rows = await run(textWhere, textArgs);
  } catch {
    rows = await run(likeWhere, likeArgs);
  }
  const dtos = await toMessageDtos(actor, rows);
  // Canales cuyo nombre coincide con el texto (como el "Canales" de los resultados de Slack).
  let channels: Array<{ id: string; name: string; kind: TalkChannelKind }> = [];
  const text = q.terms.join(' ').trim();
  if (text && !q.in.length && !q.from.length) {
    channels = (await db
      .prepare(
        `SELECT c.id, c.name, c.kind FROM talk_channels c WHERE c.workspace_id = ? AND c.kind IN ('public', 'private') AND c.archived_at IS NULL
         AND (c.kind = 'public' OR EXISTS (SELECT 1 FROM talk_members tm WHERE tm.channel_id = c.id AND tm.user_id = ?))
         AND c.name LIKE ? ESCAPE '\\' ORDER BY c.name LIMIT 5`,
      )
      .all(actor.workspaceId, actor.personId, likeContains(text.toLowerCase().replace(/\s+/g, '-')))) as Array<{ id: string; name: string; kind: TalkChannelKind }>;
  }
  return { results: rows.map((r, i) => ({ message: dtos[i], channel: { id: r.channel_id, name: r.c_name, kind: r.c_kind } })), channels };
}

// ---------- Webhooks entrantes ----------

export interface TalkHookDto {
  id: string;
  channelId: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/** Crea un webhook entrante para el canal. El token se devuelve una sola vez (se guarda su hash). */
export async function createHook(actor: TalkActor, channelId: string, name: string): Promise<{ hook: TalkHookDto; token: string }> {
  const { channel } = await writableChannel(actor, channelId);
  if (channel.kind === 'dm' || channel.kind === 'group') throw new TalkError('forbidden', 403);
  const id = crypto.randomUUID();
  const token = `zth_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = nowIso();
  const clean = name.trim().slice(0, 60) || 'Webhook';
  await getDb()
    .prepare('INSERT INTO talk_hooks (id, workspace_id, channel_id, name, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, channelId, clean, sha256(token), actor.personId, now);
  return { hook: { id, channelId, name: clean, createdBy: actor.personId, createdAt: now }, token };
}

export async function listHooks(actor: TalkActor, channelId: string): Promise<TalkHookDto[]> {
  if (!(await readableChannel(actor, channelId))?.member) throw new TalkError('not_found', 404);
  const rows = (await getDb()
    .prepare('SELECT id, channel_id, name, created_by, created_at FROM talk_hooks WHERE channel_id = ? AND workspace_id = ? ORDER BY created_at')
    .all(channelId, actor.workspaceId)) as Array<{ id: string; channel_id: string; name: string; created_by: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, channelId: r.channel_id, name: r.name, createdBy: r.created_by, createdAt: r.created_at }));
}

export async function deleteHook(actor: TalkActor, channelId: string, id: string): Promise<boolean> {
  const access = await readableChannel(actor, channelId);
  if (!access?.member) throw new TalkError('not_found', 404);
  const hook = (await getDb().prepare('SELECT created_by FROM talk_hooks WHERE id = ? AND channel_id = ? AND workspace_id = ?').get(id, channelId, actor.workspaceId)) as
    | { created_by: string }
    | undefined;
  if (!hook) return false;
  // Quien lo creó o quien administra el canal (como en Slack).
  if (hook.created_by !== actor.personId && !canManageChannel(actor, access.channel, access.member)) throw new TalkError('forbidden', 403);
  const res = await getDb().prepare('DELETE FROM talk_hooks WHERE id = ? AND channel_id = ? AND workspace_id = ?').run(id, channelId, actor.workspaceId);
  return res.changes > 0;
}

export async function hookByToken(token: string): Promise<{ id: string; workspace_id: string; channel_id: string; name: string; created_by: string } | null> {
  if (!/^zth_[a-f0-9]{48}$/.test(token)) return null;
  const row = (await getDb().prepare('SELECT * FROM talk_hooks WHERE token_hash = ?').get(sha256(token))) as
    | { id: string; workspace_id: string; channel_id: string; name: string; created_by: string }
    | undefined;
  return row ?? null;
}
