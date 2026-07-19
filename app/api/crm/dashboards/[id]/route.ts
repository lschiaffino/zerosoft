import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  deleteDashboard,
  getDashboard,
  renameDashboard,
  updateWidgetLayout,
} from '@/lib/crm-dashboards';
import { dashboardPatchSchema } from '@/lib/crm-dashboards-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  if (parsed.data.name !== undefined) {
    const renamed = await renameDashboard(user.id, params.id, parsed.data.name);
    if (!renamed) return notFound();
  }
  if (parsed.data.layout !== undefined) {
    const ok = await updateWidgetLayout(user.id, params.id, parsed.data.layout);
    if (!ok) return notFound();
  }
  return NextResponse.json(await getDashboard(user.id, params.id));
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const ok = await deleteDashboard(user.id, params.id);
  if (!ok) return notFound();
  return new NextResponse(null, { status: 204 });
}
