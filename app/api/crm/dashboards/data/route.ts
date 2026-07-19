import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getWidgetData, listReportOwners } from '@/lib/crm-dashboards';
import { dashboardDataRequestSchema } from '@/lib/crm-dashboards-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dataset de un widget: { type, pipelineId?, range? } → data computada. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardDataRequestSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const owners = await listReportOwners(user);
  const data = await getWidgetData(user.id, parsed.data, owners);
  return NextResponse.json(data);
}
