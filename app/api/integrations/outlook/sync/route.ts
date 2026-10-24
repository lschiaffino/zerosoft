import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { syncOutlookMailbox } from '@/lib/crm-outlook-sync';
import { limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "Sincronizar ahora" de Outlook: la misma pasada delta que el cron. Si el
 * cron está sincronizando este buzón responde 409 en vez de duplicar trabajo.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  const limited = await limitAction(personId, 'outlook-sync', 20, 3600);
  if (limited) return limited;

  const res = await syncOutlookMailbox(user.id, personId, { maxMessages: 150 });
  if (res.status === 'not_connected') return NextResponse.json({ error: 'not_connected' }, { status: 400 });
  if (res.status === 'token_expired') return NextResponse.json({ error: 'token_expired' }, { status: 400 });
  if (res.status === 'locked') return NextResponse.json({ error: 'sync_in_progress' }, { status: 409 });
  if (res.status === 'error') return NextResponse.json({ error: 'sync_failed' }, { status: 502 });
  return NextResponse.json({
    ok: true,
    synced: res.stored,
    meetings: res.meetings,
    fetched: res.fetched,
    more: res.more ?? false,
  });
}
