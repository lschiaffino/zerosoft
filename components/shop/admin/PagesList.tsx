'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ShopPageDto } from '@/lib/shop-pages';
import { useDate } from './shop-ui';

/** Páginas de contenido y artículos del blog de la tienda. */
export default function PagesList({ initial, q, storeHandle, published }: { initial: ShopPageDto[]; q: string; storeHandle: string; published: boolean }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const date = useDate();
  const [query, setQuery] = useState(q);
  const search = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/app/shop/pages${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  };
  return (
    <div className="app-page ui-page shop-page">
      <PageHeader
        title={t('pages.title')}
        description={t('pages.desc')}
        actions={
          <>
            <Link className="btn btn-secondary" href="/app/shop/pages/new?kind=article">{t('pages.newArticle')}</Link>
            <Link className="btn btn-primary" href="/app/shop/pages/new">{t('pages.newPage')}</Link>
          </>
        }
      />
      <div className="shop-toolbar">
        <form onSubmit={search} role="search" className="shop-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('pages.search')} aria-label={t('pages.search')} />
        </form>
      </div>
      {initial.length === 0 ? (
        q ? <EmptyState compact body={t('products.noMatch')} /> : <EmptyState product="shop" title={t('pages.emptyTitle')} body={t('pages.emptyBody')} action={{ label: t('pages.newPage'), href: '/app/shop/pages/new' }} />
      ) : (
        <div className="table-wrap table-stack">
          <table className="table shop-table" data-testid="pages-table">
            <thead>
              <tr>
                <th scope="col">{t('pages.colTitle')}</th>
                <th scope="col">{t('pages.colKind')}</th>
                <th scope="col">{t('pages.colState')}</th>
                <th scope="col">{t('pages.colUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/app/shop/pages/${p.id}`} className="shop-rowtext">
                      <span className="shop-rowtitle">{p.title}</span>
                      <span className="shop-rowmeta">/{p.kind === 'article' ? 'blog' : 'pages'}/{p.handle}</span>
                    </Link>
                  </th>
                  <td data-label={t('pages.colKind')}>{t(`pages.kind.${p.kind}`)}</td>
                  <td data-label={t('pages.colState')}>
                    <span className={`badge ${p.published ? 'badge-ok' : 'badge-outline'}`}>{p.published ? t('pages.published') : t('pages.hidden')}</span>
                  </td>
                  <td data-label={t('pages.colUpdated')}>{date(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!published && initial.length > 0 && <p className="ui-help shop-note">{t('pages.storeClosed')}</p>}
      {published && initial.length > 0 && (
        <p className="ui-help shop-note">
          <a href={`/store/${storeHandle}`} target="_blank" rel="noreferrer">{t('order.viewStore')}</a>
        </p>
      )}
    </div>
  );
}
