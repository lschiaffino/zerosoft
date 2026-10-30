'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { ShopAnalytics } from '@/lib/shop-orders';
import { useDate, useMoney } from './shop-ui';

/** KPIs: ventas, pedidos, ticket promedio y conversión. */
export function ShopKpis({ a }: { a: ShopAnalytics }) {
  const t = useTranslations('shop.analytics');
  const money = useMoney(a.currency);
  return (
    <div className="shop-kpis" data-testid="shop-kpis">
      <div className="shop-kpi">
        <span className="shop-kpi-label">{t('sales')}</span>
        <span className="shop-kpi-value">{money(a.salesCents)}</span>
      </div>
      <div className="shop-kpi">
        <span className="shop-kpi-label">{t('orders')}</span>
        <span className="shop-kpi-value">{a.orders}</span>
      </div>
      <div className="shop-kpi">
        <span className="shop-kpi-label">{t('aov')}</span>
        <span className="shop-kpi-value">{money(a.aovCents)}</span>
      </div>
      <div className="shop-kpi">
        <span className="shop-kpi-label">{t('conversion')}</span>
        <span className="shop-kpi-value">{a.conversion == null ? t('noVisits') : `${(a.conversion * 100).toFixed(1)}%`}</span>
      </div>
    </div>
  );
}

/** Ventas por día en barras (sin librería: una barra por día, título con el valor). */
export function SalesChart({ a }: { a: ShopAnalytics }) {
  const t = useTranslations('shop.analytics');
  const money = useMoney(a.currency);
  const date = useDate();
  const max = Math.max(1, ...a.series.map((d) => d.salesCents));
  return (
    <figure className="shop-chart" aria-label={t('chartLabel', { days: a.days })}>
      <div className="shop-bars">
        {a.series.map((d) => (
          <span key={d.day} className="shop-bar" style={{ height: `${Math.max(2, (d.salesCents / max) * 100)}%` }} title={`${date(d.day, false)}: ${money(d.salesCents)} · ${d.orders}`} />
        ))}
      </div>
      <figcaption className="shop-chart-cap">
        <span>{date(a.series[0]?.day ?? '', false)}</span>
        <span>{date(a.series[a.series.length - 1]?.day ?? '', false)}</span>
      </figcaption>
    </figure>
  );
}

export default function AnalyticsView({ analytics }: { analytics: ShopAnalytics }) {
  const t = useTranslations('shop');
  const money = useMoney(analytics.currency);
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('nav.analytics')} description={t('analytics.desc')} />
      <div className="ui-tabs shop-filter" role="tablist" aria-label={t('analytics.range')}>
        {[7, 30, 90, 365].map((d) => (
          <Link key={d} role="tab" className="ui-tab" aria-selected={analytics.days === d} href={`/app/shop/analytics?days=${d}`}>
            {t('analytics.days', { n: d })}
          </Link>
        ))}
      </div>
      <ShopKpis a={analytics} />
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">{t('analytics.salesOverTime')}</h2>
        {analytics.orders === 0 ? <p className="ui-help">{t('analytics.empty')}</p> : <SalesChart a={analytics} />}
      </section>
      <div className="shop-two">
        <section className="panel shop-panel">
          <h2 className="shop-panel-title">{t('analytics.topProducts')}</h2>
          {analytics.topProducts.length === 0 ? (
            <p className="ui-help">{t('analytics.empty')}</p>
          ) : (
            <ol className="shop-rank">
              {analytics.topProducts.map((p) => (
                <li key={p.productId ?? p.title}>
                  {p.productId ? <Link href={`/app/shop/products/${p.productId}`}>{p.title}</Link> : p.title}
                  <span className="data">
                    {p.quantity} · {money(p.salesCents)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="panel shop-panel">
          <h2 className="shop-panel-title">{t('analytics.funnel')}</h2>
          <dl className="shop-totals">
            <dt>{t('analytics.visits')}</dt>
            <dd>{analytics.views}</dd>
            <dt>{t('analytics.checkouts')}</dt>
            <dd>{analytics.checkouts}</dd>
            <dt>{t('analytics.paidOrders')}</dt>
            <dd>{analytics.orders}</dd>
          </dl>
          <p className="ui-help">{t('analytics.funnelHelp')}</p>
        </section>
      </div>
    </div>
  );
}
