import { NextRequest } from 'next/server';
import { publishedStore } from '@/lib/shop-storefront';
import { recordView } from '@/lib/shop-orders';
import { shopJson, shopLimit } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/** POST /api/shop/public/<handle>/view: visita (para la conversión). Una por página, con tope por IP. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'view', 60, 60, handle);
  if (limited) return shopJson({ ok: true });
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  await recordView(store.row.workspace_id).catch(() => undefined);
  return shopJson({ ok: true });
}
