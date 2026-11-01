import { NextRequest } from 'next/server';
import { sendAbandonedReminder } from '@/lib/shop-abandoned';
import { shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };


/** POST: manda el recordatorio de este checkout ahora (una sola vez, con los topes de email). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    await sendAbandonedReminder(a.actor, (await params).id);
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}
