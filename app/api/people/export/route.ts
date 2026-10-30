import { NextRequest } from 'next/server';
import { payrollCsv } from '@/lib/people';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: CSV de nómina (HR; queda auditado). No procesa pagos. */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => {
    const asOf = req.nextUrl.searchParams.get('asOf');
    const csv = await payrollCsv(ctx, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
    return new Response(csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="payroll.csv"', 'cache-control': 'no-store' },
    });
  });
}
