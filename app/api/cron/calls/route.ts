import { NextRequest, NextResponse } from 'next/server';
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
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 503 });
  }
  if (secret && (req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await runCallsCron({ budgetMs: 240_000 }));
}
