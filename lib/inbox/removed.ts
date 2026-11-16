/**
 * Inbox: chats sacados de Inbox. Server-only.
 *
 * "Sacar de Inbox" marca el chat (removed_at) en vez de borrarlo: el chat y
 * sus mensajes quedan guardados, igual de privados (solo su dueño, nunca por
 * API key ni agente), y fuera de todo lo demás: vistas, carpetas, contadores,
 * búsqueda, Cmd+K, asistente, analítica, programados y avisos. Lo que llega
 * después se sigue guardando sin moverlo de lugar (como un chat silenciado y
 * oculto), así que recuperarlo lo devuelve con todo el historial y a donde
 * estaba: carpetas, archivado y fijado no se tocan al sacarlo.
 *
 * Se ve en "Sacados de Inbox" (vista 'removed'): recuperar o borrar del todo.
 * A los REMOVED_RETENTION_DAYS días el cron lo borra del todo. Volver a
 * importar o juntar chats (lid y teléfono) no lo trae de vuelta: la fila sigue
 * existiendo (único por cuenta + id de WhatsApp) y al juntar queda afuera si
 * cualquiera de los dos estaba afuera (trigger de la migración
 * 20261115_2222_inbox_removed_chats).
 */
import { getDb } from '../db';
import { deleteUploads } from '../uploads';
import { threadDto, type ThreadRow } from './core';
import type { ThreadDto } from './types';

export const REMOVED_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_IDS = 500;

function ids(list: string[]): string[] {
  return [...new Set(list.filter((x) => typeof x === 'string' && x))].slice(0, MAX_IDS);
}

function marks(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

export function purgeAtOf(removedAt: string): string {
  return new Date(Date.parse(removedAt) + REMOVED_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Saca chats de Inbox (los de la persona que estaban adentro). Devuelve los que salieron. */
export async function removeThreads(owner: string, list: string[], now = new Date()): Promise<string[]> {
  const asked = ids(list);
  if (!asked.length) return [];
  const rows = (await getDb()
    .prepare(`UPDATE inbox_threads SET removed_at = ?, updated_at = ? WHERE owner_id = ? AND removed_at IS NULL AND id IN (${marks(asked.length)}) RETURNING id`)
    .all(now.toISOString(), now.toISOString(), owner, ...asked)) as Array<{
    id: string;
  }>;
  return rows.map((r) => r.id);
}

/** Vuelve a meter chats sacados: quedan donde estaban (carpetas, archivado, fijado), con lo que llegó mientras tanto. */
export async function restoreThreads(owner: string, list: string[], now = new Date()): Promise<string[]> {
  const asked = ids(list);
  if (!asked.length) return [];
  const rows = (await getDb()
    .prepare(`UPDATE inbox_threads SET removed_at = NULL, updated_at = ? WHERE owner_id = ? AND removed_at IS NOT NULL AND id IN (${marks(asked.length)}) RETURNING id`)
    .all(now.toISOString(), owner, ...asked)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * Borra del todo (solo los que ya estaban sacados): el chat, sus mensajes,
 * carpetas y programados (por cascada), sus transcripciones y los archivos de
 * envíos programados que no salieron. En WhatsApp y Gmail no cambia nada.
 */
async function purgeRows(where: string, args: Array<string>): Promise<string[]> {
  const db = getDb();
  const rows = (await db.prepare(`SELECT id, owner_id FROM inbox_threads WHERE removed_at IS NOT NULL AND ${where}`).all(...args)) as Array<{ id: string; owner_id: string }>;
  if (!rows.length) return [];
  const list = rows.map((r) => r.id);
  const m = marks(list.length);
  const media = (await db
    .prepare(`SELECT media_url FROM inbox_scheduled WHERE thread_id IN (${m}) AND media_url <> '' AND status NOT IN ('sent', 'sending')`)
    .all(...list)
    .catch(() => [])) as Array<{ media_url: string }>;
  await db
    .prepare(`DELETE FROM wa_transcripts WHERE scope = 'inbox' AND message_id IN (SELECT id FROM inbox_messages WHERE thread_id IN (${m}))`)
    .run(...list)
    .catch(() => null);
  // Compare-and-set: solo lo que sigue sacado (si alguien lo recuperó recién, se queda).
  const gone = (await db.prepare(`DELETE FROM inbox_threads WHERE removed_at IS NOT NULL AND id IN (${m}) RETURNING id`).all(...list)) as Array<{ id: string }>;
  if (media.length) await deleteUploads(media.map((r) => r.media_url)).catch(() => null);
  return gone.map((r) => r.id);
}

/** "Borrar definitivamente" desde Sacados de Inbox. Un chat que no estaba sacado no se toca. */
export async function purgeThreads(owner: string, list: string[]): Promise<string[]> {
  const asked = ids(list);
  if (!asked.length) return [];
  return purgeRows(`owner_id = ? AND id IN (${marks(asked.length)})`, [owner, ...asked]);
}

/** Cron: los sacados hace más de REMOVED_RETENTION_DAYS días se borran del todo, de a tandas. */
export async function purgeExpiredRemoved(now = new Date(), limit = 200): Promise<number> {
  const cutoff = new Date(now.getTime() - REMOVED_RETENTION_DAYS * DAY_MS).toISOString();
  const due = (await getDb()
    .prepare('SELECT id FROM inbox_threads WHERE removed_at IS NOT NULL AND removed_at < ? LIMIT ?')
    .all(cutoff, limit)
    .catch(() => [])) as Array<{ id: string }>;
  if (!due.length) return 0;
  const list = due.map((r) => r.id);
  return (await purgeRows(`removed_at < ? AND id IN (${marks(list.length)})`, [cutoff, ...list])).length;
}

/** Sacados de Inbox, el más reciente primero, con cuándo se sacaron y cuándo se borran solos. */
export async function listRemoved(owner: string, now = new Date()): Promise<ThreadDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.*, (SELECT group_concat(folder_id) FROM inbox_thread_folders f WHERE f.thread_id = t.id) AS folder_ids
       FROM inbox_threads t WHERE t.owner_id = ? AND t.removed_at IS NOT NULL ORDER BY t.removed_at DESC, t.id DESC LIMIT ${MAX_IDS}`,
    )
    .all(owner)) as unknown as Array<ThreadRow & { folder_ids: string | null; removed_at: string }>;
  return rows.map((r) => ({
    ...threadDto(r, now),
    draft: '',
    removedAt: r.removed_at,
    purgeAt: purgeAtOf(r.removed_at),
  }));
}
