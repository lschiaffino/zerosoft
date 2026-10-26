import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { addRoutingRule } from '@/lib/calendar-routing';
import { CalendarError } from '@/lib/calendar';
import { routingRuleCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingRuleCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const rule = await addRoutingRule(user.id, params.id, parsed.data);
    if (!rule) return notFound();
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
