import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getPublishableKey, rotatePublishableKey } from '@/lib/link-publishable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Publishable key del workspace (no es secreta: va dentro de la app). Solo admins. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ key: await getPublishableKey(user.id, realUserId(user)) });
}

/** Rotar: la anterior deja de funcionar. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ key: await rotatePublishableKey(user.id, realUserId(user)) });
}
