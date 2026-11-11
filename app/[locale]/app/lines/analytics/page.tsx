import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { analyticsFilterOptions, cachedLinesAnalytics } from '@/lib/groups-analytics';
import { ANALYTICS_PERIODS, ANALYTICS_TABS, ANALYTICS_TZ_COOKIE, analyticsTab, isDay, isEmptyData, validTz, type AnalyticsTab } from '@/lib/groups-analytics-shared';
import { pageViewer } from '@/lib/groups-page';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { TimeZoneSync } from '@/components/groups/analytics/charts';
import { AnalyticsView, type Fmt } from '@/components/groups/analytics/views';
import '@/styles/lines-analytics.css';

export const dynamic = 'force-dynamic';

type Search = { tab?: string; days?: string; from?: string; to?: string; label?: string; number?: string; agent?: string };

function safeDecode(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return undefined;
  }
}

/**
 * Reportes de Lines: un tablero con pestañas (?tab=). Cada pestaña carga solo
 * sus datos, con lo que la persona puede ver (lib/groups-analytics.ts).
 */
export default async function LinesAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const viewer = await pageViewer(user);
  const tz = validTz(safeDecode((await cookies()).get(ANALYTICS_TZ_COOKIE)?.value));
  const tab = analyticsTab(sp.tab);
  const days = (ANALYTICS_PERIODS as readonly number[]).includes(Number(sp.days)) ? Number(sp.days) : 30;
  const options = await analyticsFilterOptions(user.id, viewer);

  const day = (v?: string) => (isDay(v) ? v : undefined);
  // Rango invertido ("hasta" antes de "desde"): no se aplica y se avisa, en vez de cambiar la fecha en silencio.
  const inverted = Boolean(day(sp.from) && day(sp.to) && (day(sp.to) as string) < (day(sp.from) as string));
  const filters = {
    from: inverted ? undefined : day(sp.from),
    to: inverted ? undefined : day(sp.to),
    // Solo ids que la persona puede elegir: una línea que no ve no se filtra (ni se consulta).
    labelId: options.labels.some((l) => l.id === sp.label) ? sp.label : undefined,
    numberId: options.numbers.some((n) => n.id === sp.number) ? sp.number : undefined,
    agentId: options.people.some((p) => p.id === sp.agent) ? sp.agent : undefined,
  };
  const custom = Boolean(filters.from);
  const filtered = custom || Boolean(filters.labelId || filters.numberId || filters.agentId);
  const data = await cachedLinesAnalytics(user.id, viewer, tab, { days, tz, ...filters }, options);
  const range = data.range;

  const query = (extra: Record<string, string | undefined>, opts: { keepRange?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (tab !== 'overview') q.set('tab', tab);
    if (opts.keepRange !== false) {
      if (custom) {
        q.set('from', range.from);
        q.set('to', range.to);
      } else if (days !== 30) q.set('days', String(days));
    }
    if (filters.labelId) q.set('label', filters.labelId);
    if (filters.numberId) q.set('number', filters.numberId);
    if (filters.agentId) q.set('agent', filters.agentId);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  };
  const href = (extra: Record<string, string | undefined>, opts?: { keepRange?: boolean }) => `/app/lines/analytics${query(extra, opts)}`;

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: range.tz });
  const f: Fmt = {
    t: (key, values) => t(key as never, values as never),
    locale,
    num: (v) => number.format(v),
    dur: (min) => {
      if (min == null) return '—';
      if (min < 60) return t('time.minLong', { n: number.format(min) });
      if (min < 1440) return t('time.hoursLong', { n: number.format(Math.round((min / 60) * 10) / 10) });
      return t('time.daysLong', { n: number.format(Math.round((min / 1440) * 10) / 10) });
    },
    day: (d) => dayFmt.format(new Date(`${d}T00:00:00Z`)),
    dateTime: (iso) => {
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? dateTimeFmt.format(new Date(ms)) : '—';
    },
  };
  const empty = isEmptyData(data);
  const tabLabel = (k: AnalyticsTab) => t(`analytics.tabs.${k}`);

  return (
    <div className="ui-page la">
      <TimeZoneSync serverTz={range.tz} />
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.desc')}
        actions={
          <div className="la-head-actions">
            <nav className="gr-periods" aria-label={t('analytics.period')}>
              {ANALYTICS_PERIODS.map((p) => (
                <Link
                  key={p}
                  href={href({ days: p === 30 ? undefined : String(p) }, { keepRange: false })}
                  className={`btn btn-sm ${!custom && p === days ? 'btn-primary' : 'btn-secondary'}`}
                  aria-current={!custom && p === days ? 'page' : undefined}
                >
                  {t('analytics.days', { n: p })}
                </Link>
              ))}
            </nav>
            <a className="btn btn-sm btn-ghost" href={`/api/groups/analytics${query({ tab })}`} download>
              {t('analytics.exportCsv')}
            </a>
          </div>
        }
      />
      <form className="gr-report-filters" method="get" action={`/${locale}/app/lines/analytics`} aria-label={t('analytics.filters')}>
        <label className="ui-field">
          <span className="label">{t('analytics.from')}</span>
          <input
            className="input"
            type="date"
            name="from"
            defaultValue={inverted ? day(sp.from) : custom ? range.from : ''}
            aria-invalid={inverted || undefined}
            aria-describedby={inverted ? 'gr-range-error' : undefined}
          />
        </label>
        <label className="ui-field">
          <span className="label">{t('analytics.to')}</span>
          <input
            className="input"
            type="date"
            name="to"
            defaultValue={inverted ? day(sp.to) : custom ? range.to : ''}
            aria-invalid={inverted || undefined}
            aria-describedby={inverted ? 'gr-range-error' : undefined}
          />
        </label>
        {options.numbers.length > 1 && (
          <label className="ui-field">
            <span className="label">{t('analytics.number')}</span>
            <select className="select" name="number" defaultValue={filters.numberId ?? ''}>
              <option value="">{t('analytics.allNumbers')}</option>
              {options.numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {options.people.length > 1 && (
          <label className="ui-field">
            <span className="label">{t('analytics.agent')}</span>
            <select className="select" name="agent" defaultValue={filters.agentId ?? ''}>
              <option value="">{t('analytics.allAgents')}</option>
              {options.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ui-field">
          <span className="label">{t('inbox.label')}</span>
          <select className="select" name="label" defaultValue={filters.labelId ?? ''}>
            <option value="">{t('inbox.labelAll')}</option>
            {options.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {tab !== 'overview' && <input type="hidden" name="tab" value={tab} />}
        {!custom && days !== 30 && <input type="hidden" name="days" value={days} />}
        <div className="gr-report-actions">
          <button type="submit" className="btn btn-secondary btn-sm">
            {t('analytics.apply')}
          </button>
          {filtered && (
            <Link href={tab === 'overview' ? '/app/lines/analytics' : `/app/lines/analytics?tab=${tab}`} className="btn btn-ghost btn-sm">
              {t('list.clear')}
            </Link>
          )}
        </div>
      </form>
      {inverted && (
        <p className="ui-error" role="alert" id="gr-range-error">
          {t('analytics.rangeInverted')}
        </p>
      )}
      <nav className="ui-tabs" aria-label={t('analytics.tabsLabel')}>
        {ANALYTICS_TABS.map((k) => (
          <Link key={k} href={href({ tab: k === 'overview' ? undefined : k })} className="ui-tab" aria-current={k === tab ? 'page' : undefined} scroll={false}>
            {tabLabel(k)}
          </Link>
        ))}
      </nav>
      <p className="la-range" role="status">
        <strong>{t('analytics.showing', { from: range.from, to: range.to })}</strong>
        <span>{t('analytics.compare', { n: range.days, from: range.prevFrom, to: range.prevTo })}</span>
        <span>{t('analytics.tz', { tz: range.tz.replace(/_/g, ' ') })}</span>
        {range.clipped && <span>{t('analytics.clipped')}</span>}
      </p>
      {empty ? (
        <div className="la-empty" key={`${tab}-empty`}>
          <EmptyState
            title={filtered ? t('analytics.emptyFilteredTitle') : t(`analytics.empty.${tab}Title`)}
            body={filtered ? t('analytics.emptyFilteredBody') : t(`analytics.empty.${tab}Body`)}
            product="groups"
          />
        </div>
      ) : (
        // La clave hace que cada pestaña se monte de nuevo: los gráficos se dibujan y los números cuentan al cambiar.
        <div className="la" key={tab} data-tab={tab}>
          <AnalyticsView f={f} data={data} />
        </div>
      )}
      <p className="la-foot">
        {t('analytics.exportMore')} <a href={`/api/groups/export?type=chats`}>{t('analytics.exportChats')}</a> · <a href={`/api/groups/export?type=tickets`}>{t('analytics.exportTickets')}</a>
      </p>
    </div>
  );
}
