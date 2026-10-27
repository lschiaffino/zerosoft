import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { actorIdOf, logCalActivity } from '@/lib/calendar-activity';
import { getEventType, updateEventType, deleteEventType, CalendarError } from '@/lib/calendar';
import { eventTypeUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const eventType = await getEventType(user.id, params.id);
  if (!eventType) return notFound();
  return NextResponse.json(eventType);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = eventTypeUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const eventType = await updateEventType(user.id, params.id, parsed.data);
    if (!eventType) return notFound();
    await logCalActivity(user.id, actorIdOf(user), 'event_type.updated', { type: 'event_type', id: eventType.id, summary: eventType.title });
    return NextResponse.json(eventType);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const existing = await getEventType(user.id, params.id);
    if (!(await deleteEventType(user.id, params.id))) return notFound();
    await logCalActivity(user.id, actorIdOf(user), 'event_type.deleted', { type: 'event_type', id: params.id, summary: existing?.title ?? '' });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
  return new NextResponse(null, { status: 204 });
}
