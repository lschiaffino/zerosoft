import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createShare, listShares } from '@/lib/analytics/records-more';
import { getDashboard, getInsight } from '@/lib/analytics/records';
import { actorProject, aError, analyticsActor, canManageAnalytics, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SHARES = 10;

/** Links públicos de un insight o un tablero (solo admins: lo que se comparte queda abierto a cualquiera). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  const insightId = req.nextUrl.searchParams.get('insight') ?? undefined;
  const dashboardId = req.nextUrl.searchParams.get('dashboard') ?? undefined;
  if (!insightId && !dashboardId) return aError(400, 'target_required');
  return NextResponse.json({ shares: await listShares(project.id, { insightId, dashboardId }) });
}

const schema = z.object({ projectId: z.string().max(64), insightId: z.string().max(64).optional(), dashboardId: z.string().max(64).optional() }).refine((b) => Boolean(b.insightId) !== Boolean(b.dashboardId));

export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  const { insightId, dashboardId } = parsed.data;
  const exists = insightId ? await getInsight(project.id, insightId) : await getDashboard(project.id, dashboardId!);
  if (!exists) return aError(404, 'not_found');
  // Un resultado de SQL puede traer cualquier dato de la base del proyecto: no se publica.
  if (insightId && 'kind' in exists && exists.kind === 'sql') return aError(400, 'sql_not_shareable');
  if ((await listShares(project.id, { insightId, dashboardId })).length >= MAX_SHARES) return aError(409, 'too_many_shares');
  return NextResponse.json({ share: await createShare(project.id, actor.personId, { insightId, dashboardId }) }, { status: 201 });
}
