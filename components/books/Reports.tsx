'use client';

import { REPORT_KINDS, type ReportKind } from '@/lib/books-tabs';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { AgingReport, BalanceSheet, BudgetVariance, CashFlow, GeneralLedger, ProfitLoss, ReconciliationRow, ReportLine, SalesByItemRow, TaxReport, TrialBalance } from '@/lib/books-reports';
import type { TrackingCategoryDto } from '@/lib/books-accounting';
import { bpsToPercent, formatMoney } from '@/lib/books-money';
import { Kpi, useDate } from './ui';

const KEY: Record<ReportKind, string> = {
  pnl: 'pnl',
  'balance-sheet': 'balance',
  'cash-flow': 'cashflow',
  'aged-receivables': 'agedReceivables',
  'aged-payables': 'agedPayables',
  tax: 'tax',
  'trial-balance': 'trialBalance',
  'general-ledger': 'generalLedger',
  'sales-by-item': 'salesByItem',
  'budget-variance': 'budgetVariance',
  reconciliation: 'reconciliation',
};

/** Clave de la API para el CSV de cada informe. */
const API_KIND: Record<ReportKind, string> = { pnl: 'pnl', 'balance-sheet': 'balance', 'cash-flow': 'cashflow', 'aged-receivables': 'aged-receivables', 'aged-payables': 'aged-payables', tax: 'tax', 'trial-balance': 'trial-balance', 'general-ledger': 'general-ledger', 'sales-by-item': 'sales-by-item', 'budget-variance': 'budget-variance', reconciliation: 'reconciliation' };

function CsvLink({ kind, params }: { kind: ReportKind; params: Record<string, string | undefined> }) {
  const t = useTranslations('books.reports');
  const sp = new URLSearchParams({ kind: API_KIND[kind], format: 'csv' });
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return (
    <a className="btn btn-secondary" href={`/api/books/reports?${sp}`} download>
      {t('csv')}
    </a>
  );
}

