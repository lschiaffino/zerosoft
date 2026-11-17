import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { socialActor, SocialError, visibleAccountRows } from '@/lib/social';
import { socialBestTimes } from '@/lib/social-analytics';
import { cachedSocialDashboard, isSocialDashboardEmpty, type SocialDashboard } from '@/lib/social-dashboard';
import { periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, hourLabel, pctOf, queryString, weekdays, type Fmt } from '@/components/analytics-kit/kit';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; account?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: `${t('analytics.title')} · Social` };
}

/**
 * Social, analítica (/app/social/analytics): publicaciones, impresiones,
 * alcance, interacción y clics de las cuentas que la persona ve, con el kit
 * de analítica (el formato de Lines) y el CSV de siempre.
 */
export default async function SocialAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk, tz] = await Promise.all([getTranslations({ locale, namespace: 'social' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz()]);
  const actor = socialActor(user);
  const accounts = await visibleAccountRows(actor);
  // Solo una cuenta que la persona ve: una ajena no se consulta.
  const accountId = accounts.some((a) => a.id === sp.account) ? sp.account : undefined;
  const period = periodChoice(sp);
  const [data, best] = await Promise.all([
    cachedSocialDashboard(actor, actor.personId, accountId, { days: period.days, from: period.from, to: period.to, tz }),
    socialBestTimes(actor, accountId ?? null, tz).catch((err) => {
      if (err instanceof SocialError) return null;
      throw err;
    }),
  ]);
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });

  // Sin cuentas: el vacío que invita a conectar una (no hay período que elegir).
  if (accounts.length === 0) {
    return (
      <div className="ui-page la" data-product="social">
        <PageHeader title={t('analytics.title')} description={t('analytics.description')} />
        <EmptyState title={t('analytics.emptyTitle')} body={t('analytics.emptyBody')} product="social" action={{ label: t('calendar.emptyAction'), href: '/app/social/accounts' }} />
      </div>
    );
  }

  const base = '/app/social/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), account: accountId, ...extra })}`;
  const csv = `/api/social/analytics${queryString({ days: String(period.days), format: 'csv', account: accountId })}`;
  // El origen de los mejores horarios en una línea y los horarios en otra (la frase no termina igual en cada caso).
  const bestNote =
    best && best.times.length ? (
      <>
        {best.source === 'data' ? t('compose.bestFromData', { n: best.samples }) : t('compose.bestDefault')}
        <br />
        <strong>{best.times.map((b) => `${weekdays(locale, 'short')[(b.weekday + 6) % 7]} ${hourLabel(b.hour)}`).join(' · ')}</strong>
      </>
    ) : undefined;
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.description')}
      product="social"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      exportHref={csv}
      filters={
        accounts.length > 1 ? (
          <label className="ui-field">
            <span className="label">{t('analytics.account')}</span>
            <select className="select" name="account" defaultValue={accountId ?? ''}>
              <option value="">{t('analytics.allAccounts')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(accountId)}
      clearHref={base}
      empty={isSocialDashboardEmpty(data)}
      emptyTitle={t('analytics.emptyPeriodTitle')}
      emptyBody={t('analytics.emptyPeriodBody')}
      contentKey={`${data.range.from}-${data.range.to}-${accountId ?? ''}`}
      foot={data.updatedAt ? t('analytics.updated', { when: f.dateTime(data.updatedAt) }) : t('analytics.notYet')}
    >
      <SocialView f={f} d={data} bestNote={bestNote} />
    </AnalyticsPage>
  );
}

