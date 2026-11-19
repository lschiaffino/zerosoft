/**
 * Lines: el mismo chat en varias líneas, listado una vez (lib/same-chat.ts).
 *
 * Cada línea tiene su chat (groups_chats); el mismo grupo en dos líneas son
 * dos filas con el mismo JID y el mismo contacto, dos 1:1 con el mismo
 * teléfono. Acá se buscan esas filas hermanas, siempre dentro del workspace y
 * solo las que quien mira puede ver (acceso por línea y etiqueta). Las
 * eliminadas con "Eliminar chat" no cuentan. Server-only.
 */
import { getDb } from './db';
import type { SearchRank } from './chat-search-rank';
import { chatAccessSql, type GroupsViewer } from './groups-access';
import { linesSortKey } from './schema/inbox-lines-perf-migration';
import { lineColor } from './line-colors';
import { mergedUnread, sameChatKey, type ChatLineRef } from './same-chat';

export interface SiblingRow {
  id: string;
  key: string;
  number_id: string;
  unread_count: number;
  marked_unread: number;
  last_message_at: string | null;
  pinned_at: string | null;
  sort_key: string;
  /** Con búsqueda: rango de la coincidencia (lib/chat-search-rank.ts), que va antes que la actividad. */
  rank?: string | null;
  line_name: string;
  line_color?: string;
  line_phone: string;
  line_status: string;
  left_at: string | null;
}

type KeyRow = { kind: string; phone: string; provider_chat_id: string };

export function chatKey(r: KeyRow): string {
  return sameChatKey(r.kind, r.phone, r.provider_chat_id);
}

/**
 * Las filas de todas las líneas para estos chats, agrupadas por clave (cada
 * grupo trae también la fila pedida). Solo las que quien mira ve.
 */
export async function siblingsByKey(ws: string, viewer: GroupsViewer | null | undefined, rows: KeyRow[], rank?: SearchRank | null): Promise<Map<string, SiblingRow[]>> {
  const out = new Map<string, SiblingRow[]>();
  const groups = new Set<string>();
  const phones = new Set<string>();
  const jids = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'group' && r.provider_chat_id) groups.add(r.provider_chat_id);
    else if (r.kind === 'dm' && r.phone) phones.add(r.phone);
    else if (r.kind === 'dm' && r.provider_chat_id) jids.add(r.provider_chat_id);
  }
  if (!groups.size && !phones.size && !jids.size) return out;
  const ors: string[] = [];
  const args: string[] = [...(rank?.args ?? []), ws];
  const marks = (s: Set<string>) => [...s].map(() => '?').join(',');
  if (groups.size) {
    ors.push(`(c.kind = 'group' AND c.provider_chat_id IN (${marks(groups)}))`);
    args.push(...groups);
  }
  if (phones.size) {
    ors.push(`(c.kind = 'dm' AND c.phone IN (${marks(phones)}))`);
    args.push(...phones);
  }
  if (jids.size) {
    ors.push(`(c.kind = 'dm' AND c.phone = '' AND c.provider_chat_id IN (${marks(jids)}))`);
    args.push(...jids);
  }
  const access = chatAccessSql(viewer);
  if (access) args.push(...access.args);
  const found = (await getDb()
    .prepare(
      `SELECT c.id, c.kind, c.phone, c.provider_chat_id, c.number_id, c.unread_count, c.marked_unread, c.last_message_at, c.pinned_at, c.left_at,
         ${linesSortKey('c')} AS sort_key${rank ? `, ${rank.sql} AS rank` : ''}, n.name AS line_name, n.color AS line_color, n.phone AS line_phone, n.status AS line_status
       FROM groups_chats c JOIN groups_numbers n ON n.id = c.number_id AND n.user_id = c.user_id
       WHERE c.user_id = ? AND c.hidden_at IS NULL AND (${ors.join(' OR ')})${access ? ` AND ${access.sql}` : ''}`,
    )
    .all(...args)) as Array<KeyRow & Omit<SiblingRow, 'key'>>;
  for (const f of found) {
    const key = chatKey(f);
    if (!key) continue;
    out.set(key, [...(out.get(key) ?? []), { ...f, key }]);
  }
  return out;
}

/** Las líneas de un chat para la pantalla (la más reciente primero). Vacío si está en una sola. */
export function lineRefs(siblings: SiblingRow[] | undefined): ChatLineRef[] {
  if (!siblings || siblings.length < 2) return [];
  return [...siblings]
    .sort((a, b) => (b.sort_key ?? '').localeCompare(a.sort_key ?? '') || a.id.localeCompare(b.id))
    .map((s) => ({
      chatId: s.id,
      lineId: s.number_id,
      name: s.line_name || (s.line_phone ? `+${s.line_phone}` : ''),
      color: lineColor(s.line_color),
      unread: Number(s.unread_count) || 0,
      lastMessageAt: s.last_message_at,
      canSend: s.line_status === 'connected' && !s.left_at,
    }));
}

/** Los ids de las filas del mismo chat que quien mira ve (el pedido primero). Solo el pedido si está en una línea. */
export async function sameChatIds(ws: string, viewer: GroupsViewer | null | undefined, chat: KeyRow & { id: string }): Promise<string[]> {
  const key = chatKey(chat);
  if (!key) return [chat.id];
  const sibs = (await siblingsByKey(ws, viewer, [chat])).get(key) ?? [];
  return [chat.id, ...sibs.map((s) => s.id).filter((id) => id !== chat.id)];
}

/**
 * Un chat abierto con las líneas donde también está (`lines`, no leídos sumados). Sin cambios si está en una sola.
 */
export async function withSameChatLines<T extends { id: string; unread: number; lines?: ChatLineRef[] }>(
  ws: string,
  viewer: GroupsViewer | null | undefined,
  row: KeyRow & { id: string },
  dto: T,
): Promise<T> {
  const key = chatKey(row);
  if (!key) return dto;
  const lines = lineRefs((await siblingsByKey(ws, viewer, [row])).get(key));
  if (!lines.length) return dto;
  return { ...dto, lines, unread: mergedUnread(row.kind, lines) };
}

/**
 * Lo que se hace sobre la fila de la bandeja vale para todas sus líneas (leído, archivar, posponer, cerrar,
 * silenciar, eliminar): si no, la fila de otra línea volvería a aparecer sola. Marcar como no leído y fijar quedan
 * en la fila que se tocó (una vez alcanza).
 */
export const SAME_CHAT_PATCH_KEYS = ['archived', 'keepArchived', 'snoozedUntil', 'hidden', 'status', 'muted'] as const;

/** Los chats pedidos más sus filas en otras líneas que quien mira ve (sin repetir). */
export async function withSameChatIds(ws: string, viewer: GroupsViewer | null | undefined, ids: string[]): Promise<string[]> {
  if (!ids.length) return ids;
  const rows = (await getDb()
    .prepare(`SELECT id, kind, phone, provider_chat_id FROM groups_chats WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(ws, ...ids)) as Array<KeyRow & { id: string }>;
  const sibs = await siblingsByKey(ws, viewer, rows);
  const out = new Set(ids);
  for (const r of rows) for (const s of sibs.get(chatKey(r)) ?? []) out.add(s.id);
  return [...out];
}
