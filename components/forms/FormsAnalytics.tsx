import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { FormsActor } from '@/lib/forms/types';
import { cachedFormsAnalytics, isFormsAnalyticsEmpty, type FormsAnalytics as Data } from '@/lib/forms/analytics';
import { periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import '@/styles/analytics-kit.css';

type Search = { days?: string; from?: string; to?: string; form?: string };

/**
 * Forms, analítica (/app/forms/analytics): visitas, respuestas, tasa de
 * finalización y respuestas a medias de los formularios que la persona ve,
 * con el kit de analítica (el formato de Lines).
 */
export default async function FormsAnalytics({ locale, actor, sp }: { locale: string; actor: FormsActor; sp: Search }) {
  const [t, tk, tz] = await Promise.all([getTranslations({ locale, namespace: 'forms' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz()]);
  const period = periodChoice(sp);
  const all = await cachedFormsAnalytics(actor, undefined, { days: period.days, from: period.from, to: period.to, tz });
  // Solo un formulario que la persona ve: uno ajeno no se consulta.
  const formId = sp.form && all.formList.some((x) => x.id === sp.form) ? sp.form : undefined;
  const data = formId ? await cachedFormsAnalytics(actor, formId, { days: period.days, from: period.from, to: period.to, tz }) : all;

  if (all.formCount === 0) {
    return (
      <div className="ui-page la" data-product="forms">
        <PageHeader title={t('analytics.title')} description={t('analytics.desc')} />
        <EmptyState title={t('analytics.noFormsTitle')} body={t('analytics.noFormsBody')} product="forms" action={{ label: t('list.new'), href: '/app/forms/new' }} />
      </div>
    );
  }

  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/forms/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), form: formId, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="forms"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        all.formList.length > 1 ? (
          <label className="ui-field">
            <span className="label">{t('analytics.form')}</span>
            <select className="select" name="form" defaultValue={formId ?? ''}>
              <option value="">{t('analytics.allForms')}</option>
              {all.formList.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(formId)}
      clearHref={base}
      empty={isFormsAnalyticsEmpty(data)}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${formId ?? ''}`}
      foot={t('analytics.note')}
    >
      <FormsView f={f} d={data} />
    </AnalyticsPage>
  );
}

function FormsView({ f, d }: { f: Fmt; d: Data }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const maxForm = Math.max(1, ...d.forms.map((x) => x.responses));
  const totalResponses = k.responses.value ?? 0;
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.views')} kpi={k.views} spark={d.perDay.map((p) => p.views)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.responses')} kpi={k.responses} spark={d.perDay.map((p) => p.responses)} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.completion')} kpi={k.completion} kind="percent" better="up" />
        <KpiTile f={f} i={3} label={f.t('analytics.partial')} kpi={k.partial} spark={d.perDay.map((p) => p.partial)} sparkTone="out" better="down" />
      </Kpis>
      <Panel title={f.t('analytics.perDay')}>
        <TrendChart
          labels={labels}
          series={[
            { name: f.t('analytics.views'), values: d.perDay.map((p) => p.views) },
            { name: f.t('analytics.responses'), values: d.perDay.map((p) => p.responses) },
          ]}
          summary={chartAria(f, f.t('analytics.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.byForm')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.forms
              .filter((x) => x.responses > 0)
              .slice(0, 8)
              .map((x) => ({
                key: x.id,
                label: x.name,
                value: f.t('analytics.responsesN', { n: x.responses }),
                extra: pctOf(f, x.responses, totalResponses),
                sub: [f.t('analytics.viewsN', { n: x.views }), f.k('before', { value: f.num(x.prevResponses) })].join(' · '),
                share: x.responses / maxForm,
              }))}
          />
        </Panel>
        <Panel title={f.t('analytics.whenResponses')}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('analytics.peak', p)} />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('analytics.formsTable')}>
        <DataTable
          rows={d.forms}
          rowKey={(x) => x.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'form', label: f.t('analytics.form'), wide: true, cell: (x) => <Link href={`/app/forms/${x.id}/summary`}>{x.name}</Link> },
            { key: 'views', label: f.t('analytics.views'), num: true, cell: (x) => f.num(x.views) },
            { key: 'responses', label: f.t('analytics.responses'), num: true, cell: (x) => f.num(x.responses) },
            { key: 'completion', label: f.t('analytics.completion'), num: true, hideNarrow: true, cell: (x) => (x.views ? pctOf(f, x.completedViews, x.views) : '—') },
            { key: 'partial', label: f.t('analytics.partial'), num: true, hideNarrow: true, cell: (x) => f.num(x.partial) },
          ]}
        />
      </Panel>
    </>
  );
}
