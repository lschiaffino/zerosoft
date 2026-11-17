import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { cachedTrackAnalytics, isTrackAnalyticsEmpty, type TrackAnalytics } from '@/lib/track-analytics';
import { periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; team?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'trackPlanning' });
  return { title: `${t('analytics.title')} · Track` };
}

/**
 * Track, analítica (/app/track/analytics): issues creados y terminados,
 * tiempo de ciclo y abiertos de los equipos que la persona ve, con el kit de
 * analítica (el formato de Lines). Insights sigue siendo el armador de
 * gráficos a medida.
 */
export default async function TrackAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk, tz] = await Promise.all([getTranslations({ locale, namespace: 'trackPlanning' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz()]);
  const period = periodChoice(sp);
  const scope = { teamId: user.team?.id ?? null, ownerId: user.id };
  const viewer = realUserId(user);
  const q = { days: period.days, from: period.from, to: period.to, tz };
  const all = await cachedTrackAnalytics(scope, viewer, undefined, q);
  // Solo un equipo que la persona ve: uno ajeno no se consulta.
  const teamId = sp.team && all.teamList.some((x) => x.id === sp.team) ? sp.team : undefined;
  const data = teamId ? await cachedTrackAnalytics(scope, viewer, teamId, q) : all;
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/track/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), team: teamId, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="track"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        all.teamList.length > 1 ? (
          <label className="ui-field">
            <span className="label">{t('analytics.team')}</span>
            <select className="select" name="team" defaultValue={teamId ?? ''}>
              <option value="">{t('analytics.allTeams')}</option>
              {all.teamList.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(teamId)}
      clearHref={base}
      empty={isTrackAnalyticsEmpty(data)}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${teamId ?? ''}`}
      foot={t('analytics.note')}
    >
      <TrackView f={f} d={data} teamHref={(id) => href({ team: id })} />
    </AnalyticsPage>
  );
}

function TrackView({ f, d, teamHref }: { f: Fmt; d: TrackAnalytics; teamHref: (id: string) => string }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const completed = k.completed.value ?? 0;
  const maxTeam = Math.max(1, ...d.teams.map((x) => x.completed));
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.created')} kpi={k.created} spark={d.perDay.map((p) => p.created)} />
        <KpiTile f={f} i={1} label={f.t('analytics.completed')} kpi={k.completed} spark={d.perDay.map((p) => p.completed)} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.cycleTime')} kpi={k.cycleMin} kind="duration" better="down" />
        <KpiTile f={f} i={3} label={f.t('analytics.leadTime')} kpi={k.leadMin} kind="duration" better="down" />
        <KpiTile f={f} i={4} label={f.t('analytics.open')} kpi={k.open} snapshot />
      </Kpis>
      <Panel title={f.t('analytics.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            { name: f.t('analytics.created'), values: d.perDay.map((p) => p.created) },
            { name: f.t('analytics.completed'), values: d.perDay.map((p) => p.completed) },
          ]}
          summary={chartAria(f, f.t('analytics.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.byTeam')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.teams
              .filter((x) => x.completed > 0)
              .slice(0, 8)
              .map((x) => ({
                key: x.id,
                label: <Link href={teamHref(x.id)}>{x.name}</Link>,
                value: f.t('analytics.completedN', { n: x.completed }),
                extra: pctOf(f, x.completed, completed),
                sub: [f.t('analytics.createdN', { n: x.created }), f.t('analytics.openN', { n: x.open }), f.k('before', { value: f.num(x.prevCompleted) })].join(' · '),
                share: x.completed / maxTeam,
              }))}
          />
        </Panel>
        <Panel title={f.t('analytics.whenCompleted')}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('analytics.peak', p)} />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('analytics.byPerson')}>
        <DataTable
          rows={d.people}
          rowKey={(x) => x.id || 'none'}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'person', label: f.t('analytics.person'), wide: true, cell: (x) => x.name || f.t('analytics.unassigned'), className: (x) => (x.id ? undefined : 'la-muted') },
            { key: 'completed', label: f.t('analytics.completed'), num: true, cell: (x) => f.num(x.completed) },
            { key: 'created', label: f.t('analytics.created'), num: true, hideNarrow: true, cell: (x) => f.num(x.created) },
            { key: 'open', label: f.t('analytics.open'), num: true, cell: (x) => f.num(x.open) },
            { key: 'cycle', label: f.t('analytics.cycleTime'), num: true, hideNarrow: true, cell: (x) => f.dur(x.cycleMin) },
          ]}
        />
      </Panel>
    </>
  );
}
