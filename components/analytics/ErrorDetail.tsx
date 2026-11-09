'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { IssueDetail, IssueStatus } from '@/lib/analytics/more-types';
import Chart from './Chart';
import { IssueStatusBadge } from './ErrorsList';
import RangeSelect from './RangeSelect';
import { api, bucketLabel, fmtNumber, fmtTime, notifyChanged } from './client';

/** Un error: stack, apariciones, gráfico, personas, estado y responsable. */
export default function ErrorDetail({ refId, canEdit }: { refId: string; canEdit: boolean }) {
  const t = useTranslations('analyticsMore.errors');
  const locale = useLocale();
  const [range, setRange] = useState('-30d');
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; label: string }>>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(false);
    api<{ issue: IssueDetail; members: Array<{ id: string; label: string }> }>(`/api/analytics/errors/${encodeURIComponent(refId)}?from=${encodeURIComponent(range)}`, { signal: ctl.signal })
      .then((r) => {
        setIssue(r.issue);
        setMembers(r.members);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [refId, range]);

  const patch = async (body: { status?: IssueStatus; assigneeId?: string | null }) => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/errors/${encodeURIComponent(refId)}`, { method: 'PATCH', body });
      const r = await api<{ issue: IssueDetail }>(`/api/analytics/errors/${encodeURIComponent(refId)}?from=${encodeURIComponent(range)}`);
      setIssue(r.issue);
      setMsg(t('saved'));
      notifyChanged();
    } catch {
      setMsg(t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const back = { href: '/app/pulse/errors', label: t('title') };
  if (!issue) {
    return (
      <div className="app-page ui-page an-page" aria-busy={loading}>
        <PageHeader back={back} title={t('title')} />
        {error ? (
          <p className="ui-error" role="alert">
            {t('error')}
          </p>
        ) : (
          <span className="ui-skeleton ui-skeleton-block" />
        )}
      </div>
    );
  }
  const n = (v: number) => fmtNumber(v, locale);
  const statusValue: string = issue.status;
  return (
    <div className="app-page ui-page an-page" aria-busy={loading}>
      <PageHeader back={back} title={issue.type} description={<span className="an-issue-title-msg">{issue.message || t('noMessage')}</span>} />
      <section className="an-panel an-issue-controls" aria-label={t('manage')}>
        <div className="an-row an-wrap">
          <IssueStatusBadge status={issue.status} />
          {issue.status === 'regression' && <span className="an-note">{t('regressionHelp')}</span>}
        </div>
        <div className="an-toolbar">
          <label className="an-inline-field">
            <span className="label">{t('statusLabel')}</span>
            <select className="select" value={statusValue} disabled={!canEdit || busy} data-testid="an-issue-status" onChange={(e) => void patch({ status: e.target.value as IssueStatus })}>
              {issue.status === 'regression' && (
                <option value="regression" disabled>
                  {t('status.regression')}
                </option>
              )}
              <option value="open">{t('status.open')}</option>
              <option value="resolved">{t('status.resolved')}</option>
              <option value="ignored">{t('status.ignored')}</option>
            </select>
          </label>
          <label className="an-inline-field">
            <span className="label">{t('assignee')}</span>
            <select
              className="select"
              value={issue.assigneeId ?? ''}
              disabled={!canEdit || busy}
              data-testid="an-issue-assignee"
              onChange={(e) => void patch({ assigneeId: e.target.value || null })}
            >
              <option value="">{t('unassigned')}</option>
              {issue.assigneeId && !members.some((m) => m.id === issue.assigneeId) && <option value={issue.assigneeId}>{t('formerMember')}</option>}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="an-inline-field">
            <span className="label">{t('rangeLabel')}</span>
            <RangeSelect value={range} onChange={setRange} />
          </label>
        </div>
        <p className="an-note" role="status">
          {msg ?? t('assigneeHelp')}
        </p>
      </section>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      <div className="an-stats">
        <div className="an-stat">
          <span className="an-stat-label">{t('occurrences')}</span>
          <span className="an-stat-value" data-testid="an-issue-occurrences">
            {n(issue.occurrences)}
          </span>
        </div>
        <div className="an-stat">
          <span className="an-stat-label">{t('people')}</span>
          <span className="an-stat-value">{n(issue.people)}</span>
        </div>
        <div className="an-stat">
          <span className="an-stat-label">{t('firstSeen')}</span>
          <span className="an-issue-date">{issue.firstSeen ? fmtTime(issue.firstSeen, locale) : '–'}</span>
        </div>
        <div className="an-stat">
          <span className="an-stat-label">{t('lastSeen')}</span>
          <span className="an-issue-date">{issue.lastSeen ? fmtTime(issue.lastSeen, locale) : '–'}</span>
        </div>
      </div>
      <div className="an-panel">
        <Chart kind="bar" labels={issue.buckets.map((b) => bucketLabel(b, locale))} series={[{ label: t('occurrences'), data: issue.series }]} summary={t('chartSummary', { count: issue.occurrences })} height={180} />
      </div>
      <section className="an-panel an-form" aria-labelledby="an-issue-stack">
        <h2 id="an-issue-stack" className="an-h3">
          {t('stack')}
        </h2>
        {issue.frames.length ? (
          <ol className="an-frames" data-testid="an-issue-frames">
            {issue.frames.map((f, i) => (
              <li key={i}>
                <span className="an-frame-fn">{f.function || t('anonymous')}</span>
                <span className="an-frame-file">
                  {f.file}
                  {f.line !== null ? `:${f.line}` : ''}
                  {f.column !== null ? `:${f.column}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="an-muted an-small">{t('noStack')}</p>
        )}
        <p className="an-note">{t('sourceMapsNote')}</p>
      </section>
      <div className="an-tops">
        <section className="an-panel an-form" aria-labelledby="an-issue-recent">
          <h2 id="an-issue-recent" className="an-h3">
            {t('recent')}
          </h2>
          {issue.recent.length === 0 ? (
            <p className="an-muted an-small">{t('noneInRange')}</p>
          ) : (
            <ul className="an-occ-list" role="list">
              {issue.recent.map((o) => (
                <li key={o.id}>
                  <span className="an-small">{fmtTime(o.ts, locale)}</span>
                  <span className="an-muted an-small an-occ-url" title={o.url ?? undefined}>
                    {o.url ?? t('noUrl')}
                  </span>
                  <span className="an-muted an-small">{[o.browser, o.os].filter(Boolean).join(' · ') || t('noDevice')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="an-panel an-form" aria-labelledby="an-issue-people">
          <h2 id="an-issue-people" className="an-h3">
            {t('affected')}
          </h2>
          {issue.topPeople.length === 0 ? (
            <p className="an-muted an-small">{t('noneInRange')}</p>
          ) : (
            <ul className="an-occ-list" role="list">
              {issue.topPeople.map((p) => (
                <li key={p.key} className="an-occ-person">
                  {p.personId ? (
                    <Link href={`/app/pulse/persons/${p.personId}`} className="an-link an-mono an-occ-url">
                      {p.key}
                    </Link>
                  ) : (
                    <span className="an-mono an-occ-url">{p.key}</span>
                  )}
                  <span className="an-mono an-small">{n(p.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
