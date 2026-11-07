import { NextRequest, NextResponse } from 'next/server';
import { runSendRenderCron } from '@/lib/send/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Send: versiones a medio renderizar porque quien subió se fue (claim por fila). Va
 * aparte de /api/cron/minute: un archivo pesado no le quita tiempo ni memoria a los
 * demás trabajos del minuto. Misma autorización (CRON_SECRET como Bearer).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 503 });
  }
  if (secret && (req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await runSendRenderCron({ budgetMs: 60_000 }));
}
