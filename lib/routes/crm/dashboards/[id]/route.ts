import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDashboard, getDashboardFor, updateDashboard } from '@/lib/crm-dashboards';
import { dashboardPatchSchema } from '@/lib/crm-dashboards-schema';
import { dashboardErrorResponse, sessionViewer } from '@/lib/crm-dashboards-session';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const d = await getDashboardFor(sessionViewer(user), params.id);
  return d ? NextResponse.json(d) : notFound();
}

/** Nombre, orden y tamaño de tiles, filtros guardados, acceso (dueño o admin) y default de la persona. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const updated = await updateDashboard(sessionViewer(user), params.id, parsed.data);
    // Ya no lo ve (lo hizo privado de otra persona): sin cuerpo, el cliente lo saca de la lista.
    return updated ? NextResponse.json(updated) : new NextResponse(null, { status: 204 });
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    await deleteDashboard(sessionViewer(user), params.id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return dashboardErrorResponse(e);
  }
}
