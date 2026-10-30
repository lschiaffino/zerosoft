'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { OrderListItem } from '@/lib/shop-orders';
import { StatusBadge, useDate, useMoney } from './shop-ui';

export default function OrdersList({ initial, total, currency, q, status }: { initial: OrderListItem[]; total: number; currency: string; q: string; status: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const date = useDate();
  const [query, setQuery] = useState(q);
  const search = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (query.trim()) p.set('q', query.trim());
    if (status) p.set('status', status);
    router.push(`/app/shop/orders${p.size ? `?${p}` : ''}`);
  };
  const statuses = ['', 'pending', 'paid', 'fulfilled', 'cancelled', 'refunded'];
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('nav.orders')} description={t('orders.desc')} />
      <div className="shop-toolbar">
        <form onSubmit={search} role="search" className="shop-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('orders.search')} aria-label={t('orders.search')} />
        </form>
        <div className="ui-tabs shop-filter" role="tablist" aria-label={t('orders.filter')}>
          {statuses.map((s) => (
            <Link
              key={s || 'all'}
              role="tab"
              aria-selected={status === s}
              className="ui-tab"
              href={`/app/shop/orders${s || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(s ? { status: s } : {}) })}` : ''}`}
            >
              {s ? t(`orderStatus.${s}`) : t('products.all')}
            </Link>
          ))}
        </div>
      </div>
      {initial.length === 0 ? (
        q || status ? (
          <EmptyState compact body={t('orders.noMatch')} />
        ) : (
          <EmptyState product="shop" title={t('orders.emptyTitle')} body={t('orders.emptyBody')} action={{ label: t('orders.setup'), href: '/app/shop' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <caption className="sr-only">{t('orders.caption', { n: total })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('orders.colOrder')}</th>
                <th scope="col" className="shop-hide-sm">
                  {t('orders.colDate')}
                </th>
                <th scope="col">{t('orders.colCustomer')}</th>
                <th scope="col">{t('orders.colStatus')}</th>
                <th scope="col" className="num">
                  {t('orders.colTotal')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((o) => (
                <tr key={o.id}>
                  <th scope="row">
                    <Link href={`/app/shop/orders/${o.id}`} className="data">
                      #{o.number}
                    </Link>
                  </th>
                  <td className="shop-hide-sm">{date(o.createdAt)}</td>
                  <td className="shop-ellipsis">{o.name || o.email}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="num">{money(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
