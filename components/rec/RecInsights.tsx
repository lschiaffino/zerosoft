'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import BreakdownBars from '@/components/link/BreakdownBars';
import LinkChartView from '@/components/link/LinkChartView';
import { breakdownLabelers } from '@/lib/link-labels';
import { chartDateLabel, spansYears } from '@/lib/chart-dates';
import { flagEmoji, rewatchPeaks, type RecAnalytics, type RecViewerRow } from '@/lib/rec-insights';
import { fmtClock } from '@/lib/rec-schema';
import { parseDbUtc } from '@/lib/utils';
import RecRetentionChart from './RecRetentionChart';

/** Tiempo visto total: "1:02:30" o "4:05". */
function fmtWatch(sec: number): string {
  return fmtClock(Math.max(0, Math.round(sec)));
}

/**
 * Pestaña Analítica de un video (solo quien lo administra): totales,
 * retención con re-vistas, vistas por día, de dónde y con qué lo vieron, y
 * quién lo vio, con su ubicación aproximada.
 */
export default function RecInsights({ stats, videoId, duration }: { stats: RecAnalytics; videoId: string; duration: number }) {
  const t = useTranslations('rec.insights');
  const td = useTranslations('rec.detail');
  const locale = useLocale();

  const labels = useMemo(
    () =>
      breakdownLabelers(locale, {
        direct: t('direct'),
        other: t('other'),
        unknown: t('unknown'),
        variantDefault: '',
        device: { desktop: t('desktop'), mobile: t('mobile'), tablet: t('tablet') },
        rule: (n) => n,
        ab: (n) => n,
        app: (n) => n,
      }),
    [locale, t],
  );
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);

  if (stats.views === 0) {
    return (
      <div className="rec-insights" data-testid="rec-insights-empty">
        <EmptyState compact title={t('noViewsTitle')} body={t('noViewsBody')} />
      </div>
    );
  }

  const place = (r: Pick<RecViewerRow, 'city' | 'country'>) => {
    if (!r.country) return '';
    const country = labels.country(r.country);
    return r.city ? `${r.city}, ${country}` : country;
  };
  const deviceText = (r: RecViewerRow) =>
    [r.device ? labels.device(r.device) : '', r.browser, r.os].filter(Boolean).join(' · ');
  const viewerName = (r: RecViewerRow) => r.name || t('viewerN', { n: r.viewerNo });

  const peaks = rewatchPeaks(stats.retention, stats.plays, stats.viewers.length);
  const peakIdx = stats.plays.reduce((best, v, i, all) => (v > all[best] ? i : best), 0);
  const n = stats.retention.length;
  const retentionSummary = t('retentionSummary', {
    start: stats.retention[0] ?? 0,
    end: stats.retention[n - 1] ?? 0,
    peak: fmtClock(n ? ((peakIdx + 0.5) / n) * duration : 0),
  });

  const withYear = spansYears(stats.days.map((d) => d.date));
  const daysTotal = stats.days.reduce((s, d) => s + d.count, 0);
  const peakDay = stats.days.reduce<RecAnalytics['days'][number] | null>((b, d) => (!b || d.count > b.count ? d : b), null);
  const daysSummary =
    peakDay && daysTotal > 0
      ? t('overTimeSummary', { total: daysTotal, date: chartDateLabel(peakDay.date, locale, true), peak: peakDay.count })
      : t('overTime');

  const hasPlace = stats.countries.some((c) => c.name !== 'unknown');

  return (
    <div className="rec-insights">
      <dl className="rec-stats">
        <div>
          <dt>{td('views')}</dt>
          <dd className="data">{stats.views}</dd>
        </div>
        <div>
          <dt>{td('unique')}</dt>
          <dd className="data">{stats.unique}</dd>
        </div>
        <div>
          <dt>{td('avgWatched')}</dt>
          <dd className="data">{stats.avgPct}%</dd>
        </div>
        <div>
          <dt>{td('completed')}</dt>
          <dd className="data">{stats.completed}</dd>
        </div>
        <div>
          <dt>{t('watchTime')}</dt>
          <dd className="data">{fmtWatch(stats.watchSec)}</dd>
        </div>
        <div>
          <dt>{td('ctaClicks')}</dt>
          <dd className="data">{stats.ctaClicks}</dd>
        </div>
      </dl>

      <section className="rec-ins-block" data-testid="rec-retention">
        <h3 className="rec-h">{t('retention')}</h3>
        <p className="ui-help">{t('retentionHelp')}</p>
        <RecRetentionChart retention={stats.retention} plays={stats.plays} unique={stats.viewers.length} duration={duration} peaks={peaks} summary={retentionSummary} />
      </section>

      <section className="rec-ins-block rec-ins-days" data-testid="rec-days">
        <h3 className="rec-h">{t('overTime')}</h3>
        <LinkChartView counts={stats.days.map((d) => d.count)} labels={stats.days.map((d) => chartDateLabel(d.date, locale, withYear))} summary={daysSummary} />
      </section>

      <div className="rec-ins-grid">
        <section className="rec-ins-block" data-testid="rec-countries">
          <h3 className="rec-h">{t('countries')}</h3>
          <BreakdownBars
            items={hasPlace ? stats.countries : []}
            emptyLabel={t('noLocation')}
            labelFor={(name) => {
              const flag = flagEmoji(name);
              return flag ? `${flag} ${labels.country(name)}` : labels.country(name);
            }}
          />
        </section>
        <section className="rec-ins-block" data-testid="rec-cities">
          <h3 className="rec-h">{t('cities')}</h3>
          <BreakdownBars items={stats.cities.some((c) => c.name !== 'unknown') ? stats.cities : []} emptyLabel={t('noLocation')} labelFor={labels.city} />
        </section>
        <section className="rec-ins-block" data-testid="rec-devices">
          <h3 className="rec-h">{t('devices')}</h3>
          <BreakdownBars items={stats.devices.some((c) => c.name !== 'unknown') ? stats.devices : []} emptyLabel={t('noData')} labelFor={labels.device} />
        </section>
        <section className="rec-ins-block" data-testid="rec-sources">
          <h3 className="rec-h">{t('sources')}</h3>
          <BreakdownBars items={stats.sources} emptyLabel={t('noData')} labelFor={labels.plain} />
        </section>
      </div>

      <section className="rec-ins-block">
        <h3 className="rec-h">{td('viewers')}</h3>
        <div className="table-wrap">
          <table className="table table-compact rec-viewers" data-testid="rec-viewers">
            <caption className="sr-only">{td('viewers')}</caption>
            <thead>
              <tr>
                <th scope="col">{td('viewer')}</th>
                <th scope="col">{t('location')}</th>
                <th scope="col" className="num">
                  {td('watched')}
                </th>
                <th scope="col" className="rec-col-wide">
                  {td('lastView')}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.viewers.map((r) => {
                const where = place(r);
                const flag = flagEmoji(r.country);
                const last = dateFmt.format(parseDbUtc(r.lastAt));
                return (
                  <tr key={r.viewerKey} data-testid="rec-viewer-row">
                    <td className="rec-vw-name">
                      <span className="rec-vw-title">
                        {viewerName(r)}
                        {r.signedIn && <span className="muted"> · {td('signedIn')}</span>}
                      </span>
                      {r.email && r.email !== r.name && <span className="rec-vw-sub muted">{r.email}</span>}
                      <span className="rec-vw-sub muted">
                        {[deviceText(r) || t('unknown'), r.referrer ? labels.plain(r.referrer) : t('direct')].join(' · ')}
                      </span>
                      <span className="rec-vw-sub rec-vw-narrow muted">{last}</span>
                    </td>
                    <td className="rec-vw-loc" title={r.region && where ? `${where} (${r.region})` : undefined}>
                      {where ? (
                        <>
                          {flag && (
                            <span className="rec-flag" aria-hidden="true">
                              {flag}
                            </span>
                          )}
                          {where}
                        </>
                      ) : (
                        <span className="muted">{t('unknown')}</span>
                      )}
                    </td>
                    <td className="num data">
                      <span className="rec-vw-pct">{r.pct}%</span>
                      <span className="rec-vw-time muted">{fmtWatch(r.watchedSec)}</span>
                    </td>
                    <td className="data rec-col-wide">
                      <span className="rec-vw-pct">{last}</span>
                      <span className="rec-vw-time muted">{t('viewsCount', { n: r.views })}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {stats.sampled !== null && <p className="ui-help">{t('sampled', { n: stats.sampled })}</p>}
        <p className="ui-help">{t('geoNote')}</p>
      </section>

      <div className="rec-pane-foot">
        <a className="btn btn-secondary btn-sm" href={`/api/rec/videos/${videoId}/analytics?format=csv`} download data-testid="rec-export-csv">
          {td('exportCsv')}
        </a>
      </div>
    </div>
  );
}
