import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteIntegration } from '@/lib/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Desconecta Gmail: borra los tokens. Los emails ya sincronizados se conservan. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await deleteIntegration(user.id, 'gmail');
  return NextResponse.json({ ok: true });
}
