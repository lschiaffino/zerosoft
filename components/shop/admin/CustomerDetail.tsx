'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { CustomerDto } from '@/lib/shop';
import type { OrderListItem } from '@/lib/shop-orders';
import { StatusBadge, useDate, useMoney } from './shop-ui';

export default function CustomerDetail({ customer, orders, currency }: { customer: CustomerDto; orders: OrderListItem[]; currency: string }) {
  const t = useTranslations('shop');
  const money = useMoney(currency);
  const date = useDate();
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader back={{ href: '/app/shop/customers', label: t('nav.customers') }} title={customer.name || customer.email} description={customer.email} />
      <div className="shop-kpis">
        <div className="shop-kpi">
          <span className="shop-kpi-label">{t('customers.colOrders')}</span>
          <span className="shop-kpi-value">{customer.ordersCount}</span>
        </div>
        <div className="shop-kpi">
          <span className="shop-kpi-label">{t('customers.colSpent')}</span>
          <span className="shop-kpi-value">{money(customer.totalSpentCents)}</span>
        </div>
        <div className="shop-kpi">
          <span className="shop-kpi-label">{t('customers.since')}</span>
          <span className="shop-kpi-value shop-kpi-small">{date(customer.createdAt, false)}</span>
        </div>
      </div>
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">{t('customers.contact')}</h2>
        <p>{customer.email}</p>
        {customer.phone && <p>{customer.phone}</p>}
        {customer.crmContactId ? (
          <p>
            <Link href={`/app/crm/contacts/${customer.crmContactId}`}>{t('customers.openCrm')}</Link>
          </p>
        ) : (
          <p className="ui-help">{t('customers.crmPending')}</p>
        )}
      </section>
      <section className="panel shop-panel">
        <h2 className="shop-panel-title">{t('nav.orders')}</h2>
        {orders.length === 0 ? (
          <p className="ui-help">{t('customers.noOrders')}</p>
        ) : (
          <ul className="shop-items">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/app/shop/orders/${o.id}`} className="data">
                  #{o.number}
                </Link>
                <span className="shop-rowmeta">{date(o.createdAt)}</span>
                <StatusBadge status={o.status} />
                <span className="data">{money(o.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
