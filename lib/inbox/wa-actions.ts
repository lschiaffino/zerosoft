/**
 * Inbox: lo que se hace sobre un mensaje de WhatsApp, como en WhatsApp Web.
 * Responder citando, reaccionar, editar lo propio (15 min), borrar para
 * todos (lo propio) o solo para mí, destacar, reenviar y las tildes azules
 * al abrir el chat. Todo filtra por la dueña. Server-only.
 */
import { ProviderError } from '../groups-provider';
import { getDb } from '../db';
import { getAccount, getMessageRow, getThreadRow, nowIso, saveDraft, type AccountRow, type ThreadRow } from './core';
import { InboxError, LIMITS } from './types';
import { fetchWhatsappMedia, sendWhatsappText, waProviderFor } from './whatsapp';
import { readTranscript, transcribeMessage, type TranscriptDto } from '../wa-extras';
import { storeReaction } from './wa-meta';

/** WhatsApp deja editar 15 minutos y borrar para todos unas 60 horas. */
export const EDIT_WINDOW_MS = 15 * 60_000;
export const DELETE_WINDOW_MS = 60 * 3600_000;

type MsgRow = Awaited<ReturnType<typeof getMessageRow>>;

async function context(owner: string, messageId: string): Promise<{ msg: MsgRow; thread: ThreadRow; account: AccountRow }> {
  const msg = await getMessageRow(owner, messageId);
  const thread = await getThreadRow(owner, msg.thread_id);
  if (thread.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  const account = await getAccount(owner, thread.account_id);
  return { msg, thread, account };
}

function connected(account: AccountRow) {
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  return waProviderFor(account);
}

function providerFail(err: unknown): never {
  if (err instanceof InboxError) throw err;
  throw new InboxError(err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'send_failed', 502);
}

/**
 * Texto de WhatsApp con cita (respuesta a un mensaje del mismo chat) y/o
 * menciones (teléfonos que van como "@teléfono" en el texto, solo grupos).
 */
export async function sendWaMessage(owner: string, threadId: string, body: string, opts: { replyTo?: string; mentions?: string[]; linkPreview?: boolean } = {}): Promise<void> {
  const text = body.trim();
  if (!text) throw new InboxError('invalid_input', 400);
  if (text.length > LIMITS.message) throw new InboxError('too_long', 400);
  const thread = await getThreadRow(owner, threadId);
  if (thread.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  let replyTo: string | undefined;
  if (opts.replyTo) {
    const quoted = await getMessageRow(owner, opts.replyTo);
    if (quoted.thread_id !== thread.id) throw new InboxError('not_found', 404);
    replyTo = quoted.external_id;
  }
  // Solo se mencionan teléfonos que están escritos en el texto, y solo en grupos.
  const mentions = thread.kind === 'group' ? [...new Set((opts.mentions ?? []).filter((p) => /^\d{6,16}$/.test(p) && text.includes(`@${p}`)))].slice(0, 50) : [];
  const account = await getAccount(owner, thread.account_id);
  await sendWhatsappText(account, thread, text, { replyTo, mentions, ...(opts.linkPreview === false ? { linkPreview: false } : {}) });
  if (thread.draft.trim()) await saveDraft(owner, threadId, '');
}

/** Respuesta citando un mensaje del mismo chat. */
export async function sendWaReply(owner: string, threadId: string, body: string, replyToId: string): Promise<void> {
  await sendWaMessage(owner, threadId, body, { replyTo: replyToId });
}

/** Reaccionar (emoji vacío saca la reacción). */
export async function reactToMessage(owner: string, messageId: string, emoji: string): Promise<void> {
  const { msg, thread, account } = await context(owner, messageId);
  if (msg.revoked_at) throw new InboxError('invalid_input', 400);
  const p = connected(account);
  try {
    await p.react(thread.external_id, msg.external_id, emoji, msg.from_me === 1);
  } catch (err) {
    providerFail(err);
  }
  await storeReaction(account, thread.external_id, msg.external_id, { emoji, by: 'me', name: '' });
}

/** Editar un mensaje propio de texto (hasta 15 minutos después, como WhatsApp). */
export async function editOwnMessage(owner: string, messageId: string, body: string, now = new Date()): Promise<void> {
  const { msg, thread, account } = await context(owner, messageId);
  const text = body.trim();
  if (!text) throw new InboxError('invalid_input', 400);
  if (msg.from_me !== 1 || msg.revoked_at || msg.media_type) throw new InboxError('forbidden', 403);
  if (now.getTime() - Date.parse(msg.sent_at) > EDIT_WINDOW_MS) throw new InboxError('edit_window', 409);
  const p = connected(account);
  try {
    await p.editMessage(thread.external_id, msg.external_id, text);
  } catch (err) {
    providerFail(err);
  }
  const db = getDb();
  await db.prepare('UPDATE inbox_messages SET body = ?, edited = 1 WHERE id = ?').run(text.slice(0, 100_000), msg.id);
  if (thread.last_message_at === msg.sent_at) await db.prepare('UPDATE inbox_threads SET preview = ? WHERE id = ?').run(text.replace(/\s+/g, ' ').slice(0, 160), thread.id);
}

/** Borrar para todos un mensaje propio. Acá queda marcado (con el contenido, solo lo ve la dueña). */
export async function deleteForEveryone(owner: string, messageId: string, now = new Date()): Promise<void> {
  const { msg, thread, account } = await context(owner, messageId);
  if (msg.from_me !== 1) throw new InboxError('forbidden', 403);
  if (msg.revoked_at) return;
  if (now.getTime() - Date.parse(msg.sent_at) > DELETE_WINDOW_MS) throw new InboxError('delete_window', 409);
  const p = connected(account);
  try {
    await p.deleteMessage(thread.external_id, msg.external_id);
  } catch (err) {
    providerFail(err);
  }
  await getDb().prepare('UPDATE inbox_messages SET revoked_at = ? WHERE id = ?').run(nowIso(now), msg.id);
}

/** Borrar para mí: deja de verse acá (en WhatsApp sigue). */
export async function hideMessage(owner: string, messageId: string, now = new Date()): Promise<void> {
  const msg = await getMessageRow(owner, messageId);
  await getDb().prepare('UPDATE inbox_messages SET hidden_at = ? WHERE id = ? AND owner_id = ?').run(nowIso(now), msg.id, owner);
}

export async function starMessage(owner: string, messageId: string, on: boolean, now = new Date()): Promise<void> {
  const msg = await getMessageRow(owner, messageId);
  await getDb().prepare('UPDATE inbox_messages SET starred_at = ? WHERE id = ? AND owner_id = ?').run(on ? nowIso(now) : null, msg.id, owner);
}

/**
 * Reenviar a otros chats de WhatsApp de la persona (hasta 5, como WhatsApp).
 * El servidor no tiene reenvío nativo: sale una copia del texto. Devuelve los
 * chats a los que salió.
 */
export async function forwardMessage(owner: string, messageId: string, targetIds: string[]): Promise<string[]> {
  const { msg } = await context(owner, messageId);
  if (msg.revoked_at) throw new InboxError('invalid_input', 400);
  if (msg.media_type) throw new InboxError('unsupported', 400);
  const text = msg.body.trim();
  if (!text) throw new InboxError('invalid_input', 400);
  const done: string[] = [];
  for (const id of [...new Set(targetIds)].slice(0, 5)) {
    const thread = await getThreadRow(owner, id);
    if (thread.channel !== 'whatsapp') continue;
    const account = await getAccount(owner, thread.account_id);
    await sendWhatsappText(account, thread, text);
    done.push(thread.id);
  }
  return done;
}

/**
 * Transcripción (y resumen si es largo) de un audio del chat. `start`: si
 * no está, se hace ahora; si no, solo se lee lo guardado. Privada de la dueña.
 */
export async function messageTranscript(owner: string, messageId: string, start: boolean): Promise<TranscriptDto | null> {
  const { msg, account } = await context(owner, messageId);
  if (msg.media_type !== 'audio' || !msg.media_ref) throw new InboxError('unsupported', 400);
  const saved = await readTranscript('inbox', owner, msg.id);
  if (saved && (saved.status === 'done' || saved.status === 'failed' || !start)) return saved;
  if (!start) return null;
  let seconds: number | undefined;
  try {
    seconds = msg.meta ? (JSON.parse(msg.meta) as { duration?: number }).duration : undefined;
  } catch {
    seconds = undefined;
  }
  return transcribeMessage('inbox', owner, msg.id, async () => {
    const f = await fetchWhatsappMedia(account, msg.media_ref);
    return { data: f.data, mimetype: f.mimetype, seconds };
  });
}

/**
 * Tildes azules al abrir el chat (como WhatsApp Web): marca leídos en
 * WhatsApp los últimos mensajes recibidos. Si falla, no frena nada.
 */
export async function markChatReadOnWhatsapp(owner: string, threadId: string): Promise<void> {
  const thread = await getThreadRow(owner, threadId);
  if (thread.channel !== 'whatsapp') return;
  const account = await getAccount(owner, thread.account_id);
  if (account.status !== 'connected') return;
  const p = waProviderFor(account);
  if (!p.markRead) return;
  const rows = (await getDb()
    .prepare("SELECT external_id FROM inbox_messages WHERE thread_id = ? AND from_me = 0 AND external_id NOT LIKE 'local-%' ORDER BY sent_at DESC LIMIT 20")
    .all(thread.id)) as Array<{ external_id: string }>;
  if (!rows.length) return;
  await p.markRead(thread.external_id, rows.map((r) => r.external_id)).catch(() => null);
}
