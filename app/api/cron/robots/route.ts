import { NextRequest, NextResponse } from 'next/server';
import { cronAuthError } from '@/lib/status/agent-auth';
import { pruneRobotRuns, runDueRobots } from '@/lib/robots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Robots programados (Vercel Cron, cada pocos minutos): corre los vencidos en
 * paralelo, uno por workspace (lib/robots.ts → runDueRobots). Separado del
 * tick horario para que los schedules no esperen una hora ni compitan con la
 * cola de Flow por el tiempo del tick. Misma autorización que /api/cron/tick
 * (CRON_SECRET como Bearer). Al final borra las corridas viejas según la
 * retención de cada robot (pruneRobotRuns).
 */
export async function GET(req: NextRequest) {
  const start = Date.now();
  // CRON_SECRET en tiempo constante; en producción sin secreto no corre.
  const denied = cronAuthError(req);
  if (denied) return denied;
  const robots = await runDueRobots(new Date(), 100, Math.max(0, 270_000 - (Date.now() - start)));
  const pruned = await pruneRobotRuns().catch(() => 0);
  return NextResponse.json({ robots, pruned });
}
