import { NextResponse } from 'next/server';
import { resendDelivery } from '@/lib/webhooks';
import { groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reenvía una entrega (mismo payload, entrega nueva en el log). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = await resendDelivery(s.ws, (await ctx.params).id, s.user.actingUser?.id ?? s.user.id);
  if (id === 'not_owner') return groupsError(403, 'not_owner');
  return id ? NextResponse.json({ id }) : groupsError(404, 'not_found');
}
