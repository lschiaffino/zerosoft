import { NextRequest } from 'next/server';
import { z } from 'zod';
import { adjustInventory, listInventory } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/inventory?q=&low=1&location=: niveles por variante y ubicación. */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  return shopJson({ rows: await listInventory(a.actor.ws, { q: sp.get('q') ?? undefined, lowOnly: sp.get('low') === '1', locationId: sp.get('location') ?? undefined }) });
}

const adjustSchema = z
  .object({
    variantId: z.string().min(1).max(80),
    locationId: z.string().min(1).max(80),
    delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    set: z.number().int().min(0).max(1_000_000).optional(),
    reason: z.enum(['adjust', 'count', 'received', 'damaged', 'returned', 'correction']).default('adjust'),
  })
  .refine((v) => (v.delta === undefined) !== (v.set === undefined));

/** POST /api/shop/inventory: ajuste (+/-) o conteo, con historial. */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const parsed = adjustSchema.safeParse(await readJson(req));
  if (!parsed.success) return shopJson({ error: 'invalid_input' }, 400);
  try {
    return shopJson({ level: await adjustInventory(a.actor, parsed.data) });
  } catch (err) {
    return shopFail(err);
  }
}
