import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteIntegration } from '@/lib/integrations';
import { unregisterMailboxes } from '@/lib/crm-email-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Desconecta el Gmail de la persona: borra los tokens. Los emails ya sincronizados se conservan. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  await deleteIntegration(personId, 'gmail');
  await unregisterMailboxes(personId);
  return NextResponse.json({ ok: true });
}
