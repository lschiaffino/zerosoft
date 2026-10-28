import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import {
  DEVICE_FILTERS,
  filtersQuery,
  getAnalyticsFacets,
  getWorkspaceAnalytics,
  getWorkspaceConversions,
  parseTimezone,
  parseWorkspaceFilters,
  parseWorkspaceRange,
} from '@/lib/link-analytics';
import { listFolders, viewerOf } from '@/lib/link-folders';
import { listShares } from '@/lib/link-shares';
import { getUserTimeZone } from '@/lib/user-tz';
import { formatNumber, shortDomain } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import LinkChart from '@/components/link/LinkChart';
import LinkIcon from '@/components/link/LinkIcon';
import { breakdownLabelers } from '@/lib/link-labels';
import BreakdownBars from '@/components/link/BreakdownBars';
import { periodDelta, type PeriodDelta } from '@/lib/period-delta';
import SharePanel from '@/components/link/SharePanel';
import SettingsTabs from '@/components/ui/SettingsTabs';
import LinkEvents from '@/components/link/LinkEvents';
import LinkAskAi from '@/components/link/LinkAskAi';
import { formatMoney } from '@/lib/link-conversions';

/** Zonas para el selector: la del navegador primero, después todas las IANA. */
function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    all = [];
  }
  return [...new Set([current, 'UTC', ...all])];
}

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Días del rango (inclusive), para "vs 30 días previos". */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export default async function LinkAnalyticsPage(props: Props) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const view = one(sp.view) === 'events' ? 'events' : 'overview';
  const viewTabs = [
    { key: 'overview', label: t('analytics.viewOverview') },
    { key: 'events', label: t('analytics.viewEvents') },
  ];

  if (view === 'events') {
    // Eventos en vivo: sin las consultas pesadas del resumen.
    const link = one(sp.link);
    return (
      <div className="ui-page link-analytics">
        <PageHeader title={t('analytics.title')} description={t('events.sub')} />
        <SettingsTabs mode="query" param="view" layout="top" items={viewTabs} label={t('analytics.viewsLabel')}>
          <LinkEvents linkId={link && link.length <= 64 ? link : undefined} />
        </SettingsTabs>
      </div>
    );
  }

  const range = parseWorkspaceRange(one(sp.from), one(sp.to));
  const filters = parseWorkspaceFilters(sp);
  // Sin ?tz= se usa la zona del navegador (cookie); UTC si no hay.
  const timezone = parseTimezone(one(sp.tz) ?? (await getUserTimeZone()));
  const viewer = viewerOf(user);
  const [a, conv, facets, folders, tagShares] = await Promise.all([
    getWorkspaceAnalytics(user.id, range, { filters, timezone, viewer }),
    getWorkspaceConversions(user.id, range, { filters, timezone, viewer }),
    getAnalyticsFacets(user.id, viewer),
    listFolders(user.id, viewer),
    // Compartir un tag es de admins (puede juntar links de carpetas que otros no ven).
    filters.tag && isWorkspaceAdmin(user) ? listShares(user.id, { tag: filters.tag }) : Promise.resolve(null),
  ]);
  const filterQuery = { ...filtersQuery(filters), tz: timezone };
  const today = new Date().toISOString().slice(0, 10);
  const presets = [
    { days: 7, label: t('analytics.last7') },
    { days: 30, label: t('analytics.last30') },
    { days: 90, label: t('analytics.last90') },
    { days: 365, label: t('analytics.last365') },
  ].map((p) => ({ ...p, from: shift(today, -(p.days - 1)), to: today }));

  const labels = breakdownLabelers(locale, {
    direct: t('common.direct'),
    other: t('common.other'),
    unknown: t('labels.unknown'),
    variantDefault: t('detail.variantDefault'),
    device: { desktop: t('labels.desktop'), mobile: t('labels.mobile'), tablet: t('labels.tablet') },
    rule: (n) => t('labels.rule', { n }),
    ab: (v) => t('labels.ab', { v }),
    app: (os) => t('labels.app', { os }),
  });
  const noData = t('analytics.noData');
  const q = new URLSearchParams({ from: range.from, to: range.to, ...filterQuery }).toString();
  const hasFilters = Object.keys(filtersQuery(filters)).length > 0;
  const days = spanDays(range.from, range.to);
  const deltaLine = (d: PeriodDelta | null) =>
    d?.kind === 'none' ? (
      <dd className="lk-stat-sub">{t('detail.noPrevious')}</dd>
    ) : d?.kind === 'change' ? (
      <dd className="lk-stat-sub lk-delta" data-dir={d.dir}>
        {t('detail.vsPrevious', { delta: d.text, days })}
      </dd>
    ) : null;

  return (
    <div className="ui-page link-analytics">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.sub', { tz: timezone })}
        actions={
          <>
            <a href={`/api/links/analytics/export.csv?${q}`} className="btn" data-testid="analytics-export">
              <LinkIcon name="download" size={15} />
              {t('analytics.exportCsv')}
            </a>
            <a href={`/api/links/analytics/export.csv?${q}&kind=conversions`} className="btn btn-ghost" data-testid="analytics-export-conversions">
              <LinkIcon name="download" size={15} />
              {t('analytics.exportConversions')}
            </a>
          </>
        }
      />
      <SettingsTabs mode="query" param="view" layout="top" items={viewTabs} label={t('analytics.viewsLabel')} />

      {/* Un solo form (con un solo Aplicar) para fechas y filtros: las fechas viven arriba y se enlazan con form=. */}
      <div className="lk-toolbar">
        <div className="btn-group lk-range" role="group" aria-label={t('detail.rangeLabel')}>
          {presets.map((p) => (
            <Link
              key={p.days}
              href={{ pathname: '/app/links/analytics', query: { from: p.from, to: p.to, ...filterQuery } }}
              className="btn btn-sm"
              aria-current={p.from === range.from && p.to === range.to ? 'true' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <div className="lk-dates">
          <label className="lk-inline-field">
            <span className="label">{t('analytics.from')}</span>
            <input type="date" name="from" form="analytics-filters" defaultValue={range.from} className="input mono" />
          </label>
          <label className="lk-inline-field">
            <span className="label">{t('analytics.to')}</span>
            <input type="date" name="to" form="analytics-filters" defaultValue={range.to} className="input mono" />
          </label>
        </div>
      </div>

      <form id="analytics-filters" className="lk-an-filters" method="get" aria-label={t('analytics.filtersLabel')} data-testid="analytics-filters">
        {facets.tags.length > 0 && (
          <div className="ui-field">
            <label className="label" htmlFor="af-tag">
              {t('analytics.filterTag')}
            </label>
            <select id="af-tag" name="tag" className="select" defaultValue={filters.tag ?? ''}>
              <option value="">{t('analytics.any')}</option>
              {facets.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        )}
        {facets.domains.length > 0 && (
          <div className="ui-field">
            <label className="label" htmlFor="af-domain">
              {t('analytics.filterDomain')}
            </label>
            <select id="af-domain" name="domain" className="select" defaultValue={filters.domain ?? ''}>
              <option value="">{t('analytics.any')}</option>
              <option value="default">{shortDomain()}</option>
              {facets.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                </option>
              ))}
            </select>
          </div>
        )}
        {folders.length > 0 && (
          <div className="ui-field">
            <label className="label" htmlFor="af-folder">
              {t('folders.field')}
            </label>
            <select id="af-folder" name="folder" className="select" defaultValue={filters.folder ?? ''}>
              <option value="">{t('analytics.any')}</option>
              <option value="none">{t('folders.noFolder')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="af-link">
            {t('analytics.filterLink')}
          </label>
          <select id="af-link" name="link" className="select mono" defaultValue={filters.link ?? ''}>
            <option value="">{t('analytics.any')}</option>
            {facets.links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="af-country">
            {t('analytics.filterCountry')}
          </label>
          <select id="af-country" name="country" className="select" defaultValue={filters.country ?? ''}>
            <option value="">{t('analytics.any')}</option>
            {[...new Set([...(filters.country ? [filters.country] : []), ...facets.countries])].map((c) => (
              <option key={c} value={c}>
                {labels.country(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="af-device">
            {t('analytics.filterDevice')}
          </label>
          <select id="af-device" name="device" className="select" defaultValue={filters.device ?? ''}>
            <option value="">{t('analytics.any')}</option>
            {DEVICE_FILTERS.map((d) => (
              <option key={d} value={d}>
                {labels.device(d)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="af-tz">
            {t('analytics.timezone')}
          </label>
          <select id="af-tz" name="tz" className="select" defaultValue={timezone}>
            {timezoneOptions(timezone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-sm">
          {t('analytics.apply')}
        </button>
        {hasFilters && (
          <Link
            href={{ pathname: '/app/links/analytics', query: { from: range.from, to: range.to, tz: timezone } }}
            className="btn btn-sm btn-ghost"
          >
            {t('analytics.clearFilters')}
          </Link>
        )}
      </form>

      <dl className="lk-stats">
        <div className="lk-stat">
          <dt>{t('analytics.clicks')}</dt>
          <dd className="data num" data-testid="analytics-clicks">
            {formatNumber(a.clicks, locale)}
          </dd>
          {deltaLine(periodDelta(a.clicks, a.previous.clicks))}
        </div>
        <div className="lk-stat">
          <dt>{t('analytics.scans')}</dt>
          <dd className="data num" data-testid="analytics-scans">
            {formatNumber(a.scans, locale)}
          </dd>
          {deltaLine(periodDelta(a.scans, a.previous.scans))}
        </div>
        <div className="lk-stat">
          <dt>{t('analytics.leads')}</dt>
          <dd className="data num" data-testid="analytics-leads">
            {formatNumber(conv.leads, locale)}
          </dd>
          {deltaLine(periodDelta(conv.leads, conv.previous.leads))}
        </div>
        <div className="lk-stat">
          <dt>{t('analytics.sales')}</dt>
          <dd className="data num" data-testid="analytics-sales">
            {formatNumber(conv.sales, locale)}
          </dd>
          <dd className="lk-stat-sub lk-revenue" data-testid="analytics-revenue">
            {conv.revenue.length
              ? conv.revenue.map((r) => formatMoney(r.amount, r.currency, locale)).join(' · ')
              : t('analytics.noRevenue')}
          </dd>
        </div>
      </dl>

      <section className="lk-block" aria-labelledby="la-chart-title">
        <div className="lk-panel-head">
          <h2 className="lk-h" id="la-chart-title">
            {t('analytics.chartLabelTz', { tz: timezone })}
          </h2>
          <ul className="lk-legend">
            <li className="lk-key lk-key-1">{t('analytics.legendClicks')}</li>
            <li className="lk-key lk-key-2">{t('analytics.legendScans')}</li>
          </ul>
        </div>
        <LinkChart
          data={a.byDay.map((d) => ({ date: d.date, count: d.clicks }))}
          secondary={a.byDay.map((d) => ({ date: d.date, count: d.scans }))}
        />
      </section>

      <section className="lk-block" aria-labelledby="la-top-title">
        <h2 className="lk-h" id="la-top-title">
          {t('analytics.topLinks')}
        </h2>
        <DataTable
          caption={t('analytics.topLinks')}
          rows={a.topLinks}
          rowKey={(l) => l.id}
          rowHref={(l) => `/app/links/${l.id}`}
          compact
          empty={<EmptyState title={t('analytics.empty')} body={t('analytics.emptyBody')} quiet product="link" />}
          columns={[
            {
              key: 'link',
              header: t('analytics.colLink'),
              data: true,
              cell: (l) => l.short_url.replace(/^https?:\/\//, ''),
            },
            {
              key: 'dest',
              header: t('table.destination'),
              cell: (l) => <span className="lk-dest-text">{l.url}</span>,
            },
            { key: 'clicks', header: t('analytics.colClicks'), numeric: true, data: true, cell: (l) => formatNumber(l.clicks, locale) },
            { key: 'scans', header: t('analytics.colScans'), numeric: true, data: true, cell: (l) => formatNumber(l.scans, locale) },
          ]}
        />
      </section>

      <section className="lk-block" aria-labelledby="la-conv-title" data-testid="analytics-conversions">
        <h2 className="lk-h" id="la-conv-title">
          {t('analytics.conversions')}
        </h2>
        {conv.leads + conv.sales === 0 ? (
          <p className="lk-empty-line">{t('analytics.conversionsEmpty')}</p>
        ) : (
          <>
            <ol className="lk-funnel" aria-label={t('analytics.funnel')}>
              {[
                [t('analytics.clicks'), a.clicks + a.scans],
                [t('analytics.leads'), conv.leads],
                [t('analytics.sales'), conv.sales],
              ].map(([label, n], i, all) => {
                const top = Number(all[0][1]) || 1;
                return (
                  <li key={String(label)} className="lk-funnel-step">
                    <span className="lk-funnel-label">{label}</span>
                    <span className="lk-funnel-bar" style={{ width: `${Math.max(2, Math.round((Number(n) / top) * 100))}%` }} aria-hidden="true" />
                    <span className="data num">
                      {formatNumber(Number(n), locale)}
                      {i > 0 && Number(all[i - 1][1]) > 0 && (
                        <span className="lk-funnel-rate"> · {Math.round((Number(n) / Number(all[i - 1][1])) * 1000) / 10}%</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            <DataTable
              caption={t('analytics.topConverting')}
              rows={conv.topLinks}
              rowKey={(l) => l.id}
              rowHref={(l) => `/app/links/${l.id}`}
              compact
              columns={[
                { key: 'link', header: t('analytics.colLink'), data: true, cell: (l) => l.short_url.replace(/^https?:\/\//, '') },
                { key: 'leads', header: t('analytics.leads'), numeric: true, data: true, cell: (l) => formatNumber(l.leads, locale) },
                { key: 'sales', header: t('analytics.sales'), numeric: true, data: true, cell: (l) => formatNumber(l.sales, locale) },
                {
                  key: 'revenue',
                  header: t('analytics.revenue'),
                  numeric: true,
                  data: true,
                  cell: (l) => (conv.revenue[0] ? formatMoney(l.revenue, conv.revenue[0].currency, locale) : '0'),
                },
              ]}
            />
          </>
        )}
      </section>

      <LinkAskAi params={{ from: range.from, to: range.to, ...filterQuery }} />

      <div className="lk-grid-2">
        {(
          [
            ['referrers', a.referrers, labels.plain],
            ['countries', a.countries, labels.country],
            ['devices', a.devices, labels.device],
            ['browsers', a.browsers, labels.plain],
          ] as const
        ).map(([key, items, labelFor]) => (
          <section key={key} className="lk-block" aria-labelledby={`la-${key}`}>
            <h2 className="lk-h" id={`la-${key}`}>
              {t(`analytics.${key}`)}
            </h2>
            <BreakdownBars items={items} emptyLabel={noData} labelFor={labelFor} />
          </section>
        ))}
      </div>

      {tagShares && filters.tag && <SharePanel key={filters.tag} target={{ tag: filters.tag }} initial={tagShares} />}

      <section className="lk-block" aria-labelledby="la-cities">
        <h2 className="lk-h" id="la-cities">
          {t('analytics.cities')}
        </h2>
        <BreakdownBars items={a.cities} emptyLabel={noData} labelFor={labels.city} />
      </section>
    </div>
  );
}
