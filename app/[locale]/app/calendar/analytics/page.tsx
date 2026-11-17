import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import { analyticsHosts, cachedCalAnalytics, type CalAnalytics } from '@/lib/calendar-analytics';
import { periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, emptyHeat, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; host?: string; et?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'calendar' });
  return { title: `${t('analytics.title')} · Cal` };
}

/**
 * Cal, analítica (/app/calendar/analytics): reservas creadas, canceladas y
 * no-shows en un período contra el anterior, con el kit de analítica (el
 * formato de Lines). Un member ve solo lo suyo; un admin, a cualquiera.
 */
export default async function CalendarAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk, tz, allHosts, eventTypes] = await Promise.all([
    getTranslations({ locale, namespace: 'calendar' }),
    getTranslations({ locale, namespace: 'analyticsKit' }),
    viewerTz(),
    analyticsHosts(user.id),
    listEventTypes(user.id, { includePolls: true }),
  ]);
  // Un member ve solo lo suyo (como en Calendly); un admin, a cualquiera del equipo.
  const admin = isWorkspaceAdmin(user);
  const me = realUserId(user);
  const hosts = admin ? allHosts : [];
  // Filtros por persona y por tipo de evento: solo valores del workspace.
  const hostId = admin ? (hosts.some((h) => h.id === sp.host) ? (sp.host as string) : '') : me;
  const eventTypeId = eventTypes.some((e) => e.id === sp.et) ? (sp.et as string) : '';
  const period = periodChoice(sp);
  const data = await cachedCalAnalytics(user.id, me, { hostId, eventTypeId }, { days: period.days, from: period.from, to: period.to, tz });
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/calendar/analytics';
  const filters = { host: admin && hostId ? hostId : undefined, et: eventTypeId || undefined };
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), ...filters, ...extra })}`;
  const exportQs = queryString({ from: data.range.from, to: data.range.to, ...filters });
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="cal"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      exportHref={`/api/calendar/analytics/export${exportQs}`}
      filters={
        <>
          {hosts.length > 0 && (
            <label className="ui-field">
              <span className="label">{t('analytics.host')}</span>
              <select className="select" name="host" defaultValue={hostId}>
                <option value="">{t('analytics.allHosts')}</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {eventTypes.length > 0 && (
            <label className="ui-field">
              <span className="label">{t('analytics.eventType')}</span>
              <select className="select" name="et" defaultValue={eventTypeId}>
                <option value="">{t('analytics.allEventTypes')}</option>
                {eventTypes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.kind === 'poll' ? t('analytics.pollPrefix', { title: e.title }) : e.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      }
      filtered={period.custom || Boolean(filters.host || filters.et)}
      clearHref={base}
      empty={data.cur.created === 0}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${hostId}-${eventTypeId}`}
      foot={admin ? t('analytics.note') : `${t('analytics.note')} ${t('analytics.scopeNote')}`}
    >
      <CalAnalyticsView f={f} d={data} admin={admin} hostHref={(id) => href({ host: id })} />
    </AnalyticsPage>
  );
}

function CalAnalyticsView({ f, d, admin, hostHref }: { f: Fmt; d: CalAnalytics; admin: boolean; hostHref: (id: string) => string }) {
  const { cur, prev } = d;
  const labels = cur.byDay.map((p) => f.day(p.date));
  const live = cur.byDay.map((p, i) => p.count - cur.cancelledByDay[i] - cur.noShowByDay[i]);
  // El mapa de calor de Cal empieza el domingo; el del kit, el lunes.
  const heat = emptyHeat().map((_, d0) => cur.heatmap[(d0 + 1) % 7]);
  const maxType = Math.max(1, ...cur.byEventType.map((e) => e.created));
  const bookingsN = (n: number) => f.t('analytics.bookingsN', { n });
  const prevTypes = new Map(prev.byEventType.map((e) => [e.id, e.created]));
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.created')} kpi={{ value: cur.created, prev: prev.created }} spark={cur.byDay.map((p) => p.count)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.confirmed')} kpi={{ value: cur.confirmed, prev: prev.confirmed }} spark={live} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.cancelled')} kpi={{ value: cur.cancelled, prev: prev.cancelled }} spark={cur.cancelledByDay} sparkTone="out" better="down" />
        <KpiTile f={f} i={3} label={f.t('analytics.cancelRate')} kpi={{ value: cur.cancelRate, prev: prev.cancelRate }} kind="percent" better="down" />
        <KpiTile f={f} i={4} label={f.t('analytics.noShow')} kpi={{ value: cur.noShow, prev: prev.noShow }} better="down" />
        <KpiTile f={f} i={5} label={f.t('analytics.leadTime')} kpi={{ value: cur.leadMin, prev: prev.leadMin }} kind="duration" />
      </Kpis>
      <Panel title={f.t('analytics.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            { name: f.t('analytics.confirmed'), values: live },
            { name: f.t('analytics.cancelled'), values: cur.cancelledByDay },
            { name: f.t('analytics.noShow'), values: cur.noShowByDay },
          ]}
          summary={chartAria(f, f.t('analytics.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.byEventType')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={cur.byEventType.map((e) => ({
              key: e.id,
              label: e.title,
              value: bookingsN(e.created),
              extra: pctOf(f, e.created, cur.created),
              sub: [
                f.t('analytics.cancelledN', { n: e.cancelled }),
                f.t('analytics.noShowN', { n: e.noShow }),
                f.k('before', { value: f.num(prevTypes.get(e.id) ?? 0) }),
              ].join(' · '),
              share: e.created / maxType,
            }))}
          />
        </Panel>
        <Panel title={f.t('analytics.popularTimes')} note={f.t('analytics.popularTimesLead')}>
          <Heatmap f={f} data={heat} none={f.k('noneInPeriod')} peak={(p) => f.t('analytics.peak', p)} />
        </Panel>
      </PanelGrid>
      {admin && cur.byHost.length > 0 && (
        <Panel title={f.t('analytics.byHost')}>
          <DataTable
            rows={cur.byHost}
            rowKey={(r) => r.id || 'none'}
            empty={f.k('noneInPeriod')}
            columns={[
              {
                key: 'host',
                label: f.t('analytics.host'),
                cell: (r) => (r.id ? <Link href={hostHref(r.id)}>{r.name || f.t('analytics.unknownHost')}</Link> : f.t('analytics.unknownHost')),
                className: (r) => (r.id ? undefined : 'la-muted'),
              },
              { key: 'created', label: f.t('analytics.created'), num: true, cell: (r) => f.num(r.created) },
              { key: 'cancelled', label: f.t('analytics.cancelled'), num: true, hideNarrow: true, cell: (r) => f.num(r.cancelled) },
              { key: 'noShow', label: f.t('analytics.noShow'), num: true, hideNarrow: true, cell: (r) => f.num(r.noShow) },
              { key: 'rate', label: f.t('analytics.cancelRate'), num: true, cell: (r) => pctOf(f, r.cancelled, r.created) },
            ]}
          />
        </Panel>
      )}
    </>
  );
}
