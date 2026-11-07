'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { DocumentListItem } from '@/lib/send/core';
import { useDate } from './ui';

/** Documentos: lista, búsqueda y quién está leyendo ahora. */
export default function SendHome({ items, q }: { items: DocumentListItem[]; q: string }) {
  const t = useTranslations('send');
  const router = useRouter();
  const date = useDate();
  const [query, setQuery] = useState(q);
  const search = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/app/send${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  };
  return (
    <div className="app-page ui-page sd-page">
      <PageHeader
        title={t('home.title')}
        description={t('home.desc')}
        actions={
          <Link className="btn btn-primary" href="/app/send/new" data-testid="send-new">
            {t('nav.new')}
          </Link>
        }
      />
      {(items.length > 0 || q) && (
        <form onSubmit={search} role="search" className="sd-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('home.search')} aria-label={t('home.search')} />
        </form>
      )}
      {items.length === 0 ? (
        q ? (
          <EmptyState compact body={t('home.noMatch')} />
        ) : (
          <EmptyState product="send" title={t('home.emptyTitle')} body={t('home.emptyBody')} action={{ label: t('nav.new'), href: '/app/send/new' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table sd-table">
            <thead>
              <tr>
                <th scope="col">{t('home.colTitle')}</th>
                <th scope="col" className="num">
                  {t('home.colLinks')}
                </th>
                <th scope="col" className="num">
                  {t('home.colVisits')}
                </th>
                <th scope="col" className="sd-hide-sm">
                  {t('home.colLast')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} data-testid="send-doc-row">
                  <th scope="row">
                    <Link href={`/app/send/documents/${d.id}`} className="sd-rowlink">
                      <span className="sd-rowtitle">{d.title}</span>
                      <span className="sd-rowmeta">
                        {d.kind ? t(`kind.${d.kind}`) : ''}
                        {d.kind && d.kind !== 'video' && d.pageCount > 0 ? ` · ${t('home.pages', { count: d.pageCount })}` : ''}
                        {d.status === 'processing' || d.status === 'uploading' ? ` · ${t('status.processing')}` : ''}
                        {d.status === 'failed' ? ` · ${t('status.failed')}` : ''}
                        {d.sharing === 'workspace' ? ` · ${t('home.shared')}` : ''}
                      </span>
                    </Link>
                    {d.live > 0 && (
                      <span className="sd-live" data-testid="send-doc-live">
                        <i aria-hidden="true" />
                        {t('live.count', { count: d.live })}
                      </span>
                    )}
                  </th>
                  <td className="num">{d.links}</td>
                  <td className="num">{d.visits}</td>
                  <td className="sd-hide-sm">{d.lastVisitAt ? date(d.lastVisitAt) : t('home.never')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
