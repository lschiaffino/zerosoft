import { NextResponse } from 'next/server';
import { agentAuthError } from '@/lib/status/agent-auth';
import { reportComponentIds } from '@/lib/status/components';
import { applyReport } from '@/lib/status/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['up', 'degraded', 'down']);

function metric(v: unknown): number | undefined | null {
  if (v === undefined) return undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? v : null;
}

/**
 * POST /api/status/report { component, status: 'up'|'degraded'|'down', detail?, metrics?: { volumeUsedMB, volumeSizeMB } }
 * El watcher reporta lo que la web no puede ver (Postgres de Evolution, su disco).
 * Pasa por la misma máquina de estados que los chequeos del cron.
 */
export async function POST(req: Request) {
  const denied = agentAuthError(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { component?: unknown; status?: unknown; detail?: unknown; metrics?: unknown } | null;
  if (!body || typeof body.component !== 'string' || !reportComponentIds().includes(body.component)) {
    return NextResponse.json({ error: 'unknown_component', components: reportComponentIds() }, { status: 400 });
  }
  if (typeof body.status !== 'string' || !STATUSES.has(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  if (body.detail !== undefined && body.detail !== null && (typeof body.detail !== 'string' || body.detail.length > 1000)) {
    return NextResponse.json({ error: 'invalid_detail' }, { status: 400 });
  }
  let metrics: { volumeUsedMB?: number; volumeSizeMB?: number } | undefined;
  if (body.metrics !== undefined && body.metrics !== null) {
    if (typeof body.metrics !== 'object') return NextResponse.json({ error: 'invalid_metrics' }, { status: 400 });
    const m = body.metrics as Record<string, unknown>;
    const used = metric(m.volumeUsedMB);
    const size = metric(m.volumeSizeMB);
    if (used === null || size === null) return NextResponse.json({ error: 'invalid_metrics' }, { status: 400 });
    metrics = { volumeUsedMB: used, volumeSizeMB: size };
  }
  try {
    const res = await applyReport({
      component: body.component,
      status: body.status as 'up' | 'degraded' | 'down',
      detail: typeof body.detail === 'string' ? body.detail : undefined,
      metrics,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'conflict' ? 409 : 400 });
    return NextResponse.json({ component: body.component, status: res.status, incidentId: res.incidentId });
  } catch {
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}
