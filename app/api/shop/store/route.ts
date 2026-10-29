import { NextRequest } from 'next/server';
import { ensureStore, enabledMethods, listLocations, storeDto, updateStore, type StorePatch } from '@/lib/shop';
import { paymentsView } from '@/lib/shop-payments';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/store: la tienda, métodos de pago (sin secretos), ubicaciones y lo que falta configurar. */
export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const store = await ensureStore(a.actor.ws);
  const db = getDb();
  const [locations, products, rates] = await Promise.all([
    listLocations(a.actor.ws),
    db.prepare("SELECT COUNT(*) AS n FROM shop_products WHERE workspace_id = ? AND status = 'active'").get(a.actor.ws) as Promise<{ n: number }>,
    db.prepare('SELECT COUNT(*) AS n FROM shop_shipping_rates WHERE workspace_id = ?').get(a.actor.ws) as Promise<{ n: number }>,
  ]);
  return shopJson({
    store: storeDto(store),
    payments: a.actor.admin ? paymentsView(store) : null,
    methods: enabledMethods(store),
    locations,
    setup: { products: Number(products.n), shippingRates: Number(rates.n), payments: enabledMethods(store).length },
    canAdmin: a.actor.admin,
  });
}

/** PATCH /api/shop/store: nombre, handle, publicar, moneda, idioma, tema, marca, ajustes. */
export async function PATCH(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as StorePatch | null;
  if (!body || typeof body !== 'object') return shopJson({ error: 'invalid_input' }, 400);
  try {
    const store = await updateStore(a.actor, body);
    return shopJson({ store: storeDto(store) });
  } catch (err) {
    return shopFail(err);
  }
}
