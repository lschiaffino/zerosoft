import { NextRequest, NextResponse } from 'next/server';
import { runDueRobots } from '@/lib/robots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Robots programados (Vercel Cron, cada pocos minutos): corre los vencidos en
 * paralelo, uno por workspace (lib/robots.ts → runDueRobots). Separado del
 * tick horario para que los schedules no esperen una hora ni compitan con la
 * cola de Flow por el tiempo del tick. Misma autorización que /api/cron/tick
 * (CRON_SECRET como Bearer).
 */
export async function GET(req: NextRequest) {
  const start = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 503 });
  }
  if (secret && (req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const robots = await runDueRobots(new Date(), 100, Math.max(0, 270_000 - (Date.now() - start)));
  return NextResponse.json({ robots });
}
