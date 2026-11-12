import { getTranslations } from 'next-intl/server';
import { periodChoice, type PeriodSearch } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { cachedCallsAnalytics, isCallsAnalyticsEmpty, type CallsAnalytics as Data } from '@/lib/calls/analytics';
import { getSettings } from '@/lib/calls/settings';
import type { CallsActor } from '@/lib/calls/types';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

/**
 * Calls, analítica (/app/calls/analytics): lo que la persona puede ver en la
 * biblioteca (visibilidad del workspace), agregado por día y por rep.
 */
export default async function CallsAnalytics({ locale, actor, search }: { locale: string; actor: CallsActor; search: PeriodSearch }) {
  const [t, tk, tz, settings] = await Promise.all([
    getTranslations({ locale, namespace: 'calls' }),
    getTranslations({ locale, namespace: 'analyticsKit' }),
    viewerTz(),
    getSettings(actor.ws),
  ]);
  const period = periodChoice(search);
  const data = await cachedCallsAnalytics(actor, { days: period.days, from: period.from, to: period.to, tz });
  const f = analyticsFmt({ locale, tz: data.range.tz, t: (key, values) => t(key as never, values as never), k: (key, values) => tk(key as never, values as never) });
  const base = '/app/calls/analytics';
  const onlyMine = settings.visibility === 'private' && !actor.admin;
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="calls"
      range={data.range}
      period={period}
      periodHref={(days) => `${base}${queryString({ days: days === 30 ? undefined : String(days) })}`}
      formAction={`/${locale}${base}`}
      filtered={period.custom}
      clearHref={base}
      empty={isCallsAnalyticsEmpty(data)}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}`}
      foot={onlyMine ? t('analytics.privateScope') : undefined}
    >
      <CallsAnalyticsView f={f} d={data} />
    </AnalyticsPage>
  );
}

function CallsAnalyticsView({ f, d }: { f: Fmt; d: Data }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const maxTopic = Math.max(1, ...d.topics.map((x) => x.calls));
  const maxComp = Math.max(1, ...d.competitors.map((x) => x.calls));
  const banded = d.talkBands.reduce((a, b) => a + b, 0);
  const maxBand = Math.max(1, ...d.talkBands);
  const callsN = (n: number) => f.t('analytics.callsN', { n });
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.calls')} kpi={k.calls} spark={d.perDay.map((p) => p.calls)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.minutes')} kpi={k.minutes} spark={d.perDay.map((p) => p.minutes)} sparkTone="out" />
        <KpiTile f={f} i={2} label={f.t('analytics.avgMinutes')} kpi={k.avgMinutes} kind="decimal" />
        <KpiTile f={f} i={3} label={f.t('analytics.talkRatio')} kpi={k.talkRatio} kind="percent" />
        <KpiTile f={f} i={4} label={f.t('analytics.questions')} kpi={k.questions} better="up" />
        <KpiTile f={f} i={5} label={f.t('analytics.teamQuestions')} kpi={k.teamQuestions} />
        <KpiTile f={f} i={6} label={f.t('analytics.score')} kpi={k.score} better="up" />
        <KpiTile f={f} i={7} label={f.t('analytics.reps')} kpi={k.reps} />
      </Kpis>
      <PanelGrid>
        <Panel title={f.t('analytics.perDay')}>
          <TrendChart
            kind="bars"
            labels={labels}
            series={[{ name: f.t('analytics.calls'), values: d.perDay.map((p) => p.calls) }]}
            height={220}
            summary={chartAria(f, f.t('analytics.perDay'), d.range)}
            locale={f.locale}
          />
        </Panel>
        <Panel title={f.t('analytics.minutesPerDay')}>
          <TrendChart
            labels={labels}
            series={[{ name: f.t('analytics.minutes'), values: d.perDay.map((p) => p.minutes), compare: d.prevPerDay.map((p) => p.minutes) }]}
            height={220}
            summary={chartAria(f, f.t('analytics.minutesPerDay'), d.range)}
            locale={f.locale}
            unit={f.k('minUnit')}
            compareLabel={f.k('previous')}
          />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('analytics.topics')}>
          <BarList
            empty={f.t('analytics.noTopics')}
            rows={d.topics.map((x) => ({ key: x.name.toLowerCase(), label: x.name, value: callsN(x.calls), extra: pctOf(f, x.calls, k.calls.value ?? 0), share: x.calls / maxTopic }))}
          />
        </Panel>
        <Panel title={f.t('analytics.competitors')}>
          <BarList
            tone="ink"
            empty={f.t('analytics.noCompetitors')}
            rows={d.competitors.map((x) => ({ key: x.name.toLowerCase(), label: x.name, value: callsN(x.calls), extra: pctOf(f, x.calls, k.calls.value ?? 0), share: x.calls / maxComp }))}
          />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('analytics.talkBands')}>
          <BarList
            empty={f.t('analytics.noTalk')}
            rows={banded === 0 ? [] : d.talkBands.map((n, i) => ({ key: String(i), label: f.t(`analytics.bands.b${i}`), value: callsN(n), extra: pctOf(f, n, banded), share: n / maxBand }))}
          />
        </Panel>
        <Panel title={f.t('analytics.byRep')}>
          <DataTable
            rows={d.reps}
            rowKey={(r) => r.id}
            empty={f.k('noneInPeriod')}
            columns={[
              { key: 'rep', label: f.t('analytics.rep'), cell: (r) => r.name ?? f.t('analytics.removedRep'), className: (r) => (r.name ? undefined : 'la-muted') },
              { key: 'calls', label: f.t('analytics.calls'), num: true, cell: (r) => f.num(r.calls) },
              { key: 'min', label: f.t('analytics.minutes'), num: true, cell: (r) => f.num(r.minutes) },
              { key: 'talk', label: f.t('analytics.talkRatio'), num: true, cell: (r) => (r.talkRatio == null ? '—' : f.pct(r.talkRatio)) },
              { key: 'q', label: f.t('analytics.questions'), num: true, cell: (r) => f.num(r.questions) },
              { key: 'score', label: f.t('analytics.score'), num: true, cell: (r) => (r.score == null ? '—' : f.num(r.score)) },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
