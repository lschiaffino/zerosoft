/**
 * Talk: marcadores del canal (la barra de links debajo del encabezado, como en
 * Slack). Los ve quien lee el canal; los agrega, edita y borra quien es
 * miembro (canal sin archivar). Solo links http(s): lo que se guarda termina
 * en un href. Server-only.
 */
import { getDb } from './db';
import { TalkError, emitTalkEvent, nowIso, readableChannel, writableChannel, type TalkActor } from './talk';

export const MAX_BOOKMARKS = 50;
export const BOOKMARK_TITLE_MAX = 120;
export const BOOKMARK_URL_MAX = 2000;

export interface TalkBookmarkDto {
  id: string;
  channelId: string;
  title: string;
  url: string;
  createdBy: string;
  createdAt: string;
}

type Row = { id: string; channel_id: string; title: string; url: string; created_by: string; created_at: string };

const toDto = (r: Row): TalkBookmarkDto => ({ id: r.id, channelId: r.channel_id, title: r.title, url: r.url, createdBy: r.created_by, createdAt: r.created_at });

/** La URL normalizada si es http(s); "ejemplo.com" se toma como https. */
export function normalizeBookmarkUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > BOOKMARK_URL_MAX) return null;
  // Con esquema (javascript:, data:, mailto:…) se respeta y se rechaza abajo; sin esquema es un dominio ("host:8080" no es esquema).
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v);
  try {
    const u = new URL(hasScheme ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cleanTitle(raw: string | undefined, url: string): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, BOOKMARK_TITLE_MAX);
  return t || new URL(url).hostname.replace(/^www\./, '');
}

export async function listBookmarks(actor: TalkActor, channelId: string): Promise<TalkBookmarkDto[]> {
  if (!(await readableChannel(actor, channelId))) throw new TalkError('not_found', 404);
  const rows = (await getDb().prepare('SELECT * FROM talk_bookmarks WHERE channel_id = ? ORDER BY created_at, id LIMIT ?').all(channelId, MAX_BOOKMARKS)) as Row[];
  return rows.map(toDto);
}

export async function createBookmark(actor: TalkActor, channelId: string, input: { title?: string; url: string }): Promise<TalkBookmarkDto> {
  await writableChannel(actor, channelId);
  const url = normalizeBookmarkUrl(input.url);
  if (!url) throw new TalkError('invalid_bookmark_url');
  const now = nowIso();
  const id = crypto.randomUUID();
  // El tope va en el mismo INSERT: dos pedidos a la vez no lo pasan.
  const res = await getDb()
    .prepare(
      `INSERT INTO talk_bookmarks (id, workspace_id, channel_id, title, url, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM talk_bookmarks WHERE channel_id = ?) < ?`,
    )
    .run(id, actor.workspaceId, channelId, cleanTitle(input.title, url), url, actor.personId, now, now, channelId, MAX_BOOKMARKS);
  if (!res.changes) throw new TalkError('too_many_bookmarks', 409);
  await emitTalkEvent(actor.workspaceId, 'bookmark', { channelId, actorId: actor.personId, payload: { change: 'created', id } });
  return toDto((await getDb().prepare('SELECT * FROM talk_bookmarks WHERE id = ?').get(id)) as Row);
}

export async function updateBookmark(actor: TalkActor, channelId: string, id: string, input: { title?: string; url?: string }): Promise<TalkBookmarkDto> {
  await writableChannel(actor, channelId);
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM talk_bookmarks WHERE id = ? AND channel_id = ?').get(id, channelId)) as Row | undefined;
  if (!row) throw new TalkError('not_found', 404);
  const url = input.url !== undefined ? normalizeBookmarkUrl(input.url) : row.url;
  if (!url) throw new TalkError('invalid_bookmark_url');
  const title = input.title !== undefined ? cleanTitle(input.title, url) : row.title;
  await db.prepare('UPDATE talk_bookmarks SET title = ?, url = ?, updated_at = ? WHERE id = ? AND channel_id = ?').run(title, url, nowIso(), id, channelId);
  await emitTalkEvent(actor.workspaceId, 'bookmark', { channelId, actorId: actor.personId, payload: { change: 'updated', id } });
  return toDto({ ...row, title, url });
}

export async function deleteBookmark(actor: TalkActor, channelId: string, id: string): Promise<boolean> {
  await writableChannel(actor, channelId);
  const res = await getDb().prepare('DELETE FROM talk_bookmarks WHERE id = ? AND channel_id = ?').run(id, channelId);
  if (!res.changes) return false;
  await emitTalkEvent(actor.workspaceId, 'bookmark', { channelId, actorId: actor.personId, payload: { change: 'deleted', id } });
  return true;
}
