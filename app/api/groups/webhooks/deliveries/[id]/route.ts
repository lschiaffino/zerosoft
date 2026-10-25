import { NextResponse } from 'next/server';
import { redeliverWebhook } from '@/lib/webhooks';
import { groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reenvía una entrega (mismo payload, entrega nueva en el log). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const d = await redeliverWebhook(s.ws, (await ctx.params).id);
  return d ? NextResponse.json({ delivery: d }) : groupsError(404, 'not_found');
}
