import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createShare, listShareLog, listSharePasswords, listShares, shareOptions } from '@/lib/analytics/records-more';
import { getDashboard, getInsight } from '@/lib/analytics/records';
import { shareableQuery } from '@/lib/analytics/types';
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
  const shares = await listShares(project.id, { insightId, dashboardId });
  return NextResponse.json({
    shares: await Promise.all(shares.map(async (x) => ({ ...x, options: shareOptions(x), passwords: await listSharePasswords(x.id) }))),
    log: await listShareLog(project.id, { insightId, dashboardId }),
  });
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
  // Tampoco una apertura por persona: sus valores son emails o ids a la vista de cualquiera.
  if (insightId && 'query' in exists && !shareableQuery(exists.query)) return aError(400, 'breakdown_not_shareable');
  if ((await listShares(project.id, { insightId, dashboardId })).length >= MAX_SHARES) return aError(409, 'too_many_shares');
  const created = await createShare(project.id, actor.personId, { insightId, dashboardId });
  return NextResponse.json({ share: { ...created, options: shareOptions(created), passwords: [] } }, { status: 201 });
}
