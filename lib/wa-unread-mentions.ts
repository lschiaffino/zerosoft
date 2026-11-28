/**
 * El "@" de la lista de chats de WhatsApp (Lines e Inbox): un grupo con
 * mensajes sin leer en los que te mencionaron o respondieron a un mensaje tuyo
 * muestra un "@" junto al número de no leídos, como WhatsApp Web
 * (faq.whatsapp.com, "How to mention in a group").
 *
 * Solo mira los últimos mensajes recibidos de cada grupo, tantos como no
 * leídos tiene (con un tope), con una sola consulta por página de la lista.
 * "Te mencionaron": la mención es el teléfono de la línea (o de la cuenta de
 * WhatsApp en Inbox), o un lid que la libreta de esa cuenta une a ese teléfono.
 * Server-only.
 */
import { getDb } from './db';
import type { WaApp } from './wa-contacts';

/** Un chat de la página: su id, la cuenta (línea) y cuántos no leídos tiene. */
export interface UnreadMentionCandidate {
  id: string;
  accountId: string;
  unread: number;
}

/** Cuántos chats y cuántos mensajes por chat se miran como mucho. */
export const MAX_CHATS = 60;
export const MAX_PER_CHAT = 50;

/** Las menciones guardadas en meta.mentions (teléfono o "<dígitos>@lid"), como dígitos. */
export function mentionDigits(meta: string | null | undefined): string[] {
  if (!meta || !meta.includes('"mentions"')) return [];
  try {
    const list = (JSON.parse(meta) as { mentions?: unknown }).mentions;
    if (!Array.isArray(list)) return [];
    return list.filter((m): m is string => typeof m === 'string' && /^\d{5,20}(@lid)?$/i.test(m)).map((m) => m.replace(/@lid$/i, ''));
  } catch {
    return [];
  }
}

/**
 * ¿Alguna de estas menciones es la cuenta? `me`: los dígitos del teléfono de la
 * cuenta; `phoneOf`: el teléfono que la libreta conoce para un lid (o teléfono).
 */
export function mentionsMe(digits: string[], me: string, phoneOf: ReadonlyMap<string, string>): boolean {
  if (!/^\d{6,16}$/.test(me)) return false;
  return digits.some((d) => d === me || phoneOf.get(d) === me);
}

/** Qué chats de la lista tienen un mensaje sin leer que menciona a la cuenta o responde a uno suyo. */
export async function unreadMentionChats(app: WaApp, candidates: UnreadMentionCandidate[]): Promise<Set<string>> {
  const list = candidates.filter((c) => c.unread > 0 && c.id && c.accountId).slice(0, MAX_CHATS);
  const out = new Set<string>();
  if (!list.length) return out;
  const db = getDb();
  // Una subconsulta por chat (cada una usa el índice por chat y fecha), juntas en una sola ida a la base.
  const one =
    app === 'lines'
      ? `SELECT * FROM (SELECT m.chat_id AS chat, m.meta AS meta, CASE WHEN q.direction = 'out' THEN 1 ELSE 0 END AS mine
           FROM groups_messages m LEFT JOIN groups_messages q ON q.id = m.reply_to_id
           WHERE m.chat_id = ? AND m.direction = 'in' ORDER BY m.created_at DESC LIMIT ?)`
      : `SELECT * FROM (SELECT m.thread_id AS chat, m.meta AS meta,
             CASE WHEN m.reply_to <> '' AND EXISTS (SELECT 1 FROM inbox_messages q WHERE q.thread_id = m.thread_id AND q.external_id = m.reply_to AND q.from_me = 1) THEN 1 ELSE 0 END AS mine
           FROM inbox_messages m WHERE m.thread_id = ? AND m.from_me = 0 AND m.revoked_at IS NULL ORDER BY m.sent_at DESC LIMIT ?)`;
  const rows = (await db
    .prepare(list.map(() => one).join(' UNION ALL '))
    .all(...list.flatMap((c) => [c.id, Math.min(MAX_PER_CHAT, Math.max(1, Math.floor(c.unread)))]))) as Array<{ chat: string; meta: string | null; mine: number }>;

  const accountOf = new Map(list.map((c) => [c.id, c.accountId]));
  const pending = new Map<string, Array<{ chat: string; digits: string[] }>>();
  for (const r of rows) {
    if (out.has(r.chat)) continue;
    if (Number(r.mine) === 1) {
      out.add(r.chat);
      continue;
    }
    const digits = mentionDigits(r.meta);
    if (!digits.length) continue;
    const acc = accountOf.get(r.chat) ?? '';
    pending.set(acc, [...(pending.get(acc) ?? []), { chat: r.chat, digits }]);
  }
  if (!pending.size) return out;

  const { lookupContacts } = await import('./wa-contacts');
  for (const [accountId, items] of pending) {
    const self = (await db
      .prepare(app === 'lines' ? 'SELECT phone AS phone FROM groups_numbers WHERE id = ?' : 'SELECT address AS phone FROM inbox_accounts WHERE id = ?')
      .get(accountId)
      .catch(() => undefined)) as { phone?: string | null } | undefined;
    const me = String(self?.phone ?? '').replace(/\D/g, '');
    if (!me) continue;
    // La libreta solo hace falta para lo que no es el teléfono tal cual (un lid, por ejemplo).
    const unknown = [...new Set(items.flatMap((i) => i.digits).filter((d) => d !== me))];
    const book = unknown.length ? await lookupContacts({ app, accountId }, unknown).catch(() => new Map()) : new Map();
    const phoneOf = new Map<string, string>();
    for (const [d, row] of book) if (row?.phone) phoneOf.set(d, String(row.phone));
    for (const i of items) if (!out.has(i.chat) && mentionsMe(i.digits, me, phoneOf)) out.add(i.chat);
  }
  return out;
}
