/**
 * Inbox: mandar por el canal del chat (WhatsApp o Gmail), envíos programados
 * y el reflejo en Gmail de las acciones de la bandeja.
 */
import { getDb } from '../db';
import { ProviderError } from '../groups-provider';
import { deleteUploads } from '../uploads';
import { addMessage, applyThreadAction, sentWithClientId, claimScheduled, finishScheduled, getAccount, getThreadRow, saveDraft, type AccountRow, type ScheduledRow, type ThreadAction, type ThreadRow } from './core';
import { pushGmailLabels, sendGmailReply } from './gmail';
import { BLOCKED_SQL, readInboxMedia, scheduleNextPart } from './schedule';
import { sendWhatsappText, waProviderFor } from './whatsapp';
import { InboxError, LIMITS } from './types';
import { onceInFlight } from '../send-once';

async function deliver(account: AccountRow, thread: ThreadRow, text: string, clientId?: string): Promise<void> {
  if (thread.channel === 'whatsapp') await sendWhatsappText(account, thread, text, clientId ? { clientId } : {});
  else await sendGmailReply(account, thread, text);
}

/**
 * El chat y su cuenta, los dos de la persona, en una sola ida a la base (en
 * vez de una consulta detrás de la otra). 404 si alguno no es suyo.
 */
export async function threadWithAccount(owner: string, threadId: string, clientId?: string): Promise<{ thread: ThreadRow; account: AccountRow; sent: boolean }> {
  const [thread, account, sent] = await Promise.all([
    getThreadRow(owner, threadId),
    getDb()
      .prepare(
        `SELECT a.* FROM inbox_accounts a
         WHERE a.owner_id = ? AND a.id = (SELECT t.account_id FROM inbox_threads t WHERE t.id = ? AND t.owner_id = ?)`,
      )
      .get(owner, threadId, owner) as Promise<AccountRow | undefined>,
    // Un reintento del mismo envío (mismo clientId): ¿ya está guardado? En la misma vuelta, sin esperar más.
    sentWithClientId(owner, threadId, clientId),
  ]);
  if (!account || account.id !== thread.account_id) throw new InboxError('not_found', 404);
  return { thread, account, sent: !!sent };
}

/** Manda ya. Si lo mandado es el borrador guardado, el borrador se limpia. Un reintento con el mismo clientId no sale dos veces. */
export async function sendToThread(owner: string, threadId: string, body: string, clientId?: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new InboxError('invalid_input', 400);
  if (text.length > LIMITS.message) throw new InboxError('too_long', 400);
  const { thread, account, sent } = await threadWithAccount(owner, threadId, clientId);
  if (sent) return;
  // Dos pedidos iguales casi a la vez (en esta instancia): el segundo espera al primero en vez de mandar otro.
  await onceInFlight(
    clientId ? `inbox:${threadId}:${clientId}` : null,
    () => deliver(account, thread, text, clientId),
    async () => undefined,
  );
  if (thread.draft.trim()) await saveDraft(owner, threadId, '');
}

