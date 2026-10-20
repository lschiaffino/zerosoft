import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { bookingDateBounds, getCalendarUser, localDate } from '@/lib/calendar';
import { computeBookingAnalytics, loadAnalyticsRows, parseAnalyticsRange } from '@/lib/calendar-analytics';
import { chartDateLabel, spansYears } from '@/lib/chart-dates';
import { formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LinkChartView from '@/components/link/LinkChartView';
import { formatTimezone } from '@/components/calendar/cal-utils';

export const dynamic = 'force-dynamic';

const PRESETS = [7, 30, 90] as const;

function percent(rate: number | null, locale: string): string {
  if (rate === null) return '–';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(rate);
}

/** Etiqueta de una hora del día (14 → "14:00" / "2 PM") en el formato del locale. */
function hourLabel(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, hour)));
}

/** Nombre corto del día de la semana (0 = domingo). */
function dayLabel(dow: number, locale: string, style: 'short' | 'long' = 'short'): string {
  // 2024-01-07 fue domingo.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + dow)));
}

export default async function CalendarAnalyticsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const calendarUser = await getCalendarUser(user.id);
  const timezone = calendarUser?.timezone || 'UTC';
  const weekStart = calendarUser?.week_start ?? 1;
  const today = localDate(new Date(), timezone);
  const range = parseAnalyticsRange(sp.from, sp.to, today);
  const bounds = await bookingDateBounds(user.id, range.fromDate, range.toDate);
  const rows =
    bounds.from && bounds.to ? await loadAnalyticsRows(user.id, bounds.from, bounds.to) : [];
  const a = computeBookingAnalytics(rows, { ...range, timezone });

  const presetFrom = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const kpis = [
    { key: 'created', label: t('analytics.created'), value: formatNumber(a.created, locale) },
    {
      key: 'cancelled',
      label: t('analytics.cancelled'),
      value: formatNumber(a.cancelled, locale),
      note: percent(a.cancelRate, locale),
    },
    {
      key: 'noShow',
      label: t('analytics.noShow'),
      value: formatNumber(a.noShow, locale),
      note: percent(a.noShowRate, locale),
    },
    { key: 'confirmed', label: t('analytics.confirmed'), value: formatNumber(a.confirmed, locale) },
  ];

  const withYear = spansYears(a.byDay.map((d) => d.date));
  const peak = a.byDay.reduce<{ date: string; count: number } | null>((best, d) => (!best || d.count > best.count ? d : best), null);
  const chartSummary =
    peak && a.created > 0
      ? t('analytics.chartSummary', { total: a.created, peak: peak.count, date: chartDateLabel(peak.date, locale, true) })
      : t('analytics.chartAria');

  // Filas del mapa de calor en el orden de la semana del workspace.
  const dows = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const max = Math.max(1, ...a.heatmap.flat());
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="ui-page cal-analytics">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.lead', { timezone: formatTimezone(timezone, locale) })}
      />

      <form className="cal-range" method="get" aria-label={t('analytics.range')}>
        <nav className="btn-group" aria-label={t('analytics.presets')}>
          {PRESETS.map((d) => {
            const active = range.toDate === today && range.fromDate === presetFrom(d);
            return (
              <a key={d} href={`?from=${presetFrom(d)}&to=${today}`} className="btn btn-sm" aria-current={active ? 'true' : undefined}>
                {t('analytics.lastDays', { days: d })}
              </a>
            );
          })}
        </nav>
        <div className="cal-range-custom">
          <div className="ui-field">
            <label className="label" htmlFor="cal-an-from">
              {t('analytics.from')}
            </label>
            <input id="cal-an-from" type="date" name="from" defaultValue={range.fromDate} max={today} className="input data" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cal-an-to">
              {t('analytics.to')}
            </label>
            <input id="cal-an-to" type="date" name="to" defaultValue={range.toDate} max={today} className="input data" />
          </div>
          <button type="submit" className="btn btn-secondary">
            {t('analytics.apply')}
          </button>
        </div>
      </form>

      <dl className="cal-counts">
        {kpis.map((k) => (
          <div key={k.key} className="cal-count">
            <dt>{k.label}</dt>
            <dd className="data">
              {k.value}
              {k.note && <span className="cal-count-note">{k.note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {a.created === 0 ? (
        <EmptyState quiet title={t('analytics.emptyTitle')} body={t('analytics.emptyBody')} />
      ) : (
        <>
          <section className="cal-block" aria-labelledby="cal-an-days">
            <div className="cal-block-head">
              <h2 id="cal-an-days" className="cal-block-title">
                {t('analytics.perDay')}
              </h2>
            </div>
            <LinkChartView
              counts={a.byDay.map((d) => d.count)}
              labels={a.byDay.map((d) => chartDateLabel(d.date, locale, withYear))}
              summary={chartSummary}
            />
          </section>

          <section className="cal-block" aria-labelledby="cal-an-times">
            <div className="cal-block-head">
              <h2 id="cal-an-times" className="cal-block-title">
                {t('analytics.popularTimes')}
              </h2>
            </div>
            <p className="ui-help">{t('analytics.popularTimesLead')}</p>
            {a.topSlots.length > 0 && (
              <ol className="cal-top-slots">
                {a.topSlots.map((s) => (
                  <li key={`${s.dow}-${s.hour}`}>
                    <span>
                      {dayLabel(s.dow, locale, 'long')} · <span className="data">{hourLabel(s.hour, locale)}</span>
                    </span>
                    <span className="data cal-muted">{t('analytics.bookingsN', { n: s.count })}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="cal-heat-wrap">
              <table className="cal-heat">
                <caption className="sr-only">{t('analytics.heatCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">{t('analytics.day')}</span>
                    </th>
                    {hours.map((h) => (
                      <th key={h} scope="col" className="data">
                        {h % 3 === 0 ? hourLabel(h, locale) : <span className="sr-only">{hourLabel(h, locale)}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dows.map((dow) => (
                    <tr key={dow}>
                      <th scope="row">{dayLabel(dow, locale)}</th>
                      {hours.map((h) => {
                        const n = a.heatmap[dow][h];
                        return (
                          <td
                            key={h}
                            className={n > 0 ? 'has' : undefined}
                            style={n > 0 ? ({ '--v': (0.15 + 0.85 * (n / max)).toFixed(2) } as React.CSSProperties) : undefined}
                            title={`${dayLabel(dow, locale, 'long')} ${hourLabel(h, locale)}: ${n}`}
                          >
                            <span className="sr-only">{n}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="cal-block" aria-labelledby="cal-an-types">
            <div className="cal-block-head">
              <h2 id="cal-an-types" className="cal-block-title">
                {t('analytics.byEventType')}
              </h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('analytics.eventType')}</th>
                    <th scope="col" className="num">
                      {t('analytics.created')}
                    </th>
                    <th scope="col" className="num">
                      {t('analytics.cancelled')}
                    </th>
                    <th scope="col" className="num">
                      {t('analytics.noShow')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {a.byEventType.map((e) => (
                    <tr key={e.id}>
                      <td>{e.title}</td>
                      <td className="num data" data-label={t('analytics.created')}>
                        {formatNumber(e.created, locale)}
                      </td>
                      <td className="num data" data-label={t('analytics.cancelled')}>
                        {formatNumber(e.cancelled, locale)}
                      </td>
                      <td className="num data" data-label={t('analytics.noShow')}>
                        {formatNumber(e.noShow, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ui-help">{t('analytics.note')}</p>
          </section>
        </>
      )}
    </div>
  );
}
