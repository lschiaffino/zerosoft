import { NextResponse } from 'next/server';
import { agentAuthError } from '@/lib/status/agent-auth';
import { listIncidents } from '@/lib/status/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/status/incidents?state=open|resolved|all&limit=50 (watcher de la Mac mini, docs/status.md).
 * Devuelve un array de incidentes con su línea de tiempo completa (interna y pública).
 */
export async function GET(req: Request) {
  const denied = agentAuthError(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const raw = url.searchParams.get('state') ?? 'open';
  if (raw !== 'open' && raw !== 'resolved' && raw !== 'all') {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }
  const limit = Number(url.searchParams.get('limit') ?? 50) || 50;
  try {
    const incidents = await listIncidents(raw, limit);
    return NextResponse.json(incidents, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
