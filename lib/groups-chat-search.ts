/**
 * Lines: buscar mensajes dentro de un chat (la lupa de la cabecera, como en
 * WhatsApp Web). Busca en el texto, el nombre del archivo y las notas internas
 * del chat y de sus filas hermanas en otras líneas (lib/groups-same-chat.ts,
 * ya filtradas por acceso), del más nuevo al más viejo. Cada resultado trae el
 * fragmento con lo encontrado marcado (HIT_START/HIT_END, como Inbox) y las
 * menciones con nombre; los teléfonos van ocultos para quien no los ve.
 * Server-only.
 */
import { getDb } from './db';
import { toMessageDto, type MessageDto, type MessageRow } from './groups';
import { withLinesMentions } from './groups-wa-names';
import { maskMessage, type GroupsViewer } from './groups-access';
import { maskPhone, maskPhoneText } from './groups-mask';
import { HIT_START, HIT_END, markSnippet } from './inbox/message-search';
import { dedupeLineMessages } from './same-chat';

export interface ChatSearchHit {
  id: string;
  /** El chat (la línea) donde está el mensaje. */
  chatId: string;
  sentAt: string;
  fromMe: boolean;
  /** Quién lo escribió ('' en los propios). */
  senderName: string;
  note: boolean;
  /** Texto alrededor de lo encontrado, con lo encontrado entre HIT_START y HIT_END. */
  snippet: string;
}

/** Palabras de la búsqueda (como mucho 8), sin comillas. */
export function chatSearchTerms(raw: string): string[] {
  return raw
    .slice(0, 200)
    .replace(/["“”]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** "@<dígitos>" → "@Nombre" (o el teléfono oculto) con las menciones del mensaje. */
function namedMentions(m: MessageDto, mask: boolean): string {
  const names = m.mentionNames;
  if (!names || !m.body.includes('@')) return m.body;
  return m.body.replace(/@(\d{5,20})(?!\d)/g, (all, digits: string) => {
    const t = names[digits];
    if (!t) return all;
    if (t.name) return `@${t.name}`;
    return `@${mask ? maskPhone(t.phone || digits) : `+${t.phone || digits}`}`;
  });
}

/**
 * Mensajes de `chatIds` (el chat abierto primero) que tienen todas las palabras. `before` pagina: la fecha del
 * último resultado de la página anterior.
 */
export async function searchChatMessages(
  ws: string,
  viewer: GroupsViewer | null | undefined,
  chatIds: string[],
  raw: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ hits: ChatSearchHit[]; more: boolean }> {
  const terms = chatSearchTerms(raw);
  const ids = [...new Set(chatIds.filter(Boolean))].slice(0, 20);
  if (!terms.length || !ids.length) return { hits: [], more: false };
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 60);
  const where = [`m.chat_id IN (${ids.map(() => '?').join(',')})`, 'm.user_id = ?', "m.direction != 'system'", 'm.deleted_at IS NULL'];
  const args: Array<string | number> = [...ids, ws];
  for (const t of terms) {
    where.push("(m.body LIKE ? ESCAPE '\\' OR m.media_name LIKE ? ESCAPE '\\')");
    args.push(like(t), like(t));
  }
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? opts.before : null;
  if (before) {
    where.push('m.created_at < ?');
    args.push(before);
  }
  const rows = (await getDb()
    .prepare(`SELECT m.* FROM groups_messages m WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`)
    .all(...args, limit + 1)) as MessageRow[];
  const page = rows.slice(0, limit);
  // Varias líneas en el mismo grupo reciben el mismo mensaje: queda uno (el propio, si hay).
  const kept =
    ids.length > 1
      ? dedupeLineMessages(
          page,
          (m) => (m.direction === 'in' || m.direction === 'out' ? m.provider_message_id : null),
          (m) => m.direction === 'out',
        )
      : page;
  const dtos = kept.map((r) => toMessageDto(r));
  for (const cid of ids) {
    const own = kept.filter((r) => r.chat_id === cid);
    if (own.length) await withLinesMentions(own[0].number_id, dtos.filter((m) => m.chatId === cid), cid).catch(() => null);
  }
  const mask = Boolean(viewer?.mask);
  const hits = dtos.map((raw): ChatSearchHit => {
    const m = maskMessage(viewer, raw);
    const text = namedMentions(m, mask) || m.media?.name || '';
    const snippet = markSnippet(mask ? maskPhoneText(text) : text, terms).slice(0, 400);
    const who = m.direction === 'in' ? m.senderName || (m.senderPhone ? (mask ? maskPhone(m.senderPhone) : `+${m.senderPhone}`) : '') : '';
    const sender = mask ? maskPhoneText(who) : who;
    return { id: m.id, chatId: m.chatId, sentAt: m.createdAt, fromMe: m.direction === 'out' || m.direction === 'note', senderName: sender, note: m.direction === 'note', snippet };
  });
  return { hits, more: rows.length > limit };
}

export { HIT_START, HIT_END };
