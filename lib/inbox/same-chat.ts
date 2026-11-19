/**
 * Inbox: el mismo chat en varias cuentas de WhatsApp de la persona, listado
 * una vez (lib/same-chat.ts).
 *
 * Cada cuenta tiene su chat (inbox_threads); el mismo grupo en dos cuentas
 * son dos filas con el mismo JID y el mismo contacto, dos 1:1 con el mismo
 * teléfono (handle). Solo WhatsApp (los hilos de Gmail no se juntan), solo
 * los chats de la persona y nunca los sacados de Inbox. Server-only.
 */
import { getDb } from '../db';
import type { SearchRank } from '../chat-search-rank';
import { sameChatKey, type ChatLineRef } from '../same-chat';

export interface InboxSibling {
  id: string;
  key: string;
  account_id: string;
  unread: number;
  last_message_at: string | null;
  pinned_at: string | null;
  sort_key: string | null;
  /** Con búsqueda: rango de la coincidencia (lib/chat-search-rank.ts), que va antes que la actividad. */
  rank?: string | null;
  line_name: string;
  line_status: string;
}

type KeyRow = { channel: string; kind: string; handle: string; external_id: string };

export function threadKey(r: KeyRow): string {
  if (r.channel !== 'whatsapp') return '';
  return sameChatKey(r.kind, r.kind === 'dm' ? r.handle : '', r.external_id);
}

/**
 * Las filas de todas las cuentas para estos chats, agrupadas por clave (cada
 * grupo trae también la fila pedida). `sortExpr` es la clave de orden de la
 * lista (alias t), para decidir cuál encabeza; `rank`, el rango de la
 * búsqueda cuando la hay.
 */
export async function inboxSiblingsByKey(owner: string, rows: KeyRow[], sortExpr = 't.last_message_at', rank?: SearchRank | null): Promise<Map<string, InboxSibling[]>> {
  const out = new Map<string, InboxSibling[]>();
  const groups = new Set<string>();
  const phones = new Set<string>();
  const jids = new Set<string>();
  for (const r of rows) {
    if (r.channel !== 'whatsapp') continue;
    if (r.kind === 'group' && r.external_id) groups.add(r.external_id);
    else if (r.kind === 'dm' && r.handle) phones.add(r.handle);
    else if (r.kind === 'dm' && r.external_id) jids.add(r.external_id);
  }
  if (!groups.size && !phones.size && !jids.size) return out;
  const ors: string[] = [];
  const args: string[] = [...(rank?.args ?? []), owner];
  const marks = (s: Set<string>) => [...s].map(() => '?').join(',');
  if (groups.size) {
    ors.push(`(t.kind = 'group' AND t.external_id IN (${marks(groups)}))`);
    args.push(...groups);
  }
  if (phones.size) {
    ors.push(`(t.kind = 'dm' AND t.handle IN (${marks(phones)}))`);
    args.push(...phones);
  }
  if (jids.size) {
    ors.push(`(t.kind = 'dm' AND t.handle = '' AND t.external_id IN (${marks(jids)}))`);
    args.push(...jids);
  }
  const found = (await getDb()
    .prepare(
      `SELECT t.id, t.channel, t.kind, t.handle, t.external_id, t.account_id, t.unread, t.last_message_at, t.pinned_at, ${sortExpr} AS sort_key${rank ? `, ${rank.sql} AS rank` : ''},
         COALESCE(NULLIF(a.label, ''), a.address) AS line_name, a.status AS line_status
       FROM inbox_threads t JOIN inbox_accounts a ON a.id = t.account_id AND a.owner_id = t.owner_id
       WHERE t.owner_id = ? AND t.channel = 'whatsapp' AND t.removed_at IS NULL AND (${ors.join(' OR ')})`,
    )
    .all(...args)) as Array<KeyRow & Omit<InboxSibling, 'key'>>;
  for (const f of found) {
    const key = threadKey(f);
    if (!key) continue;
    out.set(key, [...(out.get(key) ?? []), { ...f, key }]);
  }
  return out;
}

/** Las cuentas de un chat para la pantalla (la más reciente primero). Vacío si está en una sola. */
export function inboxLineRefs(siblings: InboxSibling[] | undefined): ChatLineRef[] {
  if (!siblings || siblings.length < 2) return [];
  return [...siblings]
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '') || a.id.localeCompare(b.id))
    .map((s) => ({
      chatId: s.id,
      lineId: s.account_id,
      name: s.line_name || '',
      unread: Number(s.unread) || 0,
      lastMessageAt: s.last_message_at,
      canSend: s.line_status === 'connected',
    }));
}

async function keyRows(owner: string, ids: string[]): Promise<Array<KeyRow & { id: string }>> {
  if (!ids.length) return [];
  return (await getDb()
    .prepare(`SELECT id, channel, kind, handle, external_id FROM inbox_threads WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(owner, ...ids)) as Array<KeyRow & { id: string }>;
}

/**
 * El chat (fila completa) y sus filas en las otras cuentas, en una sola consulta: abrir una conversación no suma
 * una ida a la base. Vacío si el chat no existe, no es de la persona o se sacó de Inbox.
 */
export async function threadWithSiblings<T extends { id: string; account_id: string }>(owner: string, id: string): Promise<T[]> {
  return (await getDb()
    .prepare(
      `SELECT s.* FROM inbox_threads t JOIN inbox_threads s ON s.owner_id = t.owner_id AND s.removed_at IS NULL
         AND (s.id = t.id OR (t.channel = 'whatsapp' AND s.channel = 'whatsapp' AND s.kind = t.kind
           AND ((t.kind = 'group' AND s.external_id = t.external_id)
             OR (t.kind = 'dm' AND t.handle != '' AND s.handle = t.handle)
             OR (t.kind = 'dm' AND t.handle = '' AND s.handle = '' AND s.external_id = t.external_id))))
       WHERE t.id = ? AND t.owner_id = ? AND t.removed_at IS NULL`,
    )
    .all(id, owner)) as unknown as T[];
}

/** Los chats pedidos más sus filas en otras cuentas (sin repetir, los pedidos primero). */
export async function withInboxSameChatIds(owner: string, ids: string[]): Promise<string[]> {
  const rows = await keyRows(owner, ids);
  const sibs = await inboxSiblingsByKey(owner, rows);
  const out = new Set(ids);
  for (const r of rows) for (const s of sibs.get(threadKey(r)) ?? []) out.add(s.id);
  return [...out];
}

/** Las cuentas donde está este chat (vacío si está en una sola). */
export async function inboxChatLines(owner: string, id: string): Promise<ChatLineRef[]> {
  const [row] = await keyRows(owner, [id]);
  if (!row) return [];
  const key = threadKey(row);
  if (!key) return [];
  return inboxLineRefs((await inboxSiblingsByKey(owner, [row])).get(key));
}

/**
 * Acciones de la fila de la bandeja que valen para todas las cuentas del chat (si no, la fila de otra cuenta
 * volvería a aparecer sola). Fijar, marcar como no leído, recordatorios y carpetas quedan en la que se tocó.
 */
export const SAME_CHAT_ACTIONS = ['done', 'undone', 'read', 'seen', 'archive', 'unarchive', 'keepArchived', 'snooze', 'unsnooze', 'mute'] as const;
