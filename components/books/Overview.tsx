'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { DocSummary } from '@/lib/books-docs';
import { formatMoney } from '@/lib/books-money';
import { Kpi, StatusBadge, useDate } from './ui';

export interface OverviewData {
  currency: string;
  receivable: number;
  overdue: number;
  payable: number | null;
  payableOverdue: number | null;
  monthIncome: number | null;
  monthExpenses: number | null;
  monthProfit: number | null;
}

export default function BooksOverview({
  data,
  recent,
  setup,
  canWrite,
  showReports,
}: {
  data: OverviewData;
  recent: DocSummary[];
  setup: Array<{ key: string; done: boolean; href: string }>;
  canWrite: boolean;
  showReports: boolean;
}) {
  const t = useTranslations('books');
  const locale = useLocale();
  const date = useDate();
  const m = (v: number) => formatMoney(v, data.currency, locale);
  const pending = setup.filter((s) => !s.done).length;
  return (
    <div className="app-page ui-page bk-page">
      <PageHeader
        title={t('overview.title')}
        description={t('overview.desc')}
        actions={
          canWrite ? (
            <Link className="btn btn-primary" href="/app/books/invoices/new">
              {t('docs.invoice.new')}
            </Link>
          ) : undefined
        }
      />
      {pending > 0 && canWrite && (
        <section className="panel bk-panel" aria-labelledby="bk-setup">
          <h2 className="bk-panel-title" id="bk-setup">
            {t('overview.setupTitle', { n: pending })}
          </h2>
          <ol className="bk-steps">
            {setup.map((s) => (
              <li key={s.key} data-done={s.done || undefined}>
                <span aria-hidden="true" className="bk-step-mark">
                  {s.done ? '✓' : '○'}
                </span>
                {s.done ? <span>{t(`overview.setup.${s.key}`)}</span> : <Link href={s.href}>{t(`overview.setup.${s.key}`)}</Link>}
                {s.done && <span className="sr-only">{t('overview.done')}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="bk-kpis">
        <Kpi label={t('overview.receivable')} value={m(data.receivable)} />
        <Kpi label={t('overview.overdue')} value={m(data.overdue)} />
        {data.payable != null && <Kpi label={t('overview.payable')} value={m(data.payable)} />}
        {data.monthProfit != null && <Kpi label={t('overview.monthProfit')} value={m(data.monthProfit)} />}
      </div>
      {showReports && data.monthIncome != null && (
        <p className="ui-help">
          {t('overview.monthLine', { income: m(data.monthIncome), expenses: m(data.monthExpenses ?? 0) })} <Link href="/app/books/reports/pnl">{t('overview.openPnl')}</Link>
        </p>
      )}
      <section className="panel bk-panel" aria-labelledby="bk-recent">
        <div className="bk-panel-head">
          <h2 className="bk-panel-title" id="bk-recent">
            {t('overview.recent')}
          </h2>
          <Link href="/app/books/invoices">{t('overview.allInvoices')}</Link>
        </div>
        {recent.length === 0 ? (
          <p className="ui-help">{t('docs.invoice.emptyBody')}</p>
        ) : (
          <ul className="bk-list">
            {recent.map((d) => (
              <li key={d.id}>
                <Link href={`/app/books/invoices/${d.id}`} className="bk-ellipsis">
                  {d.reference || d.numberLabel || d.contactName || t('docs.untitled')}
                </Link>
                <span className="bk-rowmeta bk-ellipsis">{d.contactName}</span>
                <span className="bk-rowmeta">{date(d.issueDate)}</span>
                <StatusBadge status={d.status} />
                <span className="data">{formatMoney(d.total, d.currency, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
