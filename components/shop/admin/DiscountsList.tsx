'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { DiscountDto } from '@/lib/shop';
import { useDate, useMoney } from './shop-ui';

export function discountSummary(d: Pick<DiscountDto, 'kind' | 'value' | 'minOrderCents'>, t: (k: string, v?: Record<string, string | number>) => string, money: (c: number) => string): string {
  const what = d.kind === 'percent' ? t('discounts.percentOff', { n: d.value / 100 }) : d.kind === 'fixed' ? t('discounts.fixedOff', { amount: money(d.value) }) : t('discounts.freeShipping');
  return d.minOrderCents > 0 ? `${what} · ${t('discounts.minOrder', { amount: money(d.minOrderCents) })}` : what;
}

export default function DiscountsList({ initial, currency, q }: { initial: DiscountDto[]; currency: string; q: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const money = useMoney(currency);
  const date = useDate();
  const [query, setQuery] = useState(q);
  const search = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/app/shop/discounts${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  };
  const state = (d: DiscountDto) => {
    const now = Date.now();
    const end = d.endsAt ? Date.parse(`${d.endsAt.replace(' ', 'T')}Z`) : null;
    const start = d.startsAt ? Date.parse(`${d.startsAt.replace(' ', 'T')}Z`) : null;
    if (!d.active) return t('discounts.stateOff');
    if (end != null && now > end) return t('discounts.stateExpired');
    if (start != null && now < start) return t('discounts.stateScheduled');
    if (d.usageLimit != null && d.usedCount >= d.usageLimit) return t('discounts.stateUsedUp');
    return t('discounts.stateActive');
  };
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        title={t('nav.discounts')}
        description={t('discounts.desc')}
        actions={
          <Link className="btn btn-primary" href="/app/shop/discounts/new">
            {t('discounts.new')}
          </Link>
        }
      />
      <div className="shop-toolbar">
        <form onSubmit={search} role="search" className="shop-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('discounts.search')} aria-label={t('discounts.search')} />
        </form>
      </div>
      {initial.length === 0 ? (
        q ? (
          <EmptyState compact body={t('products.noMatch')} />
        ) : (
          <EmptyState product="shop" title={t('discounts.emptyTitle')} body={t('discounts.emptyBody')} action={{ label: t('discounts.new'), href: '/app/shop/discounts/new' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <thead>
              <tr>
                <th scope="col">{t('discounts.colCode')}</th>
                <th scope="col">{t('discounts.colStatus')}</th>
                <th scope="col" className="num">
                  {t('discounts.colUsed')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((d) => (
                <tr key={d.id}>
                  <th scope="row">
                    <Link href={`/app/shop/discounts/${d.id}`} className="shop-rowtext">
                      <span className="shop-rowtitle data">{d.code}</span>
                      <span className="shop-rowmeta">
                        {discountSummary(d, t, money)}
                        {d.endsAt ? ` · ${t('discounts.until', { date: date(d.endsAt, false) })}` : ''}
                      </span>
                    </Link>
                  </th>
                  <td>{state(d)}</td>
                  <td className="num">
                    {d.usedCount}
                    {d.usageLimit != null ? ` / ${d.usageLimit}` : ''}
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
