'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { ReportRow, ShopReports } from '@/lib/shop-reports';
import { useMoney } from './shop-ui';

function Table({ id, title, rows, amountLabel, showQty, exportType, days, money, label }: { id: string; title: string; rows: ReportRow[]; amountLabel: string; showQty?: boolean; exportType?: string; days: number; money: (c: number) => string; label?: (r: ReportRow) => string }) {
  const t = useTranslations('shop');
  return (
    <section className="panel shop-panel" aria-labelledby={id} data-testid={`report-${id}`}>
      <div className="shop-panel-head">
        <h2 className="shop-panel-title" id={id}>{title}</h2>
        {exportType && rows.length > 0 && <a href={`/api/shop/reports/export?type=${exportType}&days=${days}`} className="btn btn-ghost btn-sm" download>{t('reports.exportCsv')}</a>}
      </div>
      {rows.length === 0 ? (
        <p className="ui-help">{t('reports.noData')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <thead>
              <tr>
                <th scope="col">{t('reports.colName')}</th>
                <th scope="col" className="num">{t('reports.colOrders')}</th>
                {showQty && <th scope="col" className="num">{t('reports.colUnits')}</th>}
                <th scope="col" className="num">{amountLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{label ? label(r) : r.label}</th>
                  <td className="num">{r.orders}</td>
                  {showQty && <td className="num">{r.quantity}</td>}
                  <td className="num">{money(r.salesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Reportes fijos del período, con CSV. Las exportaciones con datos personales son de admins. */
export default function ReportsView({ reports, currency, canAdmin }: { reports: ShopReports; currency: string; canAdmin: boolean }) {
  const t = useTranslations('shop');
  const money = useMoney(currency);
  const d = reports.days;
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        back={{ href: '/app/shop/analytics', label: t('nav.analytics') }}
        title={t('reports.title')}
        description={t('reports.desc')}
        actions={
          canAdmin ? (
            <>
              <a className="btn btn-secondary" href={`/api/shop/reports/export?type=orders&days=${d}`} download>{t('reports.exportOrders')}</a>
              <a className="btn btn-secondary" href="/api/shop/reports/export?type=customers" download>{t('reports.exportCustomers')}</a>
            </>
          ) : undefined
        }
      />
      <div className="ui-tabs shop-filter" role="tablist" aria-label={t('reports.period')}>
        {[7, 30, 90, 365].map((n) => (
          <Link key={n} role="tab" className="ui-tab" aria-selected={d === n} href={`/app/shop/reports?days=${n}`}>
            {t('analytics.days', { n })}
          </Link>
        ))}
      </div>
      {!canAdmin && <p className="ui-help shop-note">{t('reports.adminExports')}</p>}
      <Table id="by-product" title={t('reports.byProduct')} rows={reports.byProduct} amountLabel={t('reports.colSales')} showQty exportType="products" days={d} money={money} />
      <div className="shop-two">
        <Table id="by-payment" title={t('reports.byPayment')} rows={reports.byPayment} amountLabel={t('reports.colSales')} exportType="payments" days={d} money={money} label={(r) => (t.has(`order.method.${r.label}`) ? t(`order.method.${r.label}`) : r.label)} />
        <Table id="by-discount" title={t('reports.byDiscount')} rows={reports.byDiscount} amountLabel={t('reports.colDiscounted')} exportType="discounts" days={d} money={money} />
      </div>
      <Table id="by-day" title={t('reports.byDay')} rows={reports.byDay} amountLabel={t('reports.colSales')} exportType="days" days={d} money={money} />
      {canAdmin && <Table id="top-customers" title={t('reports.topCustomers')} rows={reports.topCustomers} amountLabel={t('reports.colSales')} days={d} money={money} />}
    </div>
  );
}
