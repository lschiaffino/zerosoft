/**
 * Groups: trabajo del cron de cada minuto. Envíos masivos y programados,
 * chats sin responder (flagged_at), tickets vencidos (con su email de SLA),
 * recordatorios de tareas y asignación automática. Cada paso reclama sus
 * filas con compare-and-set, así dos corridas no hacen lo mismo dos veces.
 * Server-only.
 */
import { getDb } from './db';
import { processBroadcasts } from './groups-broadcasts';
import { markBreachedTickets } from './groups-tickets';
import { fireTaskReminders } from './groups-tasks';
import { normalizeSettings } from './groups-rules';

/** Marca los chats que esperan respuesta hace más que el umbral del workspace. */
export async function flagUnansweredChats(now = new Date(), limit = 1000): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT c.id, c.awaiting_since, s.data FROM groups_chats c LEFT JOIN groups_settings s ON s.user_id = c.user_id
       WHERE c.awaiting_since IS NOT NULL AND c.flagged_at IS NULL AND c.status = 'open' ORDER BY c.awaiting_since LIMIT ?`,
    )
    .all(limit)) as Array<{ id: string; awaiting_since: string; data: string | null }>;
  let n = 0;
  for (const r of rows) {
    const settings = normalizeSettings(r.data ? JSON.parse(r.data) : {});
    const due = Date.parse(r.awaiting_since) + settings.unansweredMin * 60_000;
    if (due > now.getTime()) continue;
    // Claim: solo si sigue esperando desde el mismo momento y sin marcar.
    const res = await db
      .prepare('UPDATE groups_chats SET flagged_at = ? WHERE id = ? AND flagged_at IS NULL AND awaiting_since = ?')
      .run(now.toISOString(), r.id, r.awaiting_since);
    n += res.changes;
  }
  return n;
}

export async function runGroupsCron(opts: { budgetMs?: number } = {}) {
  const flagged = await flagUnansweredChats().catch(() => null);
  const breached = await markBreachedTickets().catch(() => null);
  // Tareas y recordatorios de los chats (claim por fila en reminded_for).
  const reminders = await fireTaskReminders().catch(() => null);
  const broadcasts = await processBroadcasts({ budgetMs: opts.budgetMs ?? 30_000 }).catch(() => null);
  // Round-robin de lo que quedó sin asignar (nadie disponible cuando llegó, o recién se armó la regla).
  const { sweepAutoAssign } = await import('./groups-inbox');
  const assigned = await sweepAutoAssign().catch(() => null);
  return { flagged, breached, reminders, broadcasts, assigned };
}
