import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { actorIdOf, logCalActivity } from '@/lib/calendar-activity';
import { listEventTypes, createEventType, CalendarError } from '@/lib/calendar';
import { eventTypeCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listEventTypes(user.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = eventTypeCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const eventType = await createEventType(user.id, parsed.data);
    await logCalActivity(user.id, actorIdOf(user), 'event_type.created', { type: 'event_type', id: eventType.id, summary: eventType.title });
    return NextResponse.json(eventType, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
