import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { setUserHandle } from '@/lib/db';
import { getOrCreateCalendarUser, updateCalendarUser } from '@/lib/calendar';
import { calendarConfigUpdateSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

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

  const { handle, conferencing, ...rest } = parsed.data;
  // Los links fijos (Zoom, Teams, teléfono) son de cada persona: se guardan en
  // su propio calendario, el que se usa cuando le toca una reserva como host.
  if (conferencing !== undefined) await updateCalendarUser(realUserId(user), { conferencing });
  // La marca de las páginas públicas es del workspace: como el handle, la cambia un admin.
  const touchesBrand =
    rest.brandColor !== undefined ||
    rest.logoUrl !== undefined ||
    rest.displayName !== undefined ||
    rest.hideBranding !== undefined ||
    rest.tracking !== undefined;
  if (touchesBrand && !isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  if (handle !== undefined && handle !== user.handle) {
    // El handle es del usuario (dueño del workspace): solo un admin lo cambia.
    if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
    const res = await setUserHandle(user.id, handle);
    if (!res.ok) return crmError(res.code === 'handle_taken' ? 409 : 400, res.code);
  }
  const config = await updateCalendarUser(user.id, rest);
  const changed = Object.keys(rest).filter((k) => rest[k as keyof typeof rest] !== undefined);
  if (handle !== undefined && handle !== user.handle) changed.unshift('handle');
  if (changed.length > 0) {
    await logCalActivity(user.id, realUserId(user), 'settings.updated', { type: 'settings', summary: changed.join(', ') });
  }
  return NextResponse.json({ ...config, handle: handle ?? user.handle });
}
