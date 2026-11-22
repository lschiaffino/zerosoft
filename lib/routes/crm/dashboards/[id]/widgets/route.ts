import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { addWidget } from '@/lib/crm-dashboards';
import { dashboardWidgetCreateSchema } from '@/lib/crm-dashboards-schema';
import { dashboardErrorResponse, sessionViewer } from '@/lib/crm-dashboards-session';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Agrega un tile (de la biblioteca, un reporte propio o la copia de otro tile). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardWidgetCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    return NextResponse.json(await addWidget(sessionViewer(user), params.id, parsed.data), { status: 201 });
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}
