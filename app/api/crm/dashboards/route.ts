import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createDashboard, listVisibleDashboards, reorderDashboards } from '@/lib/crm-dashboards';
import { dashboardCreateSchema, dashboardReorderSchema } from '@/lib/crm-dashboards-schema';
import { dashboardErrorResponse, sessionViewer } from '@/lib/crm-dashboards-session';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Los dashboards que la persona ve (privados suyos, de su equipo y de todos). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listVisibleDashboards(sessionViewer(user)) });
}

/** Nuevo dashboard: vacío, con la plantilla de ventas o copia de uno que la persona ve. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    return NextResponse.json(await createDashboard(sessionViewer(user), parsed.data), { status: 201 });
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}

/** Orden de los dashboards en el selector. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardReorderSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  await reorderDashboards(sessionViewer(user), parsed.data.ids);
  return new NextResponse(null, { status: 204 });
}
