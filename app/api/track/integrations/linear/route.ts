import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { limitByIp } from '@/lib/rate-limit';
import { requestLocale } from '@/lib/request-locale';
import { recordAudit } from '@/lib/track-audit';
import { trackError, unauthorized } from '@/lib/track-http';
import {
  connectLinear,
  disconnectLinear,
  getLinearConnection,
  LinearApiError,
  linearSyncView,
  listLinearTeams,
  retryLinearFailures,
  startLinearImport,
  syncLinearNow,
  updateLinearConfig,
} from '@/lib/track-linear-sync';
import { LINEAR_DIRECTIONS } from '@/lib/track-linear-sync-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Track › Ajustes › Integraciones › Linear. GET: estado (sin tokens);
 * ?teams=1 suma los teams de Linear para elegir. POST: conectar con una API
 * key o una acción (start, sync, retry). PATCH: teams, sentido y pausa.
 * DELETE: desconectar (lo importado queda). Todo menos GET pide admin.
 */

function wsOf(user: SessionUser): string {
  return trackWorkspaceId(user.team?.id ?? null, user.id);
}

function linearError(err: unknown): NextResponse {
  if (err instanceof LinearApiError) {
    const status = err.code === 'unauthorized' ? 400 : err.code === 'rate_limited' ? 429 : 502;
    return trackError(status, `linear_${err.code}`);
  }
  if (err instanceof Error && err.message === 'no_teams') return trackError(400, 'linear_no_teams');
  // eslint-disable-next-line no-console
  console.error('[linear-sync] route failed', err instanceof Error ? err.name : 'error');
  return trackError(500, 'internal_error');
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const ws = wsOf(user);
  const admin = isWorkspaceAdmin(user);
  const view = await linearSyncView(ws, admin);
  let teams = null;
  if (admin && req.nextUrl.searchParams.get('teams') === '1') {
    const conn = await getLinearConnection(ws);
    if (conn) {
      try {
        teams = await listLinearTeams(conn);
      } catch (err) {
        return linearError(err);
      }
    }
  }
  return NextResponse.json({ ...view, isAdmin: admin, availableTeams: teams });
}

const connectSchema = z.object({
  action: z.literal('connect'),
  // API key personal de Linear (lin_api_…): solo se guarda cifrada.
  apiKey: z.string().trim().min(10).max(200).regex(/^[A-Za-z0-9_-]+$/),
});
const actionSchema = z.object({ action: z.enum(['start', 'sync', 'retry']), id: z.string().max(64).optional() });

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'track-linear-sync', 30, 600);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const ws = wsOf(user);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.action === 'connect') {
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) return trackError(400, 'invalid_key');
    try {
      const conn = await connectLinear(
        {
          workspaceId: ws,
          jobWorkspaceId: user.id,
          jobTeamId: user.team?.id ?? null,
          personId: realUserId(user),
          locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
        },
        { type: 'api_key', token: parsed.data.apiKey },
      );
      await recordAudit({ workspaceId: ws, actorId: realUserId(user), action: 'integration.connected', entityType: 'integration', entityLabel: `Linear (${conn.config.orgName})` });
    } catch (err) {
      return linearError(err);
    }
    return NextResponse.json(await linearSyncView(ws, true));
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return trackError(400, 'invalid_input');
  if (!(await getLinearConnection(ws))) return trackError(404, 'not_connected');
  try {
    if (parsed.data.action === 'start') {
      const jobId = await startLinearImport(ws);
      return NextResponse.json({ ...(await linearSyncView(ws, true)), importJobId: jobId });
    }
    if (parsed.data.action === 'sync') {
      const ran = await syncLinearNow(ws);
      if (!ran) return trackError(409, 'sync_running');
    } else {
      await retryLinearFailures(ws, parsed.data.id);
      const { processOutbox } = await import('@/lib/track-integrations');
      await processOutbox({ limit: 20 }).catch(() => 0);
    }
  } catch (err) {
    return linearError(err);
  }
  return NextResponse.json(await linearSyncView(ws, true));
}

const patchSchema = z.object({
  teams: z.array(z.string().min(1).max(64)).max(50).optional(),
  direction: z.enum(LINEAR_DIRECTIONS as [string, ...string[]]).optional(),
  paused: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const ws = wsOf(user);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, 'invalid_input');
  const conn = await getLinearConnection(ws);
  if (!conn) return trackError(404, 'not_connected');
  const patch: Parameters<typeof updateLinearConfig>[1] = {};
  try {
    if (parsed.data.teams) {
      // Solo teams que existen en esa organización de Linear.
      const available = await listLinearTeams(conn);
      patch.teams = available.filter((t) => parsed.data.teams!.includes(t.id));
    }
  } catch (err) {
    return linearError(err);
  }
  if (parsed.data.direction) patch.direction = parsed.data.direction as typeof conn.config.direction;
  if (parsed.data.paused !== undefined) patch.paused = parsed.data.paused;
  await updateLinearConfig(ws, patch);
  await recordAudit({ workspaceId: ws, actorId: realUserId(user), action: 'integration.updated', entityType: 'integration', entityLabel: 'Linear', data: { changes: Object.keys(patch) } });
  return NextResponse.json(await linearSyncView(ws, true));
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const ws = wsOf(user);
  const removed = await disconnectLinear(ws);
  if (removed) await recordAudit({ workspaceId: ws, actorId: realUserId(user), action: 'integration.disconnected', entityType: 'integration', entityLabel: 'Linear' });
  return NextResponse.json(await linearSyncView(ws, true));
}
