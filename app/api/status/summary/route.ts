import { NextResponse } from 'next/server';
import { agentAuthError } from '@/lib/status/agent-auth';
import { statusSummary } from '@/lib/status/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/status/summary: el estado interno de cada componente y cuándo corrió
 * el cron por última vez (lastRunAt). Si lastRunAt queda viejo, el cron de
 * Vercel no está corriendo: eso lo tiene que notar el watcher.
 */
export async function GET(req: Request) {
  const denied = agentAuthError(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await statusSummary(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
