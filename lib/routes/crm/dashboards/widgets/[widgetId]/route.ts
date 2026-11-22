import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteWidget, updateWidget } from '@/lib/crm-dashboards';
import { dashboardWidgetPatchSchema } from '@/lib/crm-dashboards-schema';
import { dashboardErrorResponse, sessionViewer } from '@/lib/crm-dashboards-session';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ widgetId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardWidgetPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    return NextResponse.json(await updateWidget(sessionViewer(user), params.widgetId, parsed.data));
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ widgetId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    await deleteWidget(sessionViewer(user), params.widgetId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}
