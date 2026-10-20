import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link, redirect } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getUserLink, linkCreatorName, linkStatus, toLinkDto } from '@/lib/links';
import { countLinkComments, listLinkComments } from '@/lib/link-comments';
import {
  getAnalytics,
  getClickCountries,
  listClicks,
  type AnalyticsRange,
  parseRange,
} from '@/lib/track';
import { formatDate, formatDateTime, formatNumber, shortUrl } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import SettingsTabs from '@/components/ui/SettingsTabs';
import CopyButton from '@/components/link/CopyButton';
import LinkIcon from '@/components/link/LinkIcon';
import LinkRoute from '@/components/link/LinkRoute';
import LinkChart from '@/components/link/LinkChart';
import BreakdownBars from '@/components/link/BreakdownBars';
import QrSection from '@/components/link/QrSection';
import EditLinkForm from '@/components/link/EditLinkForm';
import DangerZone from '@/components/link/DangerZone';
import CountryFilter from '@/components/link/CountryFilter';
import TargetingPanel from '@/components/link/TargetingPanel';
import StatusBadge from '@/components/link/StatusBadge';
import DuplicateButton from '@/components/link/DuplicateButton';
import LinkComments from '@/components/link/LinkComments';
import { parseTargeting } from '@/lib/link-targeting';
import { breakdownLabelers } from '@/lib/link-labels';
import { linkTabHref, parseLinkTab, type LinkTab } from '@/lib/link-detail-tabs';
import { periodDelta } from '@/lib/period-delta';

export const dynamic = 'force-dynamic';

interface DetailPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const RANGE_DAYS: Record<AnalyticsRange, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

