import { NextRequest } from 'next/server';
import { handle, need } from '@/lib/books-http';
import { NextResponse } from 'next/server';
import {
  aging,
  agingCsv,
  balanceCsv,
  balanceSheet,
  budgetVariance,
  cashFlow,
  cashFlowCsv,
  generalLedger,
  ledgerCsv,
  overview,
  pnlCsv,
  profitAndLoss,
  reconciliationSummary,
  rowsToCsv,
  salesByItem,
  salesByItemCsv,
  taxBookCsv,
  taxReport,
  trialBalance,
  trialBalanceCsv,
  varianceCsv,
} from '@/lib/books-reports';
import { toDecimalString } from '@/lib/books-money';
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
    const wantCsv = sp.get('format') === 'csv';
    const csv = (body: string, name: string) =>
      new NextResponse(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'private, no-store' } });
    switch (sp.get('kind')) {
      case 'pnl': {
        const report = await profitAndLoss(actor.ws, from, to, { tracking: sp.get('tracking') ?? undefined });
        return wantCsv ? csv(pnlCsv(report), `profit-loss-${from}-${to}`) : { report };
      }
      case 'balance': {
        const report = await balanceSheet(actor.ws, asOf);
        return wantCsv ? csv(balanceCsv(report), `balance-sheet-${asOf}`) : { report };
      }
      case 'cashflow': {
        const report = await cashFlow(actor.ws, from, to);
        return wantCsv ? csv(cashFlowCsv(report), `cash-flow-${from}-${to}`) : { report };
      }
      case 'aged-receivables': {
        const report = await aging(actor.ws, 'receivables', asOf);
        return wantCsv ? csv(agingCsv(report), `aged-receivables-${asOf}`) : { report };
      }
      case 'aged-payables': {
        const report = await aging(actor.ws, 'payables', asOf);
        return wantCsv ? csv(agingCsv(report), `aged-payables-${asOf}`) : { report };
      }
      case 'trial-balance': {
        const report = await trialBalance(actor.ws, asOf);
        return wantCsv ? csv(trialBalanceCsv(report), `trial-balance-${asOf}`) : { report };
      }
      case 'general-ledger': {
        const report = await generalLedger(actor.ws, from, to, { accountId: sp.get('account') ?? undefined });
        return wantCsv ? csv(ledgerCsv(report), `general-ledger-${from}-${to}`) : { report };
      }
      case 'sales-by-item': {
        const report = await salesByItem(actor.ws, from, to);
        return wantCsv ? csv(salesByItemCsv(report), `sales-by-item-${from}-${to}`) : { report };
      }
      case 'budget-variance': {
        const report = await budgetVariance(actor.ws, sp.get('budget') ?? '', from, to);
        if (!report) throw new BooksError('not_found', 404);
        return wantCsv ? csv(varianceCsv(report), `budget-variance-${from}-${to}`) : { report };
      }
      case 'reconciliation': {
        const report = await reconciliationSummary(actor.ws);
        const m = (v: number) => toDecimalString(v, report.currency);
        return wantCsv ? csv(rowsToCsv([['account', 'book_balance', 'statement_total', 'lines_to_reconcile', 'amount_to_reconcile'], ...report.rows.map((r) => [r.name, m(r.bookBalance), m(r.statementTotal), r.unmatched, m(r.unmatchedAmount)])]), 'reconciliation') : { report };
      }
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
