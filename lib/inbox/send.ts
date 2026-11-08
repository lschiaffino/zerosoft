/**
 * Inbox: mandar por el canal del chat (WhatsApp o Gmail), envíos programados
 * y el reflejo en Gmail de las acciones de la bandeja.
 */
import { getDb } from '../db';
import { applyThreadAction, claimScheduled, finishScheduled, getAccount, getThreadRow, saveDraft, type AccountRow, type ThreadAction, type ThreadRow } from './core';
import { pushGmailLabels, sendGmailReply } from './gmail';
import { sendWhatsappText } from './whatsapp';
import { InboxError, LIMITS } from './types';

async function deliver(account: AccountRow, thread: ThreadRow, text: string): Promise<void> {
  if (thread.channel === 'whatsapp') await sendWhatsappText(account, thread, text);
  else await sendGmailReply(account, thread, text);
}

/** Manda ya. Si lo mandado es el borrador guardado, el borrador se limpia. */
export async function sendToThread(owner: string, threadId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new InboxError('invalid_input', 400);
  if (text.length > LIMITS.message) throw new InboxError('too_long', 400);
  const thread = await getThreadRow(owner, threadId);
  const account = await getAccount(owner, thread.account_id);
  await deliver(account, thread, text);
  if (thread.draft.trim()) await saveDraft(owner, threadId, '');
}

/**
 * Manda un programado reclamado (compare-and-set): si otra corrida ya lo tomó,
 * no hace nada. Un error queda en el programado para reintentarlo a mano.
 */
export async function sendScheduled(id: string, now = new Date(), force = false): Promise<'sent' | 'failed' | 'skipped'> {
  const row = await claimScheduled(id, now, force);
  if (!row) return 'skipped';
  try {
    const thread = await getThreadRow(row.owner_id, row.thread_id);
    const account = await getAccount(row.owner_id, thread.account_id);
    await deliver(account, thread, row.body);
    await finishScheduled(id, true);
    return 'sent';
  } catch (err) {
    await finishScheduled(id, false, err instanceof InboxError ? err.code : 'send_failed');
    return 'failed';
  }
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
  const late = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const missed = await db.prepare("UPDATE inbox_scheduled SET status = 'missed', updated_at = ? WHERE status = 'pending' AND send_at < ?").run(nowS, late);
  out.missed = missed.changes;
  const due = (await db.prepare("SELECT id FROM inbox_scheduled WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 50").all(nowS)) as Array<{ id: string }>;
  for (const d of due) {
    if (Date.now() > deadline) break;
    const r = await sendScheduled(d.id, now);
    if (r === 'sent') out.sent++;
    else if (r === 'failed') out.failed++;
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
