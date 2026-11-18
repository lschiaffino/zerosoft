import { NextRequest } from 'next/server';
import { bulkProducts } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { ids, action: active | draft | archived | delete }: acciones masivas sobre productos del workspace. */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as { ids?: unknown; action?: unknown };
  try {
    const n = await bulkProducts(a.actor, Array.isArray(body.ids) ? (body.ids as string[]) : [], String(body.action) as 'active');
    return shopJson({ ok: true, count: n });
  } catch (err) {
    return shopFail(err);
  }
}
