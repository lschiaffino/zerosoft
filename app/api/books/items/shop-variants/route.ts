import { NextRequest } from 'next/server';
import { handle, need } from '@/lib/books-http';
import { getDb } from '@/lib/db';
import { userCanUseApp } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/items/shop-variants?q=: variantes de Shop para vincular un ítem (comparten el stock). */
export async function GET(req: NextRequest) {
  return handle(async ({ actor, user }) => {
    need(actor, 'items.write');
    if (!userCanUseApp(user, 'shop')) return { variants: [], shop: false };
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = (await getDb()
      .prepare(
        `SELECT v.id, v.title AS variant, v.sku, p.title AS product FROM shop_variants v JOIN shop_products p ON p.id = v.product_id
         WHERE v.workspace_id = ? AND (p.title LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\') ORDER BY p.title LIMIT 30`,
      )
      .all(actor.ws, like, like)
      .catch(() => [])) as Array<{ id: string; variant: string; sku: string; product: string }>;
    return { variants: rows, shop: true };
  });
}
