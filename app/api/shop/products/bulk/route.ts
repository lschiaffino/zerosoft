import { NextRequest } from 'next/server';
import { bulkPrices, bulkProducts } from '@/lib/shop';
import type { PriceChange } from '@/lib/shop-money';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { ids, action: active | draft | archived | delete }: acciones masivas sobre productos del workspace.
 * POST { ids, action: 'prices', change: { mode: sale | end-sale | adjust, percent? } }: cambia los precios.
 */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as { ids?: unknown; action?: unknown; change?: unknown };
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  try {
    if (body.action === 'prices') {
      const res = await bulkPrices(a.actor, ids, body.change as PriceChange);
      return shopJson({ ok: true, ...res });
    }
    const n = await bulkProducts(a.actor, ids, String(body.action) as 'active');
    return shopJson({ ok: true, count: n });
  } catch (err) {
    return shopFail(err);
  }
}
