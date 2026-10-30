import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { productDtos, type ProductRow } from '@/lib/shop';
import { exportShopifyCsv } from '@/lib/shop-csv';
import { shopActor } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/products/export: todos los productos en el CSV de Shopify (se puede subir a Shopify). */
export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const rows = (await getDb().prepare('SELECT * FROM shop_products WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 5000').all(a.actor.ws)) as ProductRow[];
  const products = await productDtos(a.actor.ws, rows);
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const csv = exportShopifyCsv(
    products.map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({ ...v, stock: v.inventory.reduce((s, i) => s + i.available, 0) })),
    })),
    (url) => (url.startsWith('/') ? `${base}${url}` : url),
  );
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
