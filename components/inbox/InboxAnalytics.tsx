import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { periodChoice, type PeriodSearch } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { INBOX_CHANNELS, cachedInboxAnalytics, isInboxAnalyticsEmpty, type InboxAnalytics as Data } from '@/lib/inbox/analytics';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

/**
 * Inbox, analítica (/app/inbox/analytics): lo de la persona y nada más. El
 * Inbox es personal; no hay filtro por persona ni vista de equipo.
 */
export default async function InboxAnalytics({ locale, owner, search }: { locale: string; owner: string; search: PeriodSearch }) {
  const [t, tk, tz] = await Promise.all([getTranslations({ locale, namespace: 'inbox' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz()]);
  const period = periodChoice(search);
  const data = await cachedInboxAnalytics(owner, { days: period.days, from: period.from, to: period.to, tz });
  const f = analyticsFmt({ locale, tz: data.range.tz, t: (key, values) => t(key as never, values as never), k: (key, values) => tk(key as never, values as never) });
  const base = '/app/inbox/analytics';
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="inbox"
      range={data.range}
      period={period}
      periodHref={(days) => `${base}${queryString({ days: days === 30 ? undefined : String(days) })}`}
      formAction={`/${locale}${base}`}
      filtered={period.custom}
      clearHref={base}
      empty={isInboxAnalyticsEmpty(data)}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}`}
      foot={t('analytics.private')}
    >
      <InboxAnalyticsView f={f} d={data} />
    </AnalyticsPage>
  );
}

function InboxAnalyticsView({ f, d }: { f: Fmt; d: Data }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const channelName = (c: string) => f.t(`analytics.channels.${c}`);
  const totalByChannel = d.byChannel.reduce((a, c) => a + c.received + c.sent, 0);
  const maxChannel = Math.max(1, ...d.byChannel.map((c) => c.received + c.sent));
  const responses = d.buckets.reduce((a, b) => a + b, 0);
  const maxBucket = Math.max(1, ...d.buckets);
  const frTitle = f.t('analytics.frPerDay');
  // Con medianas de horas, el eje en minutos (0 a 2000) no se lee: pasa a horas.
  const frHours = Math.max(0, ...d.responsePerDay.map((p) => p.medianMin ?? 0)) > 180;
  const frValues = d.responsePerDay.map((p) => (p.medianMin == null ? null : frHours ? Math.round((p.medianMin / 60) * 10) / 10 : p.medianMin));
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.received')} kpi={k.received} spark={d.perDay.map((p) => p.received)} />
        <KpiTile f={f} i={1} label={f.t('analytics.sent')} kpi={k.sent} spark={d.perDay.map((p) => p.sent)} sparkTone="out" />
        <KpiTile f={f} i={2} label={f.t('analytics.threads')} kpi={k.threads} />
        <KpiTile f={f} i={3} label={f.t('analytics.firstResponse')} kpi={k.firstResponseMin} kind="duration" better="down" />
        <KpiTile f={f} i={4} label={f.t('analytics.toReply')} kpi={k.toReply} snapshot />
        <KpiTile f={f} i={5} label={f.t('analytics.waiting')} kpi={k.waiting} snapshot />
        <KpiTile f={f} i={6} label={f.t('analytics.done')} kpi={k.done} better="up" />
        <KpiTile f={f} i={7} label={f.t('analytics.archived')} kpi={k.archived} />
      </Kpis>
      <Panel title={f.t('analytics.perChannel')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={INBOX_CHANNELS.map((c) => ({ name: channelName(c), values: d.perDay.map((p) => p[c]) }))}
          summary={chartAria(f, f.t('analytics.perChannel'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.volume')}>
          <TrendChart
            labels={labels}
            series={[
              { name: f.t('analytics.received'), values: d.perDay.map((p) => p.received), compare: d.prevPerDay.map((p) => p.received) },
              { name: f.t('analytics.sent'), values: d.perDay.map((p) => p.sent), compare: d.prevPerDay.map((p) => p.sent) },
            ]}
            height={220}
            summary={chartAria(f, f.t('analytics.volume'), d.range)}
            locale={f.locale}
            compareLabel={f.k('previous')}
          />
        </Panel>
        <Panel title={f.t('analytics.byChannel')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.byChannel
              .filter((c) => c.received + c.sent > 0)
              .map((c) => ({
                key: c.key,
                label: channelName(c.key),
                value: f.num(c.received + c.sent),
                extra: pctOf(f, c.received + c.sent, totalByChannel),
                sub: f.t('analytics.inOut', { inbound: f.num(c.received), outbound: f.num(c.sent) }),
                share: (c.received + c.sent) / maxChannel,
              }))}
          />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={frTitle} note={f.t('analytics.frNote')}>
          {responses === 0 ? (
            <p className="la-panel-empty">{f.t('analytics.noResponses')}</p>
          ) : (
            <TrendChart
              labels={labels}
              series={[{ name: f.t('analytics.firstResponse'), values: frValues }]}
              summary={chartAria(f, frTitle, d.range)}
              locale={f.locale}
              unit={frHours ? f.k('hourUnit') : f.k('minUnit')}
              height={220}
            />
          )}
        </Panel>
        <Panel title={f.t('analytics.frBuckets')}>
          <BarList
            empty={f.t('analytics.noResponses')}
            rows={responses === 0 ? [] : d.buckets.map((n, i) => ({ key: String(i), label: f.k(`buckets.b${i}`), value: f.num(n), extra: pctOf(f, n, responses), share: n / maxBucket }))}
          />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('analytics.heatmap')}>
          <Heatmap f={f} data={d.heatmap} none={f.t('analytics.heatNone')} peak={(p) => f.t('analytics.heatPeak', p)} />
        </Panel>
        <Panel title={f.t('analytics.topThreads')}>
          <DataTable
            rows={d.topThreads}
            rowKey={(r) => r.id}
            empty={f.k('noneInPeriod')}
            columns={[
              {
                key: 'chat',
                label: f.t('analytics.chat'),
                // El canal debajo del nombre, no en una columna: a 390 px la tabla entra sin scroll.
                cell: (r) => (
                  <>
                    <Link href={`/app/inbox?t=${r.id}`}>{r.title}</Link>
                    <small className="la-cell-sub">{channelName(r.channel)}</small>
                  </>
                ),
              },
              { key: 'in', label: f.t('analytics.received'), num: true, cell: (r) => f.num(r.received) },
              { key: 'out', label: f.t('analytics.sent'), num: true, cell: (r) => f.num(r.sent) },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
