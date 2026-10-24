import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteIntegration } from '@/lib/integrations';
import { OUTLOOK_PROVIDER } from '@/lib/microsoft';
import { unregisterOutlookMailboxes } from '@/lib/crm-outlook-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Desconecta el Outlook de la persona: borra los tokens. Emails y reuniones ya sincronizados quedan. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  await deleteIntegration(personId, OUTLOOK_PROVIDER);
  await unregisterOutlookMailboxes(personId);
  return NextResponse.json({ ok: true });
}
