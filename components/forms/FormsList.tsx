'use client';

import { useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { FormListItem } from '@/lib/forms/core';
import { StatusBadge } from './ui';

const STATUSES = ['', 'published', 'draft', 'closed'] as const;

export default function FormsList({ forms, q, status }: { forms: FormListItem[]; q: string; status: string }) {
  const t = useTranslations('forms');
  const format = useFormatter();
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const go = (next: { q?: string; status?: string }) => {
    const sp = new URLSearchParams();
    const nq = next.q ?? query;
    const ns = next.status ?? status;
    if (nq.trim()) sp.set('q', nq.trim());
    if (ns) sp.set('status', ns);
    router.push(`/app/forms${sp.size ? `?${sp}` : ''}`);
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    go({ q: query });
  };
  return (
    <div className="app-page ui-page fm-page">
      <PageHeader
        title={t('nav.forms')}
        description={t('list.desc')}
        actions={
          <Link className="btn btn-primary" href="/app/forms/new">
            {t('list.new')}
          </Link>
        }
      />
      <div className="fm-toolbar">
        <form onSubmit={search} role="search" className="fm-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} />
        </form>
        <select className="select fm-filter" aria-label={t('list.statusFilter')} value={status} onChange={(e) => go({ status: e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === '' ? t('list.allStatuses') : t(`status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {forms.length === 0 ? (
        q || status ? (
          <EmptyState compact body={t('list.noMatch')} />
        ) : (
          <EmptyState product="forms" title={t('list.emptyTitle')} body={t('list.emptyBody')} action={{ label: t('list.new'), href: '/app/forms/new' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table fm-table">
            <thead>
              <tr>
                <th scope="col">{t('list.colName')}</th>
                <th scope="col">{t('list.colStatus')}</th>
                <th scope="col" className="num">
                  {t('list.colResponses')}
                </th>
                <th scope="col" className="fm-hide-sm">
                  {t('list.colLast')}
                </th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id}>
                  <th scope="row">
                    <Link href={`/app/forms/${f.id}`} className="fm-rowlink">
                      <span className="fm-rowtitle">{f.name}</span>
                      <span className="fm-rowmeta">/f/{f.slug}</span>
                    </Link>
                  </th>
                  <td>
                    <StatusBadge status={f.status} open={f.open} />
                  </td>
                  <td className="num">
                    <Link href={`/app/forms/${f.id}/responses`} className="fm-count" aria-label={t('list.responsesOf', { name: f.name, n: f.responseCount })}>
                      {f.responseCount}
                    </Link>
                  </td>
                  <td className="fm-hide-sm fm-dim">{f.lastResponseAt ? format.relativeTime(new Date(f.lastResponseAt)) : '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
