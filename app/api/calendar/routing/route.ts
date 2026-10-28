import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listRoutingForms, createRoutingForm } from '@/lib/calendar-routing';
import { CalendarError } from '@/lib/calendar';
import { routingFormCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, unauthorized, crmError } from '@/lib/crm-http';
import { actorIdOf, logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listRoutingForms(user.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingFormCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const form = await createRoutingForm(user.id, parsed.data);
    await logCalActivity(user.id, actorIdOf(user), 'routing.created', { type: 'routing', id: form.id, summary: form.title });
    return NextResponse.json(form, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
