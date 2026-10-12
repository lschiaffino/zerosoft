import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getRoutingForm, updateRoutingForm, deleteRoutingForm } from '@/lib/calendar-routing';
import { CalendarError } from '@/lib/calendar';
import { routingFormUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const form = await getRoutingForm(user.id, params.id);
  if (!form) return notFound();
  return NextResponse.json(form);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingFormUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const form = await updateRoutingForm(user.id, params.id, parsed.data);
    if (!form) return notFound();
    return NextResponse.json(form);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await deleteRoutingForm(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
