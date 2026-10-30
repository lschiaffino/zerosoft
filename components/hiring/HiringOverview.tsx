'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { JobListItem } from '@/lib/hiring/core';
import type { ApplicationListItem } from '@/lib/hiring/candidates';
import type { PendingEvaluation } from '@/lib/hiring/evaluation';
import { useDate } from './ui';

export default function HiringOverview({
  jobs,
  pending,
  recent,
  careersUrl,
  published,
}: {
  jobs: JobListItem[];
  pending: PendingEvaluation[];
  recent: ApplicationListItem[];
  careersUrl: string;
  published: boolean;
}) {
  const t = useTranslations('hiring');
  const date = useDate();
  return (
    <div className="app-page ui-page hr-page">
      <PageHeader
        title={t('nav.home')}
        description={t('overview.desc')}
        actions={
          <>
            {published && (
              <a className="btn btn-secondary" href={careersUrl} target="_blank" rel="noreferrer">
                {t('overview.careers')}
              </a>
            )}
            <Link className="btn btn-primary" href="/app/hiring/jobs/new">
              {t('jobs.new')}
            </Link>
          </>
        }
      />
      <div className="hr-overview">
        <section className="panel" aria-labelledby="hr-open-jobs">
          <h2 id="hr-open-jobs" className="hr-panel-title">
            {t('overview.openJobs')}
          </h2>
          {jobs.length === 0 ? (
            <EmptyState compact quiet body={t('overview.noOpenJobs')} action={{ label: t('jobs.new'), href: '/app/hiring/jobs/new' }} />
          ) : (
            <ul className="hr-list">
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/app/hiring/jobs/${j.id}`} className="hr-list-row">
                    <span className="hr-list-main">{j.title}</span>
                    <span className="hr-list-meta">
                      {[j.department, j.location].filter(Boolean).join(' · ')}
                      {j.activeCount != null && ` · ${t('jobs.activeCount', { count: j.activeCount })}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel" aria-labelledby="hr-pending">
          <h2 id="hr-pending" className="hr-panel-title">
            {t('overview.pending')}
          </h2>
          {pending.length === 0 ? (
            <p className="ui-help">{t('overview.noPending')}</p>
          ) : (
            <ul className="hr-list">
              {pending.map((p) => (
                <li key={p.applicationId}>
                  <Link href={`/app/hiring/candidates/${p.candidateId}?app=${p.applicationId}`} className="hr-list-row">
                    <span className="hr-list-main">{p.candidateName}</span>
                    <span className="hr-list-meta">
                      {p.jobTitle} · {p.stageName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel hr-span-2" aria-labelledby="hr-recent">
          <h2 id="hr-recent" className="hr-panel-title">
            {t('overview.recent')}
          </h2>
          {recent.length === 0 ? (
            <p className="ui-help">{t('overview.noRecent')}</p>
          ) : (
            <ul className="hr-list">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link href={`/app/hiring/candidates/${a.candidateId}?app=${a.id}`} className="hr-list-row">
                    <span className="hr-list-main">{a.name}</span>
                    <span className="hr-list-meta">
                      {a.jobTitle} · {a.stageName} · {date(a.stageChangedAt, false)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="ui-help hr-ai-note">{t('overview.aiNote')}</p>
    </div>
  );
}
