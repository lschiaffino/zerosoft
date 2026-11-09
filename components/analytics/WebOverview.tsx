'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { CHANNEL_KEYS, WEB_FILTER_KEYS, type ChannelKey, type WebFilter, type WebFilterKey } from '@/lib/analytics/more-types';
import type { WebResult } from '@/lib/analytics/types';
import Chart from './Chart';
import { bucketLabel, delta, fmtNumber, fmtPercent, runWebQuery } from './client';
import RangeSelect, { RANGES } from './RangeSelect';
import { LiveVisitors, WebVitalsPanel } from './WebExtras';

type TopKey = 'pages' | 'entries' | 'hosts' | 'referrers' | 'utmSources' | 'countries' | 'devices' | 'browsers' | 'os' | 'channels';

/** Cada tabla, a qué filtro de la página lleva su fila. */
const FILTER_OF: Record<TopKey, WebFilterKey> = {
  pages: 'path',
  entries: 'path',
  hosts: 'host',
  referrers: 'referrer',
  utmSources: 'utm',
  countries: 'country',
  devices: 'device',
  browsers: 'browser',
  os: 'os',
  channels: 'channel',
};

function Stat({ label, value, previous, format, invert = false }: { label: string; value: number; previous: number | null; format: (n: number) => string; invert?: boolean }) {
  const t = useTranslations('analytics.web');
  const more = useTranslations('analyticsMore.web');
  const locale = useLocale();
  const d = delta(value, previous);
  const good = d === null ? null : invert ? d <= 0 : d >= 0;
  return (
    <div className="an-stat">
      <span className="an-stat-label">{label}</span>
      <span className="an-stat-value">{format(value)}</span>
      {d !== null ? (
        <span className={`an-delta ${good ? 'is-up' : 'is-down'}`}>{t('delta', { delta: `${d >= 0 ? '+' : ''}${fmtPercent(d, locale)}` })}</span>
      ) : (
        <span className="an-small an-muted">{more('noPrevious')}</span>
      )}
    </div>
  );
}

