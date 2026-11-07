import { NextRequest } from 'next/server';
import { approveReturn, declineReturn, receiveReturn } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };


/** POST { action: approve | decline | receive, restock?, refundCents? }. Reembolsar es de admins. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const { id } = await params;
  const body = ((await readJson(req)) ?? {}) as { action?: string; restock?: boolean; refundCents?: number };
  try {
    if (body.action === 'approve') await approveReturn(a.actor, id);
    else if (body.action === 'decline') await declineReturn(a.actor, id);
    else if (body.action === 'receive') await receiveReturn(a.actor, id, { restock: body.restock === true, refundCents: body.refundCents });
    else return shopJson({ error: 'invalid_input' }, 400);
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}
