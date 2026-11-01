import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { exportCustomersCsv, exportOrdersCsv, exportReportCsv } from '@/lib/shop-reports';
import { shopActor, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?type=orders|customers|products|days|payments|discounts&days=30.
 * Pedidos y clientes llevan datos personales: solo admins.
 */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const type = req.nextUrl.searchParams.get('type') ?? '';
  const raw = Number(req.nextUrl.searchParams.get('days'));
  const days = [7, 30, 90, 365].includes(raw) ? raw : 30;
  let csv: string;
  if (type === 'orders' || type === 'customers') {
    if (!a.actor.admin) return shopJson({ error: 'forbidden' }, 403);
    csv = type === 'orders' ? await exportOrdersCsv(a.actor.ws, raw ? days : null) : await exportCustomersCsv(a.actor.ws);
  } else if (type === 'products' || type === 'days' || type === 'payments' || type === 'discounts') {
    csv = await exportReportCsv(a.actor.ws, type, days);
  } else {
    return shopJson({ error: 'invalid_input' }, 400);
  }
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' },
  });
}
