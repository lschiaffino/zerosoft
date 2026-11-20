/**
 * Inbox, "Chat nuevo" de WhatsApp: el mismo panel que Lines (lib/wa-new-chat.ts)
 * sobre la cuenta personal de la persona. Los chats 1:1 de la cuenta y su
 * libreta de WhatsApp, "Mandate un mensaje" (el chat con el propio número,
 * como en WhatsApp) y crear un grupo. Todo queda dentro de las cuentas de
 * quien pide (owner). Server-only.
 */
import { contactPicture } from '../wa-picture-url';
import { getDb } from '../db';
import { ProviderError, inviteCodeFrom, phoneDigits } from '../groups-provider';
import { displayName } from '../wa-contacts';
import {
  NEW_CHAT_FREQUENT,
  NEW_CHAT_FREQUENT_DAYS,
  NEW_CHAT_FREQUENT_SCAN,
  NEW_CHAT_MAX_ROWS,
  compareNewChat,
  matchesNewChat,
  mergeNewChat,
  pageNewChat,
  parseNewChatQuery,
  type NewChatDirectory,
  type NewChatEntry,
} from '../wa-new-chat';
import { avatarVersion, findThread, getAccount, getThreadRow, listAccounts, nowIso, upsertThread, type AccountRow, type ThreadRow } from './core';
import { InboxError } from './types';
import { waProviderFor } from './whatsapp';

/** La cuenta de WhatsApp de la persona (conectada o no), o null si no vinculó ninguna. */
async function whatsappAccount(owner: string): Promise<AccountRow | null> {
  return (await listAccounts(owner)).find((a) => a.kind === 'whatsapp') ?? null;
}

/** El teléfono del chat 1:1: su handle, salvo que el chat esté guardado por lid (el handle sería el lid). */
function threadPhone(r: { external_id: string; handle: string }): string {
  if (/@lid$/.test(r.external_id)) return '';
  const d = String(r.handle || r.external_id.replace(/@.*/, '')).replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}

/** El título guardado, salvo que sea solo el número (entonces la pantalla muestra el teléfono). */
function threadName(r: { title: string; handle: string }): string {
  const t = (r.title ?? '').trim();
  return t && t !== r.handle && !/^\+?\d{6,}$/.test(t) ? t : '';
}

/**
 * El panel "Chat nuevo" de Inbox: "Mandate un mensaje", los contactados con
 * frecuencia (últimos 30 días) y todos los contactos en orden alfabético, de a
 * una página, o lo que coincide con lo escrito.
 */
export async function inboxNewChatDirectory(owner: string, opts: { q?: string; cursor?: string | null; limit?: number; now?: Date } = {}): Promise<NewChatDirectory & { connected: boolean }> {
  const account = await whatsappAccount(owner);
  if (!account) return { self: null, frequent: [], contacts: [], next: null, total: 0, connected: false };
  const db = getDb();
  const q = parseNewChatQuery(opts.q ?? '');
  const label = (phone: string) => (phone ? `+${phone}` : '');
  const phones = new Map<string, string>();
  const phoneOf = (e: NewChatEntry) => phones.get(e.key) ?? '';
  const entry = (key: string, raw: { name: string; phone: string; picture: string; about?: string }, ids: { chatId?: string; contactId?: string }): NewChatEntry => {
    phones.set(key, raw.phone);
    return { key, ...ids, name: raw.name || label(raw.phone), phoneLabel: label(raw.phone), phone: raw.phone, pictureUrl: raw.picture, about: raw.about ?? '' };
  };

  const threadRows = (await db
    .prepare(
      `SELECT id, external_id, title, handle, avatar_url, last_message_at FROM inbox_threads
       WHERE owner_id = ? AND account_id = ? AND channel = 'whatsapp' AND kind = 'dm' AND removed_at IS NULL
       ORDER BY (last_message_at IS NULL), last_message_at DESC LIMIT ?`,
    )
    .all(owner, account.id, NEW_CHAT_MAX_ROWS)) as Array<Pick<ThreadRow, 'id' | 'external_id' | 'title' | 'handle' | 'last_message_at'> & { avatar_url: string | null }>;
  const me = phoneDigits(account.address);
  let selfThread: (typeof threadRows)[number] | undefined;
  const chats: NewChatEntry[] = [];
  for (const r of threadRows) {
    const phone = threadPhone(r);
    if (me && phone === me) {
      selfThread ??= r;
      continue;
    }
    const picture = r.avatar_url ? `/api/inbox/avatar/${r.id}?v=${avatarVersion(r.avatar_url)}` : '';
    chats.push(entry(`chat:${r.id}`, { name: threadName(r), phone, picture }, { chatId: r.id }));
  }

  const bookRows = (await db
    .prepare(
      `SELECT id, phone, saved_name, push_name, picture_url, about FROM wa_contacts
       WHERE app = 'inbox' AND account_id = ? AND user_id = ? AND phone <> '' LIMIT ?`,
    )
    .all(account.id, owner, NEW_CHAT_MAX_ROWS)) as Array<{ id: string; phone: string; saved_name: string; push_name: string; picture_url: string; about: string }>;
  const book = bookRows
    .filter((r) => r.phone !== me)
    .map((r) => entry(`contact:${r.id}`, { name: displayName(r), phone: r.phone, picture: contactPicture('inbox', r.id, r.picture_url), about: r.about }, { contactId: r.id }));

  const all = mergeNewChat(chats, book, phoneOf)
    .filter((e) => matchesNewChat(e, q, { phone: true, rawPhone: phoneOf(e) }))
    .sort(compareNewChat);
  const page = pageNewChat(all, opts.cursor, opts.limit);

  let self: NewChatEntry | null = null;
  if (me && !opts.cursor) {
    const mine = bookRows.find((r) => r.phone === me);
    const candidate: NewChatEntry = {
      key: 'self',
      ...(selfThread ? { chatId: selfThread.id } : {}),
      name: (mine && displayName(mine)) || label(me),
      phoneLabel: label(me),
      phone: me,
      pictureUrl: selfThread?.avatar_url ? `/api/inbox/avatar/${selfThread.id}?v=${avatarVersion(selfThread.avatar_url)}` : '',
      about: mine?.about ?? '',
    };
    if (matchesNewChat(candidate, q, { phone: true })) self = candidate;
  }

  let frequent: NewChatEntry[] = [];
  if (!q.text && !q.digits && !opts.cursor) {
    const active = new Set(threadRows.filter((r) => r.last_message_at).map((r) => r.id));
    const recent = chats.filter((c) => active.has(c.chatId!)).slice(0, NEW_CHAT_FREQUENT_SCAN);
    if (recent.length) {
      const since = new Date((opts.now ?? new Date()).getTime() - NEW_CHAT_FREQUENT_DAYS * 86_400_000).toISOString();
      const counts = (await db
        .prepare(
          `SELECT thread_id, COUNT(*) AS n FROM inbox_messages
           WHERE thread_id IN (${recent.map(() => '?').join(',')}) AND owner_id = ? AND sent_at >= ? AND hidden_at IS NULL
           GROUP BY thread_id`,
        )
        .all(...recent.map((c) => c.chatId!), owner, since)) as Array<{ thread_id: string; n: number }>;
      const n = new Map(counts.map((c) => [c.thread_id, Number(c.n)]));
      frequent = recent
        .filter((c) => (n.get(c.chatId!) ?? 0) > 0)
        .sort((a, b) => (n.get(b.chatId!) ?? 0) - (n.get(a.chatId!) ?? 0))
        .slice(0, NEW_CHAT_FREQUENT);
    }
  }
  return { self, frequent, contacts: page.rows, next: page.next, total: all.length, connected: account.status === 'connected' };
}

