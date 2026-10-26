import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { resendDelivery } from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reenvía una entrega del log: nueva entrega con el mismo cuerpo, intentada en el momento. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const deliveryId = await resendDelivery(user.id, id, user.actingUser?.id ?? user.id);
  if (!deliveryId) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (deliveryId === 'not_owner') return NextResponse.json({ error: 'not_owner' }, { status: 403 });
  return NextResponse.json({ id: deliveryId });
}
