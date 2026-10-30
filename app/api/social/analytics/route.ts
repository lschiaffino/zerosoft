import { NextRequest, NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { analyticsCsv, socialAnalytics } from '@/lib/social-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reporte de las cuentas que ve la persona. ?days=7|30|90, ?account=, ?format=csv para descargar. */
export async function GET(req: NextRequest) {
  return withSocial(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const report = await socialAnalytics(actor, { days: Number(sp.get('days')) || 30, accountId: sp.get('account') ?? undefined });
    if (sp.get('format') === 'csv') {
      return new NextResponse(analyticsCsv(report), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="social-report-${report.days}d.csv"`,
          'cache-control': 'no-store',
        },
      });
    }
    return NextResponse.json(report);
  });
}
