import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { updateRoutingField, deleteRoutingField } from '@/lib/calendar-routing';
import { CalendarError } from '@/lib/calendar';
import { routingFieldUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; fieldId: string } },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingFieldUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const field = await updateRoutingField(user.id, params.id, params.fieldId, parsed.data);
    if (!field) return notFound();
    return NextResponse.json(field);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; fieldId: string } },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteRoutingField(user.id, params.id, params.fieldId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
