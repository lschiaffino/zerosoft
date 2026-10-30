'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ApplicationListItem } from '@/lib/hiring/candidates';
import { AppStatusBadge, api, useDate, useToast } from './ui';
import BulkBar from './BulkBar';

interface Filters {
  q: string;
  job: string;
  status: string;
  source: string;
  tag: string;
  knockout: boolean;
}

const SOURCES = ['careers', 'referral', 'linkedin', 'manual', 'email', 'other'] as const;

export default function CandidatesList({
  initial,
  jobs,
  tags,
  templates,
  filters,
}: {
  initial: ApplicationListItem[];
  jobs: Array<{ id: string; title: string }>;
  tags: string[];
  templates: Array<{ id: string; name: string }>;
  filters: Filters;
}) {
  const t = useTranslations('hiring');
  const router = useRouter();
  const date = useDate();
  const [toast, push] = useToast();
  const [query, setQuery] = useState(filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stages, setStages] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    setSelected(new Set());
    if (!filters.job) return setStages(null);
    void api<{ stages: Array<{ id: string; name: string }> }>(`/api/hiring/jobs/${filters.job}`).then((r) => setStages(r.ok ? r.data.stages : null));
  }, [filters.job, initial]);

  const go = (patch: Partial<Filters>) => {
    const f = { ...filters, q: query, ...patch };
    const sp = new URLSearchParams();
    if (f.q.trim()) sp.set('q', f.q.trim());
    if (f.job) sp.set('job', f.job);
    if (f.status && f.status !== 'active') sp.set('status', f.status);
    if (f.source) sp.set('source', f.source);
    if (f.tag) sp.set('tag', f.tag);
    if (f.knockout) sp.set('knockout', '1');
    router.push(`/app/hiring/candidates${sp.size ? `?${sp}` : ''}`);
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    go({});
  };
  const filtered = Boolean(filters.q || filters.job || filters.source || filters.tag || filters.knockout || filters.status !== 'active');

  return (
    <div className="app-page ui-page hr-page">
      <PageHeader title={t('nav.candidates')} description={t('candidates.desc')} />
      <div className="hr-toolbar hr-filters">
        <form onSubmit={search} role="search" className="hr-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('candidates.search')} aria-label={t('candidates.search')} />
        </form>
        <select className="select hr-filter" aria-label={t('filters.job')} value={filters.job} onChange={(e) => go({ job: e.target.value })}>
          <option value="">{t('filters.allJobs')}</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
        <select className="select hr-filter" aria-label={t('filters.status')} value={filters.status} onChange={(e) => go({ status: e.target.value })}>
          {(['active', 'rejected', 'hired', 'all'] as const).map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? t('filters.all') : t(`appStatus.${s}`)}
            </option>
          ))}
        </select>
        <select className="select hr-filter" aria-label={t('filters.source')} value={filters.source} onChange={(e) => go({ source: e.target.value })}>
          <option value="">{t('filters.allSources')}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`sources.${s}`)}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select className="select hr-filter" aria-label={t('filters.tag')} value={filters.tag} onChange={(e) => go({ tag: e.target.value })}>
            <option value="">{t('filters.allTags')}</option>
            {tags.map((tg) => (
              <option key={tg} value={tg}>
                {tg}
              </option>
            ))}
          </select>
        )}
        <label className="ui-check">
          <input type="checkbox" checked={filters.knockout} onChange={(e) => go({ knockout: e.target.checked })} />
          {t('filters.knockout')}
        </label>
      </div>
      <BulkBar selected={[...selected]} stages={stages} templates={templates} onDone={() => router.refresh()} push={push} />
      {initial.length === 0 ? (
        filtered ? (
          <EmptyState compact body={t('filters.noMatch')} />
        ) : (
          <EmptyState product="hiring" title={t('candidates.emptyTitle')} body={t('candidates.emptyBody')} action={{ label: t('nav.jobs'), href: '/app/hiring/jobs' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table hr-table">
            <thead>
              <tr>
                <th scope="col" className="hr-check-col">
                  <label className="ui-check">
                    <input type="checkbox" aria-label={t('bulk.selectAll')} checked={selected.size > 0 && selected.size === initial.length} onChange={(e) => setSelected(e.target.checked ? new Set(initial.map((a) => a.id)) : new Set())} />
                  </label>
                </th>
                <th scope="col">{t('candidates.colName')}</th>
                <th scope="col">{t('candidates.colJob')}</th>
                <th scope="col" className="hr-hide-sm">
                  {t('candidates.colSource')}
                </th>
                <th scope="col" className="hr-hide-sm">
                  {t('candidates.colApplied')}
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((a) => (
                <tr key={a.id}>
                  <td className="hr-check-col">
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        aria-label={t('bulk.select', { name: a.name })}
                        checked={selected.has(a.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(a.id);
                            else n.delete(a.id);
                            return n;
                          })
                        }
                      />
                    </label>
                  </td>
                  <th scope="row">
                    <Link href={`/app/hiring/candidates/${a.candidateId}?app=${a.id}`} className="hr-rowlink">
                      <span className="hr-rowtitle">{a.name}</span>
                      <span className="hr-rowmeta">{[a.email, ...a.tags].join(' · ')}</span>
                    </Link>
                  </th>
                  <td>
                    <span className="hr-rowtitle">{a.jobTitle}</span>
                    <span className="hr-rowmeta">
                      {a.stageName} {a.status !== 'active' && <AppStatusBadge status={a.status} />}
                      {a.knockedOut && <span className="badge badge-warn hr-ml">{t('pipeline.knockout')}</span>}
                    </span>
                  </td>
                  <td className="hr-hide-sm">{t(`sources.${a.source}`)}</td>
                  <td className="hr-hide-sm">{date(a.createdAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toast}
    </div>
  );
}