export function ReportsIndex() {
  const t = useTranslations('books');
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader title={t('nav.reports')} description={t('reports.desc')} />
      <ul className="bk-cards">
        {REPORT_KINDS.map((k) => (
          <li key={k}>
            <Link href={`/app/books/reports/${k}`} className="panel bk-card">
              <span className="bk-panel-title">{t(`reports.${KEY[k]}.title`)}</span>
              <span className="ui-help">{t(`reports.${KEY[k]}.desc`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Range({ kind, from, to, asOf, point, extra, selects }: { kind: ReportKind; from: string; to: string; asOf: string; point: boolean; extra?: Record<string, string>; selects?: Array<{ name: string; label: string; value: string; options: Array<{ value: string; label: string }> }> }) {
  const t = useTranslations('books.reports');
  const router = useRouter();
  const [a, setA] = useState(point ? asOf : from);
  const [b, setB] = useState(to);
  const [sel, setSel] = useState<Record<string, string>>(() => Object.fromEntries((selects ?? []).map((x) => [x.name, x.value])));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams(point ? { asOf: a } : { from: a, to: b });
    for (const [k, v] of Object.entries({ ...(extra ?? {}), ...sel })) if (v) sp.set(k, v);
    router.push(`/app/books/reports/${kind}?${sp}`);
  };
  return (
    <form className="bk-toolbar bk-range" onSubmit={submit}>
      <label className="ui-field">
        <span className="label">{point ? t('asOf') : t('from')}</span>
        <input className="input" type="date" required value={a} onChange={(e) => setA(e.target.value)} />
      </label>
      {!point && (
        <label className="ui-field">
          <span className="label">{t('to')}</span>
          <input className="input" type="date" required value={b} min={a} onChange={(e) => setB(e.target.value)} />
        </label>
      )}
      {(selects ?? []).map((x) => (
        <label key={x.name} className="ui-field">
          <span className="label">{x.label}</span>
          <select className="select" value={sel[x.name] ?? ''} onChange={(e) => setSel({ ...sel, [x.name]: e.target.value })}>
            {x.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="btn btn-secondary">
        {t('update')}
      </button>
    </form>
  );
}

function Section({ title, lines, total, currency, totalLabel, compare, compareTotal, compareLabel, currentLabel }: { title: string; lines: ReportLine[]; total: number; currency: string; totalLabel: string; compare?: ReportLine[]; compareTotal?: number; compareLabel?: string; currentLabel?: string }) {
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, currency, locale);
  const prev = new Map((compare ?? []).map((l) => [l.accountId, l]));
  // Cuentas que solo tuvieron movimiento en el período comparado también se listan, con cero en el actual.
  const rows = compare ? [...lines, ...compare.filter((l) => !lines.some((x) => x.accountId === l.accountId)).map((l) => ({ ...l, amount: 0 }))] : lines;
  return (
    <section className="bk-section">
      <h2 className="bk-panel-title">{title}</h2>
      <div className="table-wrap bk-table-wrap">
        <table className="table bk-table bk-report">
          {compare && (
            <thead>
              <tr>
                <th scope="col" colSpan={2}>
                  <span className="sr-only">{title}</span>
                </th>
                <th scope="col" className="num">
                  {currentLabel}
                </th>
                <th scope="col" className="num">
                  {compareLabel}
                </th>
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((l) => (
              <tr key={l.accountId}>
                <td className="data bk-code">{l.code}</td>
                <th scope="row">{l.accountId === 'earnings' || l.accountId === 'prior' ? l.name : <Link href={`/app/books/reports/general-ledger?account=${l.accountId}`}>{l.name}</Link>}</th>
                <td className="num">{m(l.amount)}</td>
                {compare && <td className="num">{m(prev.get(l.accountId)?.amount ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {totalLabel}
              </th>
              <td className="num data">{m(total)}</td>
              {compare && <td className="num data">{m(compareTotal ?? 0)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Shell({ kind, children, from, to, asOf, point = false, actions, extra, selects }: { kind: ReportKind; children: ReactNode; from: string; to: string; asOf: string; point?: boolean; actions?: ReactNode; extra?: Record<string, string>; selects?: Array<{ name: string; label: string; value: string; options: Array<{ value: string; label: string }> }> }) {
  const t = useTranslations('books');
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader back={{ href: '/app/books/reports', label: t('nav.reports') }} title={t(`reports.${KEY[kind]}.title`)} description={t(`reports.${KEY[kind]}.desc`)} actions={actions} />
      <Range kind={kind} from={from} to={to} asOf={asOf} point={point} extra={extra} selects={selects} />
      {children}
    </div>
  );
}

export function ProfitLossView({ report, compare, mode, asOf, tracking, trackingId }: { report: ProfitLoss; compare: ProfitLoss | null; mode: string; asOf: string; tracking: TrackingCategoryDto[]; trackingId: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const date = useDate();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  const empty = !report.income.length && !report.expenses.length && !report.costOfSales.length && !compare;
  const options = tracking.flatMap((c) => c.options.map((o) => ({ value: o.id, label: `${c.name}: ${o.name}` })));
  const cmp = compare
    ? { currentLabel: `${date(report.from)} - ${date(report.to)}`, compareLabel: `${date(compare.from)} - ${date(compare.to)}` }
    : {};
  return (
    <Shell
      kind="pnl"
      from={report.from}
      to={report.to}
      asOf={asOf}
      actions={<CsvLink kind="pnl" params={{ from: report.from, to: report.to, tracking: trackingId }} />}
      selects={[
        { name: 'compare', label: t('compareWith'), value: mode, options: [{ value: '', label: t('compareNone') }, { value: 'prev', label: t('comparePrev') }, { value: 'year', label: t('compareYear') }] },
        ...(options.length ? [{ name: 'tracking', label: t('trackingFilter'), value: trackingId, options: [{ value: '', label: t('trackingAll') }, ...options] }] : []),
      ]}
    >
      <div className="bk-kpis">
        <Kpi label={t('income')} value={m(report.totalIncome)} />
        <Kpi label={t('grossProfit')} value={m(report.grossProfit)} />
        <Kpi label={t('expenses')} value={m(report.totalExpenses)} />
        <Kpi label={t('netProfit')} value={m(report.netProfit)} />
      </div>
      {empty ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <>
          <Section title={t('income')} lines={report.income} total={report.totalIncome} currency={report.currency} totalLabel={t('totalIncome')} compare={compare?.income} compareTotal={compare?.totalIncome} {...cmp} />
          {(report.costOfSales.length > 0 || (compare?.costOfSales.length ?? 0) > 0) && <Section title={t('costOfSales')} lines={report.costOfSales} total={report.totalCostOfSales} currency={report.currency} totalLabel={t('totalCostOfSales')} compare={compare?.costOfSales} compareTotal={compare?.totalCostOfSales} {...cmp} />}
          <Section title={t('expenses')} lines={report.expenses} total={report.totalExpenses} currency={report.currency} totalLabel={t('totalExpenses')} compare={compare?.expenses} compareTotal={compare?.totalExpenses} {...cmp} />
          <p className="bk-total-line" data-testid="books-net-profit">
            <span>{t('netProfit')}</span>
            <span className="data">{m(report.netProfit)}</span>
          </p>
          {compare && (
            <p className="bk-total-line bk-total-sub">
              <span>{t('netProfitCompared')}</span>
              <span className="data">{m(compare.netProfit)}</span>
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

export function BalanceSheetView({ report, compare, from, to }: { report: BalanceSheet; compare: BalanceSheet | null; from: string; to: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const date = useDate();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  const earnings = (r: BalanceSheet) => [
    ...r.equity,
    ...(r.priorEarnings !== 0 ? [{ accountId: 'prior', code: '', name: t('priorEarnings'), type: 'equity' as const, subtype: 'equity', amount: r.priorEarnings }] : []),
    { accountId: 'earnings', code: '', name: t('currentEarnings'), type: 'equity' as const, subtype: 'equity', amount: r.currentEarnings },
  ];
  const cmp = compare ? { currentLabel: date(report.asOf), compareLabel: date(compare.asOf) } : {};
  return (
    <Shell
      kind="balance-sheet"
      from={from}
      to={to}
      asOf={report.asOf}
      point
      actions={<CsvLink kind="balance-sheet" params={{ asOf: report.asOf }} />}
      selects={[{ name: 'compare', label: t('compareWith'), value: compare ? 'year' : '', options: [{ value: '', label: t('compareNone') }, { value: 'year', label: t('compareYearEnd') }] }]}
    >
      <Section title={t('assets')} lines={report.assets} total={report.totalAssets} currency={report.currency} totalLabel={t('totalAssets')} compare={compare?.assets} compareTotal={compare?.totalAssets} {...cmp} />
      <Section title={t('liabilities')} lines={report.liabilities} total={report.totalLiabilities} currency={report.currency} totalLabel={t('totalLiabilities')} compare={compare?.liabilities} compareTotal={compare?.totalLiabilities} {...cmp} />
      <Section title={t('equity')} lines={earnings(report)} total={report.totalEquity} currency={report.currency} totalLabel={t('totalEquity')} compare={compare ? earnings(compare) : undefined} compareTotal={compare?.totalEquity} {...cmp} />
      <p className="bk-total-line">
        <span>{t('liabilitiesEquity')}</span>
        <span className="data">{m(report.totalLiabilities + report.totalEquity)}</span>
      </p>
      {report.difference !== 0 && (
        <p className="ui-error" role="alert">
          {t('outOfBalance', { amount: m(report.difference) })}
        </p>
      )}
    </Shell>
  );
}

export function TrialBalanceView({ report, from, to }: { report: TrialBalance; from: string; to: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const date = useDate();
  const m = (v: number) => (v ? formatMoney(v, report.currency, locale) : '');
  return (
    <Shell kind="trial-balance" from={from} to={to} asOf={report.asOf} point actions={<CsvLink kind="trial-balance" params={{ asOf: report.asOf }} />}>
      {report.rows.length === 0 ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <>
          <div className="table-wrap bk-table-wrap">
            <table className="table bk-table bk-report">
              <thead>
                <tr>
                  <th scope="col">{t('code')}</th>
                  <th scope="col">{t('account')}</th>
                  <th scope="col" className="num">
                    {t('debit')}
                  </th>
                  <th scope="col" className="num">
                    {t('credit')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.accountId ?? 'prior'}>
                    <td className="data bk-code">{r.code}</td>
                    <th scope="row">{r.accountId ? <Link href={`/app/books/reports/general-ledger?account=${r.accountId}`}>{r.name}</Link> : t('priorEarnings')}</th>
                    <td className="num">{m(r.debit)}</td>
                    <td className="num">{m(r.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    {t('total')}
                  </th>
                  <td className="num data" data-testid="tb-debit">
                    {m(report.totalDebit)}
                  </td>
                  <td className="num data" data-testid="tb-credit">
                    {m(report.totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="ui-help">{t('trialHelp', { date: date(report.yearStart) })}</p>
        </>
      )}
    </Shell>
  );
}

export function GeneralLedgerView({ report, asOf, accounts, accountId }: { report: GeneralLedger; asOf: string; accounts: Array<{ id: string; name: string }>; accountId: string }) {
  const t = useTranslations('books');
  const tr = useTranslations('books.reports');
  const locale = useLocale();
  const date = useDate();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  const z = (v: number) => (v ? m(v) : '');
  return (
    <Shell
      kind="general-ledger"
      from={report.from}
      to={report.to}
      asOf={asOf}
      actions={<CsvLink kind="general-ledger" params={{ from: report.from, to: report.to, account: accountId }} />}
      selects={[{ name: 'account', label: tr('account'), value: accountId, options: [{ value: '', label: tr('allAccounts') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] }]}
    >
      {report.truncated && (
        <p className="ui-error" role="alert">
          {tr('ledgerTruncated')}
        </p>
      )}
      {report.accounts.length === 0 ? (
        <EmptyState compact body={tr('empty')} />
      ) : (
        report.accounts.map((a) => (
          <section key={a.accountId} className="bk-section">
            <h2 className="bk-panel-title">
              <span className="data">{a.code}</span> {a.name}
            </h2>
            <div className="table-wrap bk-table-wrap table-stack">
              <table className="table bk-table bk-report">
                <thead>
                  <tr>
                    <th scope="col">{tr('date')}</th>
                    <th scope="col">{tr('entry')}</th>
                    <th scope="col" className="num">
                      {tr('debit')}
                    </th>
                    <th scope="col" className="num">
                      {tr('credit')}
                    </th>
                    <th scope="col" className="num">
                      {tr('balance')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" colSpan={4}>
                      {tr('opening')}
                    </th>
                    <td className="num" data-label={tr('balance')}>
                      {m(a.opening)}
                    </td>
                  </tr>
                  {a.entries.map((e, i) => (
                    <tr key={`${e.journalId}:${i}`}>
                      <td data-label={tr('date')}>{date(e.date)}</td>
                      <th scope="row">
                        <Link href={`/app/books/journal/${e.journalId}`} className="bk-rowtext">
                          <span className="bk-break">{e.memo || e.description || `#${e.number}`}</span>
                          <span className="bk-rowmeta">
                            #{e.number} · {t.has(`journal.sources.${e.sourceType}`) ? t(`journal.sources.${e.sourceType}`) : e.sourceType}
                          </span>
                        </Link>
                      </th>
                      <td className="num" data-label={tr('debit')}>
                        {z(e.debit)}
                      </td>
                      <td className="num" data-label={tr('credit')}>
                        {z(e.credit)}
                      </td>
                      <td className="num data" data-label={tr('balance')}>
                        {m(e.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      {tr('closing')}
                    </th>
                    <td className="num">{z(a.totalDebit)}</td>
                    <td className="num">{z(a.totalCredit)}</td>
                    <td className="num data">{m(a.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))
      )}
    </Shell>
  );
}

export function SalesByItemView({ report, asOf }: { report: { from: string; to: string; currency: string; rows: SalesByItemRow[]; total: number }; asOf: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  return (
    <Shell kind="sales-by-item" from={report.from} to={report.to} asOf={asOf} actions={<CsvLink kind="sales-by-item" params={{ from: report.from, to: report.to }} />}>
      {report.rows.length === 0 ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <div className="table-wrap bk-table-wrap">
          <table className="table bk-table bk-report">
            <thead>
              <tr>
                <th scope="col">{t('item')}</th>
                <th scope="col" className="num">
                  {t('quantity')}
                </th>
                <th scope="col" className="num">
                  {t('net')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={r.itemId ?? `${r.name}:${i}`}>
                  <th scope="row" className="bk-break">
                    {r.itemId ? <Link href={`/app/books/items/${r.itemId}`}>{r.name}</Link> : r.name}
                  </th>
                  <td className="num">{r.quantity}</td>
                  <td className="num">{m(r.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {t('total')}
                </th>
                <td className="num data">{m(report.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

export function BudgetVarianceView({ report, budgets, budgetId, from, to, asOf, currency, canWrite }: { report: BudgetVariance | null; budgets: Array<{ id: string; name: string }>; budgetId: string; from: string; to: string; asOf: string; currency: string; canWrite: boolean }) {
  const t = useTranslations('books.reports');
  const tb = useTranslations('books.budgets');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, currency, locale);
  return (
    <Shell
      kind="budget-variance"
      from={from}
      to={to}
      asOf={asOf}
      actions={report ? <CsvLink kind="budget-variance" params={{ from, to, budget: budgetId }} /> : undefined}
      selects={budgets.length ? [{ name: 'budget', label: t('budget'), value: budgetId, options: budgets.map((b) => ({ value: b.id, label: b.name })) }] : undefined}
    >
      {!report ? (
        <EmptyState product="books" title={tb('emptyTitle')} body={tb('emptyBody')} action={canWrite ? { label: tb('new'), href: '/app/books/budgets/new' } : undefined} />
      ) : report.rows.length === 0 ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <>
          <div className="table-wrap bk-table-wrap">
            <table className="table bk-table bk-report">
              <thead>
                <tr>
                  <th scope="col">{t('account')}</th>
                  <th scope="col" className="num">
                    {t('budget')}
                  </th>
                  <th scope="col" className="num">
                    {t('actual')}
                  </th>
                  <th scope="col" className="num">
                    {t('variance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.accountId}>
                    <th scope="row">
                      {r.code} {r.name}
                    </th>
                    <td className="num">{m(r.budget)}</td>
                    <td className="num">{m(r.actual)}</td>
                    <td className={`num${r.variance < 0 ? ' bk-neg' : ''}`}>{m(r.variance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t('netProfit')}</th>
                  <td className="num data">{m(report.netBudget)}</td>
                  <td className="num data">{m(report.netActual)}</td>
                  <td className="num data">{m(report.netActual - report.netBudget)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="ui-help">{t('varianceHelp')}</p>
        </>
      )}
    </Shell>
  );
}

export function ReconciliationView({ report, from, to, asOf }: { report: { currency: string; rows: ReconciliationRow[] }; from: string; to: string; asOf: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader back={{ href: '/app/books/reports', label: t('title') }} title={t('reconciliation.title')} description={t('reconciliation.desc')} actions={<CsvLink kind="reconciliation" params={{ from, to, asOf }} />} />
      {report.rows.length === 0 ? (
        <EmptyState compact body={t('reconciliationEmpty')} />
      ) : (
        <div className="table-wrap bk-table-wrap">
          <table className="table bk-table bk-report">
            <thead>
              <tr>
                <th scope="col">{t('account')}</th>
                <th scope="col" className="num">
                  {t('bookBalance')}
                </th>
                <th scope="col" className="num">
                  {t('statementTotal')}
                </th>
                <th scope="col" className="num">
                  {t('toReconcile')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <Link href={`/app/books/banking/${r.id}`}>{r.name}</Link>
                  </th>
                  <td className="num">{m(r.bookBalance)}</td>
                  <td className="num">{m(r.statementTotal)}</td>
                  <td className="num">
                    {r.unmatched} · {m(r.unmatchedAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CashFlowView({ report, asOf }: { report: CashFlow; asOf: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  const row = (label: string, v: number, strong = false) => (
    <tr key={label}>
      <th scope="row" className={strong ? 'bk-strong' : undefined}>
        {label}
      </th>
      <td className="num data">{m(v)}</td>
    </tr>
  );
  return (
    <Shell kind="cash-flow" from={report.from} to={report.to} asOf={asOf} actions={<CsvLink kind="cash-flow" params={{ from: report.from, to: report.to }} />}>
      <div className="table-wrap bk-table-wrap">
        <table className="table bk-table bk-report">
          <tbody>
            {row(t('opening'), report.opening, true)}
            {report.inflows.map((x) => row(`+ ${t(`cashCat.${x.category}`)}`, x.amount))}
            {report.outflows.map((x) => row(`- ${t(`cashCat.${x.category}`)}`, -x.amount))}
            {row(t('netChange'), report.net, true)}
            {row(t('closing'), report.closing, true)}
          </tbody>
        </table>
      </div>
      <p className="ui-help">{t('cashHelp')}</p>
    </Shell>
  );
}

export function AgingView({ report, from, to }: { report: AgingReport; from: string; to: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => (v ? formatMoney(v, report.currency, locale) : '');
  const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
  const kind: ReportKind = report.kind === 'receivables' ? 'aged-receivables' : 'aged-payables';
  return (
    <Shell kind={kind} from={from} to={to} asOf={report.asOf} point actions={<CsvLink kind={kind} params={{ asOf: report.asOf }} />}>
      {report.rows.length === 0 ? (
        <EmptyState compact body={t('agingEmpty')} />
      ) : (
        <div className="table-wrap bk-table-wrap">
          <table className="table bk-table bk-report">
            <thead>
              <tr>
                <th scope="col">{t('contact')}</th>
                {buckets.map((b) => (
                  <th key={b} scope="col" className="num">
                    {t(`buckets.${b}`)}
                  </th>
                ))}
                <th scope="col" className="num">
                  {t('total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.contactId ?? 'none'}>
                  <th scope="row">{r.contactId ? <Link href={`/app/books/contacts/${r.contactId}`}>{r.contactName}</Link> : r.contactName || '-'}</th>
                  {buckets.map((b) => (
                    <td key={b} className="num">
                      {m(r.buckets[b])}
                    </td>
                  ))}
                  <td className="num data">{m(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('total')}</th>
                {buckets.map((b) => (
                  <td key={b} className="num data">
                    {m(report.totals[b])}
                  </td>
                ))}
                <td className="num data">{m(report.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

export function TaxView({ report, asOf }: { report: TaxReport; asOf: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  const csv = (book: 'sales' | 'purchases') => `/api/books/reports?kind=tax&format=csv&book=${book}&from=${report.from}&to=${report.to}`;
  return (
    <Shell
      kind="tax"
      from={report.from}
      to={report.to}
      asOf={asOf}
      actions={
        <>
          <a className="btn btn-secondary" href={csv('sales')} download>
            {t('csvSales')}
          </a>
          <a className="btn btn-secondary" href={csv('purchases')} download>
            {t('csvPurchases')}
          </a>
        </>
      }
    >
      <div className="bk-kpis">
        <Kpi label={t('salesTax')} value={m(report.totals.salesTax)} />
        <Kpi label={t('purchasesTax')} value={m(report.totals.purchasesTax)} />
        <Kpi label={t('payable')} value={m(report.totals.payable)} />
      </div>
      {report.rows.length === 0 ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <div className="table-wrap bk-table-wrap">
          <table className="table bk-table bk-report">
            <thead>
              <tr>
                <th scope="col">{t('rate')}</th>
                <th scope="col" className="num">
                  {t('salesNet')}
                </th>
                <th scope="col" className="num">
                  {t('salesTax')}
                </th>
                <th scope="col" className="num">
                  {t('purchasesNet')}
                </th>
                <th scope="col" className="num">
                  {t('purchasesTax')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={`${r.taxRateId}:${r.rateBps}`}>
                  <th scope="row">
                    {r.name} <span className="bk-rowmeta">{bpsToPercent(r.rateBps)}%</span>
                  </th>
                  <td className="num">{m(r.salesNet)}</td>
                  <td className="num">{m(r.salesTax)}</td>
                  <td className="num">{m(r.purchasesNet)}</td>
                  <td className="num">{m(r.purchasesTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ui-help">{t('taxHelp', { sales: report.sales.length, purchases: report.purchases.length })}</p>
    </Shell>
  );
}
