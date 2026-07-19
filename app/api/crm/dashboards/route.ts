import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  createDashboard,
  listDashboardsWithWidgets,
  reorderDashboards,
} from '@/lib/crm-dashboards';
import { dashboardCreateSchema, dashboardReorderSchema } from '@/lib/crm-dashboards-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listDashboardsWithWidgets(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const dashboard = await createDashboard(user.id, parsed.data.name);
  return NextResponse.json(dashboard, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardReorderSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  await reorderDashboards(user.id, parsed.data.ids);
  return new NextResponse(null, { status: 204 });
}
