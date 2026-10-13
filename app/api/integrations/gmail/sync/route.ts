import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { syncMailbox } from '@/lib/crm-email-sync';
import { limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "Sync now": misma pasada incremental que el cron (lib/crm-email-sync.ts),
 * con más margen de mensajes. Si el cron está sincronizando este buzón
 * responde 409 (locked) en vez de duplicar trabajo.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  const limited = await limitAction(personId, 'gmail-sync', 20, 3600);
  if (limited) return limited;

  const res = await syncMailbox(user.id, personId, { maxMessages: 150 });
  if (res.status === 'not_connected') return NextResponse.json({ error: 'not_connected' }, { status: 400 });
  if (res.status === 'token_expired') return NextResponse.json({ error: 'token_expired' }, { status: 400 });
  if (res.status === 'locked') return NextResponse.json({ error: 'sync_in_progress' }, { status: 409 });
  if (res.status === 'error') return NextResponse.json({ error: 'sync_failed' }, { status: 502 });
  return NextResponse.json({ ok: true, synced: res.stored, fetched: res.fetched, mode: res.mode, more: res.more ?? false });
}
