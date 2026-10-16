import { NextRequest, NextResponse } from 'next/server';
import { retryDueWebhooks } from '@/lib/webhooks';
import { fireDueTasks } from '@/lib/crm';
import { processFlowQueue } from '@/lib/flow-worker';
import { runDueRobots } from '@/lib/robots';
import { syncDueMailboxes } from '@/lib/crm-email-sync';
import { processSequences } from '@/lib/crm-sequences';
import { runNightlyScoring } from '@/lib/crm-scoring';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Robots programados corren dentro del tick (hasta ~5 min por corrida).
export const maxDuration = 300;
/** Hasta cuándo (desde el inicio del tick) la cola de Flow empieza corridas nuevas. */
const FLOW_BUDGET_MS = 150_000;

/**
 * Tarea periódica única (Vercel Cron): recordatorios de Cal, reintentos de
 * webhooks, vencimiento de tareas del CRM (trigger task_due), el sync de
 * Gmail del CRM y los pasos de secuencias vencidos (ambos acotados y con lock
 * por fila; corre cada hora, esa es la granularidad de las secuencias), la
 * cola de Flow con presupuesto de tiempo (schedules vencidos, corridas en
 * cola, delays y reintentos) y al final los robots programados
 * (lib/robots.ts → runDueRobots). Misma autorización que el cron de
 * recordatorios (CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const tickStart = Date.now();
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const webhookRetries = await retryDueWebhooks();
  const dueTasks = await fireDueTasks();
  // Primero el sync (detecta respuestas → salen de la secuencia), después los envíos.
  // Van antes de la cola de Flow: son acotados y no pueden quedar sin correr.
  const emailSync = await syncDueMailboxes({ limit: 25, maxMessages: 50 }).catch(() => null);
  const sequences = await processSequences({ limit: 100 }).catch(() => null);
  // Lead scoring: recálculo completo una vez por día por workspace (ventanas de N días).
  const scoring = await runNightlyScoring(new Date(), 10).catch(() => null);
  // Flow con presupuesto: no empieza corridas nuevas pasados ~150 s del tick
  // (lo que quede sigue en cola para el próximo tick o el worker).
  const flow = await processFlowQueue({ limit: 200, budgetMs: Math.max(0, FLOW_BUDGET_MS - (Date.now() - tickStart)) });
  // Robots al final: son lo más lento y usan el tiempo que queda (con margen).
  // En Vercel también los corre /api/cron/robots cada 5 min; self-host puede
  // llamar solo al tick. El compare-and-set de next_run_at evita dobles corridas.
  const robots = await runDueRobots(new Date(), 100, Math.max(0, 270_000 - (Date.now() - tickStart)));
  return NextResponse.json({ reminders: await reminders.json(), webhookRetries, dueTasks, flow, emailSync, sequences, scoring, robots });
}
