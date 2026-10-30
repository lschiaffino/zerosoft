'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { InventoryRow, StoreDto } from '@/lib/shop';
import type { OrderListItem, ShopAnalytics } from '@/lib/shop-orders';
import { ShopKpis, SalesChart } from './AnalyticsView';
import { StatusBadge, useDate, useMoney } from './shop-ui';

/** Inicio de Shop: qué falta para vender, números de 30 días, últimos pedidos y stock bajo. */
export default function ShopOverview({
  store,
  analytics,
  orders,
  low,
  setup,
}: {
  store: StoreDto;
  analytics: ShopAnalytics;
  orders: OrderListItem[];
  low: InventoryRow[];
  setup: { products: number; shipping: number; payments: number; published: boolean };
}) {
  const t = useTranslations('shop');
  const money = useMoney(store.currency);
  const date = useDate();
  const steps = [
    { done: setup.products > 0, label: t('overview.stepProduct'), href: '/app/shop/products/new' },
    { done: setup.payments > 0, label: t('overview.stepPayments'), href: '/app/shop/settings?tab=payments' },
    { done: setup.shipping > 0, label: t('overview.stepShipping'), href: '/app/shop/settings?tab=shipping' },
    { done: setup.published, label: t('overview.stepPublish'), href: '/app/shop/settings?tab=store' },
  ];
  const pending = steps.filter((s) => !s.done).length;
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        title={store.name}
        description={store.published ? t('overview.live') : t('overview.notLive')}
        actions={
          <>
            {store.published && (
              <a className="btn btn-secondary" href={`/store/${store.handle}`} target="_blank" rel="noreferrer">
                {t('overview.viewStore')}
              </a>
            )}
            <Link className="btn btn-primary" href="/app/shop/products/new">
              {t('products.new')}
            </Link>
          </>
        }
      />
      {pending > 0 && (
        <section className="panel shop-panel shop-setup" aria-labelledby="shop-setup">
          <h2 className="shop-panel-title" id="shop-setup">
            {t('overview.setupTitle', { n: pending })}
          </h2>
          <ol className="shop-steps">
            {steps.map((s) => (
              <li key={s.href} data-done={s.done || undefined}>
                <span aria-hidden="true" className="shop-step-mark">
                  {s.done ? '✓' : '○'}
                </span>
                {s.done ? <span>{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
                {s.done && <span className="sr-only">{t('overview.done')}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <ShopKpis a={analytics} />
      {analytics.orders > 0 && (
        <section className="panel shop-panel">
          <h2 className="shop-panel-title">{t('analytics.salesOverTime')}</h2>
          <SalesChart a={analytics} />
        </section>
      )}
      <div className="shop-two">
        <section className="panel shop-panel" aria-labelledby="shop-recent">
          <div className="shop-panel-head">
            <h2 className="shop-panel-title" id="shop-recent">
              {t('overview.recentOrders')}
            </h2>
            <Link href="/app/shop/orders">{t('overview.allOrders')}</Link>
          </div>
          {orders.length === 0 ? (
            <p className="ui-help">{t('orders.emptyBody')}</p>
          ) : (
            <ul className="shop-items">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/app/shop/orders/${o.id}`} className="data">
                    #{o.number}
                  </Link>
                  <span className="shop-ellipsis">{o.name || o.email}</span>
                  <StatusBadge status={o.status} />
                  <span className="data">{money(o.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel shop-panel" aria-labelledby="shop-low">
          <div className="shop-panel-head">
            <h2 className="shop-panel-title" id="shop-low">
              {t('overview.lowStock')}
            </h2>
            <Link href="/app/shop/inventory?low=1">{t('nav.inventory')}</Link>
          </div>
          {low.length === 0 ? (
            <p className="ui-help">{t('inventory.noLow')}</p>
          ) : (
            <ul className="shop-items">
              {low.map((r) => (
                <li key={`${r.variantId}:${r.locationId}`}>
                  <Link href={`/app/shop/products/${r.productId}`}>{r.productTitle}</Link>
                  <span className="shop-rowmeta">{r.variantTitle !== 'Default' ? r.variantTitle : ''}</span>
                  <span className="data">{r.available - r.reserved}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="ui-help">{t('overview.since', { date: date(store.createdAt, false) })}</p>
    </div>
  );
}
