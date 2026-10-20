import { NextRequest, NextResponse } from 'next/server';
import { fireDueTasks } from '@/lib/crm';
import { processFlowQueue } from '@/lib/flow-worker';
import { sendOfflineReplyEmails } from '@/lib/chat-offline-email';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
/** Hasta cuándo (desde el inicio) la cola de Flow empieza corridas nuevas. */
const FLOW_BUDGET_MS = 45_000;

/**
 * Cron de cada minuto (Vercel Cron): recordatorios y pasos de workflows de Cal
 * (así "15 minutos antes" llega a tiempo), las tareas vencidas del CRM (trigger
 * task_due, con claim por fila en due_fired_at), los emails de Chat con respuestas
 * que el visitante no vio y la cola de Flow con presupuesto de
 * tiempo (schedules vencidos, corridas en cola, delays y reintentos). El tick
 * horario sigue llamando a lo mismo para self-host con un solo cron. Las secuencias del CRM quedan en el tick: van después del
 * sync de Gmail, que es el que detecta respuestas y saca al contacto. Las dobles
 * corridas se evitan con los claims por fila (compare-and-set de next_run_at,
 * locks de corridas y jobs, sent_at de recordatorios y pasos). Misma
 * autorización que /api/cron/tick (CRON_SECRET como Bearer, la valida el
 * cron de recordatorios antes de hacer nada).
 */
export async function GET(req: NextRequest) {
  const start = Date.now();
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const dueTasks = await fireDueTasks().catch(() => null);
  const chatEmails = await sendOfflineReplyEmails({ limit: 200 }).catch(() => null);
  const flow = await processFlowQueue({ limit: 200, budgetMs: Math.max(0, FLOW_BUDGET_MS - (Date.now() - start)) });
  return NextResponse.json({ reminders: await reminders.json(), dueTasks, chatEmails, flow });
}
