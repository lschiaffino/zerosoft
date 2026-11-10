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

/** Pospuestos que vencieron: vuelven a la bandeja marcados como "volvió". */
export async function wakeSnoozed(now = new Date()): Promise<number> {
  const nowS = now.toISOString();
  const r = await getDb()
    .prepare("UPDATE inbox_threads SET snoozed_until = NULL, done_at = NULL, woke_at = ?, woke_reason = 'snooze', updated_at = ? WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?")
    .run(nowS, nowS, nowS);
  return r.changes;
}

/**
 * "Recordame si no contesta": a la hora, si la otra persona no escribió
 * desde que se pidió, el chat vuelve arriba marcado. Si contestó, el aviso se
 * borra solo (también al llegar el mensaje, en addMessage).
 */
export async function fireFollowUps(now = new Date()): Promise<number> {
  const nowS = now.toISOString();
  const db = getDb();
  await db
    .prepare(
      'UPDATE inbox_threads SET follow_up_at = NULL, follow_up_since = NULL WHERE follow_up_at IS NOT NULL AND follow_up_at <= ? AND last_inbound_at IS NOT NULL AND last_inbound_at > follow_up_since',
    )
    .run(nowS);
  const r = await db
    .prepare(
      "UPDATE inbox_threads SET follow_up_at = NULL, follow_up_since = NULL, done_at = NULL, snoozed_until = NULL, woke_at = ?, woke_reason = 'followup', updated_at = ? WHERE follow_up_at IS NOT NULL AND follow_up_at <= ?",
    )
    .run(nowS, nowS, nowS);
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
  return { woke, followUps, sent: scheduled.sent, failed: scheduled.failed, missed: scheduled.missed, gmail, backfill, imports, chatInfo };
}
