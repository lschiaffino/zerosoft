'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { WebResult } from '@/lib/analytics/types';
import Chart from './Chart';
import { bucketLabel, delta, fmtNumber, fmtPercent, runWebQuery } from './client';
import RangeSelect from './RangeSelect';

type TopKey = 'pages' | 'entries' | 'referrers' | 'utmSources' | 'countries' | 'devices' | 'browsers' | 'os';

function Stat({ label, value, previous, format, invert = false }: { label: string; value: number; previous: number | null; format: (n: number) => string; invert?: boolean }) {
  const t = useTranslations('analytics.web');
  const locale = useLocale();
  const d = delta(value, previous);
  const good = d === null ? null : invert ? d <= 0 : d >= 0;
  return (
    <div className="an-stat">
      <span className="an-stat-label">{label}</span>
      <span className="an-stat-value">{format(value)}</span>
      {d !== null && <span className={`an-delta ${good ? 'is-up' : 'is-down'}`}>{t('delta', { delta: `${d >= 0 ? '+' : ''}${fmtPercent(d, locale)}` })}</span>}
    </div>
  );
}

function TopTable({ title, rows, keyLabel, empty }: { title: string; rows: WebResult['pages']; keyLabel: string; empty: string }) {
  const t = useTranslations('analytics.web');
  const locale = useLocale();
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <section className="an-top" aria-label={title}>
      <h3 className="an-h3">{title}</h3>
      {rows.length === 0 ? (
        <p className="an-muted an-small">{empty}</p>
      ) : (
        <table className="table table-compact an-top-table">
          <thead>
            <tr>
              <th scope="col">{keyLabel}</th>
              <th scope="col" className="num">
                {t('visitors')}
              </th>
              <th scope="col" className="num">
                {t('views')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="an-top-key">
                  <span className="an-top-bar" style={{ width: `${(r.visitors / max) * 100}%` }} aria-hidden="true" />
                  <span className="an-top-text">{r.key === '(none)' ? t('none') : r.key === '$direct' ? t('direct') : r.key}</span>
                </td>
                <td className="num">{fmtNumber(r.visitors, locale)}</td>
                <td className="num">{fmtNumber(r.views, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Web analytics (como el tablero web de PostHog): visitantes, páginas, fuentes y dispositivos. */
export default function WebOverview({ projectId }: { projectId: string }) {
  const t = useTranslations('analytics.web');
  const locale = useLocale();
  const [range, setRange] = useState('-7d');
  const [data, setData] = useState<WebResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<{ sources: TopKey; devices: TopKey }>({ sources: 'referrers', devices: 'devices' });

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(false);
    runWebQuery(projectId, { kind: 'web', dateRange: { from: range }, compare: true }, ctl.signal)
      .then((r) => setData(r))
      .catch((err) => {
        if (!ctl.signal.aborted) setError(Boolean(err));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [projectId, range]);

  const n = (v: number) => fmtNumber(v, locale);
  const secs = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`);

  return (
    <div className="an-web" aria-busy={loading}>
      <div className="an-toolbar">
        <RangeSelect value={range} onChange={setRange} />
        <Link href="/app/analytics/events" className="an-link">
          {t('seeEvents')}
        </Link>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {!data && loading && <span className="ui-skeleton ui-skeleton-block" />}
      {data && (
        <>
          {data.stats.pageviews.value === 0 && (data.stats.pageviews.previous ?? 0) === 0 ? (
            <div className="an-callout">
              <p>{t('noData')}</p>
              <Link href="/app/analytics/settings" className="btn btn-sm btn-primary">
                {t('install')}
              </Link>
            </div>
          ) : null}
          <div className="an-stats">
            <Stat label={t('visitors')} value={data.stats.visitors.value} previous={data.stats.visitors.previous} format={n} />
            <Stat label={t('pageviews')} value={data.stats.pageviews.value} previous={data.stats.pageviews.previous} format={n} />
            <Stat label={t('sessions')} value={data.stats.sessions.value} previous={data.stats.sessions.previous} format={n} />
            <Stat label={t('bounceRate')} value={data.stats.bounceRate.value} previous={data.stats.bounceRate.previous} format={(v) => fmtPercent(v, locale)} invert />
            <Stat label={t('duration')} value={data.stats.avgDurationSec.value} previous={data.stats.avgDurationSec.previous} format={secs} />
          </div>
          <div className="an-panel">
            <Chart
              labels={data.buckets.map((b) => bucketLabel(b, locale))}
              series={[
                { label: t('visitors'), data: data.visitors },
                { label: t('pageviews'), data: data.pageviews },
              ]}
              summary={t('chartSummary', { visitors: n(data.stats.visitors.value), pageviews: n(data.stats.pageviews.value) })}
            />
          </div>
          <div className="an-tops">
            <TopTable title={t('pages')} rows={data.pages} keyLabel={t('path')} empty={t('emptyTable')} />
            <TopTable title={t('entries')} rows={data.entries} keyLabel={t('path')} empty={t('emptyTable')} />
            <div className="an-top-tabs">
              <div className="ui-tabs" role="tablist" aria-label={t('sources')}>
                {(['referrers', 'utmSources'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tabs.sources === k} className="ui-tab" onClick={() => setTabs((x) => ({ ...x, sources: k }))}>
                    {t(k)}
                  </button>
                ))}
              </div>
              <TopTable title={t(tabs.sources)} rows={data[tabs.sources]} keyLabel={t('source')} empty={t('emptyTable')} />
            </div>
            <TopTable title={t('countries')} rows={data.countries} keyLabel={t('country')} empty={t('emptyTable')} />
            <div className="an-top-tabs">
              <div className="ui-tabs" role="tablist" aria-label={t('tech')}>
                {(['devices', 'browsers', 'os'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tabs.devices === k} className="ui-tab" onClick={() => setTabs((x) => ({ ...x, devices: k }))}>
                    {t(k)}
                  </button>
                ))}
              </div>
              <TopTable title={t(tabs.devices)} rows={data[tabs.devices]} keyLabel={t('value')} empty={t('emptyTable')} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
