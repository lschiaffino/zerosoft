import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { docsAdmin, docsHidden } from '@/lib/docs-guard';
import {
  cachedDocsAnalytics,
  cachedDocsSiteAnalytics,
  isDocsAnalyticsEmpty,
  isDocsSiteEmpty,
  type DocsAnalytics,
  type DocsSiteAnalytics,
} from '@/lib/docs-analytics';
import { localDay, periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; space?: string; tab?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'docs' });
  return { title: `${t('report.title')} · Docs` };
}

/**
 * Docs, analítica (/app/docs/analytics): páginas creadas y editadas, quién
 * edita y cuándo, vistas y comentarios de las páginas que la persona ve, con
 * el kit de analítica (el formato de Lines). Los admins ven además el sitio
 * publicado (?tab=site). La analítica de una página sigue en su panel.
 */
export default async function DocsAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk, tz, hidden] = await Promise.all([getTranslations({ locale, namespace: 'docs' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz(), docsHidden(user)]);
  const admin = docsAdmin(user);
  const tab = admin && sp.tab === 'site' ? 'site' : 'pages';
  const period = periodChoice(sp);
  const q = { days: period.days, from: period.from, to: period.to, tz };
  const viewer = { workspaceId: user.id, hidden };
  const base = '/app/docs/analytics';
  const tabs = admin ? (
    <SettingsTabs
      mode="query"
      param="tab"
      layout="top"
      className="la-tabs"
      label={t('report.tabsLabel')}
      items={[
        { key: 'pages', label: t('report.tabPages') },
        { key: 'site', label: t('report.tabSite') },
      ]}
    />
  ) : undefined;
  const fmt = (tzName: string) =>
    analyticsFmt({
      locale,
      tz: tzName,
      t: (key, values) => t(key as never, values as never),
      k: (key, values) => tk(key as never, values as never),
    });

  if (tab === 'site') {
    const data = await cachedDocsSiteAnalytics(user.id, q);
    const f = fmt(data.range.tz);
    const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), tab: 'site', ...extra })}`;
    return (
      <AnalyticsPage
        f={f}
        title={t('report.title')}
        description={t('report.siteDesc')}
        product="docs"
        range={data.range}
        period={period}
        periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
        formAction={`/${locale}${base}`}
        hidden={{ tab: 'site' }}
        tabs={tabs}
        filtered={period.custom}
        clearHref={`${base}?tab=site`}
        empty={isDocsSiteEmpty(data)}
        emptyTitle={t('report.siteEmptyTitle')}
        emptyBody={t('report.siteEmptyBody')}
        contentKey={`site-${data.range.from}-${data.range.to}`}
        foot={t('report.siteNote')}
      >
        <SiteView f={f} d={data} />
      </AnalyticsPage>
    );
  }

  const all = await cachedDocsAnalytics(viewer, undefined, q);
  // Solo un teamspace que la persona ve ('none' = páginas del workspace).
  const space = sp.space && (sp.space === 'none' || all.spaceList.some((s) => s.id === sp.space)) ? sp.space : undefined;
  const data = space ? await cachedDocsAnalytics(viewer, space, q) : all;
  const f = fmt(data.range.tz);
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), space, tab: admin && sp.tab ? 'pages' : undefined, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('report.title')}
      description={t('report.desc')}
      product="docs"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      tabs={tabs}
      filters={
        all.spaceList.length > 0 ? (
          <label className="ui-field">
            <span className="label">{t('report.space')}</span>
            <select className="select" name="space" defaultValue={space ?? ''}>
              <option value="">{t('report.allSpaces')}</option>
              <option value="none">{t('report.workspacePages')}</option>
              {all.spaceList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(space)}
      clearHref={base}
      empty={isDocsAnalyticsEmpty(data)}
      emptyTitle={all.pageCount === 0 ? t('report.noPagesTitle') : t('report.emptyTitle')}
      emptyBody={all.pageCount === 0 ? t('report.noPagesBody') : t('report.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${space ?? ''}`}
      foot={t('report.note')}
    >
      <PagesView f={f} d={data} spaceHref={(id) => href({ space: id || 'none' })} />
    </AnalyticsPage>
  );
}

