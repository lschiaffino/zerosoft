import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteIntegration } from '@/lib/integrations';
import { GOOGLE_CALENDAR_PROVIDER, invalidateBusyCache } from '@/lib/google-calendar';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Desconecta Google Calendar: borra los tokens. Los eventos ya creados quedan. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await deleteIntegration(realUserId(user), GOOGLE_CALENDAR_PROVIDER);
  invalidateBusyCache(realUserId(user));
  await logCalActivity(user.id, realUserId(user), 'integration.disconnected', { type: 'integration', id: 'google', summary: 'Google Calendar' });
  return NextResponse.json({ ok: true });
}
