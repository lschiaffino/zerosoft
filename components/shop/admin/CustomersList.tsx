'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { CustomerDto } from '@/lib/shop';
import { useMoney } from './shop-ui';

export default function CustomersList({ initial, currency, q, tag = '' }: { initial: CustomerDto[]; currency: string; q: string; tag?: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const [query, setQuery] = useState(q);
  const search = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/app/shop/customers${query.trim() || tag ? `?${new URLSearchParams({ ...(query.trim() ? { q: query.trim() } : {}), ...(tag ? { tag } : {}) })}` : ''}`);
  };
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader title={t('nav.customers')} description={t('customers.desc')} />
      {tag && (
        <p className="shop-note" data-testid="shop-tag-filter">
          {t('customers.filteredBy', { tag })} <Link href="/app/shop/customers">{t('customers.clearFilter')}</Link>
        </p>
      )}
      <div className="shop-toolbar">
        <form onSubmit={search} role="search" className="shop-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('customers.search')} aria-label={t('customers.search')} />
        </form>
      </div>
      {initial.length === 0 ? (
        q ? <EmptyState compact body={t('products.noMatch')} /> : <EmptyState product="shop" title={t('customers.emptyTitle')} body={t('customers.emptyBody')} />
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <thead>
              <tr>
                <th scope="col">{t('customers.colName')}</th>
                <th scope="col" className="num">
                  {t('customers.colOrders')}
                </th>
                <th scope="col" className="num">
                  {t('customers.colSpent')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link href={`/app/shop/customers/${c.id}`} className="shop-rowtext">
                      <span className="shop-rowtitle">{c.name || c.email}</span>
                      {c.name && <span className="shop-rowmeta">{c.email}</span>}
                    </Link>
                    {c.tags.length > 0 && (
                      <span className="shop-tags">
                        {c.tags.map((tag) => (
                          <Link key={tag} className="shop-tag" href={`/app/shop/customers?tag=${encodeURIComponent(tag)}`}>
                            {tag}
                          </Link>
                        ))}
                      </span>
                    )}
                  </th>
                  <td className="num">{c.ordersCount}</td>
                  <td className="num">{money(c.totalSpentCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