function TopTable({
  title,
  rows,
  keyLabel,
  empty,
  kind,
  filters,
  onToggle,
  display,
}: {
  title: string;
  rows: WebResult['pages'];
  keyLabel: string;
  empty: string;
  kind: TopKey;
  filters: WebFilter[];
  onToggle: (key: WebFilterKey, value: string) => void;
  display?: (key: string) => string;
}) {
  const t = useTranslations('analytics.web');
  const more = useTranslations('analyticsMore.web');
  const locale = useLocale();
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  const filterKey = FILTER_OF[kind];
  return (
    <section className="an-top" aria-label={title} data-testid={`an-top-${kind}`}>
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
            {rows.map((r) => {
              const text = display ? display(r.key) : r.key === '(none)' ? t('none') : r.key === '$direct' ? t('direct') : r.key;
              const active = filters.some((f) => f.key === filterKey && f.value === r.key);
              return (
                <tr key={r.key}>
                  <td className="an-top-key">
                    <span className="an-top-bar" style={{ width: `${(r.visitors / max) * 100}%` }} aria-hidden="true" />
                    <button type="button" className="an-top-filter" aria-pressed={active} title={more('filterBy', { value: text })} onClick={() => onToggle(filterKey, r.key)}>
                      {text}
                    </button>
                  </td>
                  <td className="num">{fmtNumber(r.visitors, locale)}</td>
                  <td className="num">{fmtNumber(r.views, locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Web analytics (como el tablero web de PostHog): visitantes, páginas, fuentes y dispositivos, filtrable tocando una fila. */
export default function WebOverview({ projectId, webVitals = false, canManage = false }: { projectId: string; webVitals?: boolean; canManage?: boolean }) {
  const t = useTranslations('analytics.web');
  const more = useTranslations('analyticsMore.web');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const rawRange = search.get('range');
  const range = RANGES.includes(rawRange as (typeof RANGES)[number]) ? (rawRange as string) : '-7d';
  const searchKey = search.toString();
  const filters = useMemo<WebFilter[]>(() => {
    const sp = new URLSearchParams(searchKey);
    const out: WebFilter[] = [];
    for (const key of WEB_FILTER_KEYS) {
      const value = sp.get(key);
      if (value) out.push({ key, value: value.slice(0, 500) });
    }
    return out;
  }, [searchKey]);
  const [data, setData] = useState<WebResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<{ pages: 'pages' | 'hosts'; sources: 'referrers' | 'utmSources'; devices: 'devices' | 'browsers' | 'os' }>({ pages: 'pages', sources: 'referrers', devices: 'devices' });

  const setParams = useCallback(
    (change: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchKey);
      change(sp);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchKey],
  );
  const toggleFilter = useCallback(
    (key: WebFilterKey, value: string) =>
      setParams((sp) => {
        if (sp.get(key) === value) sp.delete(key);
        else sp.set(key, value);
      }),
    [setParams],
  );

  const filterKey = filters.map((f) => `${f.key}:${f.value}`).join('|');
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(false);
    runWebQuery(projectId, { kind: 'web', dateRange: { from: range }, compare: true, filters: filterKey ? filterKey.split('|').map(splitFilter) : undefined }, ctl.signal)
      .then((r) => setData(r))
      .catch((err) => {
        if (!ctl.signal.aborted) setError(Boolean(err));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [projectId, range, filterKey]);

  const n = (v: number) => fmtNumber(v, locale);
  const secs = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`);
  const channelLabel = (k: string) => (CHANNEL_KEYS.includes(k as ChannelKey) ? more(`channels.${k as ChannelKey}`) : k);
  const chipValue = (f: WebFilter) => {
    if (f.key === 'channel') return channelLabel(f.value);
    if (f.value === '(none)') return t('none');
    if (f.value === '$direct') return t('direct');
    return f.value;
  };
  const tableProps = { filters, onToggle: toggleFilter, empty: filters.length ? more('emptyFiltered') : t('emptyTable') };
  const nothing = data !== null && data.stats.pageviews.value === 0 && (data.stats.pageviews.previous ?? 0) === 0;

  return (
    <div className="an-web" aria-busy={loading}>
      <div className="an-toolbar">
        <RangeSelect value={range} onChange={(v) => setParams((sp) => (v === '-7d' ? sp.delete('range') : sp.set('range', v)))} />
        <LiveVisitors projectId={projectId} />
        <Link href="/app/pulse/events" className="an-link">
          {t('seeEvents')}
        </Link>
      </div>
      {filters.length > 0 && (
        <div className="an-chips" role="group" aria-label={more('filtersLabel')} data-testid="an-web-chips">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="an-chip"
              aria-label={more('removeFilter', { name: more(`filterKeys.${f.key}`), value: chipValue(f) })}
              onClick={() => setParams((sp) => sp.delete(f.key))}
            >
              <span className="an-chip-text">
                {more(`filterKeys.${f.key}`)}: {chipValue(f)}
              </span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
          {filters.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams((sp) => filters.forEach((f) => sp.delete(f.key)))}>
              {more('clearFilters')}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {!data && loading && <span className="ui-skeleton ui-skeleton-block" />}
      {data && (
        <>
          {nothing &&
            (filters.length > 0 ? (
              <div className="an-callout">
                <p>{more('noDataFiltered')}</p>
              </div>
            ) : data.hasPageviews ? (
              <div className="an-callout">
                <p>{more('noDataPeriod')}</p>
              </div>
            ) : (
              <div className="an-callout">
                <p>{t('noData')}</p>
                <Link href="/app/pulse/settings" className="btn btn-sm btn-primary">
                  {t('install')}
                </Link>
              </div>
            ))}
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
          <p className="an-note">{more('filterHint')}</p>
          <div className="an-tops">
            <div className="an-top-tabs">
              <div className="ui-tabs" role="tablist" aria-label={t('pages')}>
                {(['pages', 'hosts'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tabs.pages === k} className="ui-tab" onClick={() => setTabs((x) => ({ ...x, pages: k }))}>
                    {k === 'pages' ? t('pages') : more('hosts')}
                  </button>
                ))}
              </div>
              {tabs.pages === 'pages' ? (
                <TopTable title={t('pages')} rows={data.pages} keyLabel={t('path')} kind="pages" {...tableProps} />
              ) : (
                <TopTable title={more('hosts')} rows={data.hosts} keyLabel={more('host')} kind="hosts" {...tableProps} />
              )}
            </div>
            <TopTable title={t('entries')} rows={data.entries} keyLabel={t('path')} kind="entries" {...tableProps} />
            <TopTable title={more('channelsTitle')} rows={data.channels} keyLabel={more('channel')} kind="channels" display={channelLabel} {...tableProps} />
            <div className="an-top-tabs">
              <div className="ui-tabs" role="tablist" aria-label={t('sources')}>
                {(['referrers', 'utmSources'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tabs.sources === k} className="ui-tab" onClick={() => setTabs((x) => ({ ...x, sources: k }))}>
                    {t(k)}
                  </button>
                ))}
              </div>
              <TopTable title={t(tabs.sources)} rows={data[tabs.sources]} keyLabel={t('source')} kind={tabs.sources} {...tableProps} />
            </div>
            <TopTable title={t('countries')} rows={data.countries} keyLabel={t('country')} kind="countries" {...tableProps} />
            <div className="an-top-tabs">
              <div className="ui-tabs" role="tablist" aria-label={t('tech')}>
                {(['devices', 'browsers', 'os'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tabs.devices === k} className="ui-tab" onClick={() => setTabs((x) => ({ ...x, devices: k }))}>
                    {t(k)}
                  </button>
                ))}
              </div>
              <TopTable title={t(tabs.devices)} rows={data[tabs.devices]} keyLabel={t('value')} kind={tabs.devices} {...tableProps} />
            </div>
          </div>
          <WebVitalsPanel projectId={projectId} range={range} filters={filters} enabled={webVitals} canManage={canManage} />
        </>
      )}
    </div>
  );
}

function splitFilter(raw: string): WebFilter {
  const at = raw.indexOf(':');
  return { key: raw.slice(0, at) as WebFilterKey, value: raw.slice(at + 1) };
}
