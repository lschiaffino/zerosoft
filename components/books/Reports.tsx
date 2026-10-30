'use client';

import { REPORT_KINDS, type ReportKind } from '@/lib/books-tabs';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { AgingReport, BalanceSheet, CashFlow, ProfitLoss, ReportLine, TaxReport } from '@/lib/books-reports';
import { bpsToPercent, formatMoney } from '@/lib/books-money';
import { Kpi } from './ui';

const KEY: Record<ReportKind, string> = {
  pnl: 'pnl',
  'balance-sheet': 'balance',
  'cash-flow': 'cashflow',
  'aged-receivables': 'agedReceivables',
  'aged-payables': 'agedPayables',
  tax: 'tax',
};

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

function Range({ kind, from, to, asOf, point }: { kind: ReportKind; from: string; to: string; asOf: string; point: boolean }) {
  const t = useTranslations('books.reports');
  const router = useRouter();
  const [a, setA] = useState(point ? asOf : from);
  const [b, setB] = useState(to);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/app/books/reports/${kind}?${point ? `asOf=${a}` : `from=${a}&to=${b}`}`);
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
      <button type="submit" className="btn btn-secondary">
        {t('update')}
      </button>
    </form>
  );
}

function Section({ title, lines, total, currency, totalLabel }: { title: string; lines: ReportLine[]; total: number; currency: string; totalLabel: string }) {
  const locale = useLocale();
  return (
    <section className="bk-section">
      <h2 className="bk-panel-title">{title}</h2>
      <div className="table-wrap bk-table-wrap">
        <table className="table bk-table bk-report">
          <tbody>
            {lines.map((l) => (
              <tr key={l.accountId}>
                <td className="data bk-code">{l.code}</td>
                <th scope="row">
                  <Link href={`/app/books/journal?account=${l.accountId}`}>{l.name}</Link>
                </th>
                <td className="num">{formatMoney(l.amount, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {totalLabel}
              </th>
              <td className="num data">{formatMoney(total, currency, locale)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Shell({ kind, children, from, to, asOf, point = false, actions }: { kind: ReportKind; children: ReactNode; from: string; to: string; asOf: string; point?: boolean; actions?: ReactNode }) {
  const t = useTranslations('books');
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader back={{ href: '/app/books/reports', label: t('nav.reports') }} title={t(`reports.${KEY[kind]}.title`)} description={t(`reports.${KEY[kind]}.desc`)} actions={actions} />
      <Range kind={kind} from={from} to={to} asOf={asOf} point={point} />
      {children}
    </div>
  );
}

export function ProfitLossView({ report, asOf }: { report: ProfitLoss; asOf: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  const empty = !report.income.length && !report.expenses.length && !report.costOfSales.length;
  return (
    <Shell kind="pnl" from={report.from} to={report.to} asOf={asOf}>
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
          <Section title={t('income')} lines={report.income} total={report.totalIncome} currency={report.currency} totalLabel={t('totalIncome')} />
          {report.costOfSales.length > 0 && <Section title={t('costOfSales')} lines={report.costOfSales} total={report.totalCostOfSales} currency={report.currency} totalLabel={t('totalCostOfSales')} />}
          <Section title={t('expenses')} lines={report.expenses} total={report.totalExpenses} currency={report.currency} totalLabel={t('totalExpenses')} />
          <p className="bk-total-line" data-testid="books-net-profit">
            <span>{t('netProfit')}</span>
            <span className="data">{m(report.netProfit)}</span>
          </p>
        </>
      )}
    </Shell>
  );
}

export function BalanceSheetView({ report, from, to }: { report: BalanceSheet; from: string; to: string }) {
  const t = useTranslations('books.reports');
  const locale = useLocale();
  const m = (v: number) => formatMoney(v, report.currency, locale);
  return (
    <Shell kind="balance-sheet" from={from} to={to} asOf={report.asOf} point>
      <Section title={t('assets')} lines={report.assets} total={report.totalAssets} currency={report.currency} totalLabel={t('totalAssets')} />
      <Section title={t('liabilities')} lines={report.liabilities} total={report.totalLiabilities} currency={report.currency} totalLabel={t('totalLiabilities')} />
      <Section
        title={t('equity')}
        lines={[...report.equity, { accountId: 'earnings', code: '', name: t('currentEarnings'), type: 'equity', subtype: 'equity', amount: report.currentEarnings }]}
        total={report.totalEquity}
        currency={report.currency}
        totalLabel={t('totalEquity')}
      />
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
    <Shell kind="cash-flow" from={report.from} to={report.to} asOf={asOf}>
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
    <Shell kind={kind} from={from} to={to} asOf={report.asOf} point>
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
