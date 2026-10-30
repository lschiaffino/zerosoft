'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { CollectionDto } from '@/lib/shop';

export default function CollectionsList({ initial, q }: { initial: CollectionDto[]; q: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const search = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/app/shop/collections${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  };
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        title={t('nav.collections')}
        description={t('collections.desc')}
        actions={
          <Link className="btn btn-primary" href="/app/shop/collections/new">
            {t('collections.new')}
          </Link>
        }
      />
      <div className="shop-toolbar">
        <form onSubmit={search} role="search" className="shop-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('collections.search')} aria-label={t('collections.search')} />
        </form>
      </div>
      {initial.length === 0 ? (
        q ? (
          <EmptyState compact body={t('products.noMatch')} />
        ) : (
          <EmptyState product="shop" title={t('collections.emptyTitle')} body={t('collections.emptyBody')} action={{ label: t('collections.new'), href: '/app/shop/collections/new' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table shop-table">
            <thead>
              <tr>
                <th scope="col">{t('collections.colTitle')}</th>
                <th scope="col">{t('collections.colKind')}</th>
                <th scope="col" className="num">
                  {t('collections.colProducts')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link href={`/app/shop/collections/${c.id}`} className="shop-rowlink">
                      <span className="shop-rowtext">
                        <span className="shop-rowtitle">{c.title}</span>
                        <span className="shop-rowmeta">
                          {c.published ? t('collections.published') : t('collections.hidden')}
                          {c.featured ? ` · ${t('collections.featured')}` : ''}
                        </span>
                      </span>
                    </Link>
                  </th>
                  <td>{c.kind === 'auto' ? t('collections.auto') : t('collections.manual')}</td>
                  <td className="num">{c.productCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