function PagesView({ f, d, spaceHref }: { f: Fmt; d: DocsAnalytics; spaceHref: (id: string) => string }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const edits = k.edits.value ?? 0;
  const maxPerson = Math.max(1, ...d.people.map((p) => p.edits));
  const maxSpace = Math.max(1, ...d.spaces.map((s) => s.edits + s.views));
  const someone = f.t('report.someone');
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('report.created')} kpi={k.created} spark={d.perDay.map((p) => p.created)} better="up" />
        <KpiTile f={f} i={1} label={f.t('report.edited')} kpi={k.edited} better="up" />
        <KpiTile f={f} i={2} label={f.t('report.edits')} kpi={k.edits} spark={d.perDay.map((p) => p.edits)} better="up" />
        <KpiTile f={f} i={3} label={f.t('report.views')} kpi={k.views} spark={d.perDay.map((p) => p.views)} better="up" />
        <KpiTile f={f} i={4} label={f.t('report.readers')} kpi={k.readers} better="up" />
        <KpiTile f={f} i={5} label={f.t('report.comments')} kpi={k.comments} />
      </Kpis>
      <Panel title={f.t('report.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            { name: f.t('report.edits'), values: d.perDay.map((p) => p.edits) },
            { name: f.t('report.created'), values: d.perDay.map((p) => p.created) },
          ]}
          summary={chartAria(f, f.t('report.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('report.viewsPerDay')}>
          <TrendChart
            labels={labels}
            series={[{ name: f.t('report.views'), values: d.perDay.map((p) => p.views), compare: d.prevViews }]}
            summary={chartAria(f, f.t('report.viewsPerDay'), d.range)}
            locale={f.locale}
            compareLabel={f.k('previous')}
          />
        </Panel>
        <Panel title={f.t('report.whenEdited')}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('report.peak', p)} />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('report.whoEdits')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.people
              .filter((p) => p.edits > 0)
              .slice(0, 8)
              .map((p) => ({
                key: p.id || 'none',
                label: p.name || someone,
                value: f.t('report.editsN', { n: p.edits }),
                extra: pctOf(f, p.edits, edits),
                sub: [f.t('report.pagesN', { n: p.pages }), f.k('before', { value: f.num(p.prevEdits) })].join(' · '),
                share: p.edits / maxPerson,
              }))}
          />
        </Panel>
        <Panel title={d.spaceList.length > 0 ? f.t('report.bySpace') : f.t('report.mostRead')}>
          {d.spaceList.length > 0 ? (
            <BarList
              empty={f.k('noneInPeriod')}
              rows={d.spaces.slice(0, 8).map((s) => ({
                key: s.id || 'none',
                label: <Link href={spaceHref(s.id)}>{s.name || f.t('report.workspacePages')}</Link>,
                value: f.t('report.editsN', { n: s.edits }),
                sub: [f.t('report.viewsN', { n: s.views }), f.t('report.createdN', { n: s.created })].join(' · '),
                share: (s.edits + s.views) / maxSpace,
              }))}
            />
          ) : (
            <BarList
              empty={f.k('noneInPeriod')}
              rows={[...d.pages]
                .filter((p) => p.views > 0)
                .sort((a, b) => b.views - a.views)
                .slice(0, 8)
                .map((p, _i, list) => ({
                  key: p.id,
                  label: <Link href={`/app/docs/${p.id}`}>{p.title || f.t('untitled')}</Link>,
                  value: f.t('report.viewsN', { n: p.views }),
                  sub: f.t('report.readersN', { n: p.readers }),
                  share: p.views / Math.max(1, list[0]?.views ?? 1),
                }))}
            />
          )}
        </Panel>
      </PanelGrid>
      <Panel title={f.t('report.byPage')}>
        <DataTable
          rows={d.pages}
          rowKey={(p) => p.id}
          empty={f.k('noneInPeriod')}
          columns={[
            {
              key: 'page',
              label: f.t('report.page'),
              wide: true,
              cell: (p) => (
                <Link href={`/app/docs/${p.id}`}>
                  {p.icon && !p.icon.startsWith('http') && !p.icon.startsWith('/') ? `${p.icon} ` : ''}
                  {p.title || f.t('untitled')}
                </Link>
              ),
            },
            { key: 'views', label: f.t('report.views'), num: true, cell: (p) => f.num(p.views) },
            { key: 'readers', label: f.t('report.readers'), num: true, hideNarrow: true, cell: (p) => f.num(p.readers) },
            { key: 'edits', label: f.t('report.edits'), num: true, cell: (p) => f.num(p.edits) },
            { key: 'editors', label: f.t('report.editors'), num: true, hideNarrow: true, cell: (p) => f.num(p.editors) },
            { key: 'comments', label: f.t('report.comments'), num: true, hideNarrow: true, cell: (p) => f.num(p.comments) },
            { key: 'last', label: f.t('report.lastEdit'), hideNarrow: true, cell: (p) => (p.lastEditAt ? f.day(localDay(p.lastEditAt, d.range.tz)) : '—') },
          ]}
        />
      </Panel>
    </>
  );
}

