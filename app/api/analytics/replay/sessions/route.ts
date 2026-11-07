import { NextRequest, NextResponse } from 'next/server';
import { actorProject, aError, analyticsActor, canManageAnalytics, isResponse } from '@/lib/analytics/http';
import { recordingsForSessions } from '@/lib/analytics/replay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** De sesiones a grabaciones, para los links de los eventos en vivo (?ids=a,b,c). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const ids = (sp.get('ids') ?? '').split(',').filter(Boolean);
  return NextResponse.json({ recordings: await recordingsForSessions(project, ids) });
}
