import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { addRoutingField } from '@/lib/calendar-routing';
import { CalendarError } from '@/lib/calendar';
import { routingFieldCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingFieldCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const field = await addRoutingField(user.id, params.id, parsed.data);
    if (!field) return notFound();
    return NextResponse.json(field, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
