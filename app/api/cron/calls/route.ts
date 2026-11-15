import { NextRequest, NextResponse } from 'next/server';
import { cronAuthError } from '@/lib/status/agent-auth';
import { runCallsCron } from '@/lib/calls/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Calls: agenda desde los calendarios, manda el bot a las reuniones que
 * empiezan y transcribe y analiza las grabaciones (claim por fila). Va aparte
 * de /api/cron/minute: una transcripción larga no le quita tiempo a los demás
 * trabajos. Misma autorización (CRON_SECRET como Bearer).
 */
export async function GET(req: NextRequest) {
  // CRON_SECRET en tiempo constante; en producción sin secreto no corre.
  const denied = cronAuthError(req);
  if (denied) return denied;
  return NextResponse.json(await runCallsCron({ budgetMs: 240_000 }));
}
