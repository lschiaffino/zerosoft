import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { DEVICE_FILTERS, cachedLinkDashboard, filtersQuery, getAnalyticsFacets, parseTimezone, parseWorkspaceFilters, type LinkDashboard } from '@/lib/link-analytics';
import { listFolders, viewerOf } from '@/lib/link-folders';
import { listShares } from '@/lib/link-shares';
import { breakdownLabelers } from '@/lib/link-labels';
import { formatMoney as formatMinor } from '@/lib/link-conversions';
import { periodChoice, periodParams, share } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import type { BreakdownItem } from '@/lib/track';
import { shortDomain } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import SharePanel from '@/components/link/SharePanel';
import LinkEvents from '@/components/link/LinkEvents';
import LinkAskAi from '@/components/link/LinkAskAi';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Zonas para el selector: la de quien mira primero, después todas las IANA. */
function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    all = [];
  }
  return [...new Set([current, 'UTC', ...all])];
}

/** Monedas sin decimales (los montos de Link vienen en unidades menores). */
const ZERO_DECIMAL = ['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'UGX', 'XAF', 'XOF'];
const fromMinor = (amount: number, currency: string) => (ZERO_DECIMAL.includes(currency.toUpperCase()) ? amount : amount / 100);

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'link' });
  return { title: `${t('analytics.title')} · Link` };
}

/**
 * Link, analítica (/app/links/analytics): clics, escaneos y conversiones de
 * todos los links del workspace con el kit de analítica (el formato de
 * Lines). La pestaña de eventos muestra el detalle en vivo.
 */
export default async function LinkAnalyticsPage(props: Props) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk] = await Promise.all([getTranslations({ locale, namespace: 'link' }), getTranslations({ locale, namespace: 'analyticsKit' })]);
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

  const period = periodChoice({ days: one(sp.days), from: one(sp.from), to: one(sp.to) });
  const filters = parseWorkspaceFilters(sp);
  // ?tz= elige otra zona; si no, la de quien mira (la cookie del kit).
  const tzParam = one(sp.tz) ? parseTimezone(one(sp.tz)) : undefined;
  const tz = tzParam ?? (await viewerTz());
  const viewer = viewerOf(user);
  const [data, facets, folders, tagShares] = await Promise.all([
    cachedLinkDashboard(user.id, { days: period.days, from: period.from, to: period.to, tz }, { filters, viewer }),
    getAnalyticsFacets(user.id, viewer),
    listFolders(user.id, viewer),
    // Compartir un tag es de admins (puede juntar links de carpetas que otros no ven).
    filters.tag && isWorkspaceAdmin(user) ? listShares(user.id, { tag: filters.tag }) : Promise.resolve(null),
  ]);
  const { a, conv } = data;
  const currency = conv.revenue[0]?.currency?.toUpperCase() ?? 'USD';
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    currency,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/links/analytics';
  const fq = { ...filtersQuery(filters), tz: tzParam };
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), ...fq, ...extra })}`;
  const exportQs = queryString({ from: data.range.from, to: data.range.to, ...filtersQuery(filters), tz: data.range.tz });
  const hasFilters = Object.keys(filtersQuery(filters)).length > 0 || Boolean(tzParam);
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

  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="link"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      exportHref={`/api/links/analytics/export.csv${exportQs}`}
      tabs={<SettingsTabs mode="query" param="view" layout="top" items={viewTabs} label={t('analytics.viewsLabel')} className="la-tabs" />}
      filters={
        <>
          {facets.tags.length > 0 && (
            <label className="ui-field">
              <span className="label">{t('analytics.filterTag')}</span>
              <select name="tag" className="select" defaultValue={filters.tag ?? ''}>
                <option value="">{t('analytics.any')}</option>
                {facets.tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          )}
          {facets.domains.length > 0 && (
            <label className="ui-field">
              <span className="label">{t('analytics.filterDomain')}</span>
              <select name="domain" className="select" defaultValue={filters.domain ?? ''}>
                <option value="">{t('analytics.any')}</option>
                <option value="default">{shortDomain()}</option>
                {facets.domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hostname}
                  </option>
                ))}
              </select>
            </label>
          )}
          {folders.length > 0 && (
            <label className="ui-field">
              <span className="label">{t('folders.field')}</span>
              <select name="folder" className="select" defaultValue={filters.folder ?? ''}>
                <option value="">{t('analytics.any')}</option>
                <option value="none">{t('folders.noFolder')}</option>
                {folders.map((fo) => (
                  <option key={fo.id} value={fo.id}>
                    {fo.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {facets.links.length > 0 && (
            <label className="ui-field">
              <span className="label">{t('analytics.filterLink')}</span>
              <select name="link" className="select" defaultValue={filters.link ?? ''}>
                <option value="">{t('analytics.any')}</option>
                {facets.links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ui-field">
            <span className="label">{t('analytics.filterCountry')}</span>
            <select name="country" className="select" defaultValue={filters.country ?? ''}>
              <option value="">{t('analytics.any')}</option>
              {[...new Set([...(filters.country ? [filters.country] : []), ...facets.countries])].map((c) => (
                <option key={c} value={c}>
                  {labels.country(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('analytics.filterDevice')}</span>
            <select name="device" className="select" defaultValue={filters.device ?? ''}>
              <option value="">{t('analytics.any')}</option>
              {DEVICE_FILTERS.map((d) => (
                <option key={d} value={d}>
                  {labels.device(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('analytics.timezone')}</span>
            <select name="tz" className="select" defaultValue={data.range.tz}>
              {timezoneOptions(data.range.tz).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      filtered={period.custom || hasFilters}
      clearHref={base}
      empty={a.clicks + a.scans + conv.leads + conv.sales === 0}
      emptyTitle={t('analytics.empty')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${JSON.stringify(fq)}`}
    >
      <LinkAnalyticsView f={f} d={data} labels={labels} exportConversions={`/api/links/analytics/export.csv${exportQs}${exportQs ? '&' : '?'}kind=conversions`} />
      <LinkAskAi params={{ from: data.range.from, to: data.range.to, ...filtersQuery(filters), tz: data.range.tz }} />
      {tagShares && filters.tag && <SharePanel key={filters.tag} target={{ tag: filters.tag }} initial={tagShares} />}
    </AnalyticsPage>
  );
}

