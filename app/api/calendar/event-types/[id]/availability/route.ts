import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getEventType, listAvailability, setAvailability } from '@/lib/calendar';
import { availabilityBatchSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const eventType = await getEventType(user.id, params.id);
  if (!eventType) return notFound();
  const rules = await listAvailability(params.id);
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const eventType = await getEventType(user.id, params.id);
  if (!eventType) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = availabilityBatchSchema.safeParse(body);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.message === 'invalid_range')) return crmError(400, 'invalid_range');
    return invalidBody(parsed.error);
  }

  const rules = await setAvailability(params.id, parsed.data);
  return NextResponse.json({ rules });
}
