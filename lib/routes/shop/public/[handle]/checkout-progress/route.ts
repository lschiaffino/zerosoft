import { NextRequest } from 'next/server';
import { z } from 'zod';
import { saveCheckoutProgress } from '@/lib/shop-abandoned';
import { priceCart } from '@/lib/shop-orders';
import { publishedStore } from '@/lib/shop-storefront';
import { readJson, shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).optional(),
  lines: z.array(z.object({ variantId: z.string().max(80), quantity: z.number().int().min(1).max(999) })).min(1).max(100),
  website: z.string().max(200).optional(),
});

/** POST: guarda el carrito cuando el cliente escribió su email. El subtotal sale del servidor. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'progress', 20, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return shopJson({ error: 'invalid_input' }, 400);
  // Campo trampa: un bot no deja filas, y no se entera.
  if (parsed.data.website) return shopJson({ ok: true });
  const cart = await priceCart(store.row, { lines: parsed.data.lines });
  if (!cart.lines.length) return shopJson({ ok: true });
  await saveCheckoutProgress(store.row, {
    email: parsed.data.email,
    name: parsed.data.name,
    lines: cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    subtotalCents: cart.totals.subtotalCents,
  });
  return shopJson({ ok: true });
}
