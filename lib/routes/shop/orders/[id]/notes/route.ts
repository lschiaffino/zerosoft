import { NextRequest } from 'next/server';
import { addOrderNote } from '@/lib/shop-orders';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { text }: nota interna en la línea de tiempo del pedido. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as { text?: unknown } | null;
  try {
    return shopJson({ order: await addOrderNote(a.actor, (await params).id, String(body?.text ?? '')) });
  } catch (err) {
    return shopFail(err);
  }
}
