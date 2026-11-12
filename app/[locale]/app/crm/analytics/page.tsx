import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listPipelinesWithStages } from '@/lib/crm';
import { periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { CRM_ACTIVITY_TYPES, cachedCrmAnalytics, isCrmAnalyticsEmpty, type CrmAnalytics } from '@/lib/crm-analytics';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; pipeline?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'crm' });
  return { title: `${t('analytics.title')} · CRM` };
}

/**
 * CRM, analítica (/app/crm/analytics): deals, pipeline y actividad con el
 * alcance por owner de quien mira (sessionScope).
 */
export default async function CrmAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk, tz, scope, pipelines] = await Promise.all([
    getTranslations({ locale, namespace: 'crm' }),
    getTranslations({ locale, namespace: 'analyticsKit' }),
    viewerTz(),
    sessionScope(user),
    listPipelinesWithStages(user.id),
  ]);
  const period = periodChoice(sp);
  // Solo un pipeline del workspace: un id ajeno no se consulta.
  const pipelineId = pipelines.some((p) => p.id === sp.pipeline) ? sp.pipeline : undefined;
  const data = await cachedCrmAnalytics(user.id, user.actingUser?.id ?? user.id, scope, { days: period.days, from: period.from, to: period.to, tz, pipelineId });
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    currency: data.currency,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/crm/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), pipeline: pipelineId, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="crm"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        pipelines.length > 1 ? (
          <label className="ui-field">
            <span className="label">{t('analytics.pipeline')}</span>
            <select className="select" name="pipeline" defaultValue={pipelineId ?? ''}>
              <option value="">{t('analytics.allPipelines')}</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(pipelineId)}
      clearHref={base}
      empty={isCrmAnalyticsEmpty(data)}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${pipelineId ?? ''}`}
      foot={scope ? t('analytics.scopeNote') : undefined}
    >
      <CrmAnalyticsView f={f} d={data} multiPipeline={!pipelineId && pipelines.length > 1} />
    </AnalyticsPage>
  );
}

function CrmAnalyticsView({ f, d, multiPipeline }: { f: Fmt; d: CrmAnalytics; multiPipeline: boolean }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  // Con todos los pipelines, las etapas vacías de otros pipelines solo agregan ruido.
  const stages = multiPipeline ? d.stages.filter((s) => s.deals > 0) : d.stages;
  const maxStage = Math.max(1, ...stages.map((s) => s.amount));
  const maxStageDeals = Math.max(1, ...stages.map((s) => s.deals));
  const useAmount = stages.some((s) => s.amount > 0);
  const totalActs = d.activityTypes.reduce((a, x) => a + x.value, 0);
  const maxAct = Math.max(1, ...d.activityTypes.map((x) => x.value));
  const totalLost = d.lostReasons.reduce((a, x) => a + x.deals, 0);
  const maxLost = Math.max(1, ...d.lostReasons.map((x) => x.deals));
  const dealsN = (n: number) => f.t('analytics.dealsN', { n });
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.created')} kpi={k.created} spark={d.perDay.map((p) => p.created)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.won')} kpi={k.won} spark={d.perDay.map((p) => p.won)} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.lost')} kpi={k.lost} better="down" />
        <KpiTile f={f} i={3} label={f.t('analytics.wonAmount')} kpi={k.wonAmount} kind="money" better="up" />
        <KpiTile f={f} i={4} label={f.t('analytics.winRate')} kpi={k.winRate} kind="percent" better="up" />
        <KpiTile f={f} i={5} label={f.t('analytics.cycle')} kpi={{ value: k.cycleDays.value == null ? null : k.cycleDays.value * 1440, prev: k.cycleDays.prev == null ? null : k.cycleDays.prev * 1440 }} kind="duration" better="down" />
        <KpiTile f={f} i={6} label={f.t('analytics.openAmount')} kpi={k.openAmount} kind="money" snapshot />
        <KpiTile f={f} i={7} label={f.t('analytics.activities')} kpi={k.activities} better="up" />
      </Kpis>
      <Panel title={f.t('analytics.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            { name: f.t('analytics.created'), values: d.perDay.map((p) => p.created) },
            { name: f.t('analytics.won'), values: d.perDay.map((p) => p.won) },
            { name: f.t('analytics.lost'), values: d.perDay.map((p) => p.lost) },
          ]}
          summary={chartAria(f, f.t('analytics.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.byStage')} note={useAmount ? f.t('analytics.weightedSub', { value: f.money(k.weighted.value ?? 0) }) : undefined}>
          <BarList
            empty={f.t('analytics.noOpen')}
            rows={stages.map((s) => ({
              key: s.id,
              label: s.name,
              value: useAmount ? f.money(s.amount) : dealsN(s.deals),
              // El pipeline, la cantidad y el ponderado van abajo: en angosto, el nombre de la etapa entra entero.
              sub: [multiPipeline ? s.pipelineName : '', useAmount ? dealsN(s.deals) : '', useAmount && s.amount > 0 ? f.t('analytics.weightedSub', { value: f.money(Math.round(s.weighted)) }) : '']
                .filter(Boolean)
                .join(' · '),
              share: useAmount ? s.amount / maxStage : s.deals / maxStageDeals,
            }))}
          />
        </Panel>
        <Panel title={f.t('analytics.wonPerDay')}>
          {/* Barras: lo ganado cae en pocos días, y una línea entre ceros se lee como picos. */}
          <TrendChart
            kind="bars"
            labels={labels}
            series={[{ name: f.t('analytics.wonAmount'), values: d.perDay.map((p) => p.wonAmount) }]}
            height={220}
            summary={chartAria(f, f.t('analytics.wonPerDay'), d.range)}
            locale={f.locale}
            unit={d.currency}
          />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('analytics.activityTypes')}>
          <BarList
            tone="ink"
            empty={f.t('analytics.noActivity')}
            rows={
              totalActs === 0
                ? []
                : CRM_ACTIVITY_TYPES.map((key) => d.activityTypes.find((x) => x.key === key)!)
                    .filter((x) => x.value > 0 || x.prev > 0)
                    .map((x) => ({ key: x.key, label: f.t(`analytics.types.${x.key}`), value: f.num(x.value), extra: pctOf(f, x.value, totalActs), sub: f.k('before', { value: f.num(x.prev) }), share: x.value / maxAct }))
            }
          />
        </Panel>
        <Panel title={f.t('analytics.lostReasons')}>
          <BarList
            empty={f.t('analytics.noLost')}
            rows={d.lostReasons.map((x) => ({
              key: x.reason || '-',
              label: x.reason || <span className="la-muted">{f.t('analytics.noReason')}</span>,
              value: dealsN(x.deals),
              extra: pctOf(f, x.deals, totalLost),
              share: x.deals / maxLost,
            }))}
          />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('analytics.byOwner')}>
        <DataTable
          rows={d.owners}
          rowKey={(r) => r.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'owner', label: f.t('analytics.owner'), cell: (r) => r.name ?? f.t('analytics.removedOwner'), className: (r) => (r.name ? undefined : 'la-muted') },
            { key: 'created', label: f.t('analytics.created'), num: true, cell: (r) => f.num(r.created) },
            { key: 'won', label: f.t('analytics.won'), num: true, cell: (r) => f.num(r.won) },
            { key: 'lost', label: f.t('analytics.lost'), num: true, cell: (r) => f.num(r.lost) },
            { key: 'amount', label: f.t('analytics.wonAmount'), num: true, cell: (r) => f.money(r.wonAmount) },
            { key: 'acts', label: f.t('analytics.activities'), num: true, cell: (r) => f.num(r.activities) },
          ]}
        />
      </Panel>
    </>
  );
}
