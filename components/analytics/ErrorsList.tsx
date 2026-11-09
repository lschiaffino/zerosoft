'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import { ISSUE_FILTERS, issueRef, type IssueEffectiveStatus, type IssueFilter, type IssueListResult } from '@/lib/analytics/more-types';
import RangeSelect from './RangeSelect';
import { api, fmtNumber, fmtTime } from './client';

const STATUS_CLASS: Record<IssueEffectiveStatus, string> = {
  open: 'badge badge-warn',
  regression: 'badge badge-bad',
  resolved: 'badge badge-ok',
  ignored: 'badge badge-outline',
};

export function IssueStatusBadge({ status }: { status: IssueEffectiveStatus }) {
  const t = useTranslations('analyticsMore.errors.status');
  return <span className={STATUS_CLASS[status]}>{t(status)}</span>;
}

export function Sparkline({ data, label }: { data: number[]; label: string }) {
  const max = Math.max(1, ...data);
  const w = 96;
  const h = 24;
  const step = w / Math.max(1, data.length);
  return (
    <svg className="an-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} className="an-spark-base" />
      {data.map((v, i) => {
        if (!v) return null;
        const bar = Math.max(2, (v / max) * (h - 2));
        return <rect key={i} x={i * step + 0.5} y={h - bar} width={Math.max(1, step - 1)} height={bar} className="an-spark-bar" />;
      })}
    </svg>
  );
}

/** Errores agrupados por huella, con búsqueda, estado y rango. */
export default function ErrorsList({ projectId, captureOn, canManage }: { projectId: string; captureOn: boolean; canManage: boolean }) {
  const t = useTranslations('analyticsMore.errors');
  const locale = useLocale();
  const [range, setRange] = useState('-30d');
  const [status, setStatus] = useState<IssueFilter>('active');
  const [sort, setSort] = useState<'last' | 'count'>('last');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<IssueListResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ project: projectId, from: range, status, sort });
    if (query) params.set('q', query);
    api<IssueListResult>(`/api/analytics/errors?${params.toString()}`, { signal: ctl.signal })
      .then(setData)
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [projectId, range, status, sort, query]);

  const filtered = status !== 'active' || query !== '';
  const offCallout = !captureOn && (
    <div className="an-callout" data-testid="an-errors-off">
      <p>{canManage ? t('captureOff') : t('captureOffMember')}</p>
      {canManage && (
        <Link href="/app/pulse/settings" className="btn btn-sm">
          {t('openSettings')}
        </Link>
      )}
    </div>
  );

  return (
    <div className="app-page ui-page an-page" aria-busy={loading}>
      <PageHeader title={t('title')} description={t('description')} />
      {offCallout}
      <div className="an-toolbar">
        <input className="input an-search" type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />
        <select className="select" aria-label={t('statusLabel')} value={status} onChange={(e) => setStatus(e.target.value as IssueFilter)}>
          {ISSUE_FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`filters.${f}`)}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('sortLabel')} value={sort} onChange={(e) => setSort(e.target.value === 'count' ? 'count' : 'last')}>
          <option value="last">{t('sortLast')}</option>
          <option value="count">{t('sortCount')}</option>
        </select>
        <RangeSelect value={range} onChange={setRange} />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {!data && loading && <span className="ui-skeleton ui-skeleton-block" />}
      {data && data.issues.length === 0 && (filtered ? <p className="an-empty-result">{t('noMatch')}</p> : <EmptyState product="pulse" title={t('emptyTitle')} body={t('emptyBody')} />)}
      {data && data.issues.length > 0 && (
        <div className="table-wrap table-stack">
          <table className="table an-list" data-testid="an-list-errors">
            <thead>
              <tr>
                <th scope="col">{t('issue')}</th>
                <th scope="col">{t('statusLabel')}</th>
                <th scope="col" className="num">
                  {t('occurrences')}
                </th>
                <th scope="col" className="num">
                  {t('people')}
                </th>
                <th scope="col">{t('activity')}</th>
                <th scope="col">{t('firstSeen')}</th>
                <th scope="col">{t('lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((i) => (
                <tr key={i.fingerprint}>
                  <td className="an-issue-cell">
                    <Link href={`/app/pulse/errors/${issueRef(projectId, i.fingerprint)}`} className="an-row-link">
                      {i.type}
                    </Link>
                    {i.message && <span className="an-issue-msg">{i.message}</span>}
                  </td>
                  <td data-label={t('statusLabel')}>
                    <IssueStatusBadge status={i.status} />
                  </td>
                  <td className="num" data-label={t('occurrences')}>
                    {fmtNumber(i.occurrences, locale)}
                  </td>
                  <td className="num" data-label={t('people')}>
                    {fmtNumber(i.people, locale)}
                  </td>
                  <td data-label={t('activity')}>
                    <Sparkline data={i.spark} label={t('sparkLabel', { count: i.occurrences })} />
                  </td>
                  <td className="an-muted an-small an-nowrap" data-label={t('firstSeen')}>
                    {fmtTime(i.firstSeen, locale)}
                  </td>
                  <td className="an-muted an-small an-nowrap" data-label={t('lastSeen')}>
                    {fmtTime(i.lastSeen, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}
