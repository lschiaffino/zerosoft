import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { updateRoutingRule, deleteRoutingRule } from '@/lib/calendar-routing';
import { CalendarError } from '@/lib/calendar';
import { routingRuleUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; ruleId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingRuleUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const rule = await updateRoutingRule(user.id, params.id, params.ruleId, parsed.data);
    if (!rule) return notFound();
    return NextResponse.json(rule);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; ruleId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteRoutingRule(user.id, params.id, params.ruleId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