export default async function LinkDetailPage(props: DetailPageProps) {
  const searchParams = await props.searchParams;
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  const link = await getUserLink(user.id, id);
  if (!link) notFound();

  const tab: LinkTab = parseLinkTab(searchParams);
  // Links viejos (?edit=1 desde la tabla): la pestaña tiene que quedar marcada en la URL.
  if (searchParams.edit === '1' && typeof searchParams.tab !== 'string') {
    redirect({ href: linkTabHref(link.id, 'settings'), locale });
  }
  const rawRange = typeof searchParams.range === 'string' ? searchParams.range : undefined;
  const range: AnalyticsRange = parseRange(rawRange);
  const country = typeof searchParams.country === 'string' ? searchParams.country : undefined;
  const clickPage = Math.max(Number(searchParams.page ?? '1') || 1, 1);
  const clickPageSize = Math.min(Math.max(Number(searchParams.pageSize ?? '25') || 25, 1), 100);

  // Cada pestaña pide solo lo que muestra.
  const needsStats = tab === 'overview' || tab === 'analytics';
  const [a, clickResult, countries, comments, commentCount, creatorName] = await Promise.all([
    needsStats ? getAnalytics(link.id, link.created_at, range) : null,
    tab === 'analytics'
      ? listClicks(link.id, link.created_at, { range, country, page: clickPage, pageSize: clickPageSize })
      : null,
    tab === 'analytics' ? getClickCountries(link.id) : null,
    tab === 'comments' ? listLinkComments(link.id) : null,
    countLinkComments(link.id),
    linkCreatorName(link.created_by),
  ]);

  const short = shortUrl(link.slug, link.domain_hostname ?? null);
  const shortText = short.replace(/^https?:\/\//, '');
  const status = linkStatus(link);
  const targeting = parseTargeting(link.targeting);
  const branches = targeting
    ? targeting.rules.length + Math.max(targeting.ab.length - 1, 0) + (targeting.ios ? 1 : 0) + (targeting.android ? 1 : 0)
    : 0;

  const ranges: Array<{ value: AnalyticsRange; label: string }> = [
    { value: '7d', label: t('detail.range7') },
    { value: '30d', label: t('detail.range30') },
    { value: '90d', label: t('detail.range90') },
    { value: 'all', label: t('detail.rangeAll') },
  ];
  const rangeLabel = ranges.find((r) => r.value === range)?.label ?? range;

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
  const noData = t('detail.noData');

  const rangeSwitch = (tabFor: LinkTab) => (
    <div className="btn-group lk-range" role="group" aria-label={t('detail.rangeLabel')}>
      {ranges.map((r) => (
        <Link
          key={r.value}
          href={linkTabHref(link.id, tabFor, { range: r.value === '30d' ? undefined : r.value })}
          className="btn btn-sm"
          aria-current={r.value === range ? 'true' : undefined}
          scroll={false}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );

  const tabs = [
    { key: 'overview', label: t('detail.tabs.overview') },
    { key: 'analytics', label: t('detail.tabs.analytics') },
    { key: 'qr', label: t('detail.tabs.qr') },
    { key: 'routing', label: t('detail.tabs.routing') },
    {
      key: 'comments',
      label: commentCount > 0 ? t('detail.tabs.commentsN', { n: commentCount }) : t('detail.tabs.comments'),
    },
    { key: 'settings', label: t('detail.tabs.settings') },
  ];

  let body: React.ReactNode = null;

  if (tab === 'overview' && a && a.total === 0) {
    // Recién creado: en vez de un gráfico plano y ceros, qué hacer para que lleguen clicks.
    body = (
      <EmptyState
        title={t('detail.emptyTitle')}
        body={t.rich('detail.emptyBody', {
          short: shortText,
          data: (chunks) => <span className="data">{chunks}</span>,
        })}
        action={<CopyButton text={short} className="btn" label={t('detail.copyShort')} />}
        product="link"
      />
    );
  } else if (tab === 'overview' && a) {
    const today = a.byDay[a.byDay.length - 1]?.count ?? 0;
    const delta = periodDelta(a.rangeTotal, a.previousTotal);
    const days = RANGE_DAYS[range];
    const topRef = a.referrers[0]?.name;
    body = (
      <>
        <dl className="lk-stats">
          <div className="lk-stat">
            <dt>{t('detail.total')}</dt>
            <dd className="data num">{formatNumber(a.total, locale)}</dd>
            <dd className="lk-stat-sub" data-testid="detail-qr-scans">
              {t('detail.qrScansCount', { n: formatNumber(link.qr_scans ?? 0, locale) })}
            </dd>
          </div>
          <div className="lk-stat">
            <dt>{t('detail.today')}</dt>
            <dd className="data num">{formatNumber(today, locale)}</dd>
          </div>
          <div className="lk-stat">
            <dt>{t('detail.inRange', { range: rangeLabel })}</dt>
            <dd className="data num">{formatNumber(a.rangeTotal, locale)}</dd>
            {delta?.kind === 'none' && <dd className="lk-stat-sub">{t('detail.noPrevious')}</dd>}
            {delta?.kind === 'change' && days && (
              <dd className="lk-stat-sub lk-delta" data-dir={delta.dir}>
                {t('detail.vsPrevious', { delta: delta.text, days })}
              </dd>
            )}
          </div>
          <div className="lk-stat">
            <dt>{t('detail.topRef')}</dt>
            <dd className="lk-stat-text" title={topRef}>
              {topRef ? labels.plain(topRef) : t('detail.none')}
            </dd>
          </div>
        </dl>

        <section className="lk-block" aria-labelledby="lk-chart-title">
          <div className="lk-panel-head">
            <h2 className="lk-h" id="lk-chart-title">
              {t('detail.chartLabel')}
            </h2>
            {rangeSwitch('overview')}
          </div>
          <LinkChart data={a.byDay} />
        </section>

        <div className="lk-grid-2">
          <section className="lk-block" aria-labelledby="lk-ref-title">
            <h2 className="lk-h" id="lk-ref-title">
              {t('detail.referrers')}
            </h2>
            <BreakdownBars items={a.referrers.slice(0, 6)} emptyLabel={noData} labelFor={labels.plain} />
          </section>
          <section className="lk-block" aria-labelledby="lk-geo-title">
            <h2 className="lk-h" id="lk-geo-title">
              {t('detail.countries')}
            </h2>
            <BreakdownBars items={a.countries.slice(0, 6)} emptyLabel={noData} labelFor={labels.country} />
          </section>
        </div>
        <p>
          <Link href={linkTabHref(link.id, 'analytics', { range: range === '30d' ? undefined : range })} className="lk-more">
            {t('detail.seeAnalytics')}
          </Link>
        </p>
      </>
    );
  } else if (tab === 'analytics' && a && clickResult && countries) {
    const pages = Math.ceil(clickResult.total / clickResult.pageSize);
    const pageHref = (p: number) =>
      linkTabHref(link.id, 'analytics', {
        range: range === '30d' ? undefined : range,
        country,
        page: p > 1 ? String(p) : undefined,
      });
    body = (
      <>
        <div className="lk-toolbar">
          {rangeSwitch('analytics')}
          <a
            href={`/api/links/${link.id}/export.csv?range=${range}${country ? `&country=${encodeURIComponent(country)}` : ''}`}
            className="btn btn-sm"
          >
            <LinkIcon name="download" size={14} />
            {t('detail.exportCsv')}
          </a>
        </div>

        <section className="lk-block" aria-labelledby="lk-chart-title">
          <h2 className="lk-h" id="lk-chart-title">
            {t('detail.chartLabel')}
          </h2>
          <LinkChart data={a.byDay} />
        </section>

        {/* De dónde (listas largas, de a dos) y con qué (listas cortas, de a tres). */}
        {(
          [
            [
              'lk-grid-2',
              [
                ['referrers', a.referrers, labels.plain],
                ['countries', a.countries, labels.country],
              ],
            ],
            [
              'lk-grid-3',
              [
                ['devices', a.devices, labels.device],
                ['browsers', a.browsers, labels.plain],
                ['os', a.os, labels.plain],
              ],
            ],
          ] as const
        ).map(([grid, blocks]) => (
          <div key={grid} className={grid}>
            {blocks.map(([key, items, labelFor]) => (
              <section key={key} className="lk-block" aria-labelledby={`lk-${key}`}>
                <h2 className="lk-h" id={`lk-${key}`}>
                  {t(`detail.${key}`)}
                </h2>
                <BreakdownBars items={items} emptyLabel={noData} labelFor={labelFor} />
              </section>
            ))}
          </div>
        ))}
        <div className="lk-grid-2">
          <section className="lk-block" aria-labelledby="lk-cities">
            <h2 className="lk-h" id="lk-cities">
              {t('detail.cities')}
            </h2>
            <BreakdownBars items={a.cities} emptyLabel={noData} labelFor={labels.city} />
          </section>
          <section className="lk-block" aria-labelledby="lk-regions">
            <h2 className="lk-h" id="lk-regions">
              {t('detail.regions')}
            </h2>
            <BreakdownBars items={a.regions} emptyLabel={noData} labelFor={labels.region} />
          </section>
        </div>
        <section className="lk-block" aria-labelledby="lk-referrer-urls">
          <h2 className="lk-h" id="lk-referrer-urls">
            {t('detail.referrerUrls')}
          </h2>
          <BreakdownBars items={a.referrerUrls} emptyLabel={noData} labelFor={labels.plain} />
        </section>
        {(link.targeting || a.variants.some((v) => v.name !== 'default')) && (
          <section className="lk-block" data-testid="detail-variants" aria-labelledby="lk-variants">
            <h2 className="lk-h" id="lk-variants">
              {t('detail.variants')}
            </h2>
            <BreakdownBars items={a.variants} emptyLabel={noData} labelFor={labels.variant} />
          </section>
        )}

        <section className="lk-block" id="clicks" aria-labelledby="lk-log-title">
          <div className="lk-panel-head">
            <h2 className="lk-h" id="lk-log-title">
              {t('detail.clickLogTitle')}
            </h2>
            {countries.length > 0 && (
              <div className="lk-inline-field">
                <label className="label" htmlFor="country-filter">
                  {t('detail.countryFilter')}
                </label>
                <CountryFilter
                  id="country-filter"
                  linkId={link.id}
                  range={range}
                  value={country ?? ''}
                  countries={countries}
                  allLabel={t('detail.allCountries')}
                />
              </div>
            )}
          </div>

          {clickResult.clicks.length === 0 ? (
            <p className="lk-empty-line">{country ? t('detail.noClicksCountry') : t('detail.noClicks')}</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table table-compact lk-log">
                  <caption className="sr-only">{t('detail.clickLogTitle')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('detail.colTimestamp')}</th>
                      <th scope="col">{t('detail.colCountry')}</th>
                      <th scope="col">{t('detail.colCity')}</th>
                      <th scope="col">{t('detail.colReferrer')}</th>
                      <th scope="col">{t('detail.colDevice')}</th>
                      <th scope="col">{t('detail.colBrowser')}</th>
                      <th scope="col">{t('detail.colOs')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clickResult.clicks.map((c) => (
                      <tr key={c.id}>
                        <td className="data">{formatDateTime(c.ts, locale)}</td>
                        <td title={c.country ?? undefined}>{c.country ? labels.country(c.country) : t('detail.none')}</td>
                        <td title={c.region ? `${c.country ?? ''}-${c.region}` : undefined}>
                          {c.city ?? (c.region ? labels.region(`${c.country ?? ''}-${c.region}`) : t('detail.none'))}
                        </td>
                        <td className="data lk-cell-trunc" title={c.referrer_url ?? undefined}>
                          {c.referrer ? labels.plain(c.referrer) : t('detail.none')}
                        </td>
                        <td>{c.device ? labels.device(c.device) : t('detail.none')}</td>
                        <td>{c.browser ? labels.plain(c.browser) : t('detail.none')}</td>
                        <td>{c.os ? labels.plain(c.os) : t('detail.none')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <nav className="lk-pager" aria-label={t('table.pagination')}>
                  {clickResult.page > 1 ? (
                    <Link href={pageHref(clickResult.page - 1)} className="btn btn-sm" scroll={false}>
                      {t('table.pagePrev')}
                    </Link>
                  ) : (
                    <span className="btn btn-sm" aria-disabled="true">
                      {t('table.pagePrev')}
                    </span>
                  )}
                  <span className="lk-pager-info data">{t('table.pageOf', { page: clickResult.page, pages })}</span>
                  {clickResult.page < pages ? (
                    <Link href={pageHref(clickResult.page + 1)} className="btn btn-sm" scroll={false}>
                      {t('table.pageNext')}
                    </Link>
                  ) : (
                    <span className="btn btn-sm" aria-disabled="true">
                      {t('table.pageNext')}
                    </span>
                  )}
                </nav>
              )}
            </>
          )}
        </section>
      </>
    );
  } else if (tab === 'qr') {
    body = <QrSection id={link.id} slug={link.slug} />;
  } else if (tab === 'routing') {
    body = <TargetingPanel key={link.url} linkId={link.id} defaultUrl={link.url} initial={targeting} />;
  } else if (tab === 'comments' && comments) {
    body = <LinkComments linkId={link.id} initial={comments} viewerId={realUserId(user)} isAdmin={isWorkspaceAdmin(user)} />;
  } else if (tab === 'settings') {
    body = (
      <>
        <EditLinkForm link={toLinkDto(link)} />
        <DangerZone id={link.id} slug={link.slug} archived={link.archived === 1} canDelete={isWorkspaceAdmin(user)} />
      </>
    );
  }

  return (
    <div className="ui-page link-detail">
      <PageHeader
        back={{ href: '/app/links', label: t('detail.back') }}
        title={link.title || shortText}
        description={
          <span className="lk-meta">
            <StatusBadge status={status} />
            <span>
              {creatorName
                ? t('detail.createdOnBy', { date: formatDate(link.created_at, locale), name: creatorName })
                : t('detail.createdOn', { date: formatDate(link.created_at, locale) })}
            </span>
          </span>
        }
        actions={
          <>
            <DuplicateButton id={link.id} />
            <a href={short} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              <LinkIcon name="external" size={15} />
              {t('detail.openShort')}
            </a>
            <CopyButton text={short} className="btn btn-primary" label={t('detail.copyShort')} />
          </>
        }
      />

      <LinkRoute
        short={short}
        destination={link.url}
        label={t('detail.routeLabel')}
        branches={branches}
        branchesLabel={t('detail.routeBranches', { n: branches })}
      />

      <SettingsTabs mode="query" param="tab" layout="top" items={tabs} label={t('detail.tabsLabel')}>
        {body}
      </SettingsTabs>
    </div>
  );
}
