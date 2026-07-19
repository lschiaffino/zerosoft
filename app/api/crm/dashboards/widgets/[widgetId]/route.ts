import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteWidget, updateWidget } from '@/lib/crm-dashboards';
import { dashboardWidgetPatchSchema } from '@/lib/crm-dashboards-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { widgetId: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardWidgetPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const widget = await updateWidget(user.id, params.widgetId, parsed.data);
  if (!widget) return notFound();
  return NextResponse.json(widget);
}

export async function DELETE(_req: NextRequest, { params }: { params: { widgetId: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const ok = await deleteWidget(user.id, params.widgetId);
  if (!ok) return notFound();
  return new NextResponse(null, { status: 204 });
}