function SiteView({ f, d }: { f: Fmt; d: DocsSiteAnalytics }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const maxPage = Math.max(1, ...d.pages.map((p) => p.views));
  const maxRef = Math.max(1, ...d.referrers.map((r) => r.visitors));
  const views = k.views.value ?? 0;
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('report.siteViews')} kpi={k.views} spark={d.perDay.map((p) => p.views)} better="up" />
        <KpiTile f={f} i={1} label={f.t('report.siteVisitors')} kpi={k.visitors} spark={d.perDay.map((p) => p.visitors)} better="up" />
        <KpiTile f={f} i={2} label={f.t('report.sitePages')} kpi={k.pages} better="up" />
        <KpiTile f={f} i={3} label={f.t('report.siteHelpful')} kpi={k.helpful} kind="percent" better="up" />
      </Kpis>
      <Panel title={f.t('report.siteViewsPerDay')}>
        <TrendChart
          labels={labels}
          series={[
            { name: f.t('report.siteViews'), values: d.perDay.map((p) => p.views), compare: d.prevViews },
            { name: f.t('report.siteVisitors'), values: d.perDay.map((p) => p.visitors) },
          ]}
          summary={chartAria(f, f.t('report.siteViewsPerDay'), d.range)}
          locale={f.locale}
          compareLabel={f.k('previous')}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('report.siteTopPages')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.pages.slice(0, 8).map((p) => ({
              key: p.id,
              label: <Link href={`/app/docs/${p.id}`}>{p.title || f.t('untitled')}</Link>,
              value: f.num(p.views),
              extra: pctOf(f, p.views, views),
              sub: f.t('report.siteVisitorsN', { n: p.visitors }),
              share: p.views / maxPage,
            }))}
          />
        </Panel>
        <Panel title={f.t('report.siteReferrers')}>
          <BarList
            empty={f.t('report.siteNoReferrers')}
            rows={d.referrers.map((r) => ({ key: r.host, label: r.host, value: f.t('report.siteVisitorsN', { n: r.visitors }), share: r.visitors / maxRef }))}
          />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('report.byPage')}>
        <DataTable
          rows={d.pages}
          rowKey={(p) => p.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'page', label: f.t('report.page'), wide: true, cell: (p) => <Link href={`/app/docs/${p.id}`}>{p.title || f.t('untitled')}</Link> },
            { key: 'views', label: f.t('report.siteViews'), num: true, cell: (p) => f.num(p.views) },
            { key: 'visitors', label: f.t('report.siteVisitors'), num: true, hideNarrow: true, cell: (p) => f.num(p.visitors) },
            {
              key: 'helpful',
              label: f.t('report.siteHelpful'),
              num: true,
              cell: (p) => (p.helpful + p.notHelpful > 0 ? f.pct(p.helpful / (p.helpful + p.notHelpful)) : '—'),
            },
          ]}
        />
      </Panel>
    </>
  );
}
