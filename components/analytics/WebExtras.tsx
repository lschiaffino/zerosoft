'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { VITAL_METRICS, type VitalMetric, type VitalRating, type VitalSummary, type VitalsResult, type WebFilter } from '@/lib/analytics/more-types';
import { api, fmtNumber } from './client';

const POLL_MS = 15_000;

/** Visitantes en los últimos 5 minutos. Pide de nuevo solo mientras la pestaña está visible. */
export function LiveVisitors({ projectId }: { projectId: string }) {
  const t = useTranslations('analyticsMore.web');
  const locale = useLocale();
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      timer = null;
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api<{ visitors: number }>(`/api/analytics/web-live?project=${encodeURIComponent(projectId)}`);
        if (alive) {
          setCount(r.visitors);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
      if (alive && !timer) timer = setTimeout(() => void tick(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !timer) void tick();
      else if (document.visibilityState !== 'visible' && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId]);

  return (
    <span className="an-web-live" role="status" data-testid="an-live-visitors">
      <i className={count ? 'is-on' : ''} aria-hidden="true" />
      {failed ? t('liveFailed') : count === null ? t('liveLoading') : t('liveNow', { count, formatted: fmtNumber(count, locale) })}
    </span>
  );
}

const RATING_CLASS: Record<VitalRating, string> = { good: 'badge badge-ok', needs_improvement: 'badge badge-warn', poor: 'badge badge-bad' };

export function fmtVital(metric: VitalMetric, v: number | null): string {
  if (v === null) return '–';
  if (metric === 'CLS') return v.toFixed(3);
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

function VitalCell({ s }: { s: VitalSummary }) {
  const t = useTranslations('analyticsMore.web');
  if (s.p75 === null || !s.rating) return <span className="an-muted">–</span>;
  return (
    <span className="an-vital-cell">
      <span className="an-mono">{fmtVital(s.metric, s.p75)}</span>
      <span className={RATING_CLASS[s.rating]}>{t(`rating.${s.rating}`)}</span>
    </span>
  );
}

/** Web vitals: p75 por métrica y por página. Si está apagado, se dice y se explica dónde prenderlo. */
export function WebVitalsPanel({ projectId, range, filters, enabled, canManage }: { projectId: string; range: string; filters: WebFilter[]; enabled: boolean; canManage: boolean }) {
  const t = useTranslations('analyticsMore.web');
  const locale = useLocale();
  const [data, setData] = useState<VitalsResult | null>(null);
  const [error, setError] = useState(false);
  const key = filters.map((f) => `${f.key}:${f.value}`).join('|');

  useEffect(() => {
    const ctl = new AbortController();
    setError(false);
    const params = new URLSearchParams({ project: projectId, from: range });
    for (const f of key ? key.split('|') : []) params.append('f', f);
    api<{ vitals: VitalsResult }>(`/api/analytics/web-vitals?${params.toString()}`, { signal: ctl.signal })
      .then((r) => setData(r.vitals))
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      });
    return () => ctl.abort();
  }, [projectId, range, key]);

  return (
    <section className="an-panel an-form" aria-labelledby="an-vitals-title" data-testid="an-vitals">
      <div>
        <h2 id="an-vitals-title" className="an-h3">
          {t('vitalsTitle')}
        </h2>
        <p className="an-note">{t('vitalsDesc')}</p>
      </div>
      {!enabled && (
        <div className="an-callout" data-testid="an-vitals-off">
          <p>{canManage ? t('vitalsOff') : t('vitalsOffMember')}</p>
          {canManage && (
            <Link href="/app/pulse/settings" className="btn btn-sm">
              {t('openSettings')}
            </Link>
          )}
        </div>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {t('vitalsError')}
        </p>
      )}
      {!data && !error && <span className="ui-skeleton ui-skeleton-row" />}
      {data && (
        <>
          <div className="an-stats">
            {data.metrics.map((m) => (
              <div key={m.metric} className="an-stat" data-testid={`an-vital-${m.metric}`}>
                <span className="an-stat-label" title={t(`metrics.${m.metric}`)}>
                  {m.metric} · {t('p75')}
                </span>
                <span className="an-stat-value">{fmtVital(m.metric, m.p75)}</span>
                {m.rating ? <span className={`${RATING_CLASS[m.rating]} an-vital-badge`}>{t(`rating.${m.rating}`)}</span> : <span className="an-small an-muted">{t('noSamples')}</span>}
              </div>
            ))}
          </div>
          {data.pages.length === 0 ? (
            <p className="an-muted an-small">{enabled ? t('vitalsEmpty') : t('vitalsEmptyOff')}</p>
          ) : (
            <div className="table-wrap table-stack">
              <table className="table an-list" data-testid="an-vitals-pages">
                <thead>
                  <tr>
                    <th scope="col">{t('page')}</th>
                    <th scope="col" className="num">
                      {t('samples')}
                    </th>
                    {VITAL_METRICS.map((m) => (
                      <th key={m} scope="col">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pages.map((p) => (
                    <tr key={p.path}>
                      <td className="an-vital-path" title={p.path}>
                        {p.path === '(none)' ? t('unknownPage') : p.path}
                      </td>
                      <td className="num" data-label={t('samples')}>
                        {fmtNumber(p.samples, locale)}
                      </td>
                      {p.metrics.map((s) => (
                        <td key={s.metric} data-label={s.metric}>
                          <VitalCell s={s} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.truncated && <p className="an-note">{t('vitalsTruncated')}</p>}
          <p className="an-note">{t('vitalsThresholds')}</p>
        </>
      )}
    </section>
  );
}