function SocialView({ f, d, bestNote }: { f: Fmt; d: SocialDashboard; bestNote?: ReactNode }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const maxNet = Math.max(1, ...d.networks.map((x) => x.engagement));
  const totalEng = k.engagement.value ?? 0;
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.posts')} kpi={k.posts} spark={d.perDay.map((p) => p.posts)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.impressions')} kpi={k.impressions} spark={d.perDay.map((p) => p.impressions)} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.reach')} kpi={k.reach} spark={d.perDay.map((p) => p.reach)} better="up" />
        <KpiTile f={f} i={3} label={f.t('analytics.engagement')} kpi={k.engagement} spark={d.perDay.map((p) => p.engagement)} better="up" />
        <KpiTile f={f} i={4} label={f.t('analytics.clicks')} kpi={k.clicks} spark={d.perDay.map((p) => p.clicks)} better="up" />
        <KpiTile f={f} i={5} label={f.t('analytics.engagementRate')} kpi={k.engagementRate} kind="percent" better="up" />
        <KpiTile f={f} i={6} label={f.t('analytics.followers')} kpi={k.followers} better="up" />
      </Kpis>
      <Panel title={f.t('analytics.engagementPerDay')}>
        <TrendChart
          labels={labels}
          series={[
            { name: f.t('analytics.engagement'), values: d.perDay.map((p) => p.engagement) },
            { name: f.t('analytics.clicks'), values: d.perDay.map((p) => p.clicks) },
          ]}
          summary={chartAria(f, f.t('analytics.engagementPerDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.byNetwork')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.networks.map((x) => ({
              key: x.network,
              label: <span className="sc-net" data-net={x.network}>{x.name}</span>,
              value: f.num(x.engagement),
              extra: pctOf(f, x.engagement, totalEng),
              sub: [f.t('analytics.postsN', { n: x.posts }), f.t('analytics.impressionsN', { n: f.num(x.impressions) })].join(' · '),
              share: x.engagement / maxNet,
            }))}
          />
        </Panel>
        <Panel title={f.t('analytics.whenEngage')} note={bestNote}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('analytics.peak', p)} />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('analytics.byPost')}>
        <DataTable
          rows={d.topPosts}
          rowKey={(p) => p.targetId}
          empty={f.t('analytics.noPosts')}
          columns={[
            {
              key: 'post',
              label: f.t('analytics.postCol'),
              wide: true,
              cell: (p) => <Link href={`/app/social/posts/${p.postId}`}>{p.text.replace(/\s+/g, ' ').slice(0, 120) || f.t('calendar.mediaOnly')}</Link>,
            },
            { key: 'account', label: f.t('analytics.accountCol'), hideNarrow: true, cell: (p) => <span className="sc-net" data-net={p.network}>{p.account}</span> },
            { key: 'impressions', label: f.t('analytics.impressions'), num: true, cell: (p) => (p.impressions == null ? '—' : f.num(p.impressions)) },
            { key: 'engagement', label: f.t('analytics.engagement'), num: true, cell: (p) => (p.engagement == null ? '—' : f.num(p.engagement)) },
            { key: 'clicks', label: f.t('analytics.clicks'), num: true, hideNarrow: true, cell: (p) => (p.clicks == null ? '—' : f.num(p.clicks)) },
          ]}
        />
      </Panel>
      <Panel title={f.t('analytics.byAccount')}>
        <DataTable
          rows={d.accounts}
          rowKey={(a) => a.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'account', label: f.t('analytics.accountCol'), cell: (a) => <span className="sc-net" data-net={a.network}>{a.name}</span> },
            {
              key: 'followers',
              label: f.t('analytics.followers'),
              num: true,
              cell: (a) =>
                a.followers == null
                  ? '—'
                  : `${f.num(a.followers)}${a.followersDelta ? ` (${new Intl.NumberFormat(f.locale, { signDisplay: 'exceptZero' }).format(a.followersDelta)})` : ''}`,
            },
            { key: 'posts', label: f.t('analytics.posts'), num: true, hideNarrow: true, cell: (a) => f.num(a.posts) },
            { key: 'impressions', label: f.t('analytics.impressions'), num: true, hideNarrow: true, cell: (a) => f.num(a.impressions) },
            { key: 'engagement', label: f.t('analytics.engagement'), num: true, cell: (a) => f.num(a.engagement) },
          ]}
        />
      </Panel>
    </>
  );
}
