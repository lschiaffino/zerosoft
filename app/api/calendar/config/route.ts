import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { setUserHandle } from '@/lib/db';
import { getOrCreateCalendarUser, updateCalendarUser } from '@/lib/calendar';
import { calendarConfigUpdateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const config = await getOrCreateCalendarUser(user.id);
  return NextResponse.json({ ...config, handle: user.handle ?? null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = calendarConfigUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { handle, ...rest } = parsed.data;
  if (handle !== undefined && handle !== user.handle) {
    // El handle es del usuario (dueño del workspace): solo un admin lo cambia.
    if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
    const res = await setUserHandle(user.id, handle);
    if (!res.ok) return crmError(res.code === 'handle_taken' ? 409 : 400, res.code);
  }
  const config = await updateCalendarUser(user.id, rest);
  return NextResponse.json({ ...config, handle: handle ?? user.handle });
}
