import { NextRequest, NextResponse } from 'next/server';
import { retryDueWebhooks } from '@/lib/webhooks';
import { fireDueTasks } from '@/lib/crm';
import { processFlowQueue } from '@/lib/flow-worker';
import { runDueRobots } from '@/lib/robots';
import { syncDueMailboxes } from '@/lib/crm-email-sync';
import { processSequences } from '@/lib/crm-sequences';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Robots programados corren dentro del tick (hasta ~5 min por corrida).
export const maxDuration = 300;

/**
 * Tarea periódica única (Vercel Cron): recordatorios de Cal, reintentos de
 * webhooks, vencimiento de tareas del CRM (trigger task_due) y la cola de
 * Flow (schedules vencidos, corridas en cola, delays y reintentos), el sync
 * de Gmail del CRM y los pasos de secuencias vencidos (ambos acotados y con
 * lock por fila; corre cada hora, esa es la granularidad de las secuencias),
 * y al final los robots programados (lib/robots.ts → runDueRobots). Misma
 * autorización que el cron de recordatorios (CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const tickStart = Date.now();
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const webhookRetries = await retryDueWebhooks();
  const dueTasks = await fireDueTasks();
  const flow = await processFlowQueue({ limit: 200 });
  // Primero el sync (detecta respuestas → salen de la secuencia), después los envíos.
  const emailSync = await syncDueMailboxes({ limit: 25, maxMessages: 50 }).catch(() => null);
  const sequences = await processSequences({ limit: 100 }).catch(() => null);
  // Robots al final: son lo más lento y usan el tiempo que queda.
  // El tick tiene 300 s: los robots usan lo que quede (con margen).
  const robots = await runDueRobots(new Date(), 5, Math.max(0, 270_000 - (Date.now() - tickStart)));
  return NextResponse.json({ reminders: await reminders.json(), webhookRetries, dueTasks, flow, emailSync, sequences, robots });
}