type Labels = ReturnType<typeof breakdownLabelers>;

function LinkAnalyticsView({ f, d, labels, exportConversions }: { f: Fmt; d: LinkDashboard; labels: Labels; exportConversions: string }) {
  const { a, conv } = d;
  const dayLabels = a.byDay.map((p) => f.day(p.date));
  const visits = a.clicks + a.scans;
  const prevVisits = a.previous.clicks + a.previous.scans;
  const main = conv.revenue[0];
  const bars = (items: BreakdownItem[], labelFor: (n: string) => string) => {
    const total = items.reduce((s, i) => s + i.count, 0);
    const max = Math.max(1, ...items.map((i) => i.count));
    return items.map((i) => ({ key: i.name, label: labelFor(i.name), value: f.num(i.count), extra: pctOf(f, i.count, total), share: i.count / max }));
  };
  const funnel: Array<[string, string, number]> = [
    ['visits', f.t('analytics.clicks'), visits],
    ['leads', f.t('analytics.leads'), conv.leads],
    ['sales', f.t('analytics.sales'), conv.sales],
  ];
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.clicks')} kpi={{ value: a.clicks, prev: a.previous.clicks }} spark={a.byDay.map((p) => p.clicks)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.scans')} kpi={{ value: a.scans, prev: a.previous.scans }} spark={a.byDay.map((p) => p.scans)} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.leads')} kpi={{ value: conv.leads, prev: conv.previous.leads }} spark={conv.byDay.map((p) => p.leads)} better="up" />
        <KpiTile f={f} i={3} label={f.t('analytics.sales')} kpi={{ value: conv.sales, prev: conv.previous.sales }} spark={conv.byDay.map((p) => p.sales)} better="up" />
        <KpiTile
          f={f}
          i={4}
          label={f.t('analytics.convRate')}
          kpi={{ value: visits ? conv.leads / visits : null, prev: prevVisits ? conv.previous.leads / prevVisits : null }}
          kind="percent"
          better="up"
        />
        {main ? <KpiTile f={f} i={5} label={f.t('analytics.revenue')} kpi={{ value: fromMinor(main.amount, main.currency) }} kind="money" /> : null}
      </Kpis>
      <Panel title={f.t('analytics.chartLabel')}>
        <TrendChart
          labels={dayLabels}
          series={[
            { name: f.t('analytics.legendClicks'), values: a.byDay.map((p) => p.clicks) },
            { name: f.t('analytics.legendScans'), values: a.byDay.map((p) => p.scans) },
          ]}
          summary={chartAria(f, f.t('analytics.chartLabel'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <Panel title={f.t('analytics.topLinks')}>
        <DataTable
          rows={a.topLinks}
          rowKey={(l) => l.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'link', label: f.t('analytics.colLink'), cell: (l) => <Link href={`/app/links/${l.id}`} className="la-link-cell">{l.short_url.replace(/^https?:\/\//, '')}</Link> },
            { key: 'dest', label: f.t('table.destination'), wide: true, hideNarrow: true, cell: (l) => l.url, className: () => 'la-muted' },
            { key: 'clicks', label: f.t('analytics.colClicks'), num: true, cell: (l) => f.num(l.clicks) },
            { key: 'scans', label: f.t('analytics.colScans'), num: true, cell: (l) => f.num(l.scans) },
          ]}
        />
      </Panel>
      <Panel
        title={f.t('analytics.conversions')}
        note={
          <a href={exportConversions} download>
            {f.t('analytics.exportConversions')}
          </a>
        }
      >
        {conv.leads + conv.sales === 0 ? (
          <p className="la-panel-empty">{f.t('analytics.conversionsEmpty')}</p>
        ) : (
          <>
            <BarList
              empty={f.k('noneInPeriod')}
              rows={funnel.map(([key, label, n], i) => ({
                key,
                label,
                value: f.num(n),
                extra: i > 0 && funnel[i - 1][2] > 0 ? f.pct(share(n, funnel[i - 1][2])) : undefined,
                share: visits ? n / visits : 0,
              }))}
            />
            <DataTable
              rows={conv.topLinks}
              rowKey={(l) => l.id}
              empty={f.k('noneInPeriod')}
              columns={[
                { key: 'link', label: f.t('analytics.colLink'), cell: (l) => <Link href={`/app/links/${l.id}`} className="la-link-cell">{l.short_url.replace(/^https?:\/\//, '')}</Link> },
                { key: 'leads', label: f.t('analytics.leads'), num: true, cell: (l) => f.num(l.leads) },
                { key: 'sales', label: f.t('analytics.sales'), num: true, cell: (l) => f.num(l.sales) },
                { key: 'revenue', label: f.t('analytics.revenue'), num: true, hideNarrow: true, cell: (l) => (main ? formatMinor(l.revenue, main.currency, f.locale) : f.num(0)) },
              ]}
            />
            {conv.revenue.length > 1 && <p className="la-panel-note">{conv.revenue.map((r) => formatMinor(r.amount, r.currency, f.locale)).join(' · ')}</p>}
          </>
        )}
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.referrers')}>
          <BarList rows={bars(a.referrers, labels.plain)} empty={f.t('analytics.noData')} />
        </Panel>
        <Panel title={f.t('analytics.countries')}>
          <BarList rows={bars(a.countries, labels.country)} empty={f.t('analytics.noData')} />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('analytics.devices')}>
          <BarList tone="ink" rows={bars(a.devices, labels.device)} empty={f.t('analytics.noData')} />
        </Panel>
        <Panel title={f.t('analytics.browsers')}>
          <BarList tone="ink" rows={bars(a.browsers, labels.plain)} empty={f.t('analytics.noData')} />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('analytics.cities')}>
        <BarList rows={bars(a.cities, labels.city)} empty={f.t('analytics.noData')} />
      </Panel>
    </>
  );
}
