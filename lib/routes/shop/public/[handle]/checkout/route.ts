import { NextRequest } from 'next/server';
import { publishedStore } from '@/lib/shop-storefront';
import { createCheckoutOrder } from '@/lib/shop-orders';
import { codeGuessBlocked, countCodeMiss, publicOrigin, readJson, shopFail, shopJson, shopLimit } from '@/lib/shop-http';
import { ShopError } from '@/lib/shop-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/**
 * POST /api/shop/public/<handle>/checkout: crea el pedido como invitado
 * (email, carrito, dirección, envío, código y método) y devuelve a dónde
 * redirigir para pagar. Montos siempre del servidor.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'checkout', 10, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (body?.discountCode) {
    const blocked = await codeGuessBlocked(req, handle);
    if (blocked) return blocked;
  }
  try {
    const res = await createCheckoutOrder(store.row, body, { origin: publicOrigin(req) });
    return shopJson({ number: res.order.number, statusToken: res.statusToken, redirectUrl: res.redirectUrl }, 201);
  } catch (err) {
    // Un código válido no cuenta; uno inexistente sí (como en el carrito).
    if (err instanceof ShopError && err.code === 'discount_invalid') await countCodeMiss(req, handle);
    return shopFail(err);
  }
}
