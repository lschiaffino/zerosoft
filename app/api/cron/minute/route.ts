import { NextRequest, NextResponse } from 'next/server';
import { processFlowQueue } from '@/lib/flow-worker';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
/** Hasta cuándo (desde el inicio) la cola de Flow empieza corridas nuevas. */
const FLOW_BUDGET_MS = 45_000;

/**
 * Cron de cada minuto (Vercel Cron): recordatorios y pasos de workflows de Cal
 * (así "15 minutos antes" llega a tiempo) y la cola de Flow con presupuesto de
 * tiempo (schedules vencidos, corridas en cola, delays y reintentos). El tick
 * horario sigue llamando a lo mismo para self-host con un solo cron; las dobles
 * corridas se evitan con los claims por fila (compare-and-set de next_run_at,
 * locks de corridas y jobs, sent_at de recordatorios y pasos). Misma
 * autorización que /api/cron/tick (CRON_SECRET como Bearer, la valida el
 * cron de recordatorios antes de hacer nada).
 */
export async function GET(req: NextRequest) {
  const start = Date.now();
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const flow = await processFlowQueue({ limit: 200, budgetMs: Math.max(0, FLOW_BUDGET_MS - (Date.now() - start)) });
  return NextResponse.json({ reminders: await reminders.json(), flow });
}
