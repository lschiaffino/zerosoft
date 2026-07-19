import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getOrCreateCalendarUser, updateCalendarUser } from '@/lib/calendar';
import { calendarConfigUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const config = await getOrCreateCalendarUser(user.id);
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = calendarConfigUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const config = await updateCalendarUser(user.id, parsed.data);
  return NextResponse.json(config);
}
