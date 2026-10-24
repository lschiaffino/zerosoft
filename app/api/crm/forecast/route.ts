import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listReportOwners } from '@/lib/crm-dashboards';
import { getForecast } from '@/lib/crm-forecast';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Forecast del período: ?period=month|quarter&offset=0&team=<id>&pipeline=<id>. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const period = sp.get('period') === 'quarter' ? 'quarter' : 'month';
  const offset = Number(sp.get('offset') ?? '0') || 0;
  const scope = await sessionScope(user);
  const owners = await listReportOwners(user, scope);
  const view = await getForecast(user.id, {
    period,
    offset,
    people: owners.map((o) => ({ id: o.id, name: o.name || o.email })),
    teamId: sp.get('team'),
    pipelineId: sp.get('pipeline'),
    scope,
  });
  return NextResponse.json(view);
}