function mediaKindOf(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Un mensaje programado con archivo (WhatsApp): el archivo con el texto como pie. */
async function deliverMedia(account: AccountRow, thread: ThreadRow, row: ScheduledRow): Promise<void> {
  if (thread.channel !== 'whatsapp') throw new InboxError('media_unsupported', 400);
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  const data = await readInboxMedia(row.media_url);
  let id: string;
  try {
    id = (
      await waProviderFor(account).sendMedia(thread.external_id, {
        url: row.media_url.startsWith('https://') ? row.media_url : '',
        mimetype: row.media_type || 'application/octet-stream',
        filename: row.media_name || 'archivo',
        caption: row.body || undefined,
        base64: data.toString('base64'),
      })
    ).id;
  } catch (err) {
    throw new InboxError(err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'send_failed', 502);
  }
  await addMessage(thread, { externalId: id || `local-${Date.now()}`, fromMe: true, body: row.body, mediaType: mediaKindOf(row.media_type), mediaName: row.media_name, status: 'sent' });
}

/**
 * Manda un programado reclamado (compare-and-set): si otra corrida ya lo tomó,
 * no hace nada. Un error queda en el programado para reintentarlo a mano. Si
 * es parte de una secuencia, deja lista la hora de la siguiente. Devuelve la
 * siguiente parte pendiente (para que el cron la mande enseguida si la espera
 * es corta).
 */
export async function sendScheduled(id: string, now = new Date(), force = false): Promise<'sent' | 'failed' | 'skipped'> {
  return (await sendScheduledPart(id, now, force)).result;
}

async function sendScheduledPart(id: string, now: Date, force: boolean): Promise<{ result: 'sent' | 'failed' | 'skipped'; next: ScheduledRow | null }> {
  const row = await claimScheduled(id, now, force);
  if (!row) return { result: 'skipped', next: null };
  try {
    const thread = await getThreadRow(row.owner_id, row.thread_id);
    const account = await getAccount(row.owner_id, thread.account_id);
    if (row.media_url) await deliverMedia(account, thread, row);
    else await deliver(account, thread, row.body);
    await finishScheduled(id, true);
    if (row.media_url) await deleteUploads([row.media_url]);
    return { result: 'sent', next: await scheduleNextPart(row, now) };
  } catch (err) {
    await finishScheduled(id, false, err instanceof InboxError ? err.code : 'send_failed');
    return { result: 'failed', next: null };
  }
}

/** Esperas de hasta esto se cumplen en la misma corrida (los mensajes salen seguidos, como escritos a mano). */
const INLINE_WAIT_MS = 20_000;

/**
 * Manda una parte y, mientras la siguiente de su secuencia tenga una espera
 * corta y quede tiempo, la siguiente también (en orden, una por vez).
 */
async function sendChain(id: string, now: Date, deadline: number, out: { sent: number; failed: number }, force = false): Promise<void> {
  // El reloj de la corrida (los tests pasan otra hora): las esperas se miden con él.
  const skew = now.getTime() - Date.now();
  const clock = () => new Date(Date.now() + skew);
  let cur: string | null = id;
  let first = true;
  while (cur) {
    const r = await sendScheduledPart(cur, clock(), first && force);
    first = false;
    if (r.result === 'sent') out.sent++;
    else if (r.result === 'failed') out.failed++;
    const next = r.next;
    if (!next) return;
    const wait = Date.parse(next.send_at) - clock().getTime();
    if (wait > INLINE_WAIT_MS || Date.now() + Math.max(wait, 0) + 5_000 > deadline) return;
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    cur = next.id;
  }
}

/** "Enviar ya" de una secuencia: su primera parte sin mandar sale ahora y las siguientes siguen con sus esperas. */
export async function sendScheduledNow(id: string, now = new Date(), deadline = Date.now() + 45_000): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  await sendChain(id, now, deadline, out, true);
  return out;
}

/** Programados que vencieron: se mandan (los muy atrasados quedan como "no salió" para decidir a mano). */
export async function sendDueScheduled(now = new Date(), deadline = Date.now() + 30_000): Promise<{ sent: number; failed: number; missed: number }> {
  const db = getDb();
  const nowS = now.toISOString();
  const out = { sent: 0, failed: 0, missed: 0 };
  // Un envío que se cortó a mitad no se reintenta solo: puede haber salido.
  await db
    .prepare("UPDATE inbox_scheduled SET status = 'failed', error = 'interrupted', claimed_until = NULL WHERE status = 'sending' AND claimed_until < ?")
    .run(nowS);
  // Muy atrasado: no sale solo. Las partes que esperan a una anterior no cuentan (salen cuando salga esa).
  const late = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const missed = await db.prepare(`UPDATE inbox_scheduled AS s SET status = 'missed', updated_at = ? WHERE s.status = 'pending' AND s.send_at < ? AND NOT ${BLOCKED_SQL}`).run(nowS, late);
  out.missed = missed.changes;
  const due = (await db
    .prepare(`SELECT s.id FROM inbox_scheduled s WHERE s.status = 'pending' AND s.send_at <= ? AND NOT ${BLOCKED_SQL} ORDER BY s.send_at, s.seq LIMIT 50`)
    .all(nowS)) as Array<{ id: string }>;
  for (const d of due) {
    if (Date.now() > deadline) break;
    await sendChain(d.id, now, deadline, out);
  }
  return out;
}

const GMAIL_LABELS: Partial<Record<ThreadAction['action'], { add?: string[]; remove?: string[] }>> = {
  done: { remove: ['INBOX', 'UNREAD'] },
  undone: { add: ['INBOX'] },
  read: { remove: ['UNREAD'] },
  seen: { remove: ['UNREAD'] },
  unread: { add: ['UNREAD'] },
};

/** Aplica la acción y, en los hilos de Gmail, la refleja en Gmail. */
export async function threadAction(owner: string, ids: string[], action: ThreadAction): Promise<string[]> {
  const changed = await applyThreadAction(owner, ids, action);
  const labels = GMAIL_LABELS[action.action];
  if (!labels || !changed.length) return changed;
  const marks = changed.map(() => '?').join(',');
  const rows = (await getDb()
    .prepare(`SELECT t.external_id, a.* FROM inbox_threads t JOIN inbox_accounts a ON a.id = t.account_id WHERE t.owner_id = ? AND t.channel = 'gmail' AND t.id IN (${marks})`)
    .all(owner, ...changed)) as Array<AccountRow & { external_id: string }>;
  for (const r of rows.slice(0, 50)) {
    await pushGmailLabels(r, r.external_id, labels).catch(() => null);
  }
  return changed;
}
