import { NextRequest } from 'next/server';
import { z } from 'zod';
import { publishedStore } from '@/lib/shop-storefront';
import { priceCart } from '@/lib/shop-orders';
import { readJson, shopJson, shopLimit } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

const schema = z.object({
  lines: z.array(z.object({ variantId: z.string().max(80), quantity: z.number().int().min(1).max(999) })).max(100),
  address: z.object({ country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), region: z.string().trim().max(120).optional() }).nullable().optional(),
  shippingRateId: z.string().max(80).nullable().optional(),
  discountCode: z.string().trim().max(40).nullable().optional(),
});

/**
 * POST /api/shop/public/<handle>/cart: el carrito preciado en el servidor
 * (precios, stock, envío, impuesto y descuento). Probar códigos tiene su
 * propio límite: no se adivinan a fuerza de intentos.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'cart', 120, 60, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return shopJson({ error: 'invalid_input' }, 400);
  if (parsed.data.discountCode) {
    const codeLimited = await shopLimit(req, 'code', 20, 600, handle);
    if (codeLimited) return codeLimited;
  }
  const cart = await priceCart(store.row, parsed.data);
  return shopJson({ cart, methods: store.methods });
}
