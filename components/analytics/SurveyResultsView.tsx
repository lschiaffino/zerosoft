'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { SurveyQuestionResult, SurveyResults } from '@/lib/analytics/more-types';
import type { SurveyDisplayStatus } from '@/lib/analytics/surveys-core';
import RangeSelect from './RangeSelect';
import { SurveyStatusBadge, SurveyTabs } from './SurveyStatusBadge';
import { api, fmtNumber, fmtPercent, fmtTime } from './client';

const DISPLAY_CAP = 600;

function Bar({ label, count, total, locale }: { label: string; count: number; total: number; locale: string }) {
  const pct = total ? count / total : 0;
  return (
    <li className="an-sv-bar">
      <span className="an-sv-bar-label" title={label}>
        {label}
      </span>
      <span className="an-sv-bar-track" aria-hidden="true">
        <span style={{ width: `${pct * 100}%` }} />
      </span>
      <span className="an-sv-bar-num">
        {fmtNumber(count, locale)} · {fmtPercent(pct, locale)}
      </span>
    </li>
  );
}

function OpenAnswers({ q, locale }: { q: Extract<SurveyQuestionResult, { type: 'open' }>; locale: string }) {
  const t = useTranslations('analyticsMore.results');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  if (!q.answers.length) return <p className="an-muted an-small">{t('noAnswers')}</p>;
  return (
    <div className="table-wrap table-stack">
      <table className="table an-table">
        <thead>
          <tr>
            <th scope="col">{t('answer')}</th>
            <th scope="col" className="an-nowrap">
              {t('person')}
            </th>
            <th scope="col" className="an-nowrap">
              {t('date')}
            </th>
          </tr>
        </thead>
        <tbody>
          {q.answers.map((a, i) => {
            const long = a.text.length > DISPLAY_CAP && !expanded.has(i);
            return (
              <tr key={i}>
                <td className="an-sv-answer">
                  {long ? `${a.text.slice(0, DISPLAY_CAP)}…` : a.text}
                  {long && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set(expanded).add(i))}>
                      {t('showMore')}
                    </button>
                  )}
                </td>
                <td className="an-mono an-muted an-sv-person" data-label={t('person')}>
                  {a.distinctId.slice(0, 80)}
                </td>
                <td className="an-muted an-nowrap" data-label={t('date')}>
                  {fmtTime(a.ts, locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QuestionResult({ q, index }: { q: SurveyQuestionResult; index: number }) {
  const t = useTranslations('analyticsMore.results');
  const locale = useLocale();
  return (
    <section className="an-panel an-form" aria-labelledby={`an-sv-r-${index}`}>
      <div>
        <h2 id={`an-sv-r-${index}`} className="an-h3">
          {q.text}
        </h2>
        <p className="an-note">
          {t('answered', { count: q.answered, formatted: fmtNumber(q.answered, locale) })}
          {q.invalid > 0 ? ` · ${t('invalid', { count: q.invalid })}` : ''}
        </p>
      </div>
      {q.type === 'rating' && (
        <>
          <div className="an-bignums">
            {q.average !== null && (
              <div className="an-bignum">
                <span className="an-bignum-value">{fmtNumber(q.average, locale)}</span>
                <span className="an-bignum-label">{t('average')}</span>
              </div>
            )}
            {q.scale === 10 && q.nps !== null && (
              <div className="an-bignum" data-testid="an-sv-nps">
                <span className="an-bignum-value">{q.nps}</span>
                <span className="an-bignum-label">{t('nps')}</span>
              </div>
            )}
          </div>
          <ul className="an-sv-bars" role="list">
            {q.distribution.map((count, i) => (
              <Bar key={i} label={String(i + 1)} count={count} total={q.answered} locale={locale} />
            ))}
          </ul>
          {q.scale === 10 && <p className="an-note">{t('npsBreakdown', { promoters: q.promoters, passives: q.passives, detractors: q.detractors })}</p>}
        </>
      )}
      {(q.type === 'single' || q.type === 'multiple') && (
        <ul className="an-sv-bars" role="list">
          {q.choices.map((c) => (
            <Bar key={c.label} label={c.label} count={c.count} total={q.answered} locale={locale} />
          ))}
        </ul>
      )}
      {q.type === 'open' && <OpenAnswers q={q} locale={locale} />}
    </section>
  );
}

/** Resultados: lo calcula el servidor de los eventos del período; las respuestas se muestran como texto. */
export default function SurveyResultsView({ id, name, status }: { id: string; name: string; status: SurveyDisplayStatus }) {
  const t = useTranslations('analyticsMore.results');
  const ts = useTranslations('analyticsMore.surveys');
  const locale = useLocale();
  const [range, setRange] = useState('-30d');
  const [data, setData] = useState<SurveyResults | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(false);
    api<{ results: SurveyResults }>(`/api/analytics/surveys/${id}/results?from=${encodeURIComponent(range)}`, { signal: ctl.signal })
      .then((r) => setData(r.results))
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [id, range]);

  const rate = data && data.shown ? data.sent / data.shown : null;

  return (
    <div className="app-page ui-page an-page" aria-busy={loading}>
      <PageHeader back={{ href: '/app/analytics/surveys', label: ts('title') }} title={name} description={<SurveyStatusBadge status={status} />} />
      <SurveyTabs id={id} current="results" />
      <div className="an-toolbar">
        <RangeSelect value={range} onChange={setRange} />
        {data && data.sent > 0 ? (
          <a className="btn btn-sm" href={`/api/analytics/surveys/${id}/export?from=${encodeURIComponent(range)}`} download data-testid="an-sv-export">
            {t('export')}
          </a>
        ) : (
          <button type="button" className="btn btn-sm" disabled title={t('exportEmpty')}>
            {t('export')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {!data && loading && <span className="ui-skeleton ui-skeleton-block" />}
      {data && (
        <>
          <div className="an-stats" data-testid="an-sv-stats">
            <div className="an-stat">
              <span className="an-stat-label">{t('shown')}</span>
              <span className="an-stat-value">{fmtNumber(data.shown, locale)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('sent')}</span>
              <span className="an-stat-value">{fmtNumber(data.sent, locale)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('dismissed')}</span>
              <span className="an-stat-value">{fmtNumber(data.dismissed, locale)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('rate')}</span>
              <span className="an-stat-value">{rate === null ? '–' : fmtPercent(rate, locale)}</span>
            </div>
          </div>
          <p className="an-note">{t('clientNote')}</p>
          {data.truncated && <p className="an-note">{t('truncated')}</p>}
          {data.sent === 0 ? <EmptyState product="analytics" title={t('emptyTitle')} body={t('emptyBody')} /> : data.questions.map((q, i) => <QuestionResult key={q.id} q={q} index={i} />)}
        </>
      )}
    </div>
  );
}
