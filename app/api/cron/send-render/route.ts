import { NextRequest, NextResponse } from 'next/server';
import { cronAuthError } from '@/lib/status/agent-auth';
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
  // CRON_SECRET en tiempo constante; en producción sin secreto no corre.
  const denied = cronAuthError(req);
  if (denied) return denied;
  return NextResponse.json(await runSendRenderCron({ budgetMs: 60_000 }));
}
