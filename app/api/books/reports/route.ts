import { NextRequest } from 'next/server';
import { handle, need } from '@/lib/books-http';
import { NextResponse } from 'next/server';
import { aging, balanceSheet, cashFlow, overview, profitAndLoss, taxBookCsv, taxReport } from '@/lib/books-reports';
import { BooksError } from '@/lib/books-schema';
import { isValidDate, todayIso } from '@/lib/books-money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/books/reports?kind=pnl|balance|cashflow|aged-receivables|aged-payables|tax|overview&from=&to=&asOf=
 * Impuestos en CSV: &format=csv&book=sales|purchases. Rol con informes (accountant o viewer).
 */
export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'reports.read');
    const sp = req.nextUrl.searchParams;
    const today = todayIso();
    const from = sp.get('from') ?? `${today.slice(0, 4)}-01-01`;
    const to = sp.get('to') ?? today;
    const asOf = sp.get('asOf') ?? today;
    if (![from, to, asOf].every(isValidDate) || from > to) throw new BooksError('invalid_date');
    switch (sp.get('kind')) {
      case 'pnl':
        return { report: await profitAndLoss(actor.ws, from, to) };
      case 'balance':
        return { report: await balanceSheet(actor.ws, asOf) };
      case 'cashflow':
        return { report: await cashFlow(actor.ws, from, to) };
      case 'aged-receivables':
        return { report: await aging(actor.ws, 'receivables', asOf) };
      case 'aged-payables':
        return { report: await aging(actor.ws, 'payables', asOf) };
      case 'tax': {
        const report = await taxReport(actor.ws, from, to);
        if (sp.get('format') === 'csv') {
          const book = sp.get('book') === 'purchases' ? 'purchases' : 'sales';
          return new NextResponse(taxBookCsv(report[book], report.currency), {
            headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="tax-${book}-${from}-${to}.csv"`, 'cache-control': 'private, no-store' },
          });
        }
        return { report };
      }
      case 'overview':
        return { report: await overview(actor.ws, today) };
      default:
        throw new BooksError('invalid_kind');
    }
  });
}
