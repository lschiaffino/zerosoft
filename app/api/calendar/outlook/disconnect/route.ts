import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteIntegration } from '@/lib/integrations';
import { OUTLOOK_CALENDAR_PROVIDER, invalidateOutlookBusyCache } from '@/lib/outlook-calendar';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Desconecta el Outlook de Cal de la persona: borra los tokens. Los eventos ya creados quedan. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  await deleteIntegration(personId, OUTLOOK_CALENDAR_PROVIDER);
  invalidateOutlookBusyCache(personId);
  await logCalActivity(user.id, personId, 'integration.disconnected', { type: 'integration', id: 'outlook', summary: 'Outlook' });
  return NextResponse.json({ ok: true });
}
