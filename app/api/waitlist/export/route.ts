import { NextRequest, NextResponse } from 'next/server';
import { currentUserIsAdmin } from '@/lib/roadmap-admin';
import { isProductKey } from '@/lib/products';
import { waitlistCsv, waitlistRows } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

/** CSV de la lista de espera (?app= para una sola). Solo ADMIN_EMAILS; para el resto la ruta no existe. */
export async function GET(req: NextRequest) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const raw = req.nextUrl.searchParams.get('app');
  const app = raw && isProductKey(raw) ? raw : null;
  const csv = waitlistCsv(await waitlistRows(app));
  const name = `waitlist-${app ?? 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
}
