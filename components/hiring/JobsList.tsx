'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { JobListItem } from '@/lib/hiring/core';
import { JobStatusBadge } from './ui';

const STATUSES = ['', 'published', 'draft', 'closed', 'archived', 'all'] as const;

export default function JobsList({ initial, q, status }: { initial: JobListItem[]; q: string; status: string }) {
  const t = useTranslations('hiring');
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const go = (next: { q?: string; status?: string }) => {
    const sp = new URLSearchParams();
    const nq = next.q ?? query;
    const ns = next.status ?? status;
    if (nq.trim()) sp.set('q', nq.trim());
    if (ns) sp.set('status', ns);
    router.push(`/app/hiring/jobs${sp.size ? `?${sp}` : ''}`);
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    go({ q: query });
  };
  return (
    <div className="app-page ui-page hr-page">
      <PageHeader
        title={t('nav.jobs')}
        description={t('jobs.desc')}
        actions={
          <Link className="btn btn-primary" href="/app/hiring/jobs/new">
            {t('jobs.new')}
          </Link>
        }
      />
      <div className="hr-toolbar">
        <form onSubmit={search} role="search" className="hr-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('jobs.search')} aria-label={t('jobs.search')} />
        </form>
        <select className="select hr-filter" aria-label={t('jobs.statusFilter')} value={status} onChange={(e) => go({ status: e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === '' ? t('jobs.notArchived') : s === 'all' ? t('filters.all') : t(`jobStatus.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {initial.length === 0 ? (
        q || status ? (
          <EmptyState compact body={t('filters.noMatch')} />
        ) : (
          <EmptyState product="hiring" title={t('jobs.emptyTitle')} body={t('jobs.emptyBody')} action={{ label: t('jobs.new'), href: '/app/hiring/jobs/new' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table hr-table">
            <thead>
              <tr>
                <th scope="col">{t('jobs.colTitle')}</th>
                <th scope="col" className="hr-hide-sm">
                  {t('jobs.colLocation')}
                </th>
                <th scope="col">{t('jobs.colStatus')}</th>
                <th scope="col" className="num">
                  {t('jobs.colCandidates')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((j) => (
                <tr key={j.id}>
                  <th scope="row">
                    <Link href={`/app/hiring/jobs/${j.id}`} className="hr-rowlink">
                      <span className="hr-rowtitle">{j.title}</span>
                      <span className="hr-rowmeta">
                        {[j.department, j.myRole ? t(`roles.${j.myRole}`) : null].filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                  </th>
                  <td className="hr-hide-sm">{[j.location, t(`workplace.${j.workplace}`)].filter(Boolean).join(' · ')}</td>
                  <td>
                    <JobStatusBadge status={j.status} />
                  </td>
                  <td className="num">{j.activeCount ?? '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
