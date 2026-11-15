/**
 * Inbox: lo que corre cada minuto (/api/cron/minute). Cada paso es seguro
 * con dos corridas a la vez: los despertares son un UPDATE atómico, los
 * programados, las cuentas y las importaciones se reclaman por fila
 * (compare-and-set).
 */
import { getDb } from '../db';
import type { AccountRow } from './core';
import { syncGmail } from './gmail';
import { runInboxImports } from './import-jobs';
import { sendDueScheduled } from './send';
import { runWhatsappBackfill } from './whatsapp';
import { refreshAllStaleInfo } from './wa-meta';
import { refreshInboxDaily } from '../wa-contacts-refresh';

/** Los chats de WhatsApp que volvieron a la bandeja se desarchivan también en el teléfono (lib/wa-archive-sync.ts). */
async function pushUnarchive(rows: Array<{ id: string; owner_id: string; channel: string }>, now: Date): Promise<void> {
  const byOwner = new Map<string, string[]>();
  for (const r of rows) if (r.channel === 'whatsapp') byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r.id]);
  if (!byOwner.size) return;
  const { queueAndFlushArchivePush } = await import('../wa-archive-sync');
  for (const [owner, ids] of byOwner) await queueAndFlushArchivePush('inbox', owner, ids, false, now).catch(() => null);
}

/**
 * Pospuestos que vencieron: salen de Archivados y vuelven a la bandeja marcados como "volvió" (también el que ya
 * estaba archivado antes de posponerlo: posponer es pedir verlo de nuevo). Las filas que cambia las devuelve el mismo
 * UPDATE: dos corridas a la vez no desarchivan dos veces el mismo chat.
 */
export async function wakeSnoozed(now = new Date()): Promise<number> {
  const nowS = now.toISOString();
  const rows = (await getDb()
    .prepare(
      `UPDATE inbox_threads SET snoozed_until = NULL, snooze_archived = 0, done_at = NULL, archived_at = NULL, woke_at = ?, woke_reason = 'snooze', updated_at = ?
       WHERE snoozed_until IS NOT NULL AND snoozed_until <= ? RETURNING id, owner_id, channel`,
    )
    .all(nowS, nowS, nowS)) as Array<{ id: string; owner_id: string; channel: string }>;
  await pushUnarchive(rows, now);
  return rows.length;
}

/**
 * "Recordame si no contesta": a la hora, si la otra persona no escribió
 * desde que se pidió, el chat vuelve arriba marcado. Si contestó, el aviso se
 * borra solo (también al llegar el mensaje, en addMessage). Si además estaba
 * pospuesto, el pospuesto termina y lo que archivó se desarchiva.
 */
export async function fireFollowUps(now = new Date()): Promise<number> {
  const nowS = now.toISOString();
  const db = getDb();
  await db
    .prepare(
      'UPDATE inbox_threads SET follow_up_at = NULL, follow_up_since = NULL WHERE follow_up_at IS NOT NULL AND follow_up_at <= ? AND last_inbound_at IS NOT NULL AND last_inbound_at > follow_up_since',
    )
    .run(nowS);
  const due = 'follow_up_at IS NOT NULL AND follow_up_at <= ?';
  const snoozed = (await db
    .prepare(`SELECT id, owner_id, channel FROM inbox_threads WHERE ${due} AND snoozed_until IS NOT NULL AND snooze_archived = 1 AND archived_at IS NOT NULL`)
    .all(nowS)) as Array<{ id: string; owner_id: string; channel: string }>;
  const r = await db
    .prepare(
      `UPDATE inbox_threads SET follow_up_at = NULL, follow_up_since = NULL, done_at = NULL,
         archived_at = CASE WHEN snoozed_until IS NOT NULL AND snooze_archived = 1 THEN NULL ELSE archived_at END,
         snoozed_until = NULL, snooze_archived = 0, woke_at = ?, woke_reason = 'followup', updated_at = ? WHERE ${due}`,
    )
    .run(nowS, nowS, nowS);
  await pushUnarchive(snoozed, now);
  return r.changes;
}

/** Cuentas de Gmail sin sincronizar hace más de 2 minutos (reclamadas por fila). */
async function syncStaleGmail(now: Date, deadline: number): Promise<number> {
  const db = getDb();
  const nowS = now.toISOString();
  const stale = new Date(now.getTime() - 2 * 60_000).toISOString();
  const rows = (await db
    .prepare(
      "SELECT * FROM inbox_accounts WHERE kind = 'gmail' AND status = 'connected' AND (last_sync_at IS NULL OR last_sync_at < ?) AND (sync_claimed_until IS NULL OR sync_claimed_until < ?) ORDER BY last_sync_at LIMIT 20",
    )
    .all(stale, nowS)) as unknown as AccountRow[];
  let n = 0;
  for (const a of rows) {
    if (Date.now() > deadline) break;
    const claim = await db
      .prepare('UPDATE inbox_accounts SET sync_claimed_until = ? WHERE id = ? AND (sync_claimed_until IS NULL OR sync_claimed_until < ?)')
      .run(new Date(now.getTime() + 5 * 60_000).toISOString(), a.id, nowS);
    if (claim.changes === 0) continue;
    try {
      await syncGmail(a);
      n++;
    } catch {
      await db.prepare('UPDATE inbox_accounts SET last_sync_at = ? WHERE id = ?').run(nowS, a.id);
    } finally {
      await db.prepare('UPDATE inbox_accounts SET sync_claimed_until = NULL WHERE id = ?').run(a.id);
    }
  }
  return n;
}

async function backfillWhatsapp(now: Date, deadline: number): Promise<number> {
  const rows = (await getDb()
    .prepare("SELECT * FROM inbox_accounts WHERE kind = 'whatsapp' AND status = 'connected' AND sync_cursor <> '' AND sync_cursor NOT LIKE '%\"done\"%' LIMIT 10")
    .all()) as unknown as AccountRow[];
  let n = 0;
  for (const a of rows) {
    if (Date.now() > deadline) break;
    if (await runWhatsappBackfill(a, Math.min(deadline, Date.now() + 15_000), now)) n++;
  }
  return n;
}

export async function runInboxCron(now = new Date(), budgetMs = 40_000): Promise<Record<string, number>> {
  const deadline = Date.now() + budgetMs;
  const woke = await wakeSnoozed(now);
  const followUps = await fireFollowUps(now);
  const scheduled = await sendDueScheduled(now, deadline);
  const gmail = await syncStaleGmail(now, deadline).catch(() => 0);
  const backfill = await backfillWhatsapp(now, deadline).catch(() => 0);
  const imports = await runInboxImports(now, deadline).catch(() => 0);
  // Asunto y foto de los grupos, "info" y foto de los contactos (en tandas, los que faltan primero).
  const chatInfo = await refreshAllStaleInfo(now, Math.min(deadline, Date.now() + 15_000)).catch(() => 0);
  // Repaso diario de cada cuenta de WhatsApp: contactos, nombres, info, asuntos y fotos (despacio, retoma donde quedó).
  const daily = await refreshInboxDaily(now, Math.min(deadline, Date.now() + 10_000)).catch(() => 0);
  return { woke, followUps, sent: scheduled.sent, failed: scheduled.failed, missed: scheduled.missed, gmail, backfill, imports, chatInfo, daily };
}
