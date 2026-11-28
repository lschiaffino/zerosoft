/**
 * Groups: trabajo del cron de cada minuto. Envíos masivos y programados,
 * chats sin responder (flagged_at), tickets vencidos (con su email de SLA),
 * recordatorios de tareas, asignación automática y HubSpot (vínculo por
 * teléfono, nota diaria y sync de las propiedades de las empresas). Cada paso reclama sus
 * filas con compare-and-set, así dos corridas no hacen lo mismo dos veces.
 * Server-only.
 */
import { getDb } from './db';
import { processBroadcasts } from './groups-broadcasts';
import { runDueRecurring } from './groups-recurring';
import { syncRemoteTickets } from './groups-integrations';
import { markBreachedTickets } from './groups-tickets';
import { fireTaskReminders } from './groups-tasks';
import { MAX_UNANSWERED_MIN, normalizeSettings } from './groups-rules';

/**
 * Marca los chats que esperan respuesta hace más que el umbral del workspace. El SQL ya deja afuera los que todavía no
 * vencen (con el umbral entero del workspace, que nunca es más que el que aplica normalizeSettings): así mil chats que
 * esperan en un workspace con un umbral largo no tapan a uno vencido en otro. La cuenta de abajo sigue mandando.
 */
export async function flagUnansweredChats(now = new Date(), limit = 1000): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT c.id, c.awaiting_since, s.data FROM groups_chats c LEFT JOIN groups_settings s ON s.user_id = c.user_id
       WHERE c.awaiting_since IS NOT NULL AND c.flagged_at IS NULL AND c.status = 'open'
         AND c.awaiting_since <= strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || MIN(?, MAX(1, COALESCE(CAST(json_extract(s.data, '$.unansweredMin') AS INTEGER), 1))) || ' minutes')
       ORDER BY c.awaiting_since LIMIT ?`,
    )
    .all(now.toISOString(), MAX_UNANSWERED_MIN, limit)) as Array<{ id: string; awaiting_since: string; data: string | null }>;
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

/**
 * Pospuestos que vencieron: salen de Archivados y vuelven a la lista, marcados como no leídos para que se vean
 * (también el que ya estaba archivado antes de posponerlo: posponer es pedir verlo de nuevo). El desarchivado va
 * también a WhatsApp. Las filas que cambia las devuelve el mismo UPDATE: dos corridas no despiertan dos veces el
 * mismo chat.
 */
export async function wakeSnoozedChats(now = new Date()): Promise<number> {
  const nowS = now.toISOString();
  const rows = (await getDb()
    .prepare(
      `UPDATE groups_chats SET snoozed_until = NULL, snooze_archived = 0, archived_at = CASE WHEN keep_archived = 1 THEN archived_at ELSE NULL END,
         marked_unread = CASE WHEN unread_count = 0 THEN 1 ELSE marked_unread END, unread_count = CASE WHEN unread_count = 0 THEN 1 ELSE unread_count END,
         updated_at = ?
       WHERE snoozed_until IS NOT NULL AND snoozed_until <= ? RETURNING id, user_id, keep_archived`,
    )
    .all(nowS, nowS)) as Array<{ id: string; user_id: string; keep_archived: number | null }>;
  const byWs = new Map<string, string[]>();
  // "Mantener archivado" gana: el chat vuelve como no leído pero sigue en Archivados (acá y en el teléfono).
  for (const r of rows) if (!r.keep_archived) byWs.set(r.user_id, [...(byWs.get(r.user_id) ?? []), r.id]);
  if (byWs.size) {
    const { queueAndFlushArchivePush } = await import('./wa-archive-sync');
    for (const [ws, ids] of byWs) await queueAndFlushArchivePush('lines', ws, ids, false, now).catch(() => null);
  }
  return rows.length;
}

export async function runGroupsCron(opts: { budgetMs?: number; importBudgetMs?: number; dailyBudgetMs?: number } = {}) {
  const woke = await wakeSnoozedChats().catch(() => null);
  const flagged = await flagUnansweredChats().catch(() => null);
  const breached = await markBreachedTickets().catch(() => null);
  // Tareas y recordatorios de los chats (claim por fila en reminded_for).
  const reminders = await fireTaskReminders().catch(() => null);
  // Las corridas recurrentes vencidas pasan a envíos; processBroadcasts los manda con el ritmo de siempre.
  const recurring = await runDueRecurring().catch(() => null);
  const broadcasts = await processBroadcasts({ budgetMs: opts.budgetMs ?? 30_000 }).catch(() => null);
  const remoteTickets = await syncRemoteTickets().catch(() => null);
  // HubSpot: vínculo automático por teléfono (si el workspace lo prendió) y la nota diaria de cada chat vinculado.
  const { sweepHubspotAutoLink, syncHubspotNotes } = await import('./groups-hubspot');
  const hubspotLinked = await sweepHubspotAutoLink().catch(() => null);
  const hubspotNotes = await syncHubspotNotes().catch(() => null);
  // Alta automática del contacto de los chats 1:1 nuevos, en Lines y en Inbox (si se prendió).
  const { sweepHubspotAutoContacts } = await import('./hubspot-auto-contacts');
  const hubspotCreated = await sweepHubspotAutoContacts().catch(() => null);
  // HubSpot → Lines: empresas vinculadas que cambiaron, las borradas o fusionadas y, cada 6 horas, el esquema de propiedades.
  const { syncHubspotCompanies } = await import('./groups-hubspot-sync');
  const hubspotSync = await syncHubspotCompanies().catch(() => null);
  // Los reintentos de webhooks (también los de Groups) los corre /api/cron/minute con retryDueWebhooks.
  // Round-robin de lo que quedó sin asignar (nadie disponible cuando llegó, o recién se armó la regla).
  const { sweepAutoAssign } = await import('./groups-inbox');
  const assigned = await sweepAutoAssign().catch(() => null);
  // Importación de chats al conectar un número: una tanda por corrida (claim por fila; retoma donde quedó).
  const { runImports } = await import('./groups-import');
  const imports = await runImports({ budgetMs: opts.importBudgetMs ?? 20_000 }).catch(() => null);
  // Historial de mensajes de Periskope (lib/groups-periskope-history.ts): una tanda por workspace, retoma donde quedó.
  const { runHistoryJobs } = await import('./groups-periskope-history');
  const periskopeHistory = await runHistoryJobs({ budgetMs: opts.importBudgetMs ?? 20_000 }).catch(() => null);
  // Repaso diario de cada número: contactos, nombres, info, asuntos, descripciones, miembros y fotos (despacio, retoma donde quedó).
  const { refreshLinesDaily } = await import('./wa-contacts-refresh');
  const daily = await refreshLinesDaily(new Date(), Date.now() + (opts.dailyBudgetMs ?? 10_000)).catch(() => null);
  return { woke, flagged, breached, reminders, recurring, broadcasts, remoteTickets, hubspotLinked, hubspotNotes, hubspotCreated, hubspotSync, assigned, imports, periskopeHistory, daily };
}
