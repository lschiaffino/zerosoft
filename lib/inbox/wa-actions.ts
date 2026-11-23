/**
 * Inbox: lo que se hace sobre un mensaje de WhatsApp, como en WhatsApp Web.
 * Responder citando, reaccionar, editar lo propio (15 min), borrar para
 * todos (lo propio) o solo para mí, destacar, fijar, reenviar y las tildes azules
 * al abrir el chat. Todo filtra por la dueña. Server-only.
 */
import { privateQuoteAllowed } from '../wa-person';
import { PROVIDER_CAPS, ProviderError, phoneDigits } from '../groups-provider';
import { getDb } from '../db';
import { addMessage, getAccount, getMessageRow, getThreadRow, nowIso, saveDraft, sentWithClientId, type AccountRow, type ThreadRow } from './core';
import { pokeLive } from '../wa-live';
import { onceInFlight } from '../send-once';
import { MENTION_ALL, keepMentionAll } from '../wa-mention-all';
import { InboxError, LIMITS, type WaMessageMeta } from './types';
import { forwardWhatsappMedia } from './wa-media';
import { sendWhatsappText, waProviderFor } from './whatsapp';
import { inboxMedia } from './media-store';
import { readTranscript, retryableTranscript, transcribeMessage, type TranscriptDto } from '../wa-extras';
import { storeReaction } from './wa-meta';
import { nextForwardScore, type ForwardFlag } from '../wa-forward';

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
export async function sendWaMessage(owner: string, threadId: string, body: string, opts: { replyTo?: string; mentions?: string[]; clientId?: string; linkPreview?: boolean } = {}): Promise<void> {
  const text = body.trim();
  if (!text) throw new InboxError('invalid_input', 400);
  if (text.length > LIMITS.message) throw new InboxError('too_long', 400);
  // El chat y, en la misma vuelta, si este envío (mismo clientId) ya está guardado: un reintento no sale dos veces.
  const [thread, sent] = await Promise.all([getThreadRow(owner, threadId), sentWithClientId(owner, threadId, opts.clientId)]);
  if (thread.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  if (sent) return;
  let replyTo: string | undefined;
  if (opts.replyTo) {
    const quoted = await getMessageRow(owner, opts.replyTo);
    if (quoted.thread_id !== thread.id) {
      // "Responder en privado": un mensaje de esta persona en un grupo de la misma cuenta, citado en su chat 1:1.
      const from = await getThreadRow(owner, quoted.thread_id);
      const ok = privateQuoteAllowed(
        { accountId: from.account_id, groupKind: from.kind === 'group' ? 'group' : 'dm', fromMe: quoted.from_me === 1, senderPhone: phoneDigits(quoted.sender_handle), deleted: !!quoted.revoked_at },
        { accountId: thread.account_id, kind: thread.kind === 'group' ? 'group' : 'dm', phone: phoneDigits(thread.handle) },
      );
      if (!ok) throw new InboxError('not_found', 404);
    }
    replyTo = quoted.external_id;
  }
  // Solo se mencionan teléfonos que están escritos en el texto, y solo en grupos.
  // "@all" (o "@todos") en el texto: todo el grupo (lib/wa-mention-all.ts), primero en la lista.
  const all = keepMentionAll(opts.mentions, text, thread.kind === 'group') ? [MENTION_ALL] : [];
  const mentions = thread.kind === 'group' ? [...all, ...new Set((opts.mentions ?? []).filter((p) => /^\d{6,16}$/.test(p) && text.includes(`@${p}`)))].slice(0, 50) : [];
  const account = await getAccount(owner, thread.account_id);
  await onceInFlight(
    opts.clientId ? `inbox:${threadId}:${opts.clientId}` : null,
    () => sendWhatsappText(account, thread, text, { replyTo, mentions, clientId: opts.clientId, ...(opts.linkPreview === false ? { linkPreview: false } : {}) }),
    async () => '',
  );
  if (thread.draft.trim()) await saveDraft(owner, threadId, '');
}

/**
 * Encuesta o tarjetas de contacto (el menú + del chat, como WhatsApp). Sale por el proveedor (Evolution:
 * /message/sendPoll y /message/sendContact) y queda guardada con su meta, como las que llegan: la burbuja
 * es la misma. Un reintento con el mismo clientId no sale dos veces.
 */
export async function sendWaCard(
  owner: string,
  threadId: string,
  card: { poll: { question: string; options: string[]; multi?: boolean } } | { contacts: Array<{ name?: string; phone: string }> },
  clientId?: string,
): Promise<void> {
  const [thread, sent] = await Promise.all([getThreadRow(owner, threadId), sentWithClientId(owner, threadId, clientId)]);
  if (thread.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  if (sent) return;
  if (thread.kind === 'group' && thread.left_at) throw new InboxError('group_left', 409);
  const account = await getAccount(owner, thread.account_id);
  const provider = connected(account);
  const poll = 'poll' in card ? { question: card.poll.question.trim(), options: [...new Set(card.poll.options.map((o) => o.trim()).filter(Boolean))], multi: !!card.poll.multi } : null;
  const contacts =
    'contacts' in card
      ? card.contacts
          .map((c) => ({ name: (c.name ?? '').trim().slice(0, 100), phone: c.phone.replace(/\D/g, '') }))
          .filter((c) => c.phone.length >= 8 && c.phone.length <= 15)
      : [];
  if (poll && (poll.options.length < 2 || !poll.question)) throw new InboxError('invalid_input', 400);
  if (!poll && !contacts.length) throw new InboxError('invalid_contact_card', 400);
  if (poll ? !provider.caps.polls || !provider.sendPoll : !provider.sendContact) throw new InboxError('unsupported', 400);
  let id: string;
  try {
    id = poll ? (await provider.sendPoll!(thread.external_id, poll)).id : (await provider.sendContact!(thread.external_id, contacts)).id;
  } catch (err) {
    providerFail(err);
  }
  const meta = {
    ...(poll ? { poll } : { contacts: contacts.map((c) => ({ name: c.name || `+${c.phone}`, phones: [c.phone] })) }),
    ...(clientId ? { cid: clientId } : {}),
  };
  await addMessage(thread, {
    externalId: id || `local-${Date.now()}`,
    fromMe: true,
    body: poll ? poll.question : contacts.map((c) => c.name || `+${c.phone}`).join(', '),
    status: 'sent',
    kind: poll ? 'poll' : 'contact',
    meta: JSON.stringify(meta),
    ...(clientId ? { clientId } : {}),
  });
  pokeLive('inbox', owner);
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
  await storeReaction(account, thread.external_id, msg.external_id, { emoji, by: 'me', name: '', at: new Date().toISOString() });
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
 * "Reportar" de WhatsApp sobre un mensaje recibido: queda marcado en Inbox
 * (meta.reported). Ningún servidor de WhatsApp vinculado (Evolution, WAHA)
 * expone el reporte a WhatsApp, así que no sale de acá. Como en WhatsApp se
 * puede, a la vez, bloquear al contacto (chat 1:1) o salir del grupo. Si eso
 * falla, el reporte queda igual y vuelve el código del error.
 */
export async function reportMessage(owner: string, messageId: string, opts: { block?: boolean; leave?: boolean } = {}, now = new Date()): Promise<{ blocked: boolean; left: boolean; error?: string }> {
  const { msg, thread } = await context(owner, messageId);
  if (msg.from_me === 1 || msg.revoked_at || (msg as { media_type?: string }).media_type === 'system') throw new InboxError('not_reportable', 400);
  await getDb()
    .prepare("UPDATE inbox_messages SET meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.reported', json(?)) WHERE id = ? AND owner_id = ?")
    .run(JSON.stringify({ at: nowIso(now) }), msg.id, owner);
  let blocked = false;
  let left = false;
  let error: string | undefined;
  try {
    if (opts.block && thread.kind === 'dm') {
      const { setBlocked } = await import('./wa-meta');
      await setBlocked(owner, thread.id, true);
      blocked = true;
    }
    if (opts.leave && thread.kind === 'group' && !thread.left_at) {
      const { leaveGroupThread } = await import('./wa-group-members');
      await leaveGroupThread(owner, thread.id);
      left = true;
    }
  } catch (err) {
    error = err instanceof InboxError ? err.code : 'send_failed';
  }
  return { blocked, left, ...(error ? { error } : {}) };
}

/** Hasta 3 mensajes fijados por chat, como WhatsApp. */
export const MAX_PINNED_MESSAGES = 3;

/**
 * Fijar o desfijar un mensaje del chat. Si el proveedor de la cuenta fija en
 * WhatsApp (caps.pin) también lo hace ahí; si no (la línea administrada,
 * Evolution), queda fijado solo en Inbox. `inWhatsApp`: si salió al teléfono.
 */
export async function pinMessage(owner: string, messageId: string, on: boolean, now = new Date()): Promise<{ inWhatsApp: boolean }> {
  const { msg, thread, account } = await context(owner, messageId);
  if (on && (msg.revoked_at || (msg as { media_type?: string }).media_type === 'system')) throw new InboxError('not_pinnable', 400);
  const db = getDb();
  if (on && !msg.pinned_at) {
    const c = (await db.prepare('SELECT COUNT(*) AS c FROM inbox_messages WHERE thread_id = ? AND owner_id = ? AND pinned_at IS NOT NULL AND hidden_at IS NULL').get(thread.id, owner)) as { c: number };
    if (Number(c.c) >= MAX_PINNED_MESSAGES) throw new InboxError('too_many_pins', 400);
  }
  const inWhatsApp = account.status === 'connected' && !!msg.external_id && PROVIDER_CAPS[account.provider === 'fake' ? 'fake' : 'managed'].pin;
  if (inWhatsApp) {
    try {
      await connected(account).pinMessage(thread.external_id, msg.external_id, on);
    } catch (err) {
      providerFail(err);
    }
  }
  await db.prepare('UPDATE inbox_messages SET pinned_at = ? WHERE id = ? AND owner_id = ?').run(on ? msg.pinned_at || nowIso(now) : null, msg.id, owner);
  return { inWhatsApp };
}

/** Lo que salió y lo que no al reenviar (cada chat por su lado, como WhatsApp). */
export interface ForwardOutcome {
  sent: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Reenviar a otros chats de WhatsApp de la persona (hasta 5, como WhatsApp):
 * texto, fotos, videos, documentos, stickers y audios (una nota de voz sale
 * como nota de voz, con su duración y su onda). Sale con la marca "Reenviado"
 * de WhatsApp (score del original + 1, lib/wa-forward.ts), también acá. En la
 * misma línea va el original y el gateway lo reenvía desde lo que tiene
 * guardado; si no, sale como copia. El archivo se baja una sola vez.
 * "Ver una vez" no se reenvía. Un chat que falla no frena a los demás.
 */
export async function forwardMessage(owner: string, messageId: string, targetIds: string[]): Promise<ForwardOutcome> {
  const { msg, thread: source, account } = await context(owner, messageId);
  if (msg.revoked_at) throw new InboxError('invalid_input', 400);
  let meta: WaMessageMeta = {};
  try {
    meta = msg.meta ? (JSON.parse(msg.meta) as WaMessageMeta) : {};
  } catch {
    meta = {};
  }
  if (meta.viewOnce) throw new InboxError('unsupported', 400);
  const text = msg.body.trim();
  if (!msg.media_type && !text) throw new InboxError('invalid_input', 400);
  if (msg.media_type && !msg.media_ref) throw new InboxError('media_unavailable', 400);
  let file: ReturnType<typeof inboxMedia> | null = null;
  // Un mensaje propio que no era un reenvío da 0: sale sin la marca, como desde el teléfono.
  const score = nextForwardScore({ forwarded: msg.forwarded === 1, meta, fromMe: msg.from_me === 1 });
  const original = msg.external_id && !msg.external_id.startsWith('local-') ? { id: msg.external_id, remoteJid: source.external_id, fromMe: msg.from_me === 1 } : null;
  const out: ForwardOutcome = { sent: [], failed: [] };
  for (const id of [...new Set(targetIds)].slice(0, 5)) {
    try {
      const thread = await getThreadRow(owner, id);
      if (thread.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
      const target = thread.account_id === account.id ? account : await getAccount(owner, thread.account_id);
      // El original solo sirve en la misma línea (el gateway lo busca entre lo que guardó esa instancia).
      const forward: ForwardFlag | undefined = score ? { score, ...(original && target.id === account.id ? { key: original } : {}) } : undefined;
      if (!msg.media_type) {
        await sendWhatsappText(target, thread, text, { forwarded: true, forward });
      } else {
        file ??= inboxMedia(account, owner, msg);
        const src = { mediaType: msg.media_type, mediaName: msg.media_name, body: msg.body, meta };
        await forwardWhatsappMedia(target, thread, src, await file, forward);
        // WhatsApp no muestra texto en un audio o un sticker: va aparte, como lo manda Lines (sin el original: ese era el archivo).
        if (text && !['image', 'video', 'document'].includes(msg.media_type)) await sendWhatsappText(target, thread, text, { forwarded: true, ...(forward ? { forward: { score } } : {}) });
      }
      out.sent.push(thread.id);
    } catch (err) {
      out.failed.push({ id, error: err instanceof InboxError ? err.code : 'send_failed' });
    }
  }
  return out;
}

/**
 * Transcripción (y resumen si es largo) de un audio del chat. `start`: si
 * no está, se hace ahora; si no, solo se lee lo guardado. Privada de la dueña.
 */
export async function messageTranscript(owner: string, messageId: string, start: boolean, force = false): Promise<TranscriptDto | null> {
  const { msg, account } = await context(owner, messageId);
  if (msg.media_type !== 'audio' || !msg.media_ref) throw new InboxError('unsupported', 400);
  const saved = await readTranscript('inbox', owner, msg.id);
  // Lo que falló porque el audio no se pudo bajar se vuelve a intentar (el audio pudo haber vuelto).
  if (saved && (saved.status === 'done' || (saved.status === 'failed' && !retryableTranscript(saved)) || !start)) return saved;
  if (!start) return null;
  let seconds: number | undefined;
  try {
    seconds = msg.meta ? (JSON.parse(msg.meta) as { duration?: number }).duration : undefined;
  } catch {
    seconds = undefined;
  }
  return transcribeMessage('inbox', owner, msg.id, async () => {
    const f = await inboxMedia(account, owner, msg);
    return { data: f.data, mimetype: f.mimetype, seconds };
  }, new Date(), { force });
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
  // Solo por markRead (el "marcar leído" del servidor): con las confirmaciones de lectura apagadas en el
  // teléfono, Baileys manda 'read-self' y el otro no ve tildes azules. Nunca un recibo 'read' a mano.
  await p.markRead(thread.external_id, rows.map((r) => r.external_id)).catch(() => null);
}