/**
 * Crea un grupo de WhatsApp desde la cuenta de Inbox con esos teléfonos y
 * devuelve su chat. Errores: invalid_input (sin nombre o sin participantes),
 * not_connected (409) y group_failed (502: WhatsApp no lo creó).
 */
export async function createWhatsappGroup(owner: string, input: { name: string; phones: string[] }): Promise<ThreadRow> {
  const name = String(input.name ?? '').trim().slice(0, 100);
  const me = new Set<string>();
  const account = await whatsappAccount(owner);
  if (!account || account.status !== 'connected') throw new InboxError('not_connected', 409);
  me.add(phoneDigits(account.address));
  const phones = [...new Set((input.phones ?? []).map((p) => phoneDigits(String(p))).filter((p) => p.length >= 8 && p.length <= 15 && !me.has(p)))].slice(0, 256);
  if (!name || phones.length === 0) throw new InboxError('invalid_input', 400);
  let info;
  try {
    info = await waProviderFor(account).createGroup(name, phones);
  } catch (err) {
    if (err instanceof InboxError) throw err;
    throw new InboxError('group_failed', 502);
  }
  if (!info?.id) throw new InboxError('group_failed', 502);
  const thread = await upsertThread(account, { externalId: info.id, kind: 'group', title: info.name || name, forceTitle: true });
  // "Creaste el grupo «…»": el grupo queda arriba de la lista con su hora aunque todavía no tenga mensajes.
  const { addInboxGroupEvent } = await import('../wa-group-system');
  await addInboxGroupEvent(thread, { t: 'create', by: { p: 'me' }, subject: info.name || name }, nowIso());
  return (await findThread(account.id, thread.external_id)) ?? thread;
}

/**
 * Entra a un grupo de WhatsApp con un link de invitación desde la cuenta de
 * Inbox (la del chat donde llegó el link, si se pasa) y devuelve su chat.
 * Solo la dueña: todo filtra por owner. Errores: invalid_invite (no es un
 * link), not_connected (409), invite_invalid (vencido o reiniciado, 400),
 * invite_already_member y invite_approval_required (409), join_failed (502).
 */
export async function joinWhatsappGroup(owner: string, input: { invite: string; threadId?: string }): Promise<ThreadRow> {
  const code = inviteCodeFrom(String(input.invite ?? '').slice(0, 300));
  if (!code) throw new InboxError('invalid_invite', 400);
  let account: AccountRow | null;
  if (input.threadId) {
    const thread = await getThreadRow(owner, input.threadId);
    account = await getAccount(owner, thread.account_id);
  } else account = await whatsappAccount(owner);
  if (!account || account.kind !== 'whatsapp') throw new InboxError('not_found', 404);
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  const provider = waProviderFor(account);
  let info: { id: string; name?: string };
  try {
    info = await provider.joinGroup(code);
  } catch (err) {
    if (err instanceof InboxError) throw err;
    const why = err instanceof ProviderError ? err.reason : undefined;
    if (why === 'invite_invalid' || (!why && err instanceof ProviderError && err.code === 'not_found')) throw new InboxError('invite_invalid', 400);
    if (why === 'already_member' || why === 'approval_required') throw new InboxError(`invite_${why}`, 409);
    if (err instanceof ProviderError && err.code === 'not_connected') throw new InboxError('not_connected', 409);
    throw new InboxError('join_failed', 502);
  }
  if (!info?.id) throw new InboxError('join_failed', 502);
  let name = info.name ?? '';
  if (!name) name = (await provider.listGroups().catch(() => [])).find((g) => g.id === info.id)?.name ?? '';
  const thread = await upsertThread(account, { externalId: info.id, kind: 'group', title: name, ...(name ? { forceTitle: true } : {}) });
  return (await findThread(account.id, thread.external_id)) ?? thread;
}
