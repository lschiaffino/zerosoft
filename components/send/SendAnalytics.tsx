import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { SendActor } from '@/lib/send/types';
import { cachedSendAnalytics, isSendAnalyticsEmpty, type SendAnalytics as Data } from '@/lib/send/dashboard';
import { periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import '@/styles/analytics-kit.css';

type Search = { days?: string; from?: string; to?: string; doc?: string };

/**
 * Send, analítica (/app/send/analytics): visitas, personas, tiempo de
 * lectura, cuánto leyeron y descargas de los documentos que la persona ve,
 * con el kit de analítica (el formato de Lines).
 */
export default async function SendAnalytics({ locale, actor, sp }: { locale: string; actor: SendActor; sp: Search }) {
  const [t, tv, tk, tz] = await Promise.all([
    getTranslations({ locale, namespace: 'send' }),
    getTranslations({ locale, namespace: 'send.visits' }),
    getTranslations({ locale, namespace: 'analyticsKit' }),
    viewerTz(),
  ]);
  const period = periodChoice(sp);
  const q = { days: period.days, from: period.from, to: period.to, tz };
  const all = await cachedSendAnalytics(actor, undefined, q);
  // Solo un documento que la persona ve: uno ajeno no se consulta.
  const docId = sp.doc && all.docList.some((d) => d.id === sp.doc) ? sp.doc : undefined;
  const data = docId ? await cachedSendAnalytics(actor, docId, q) : all;

  if (all.docCount === 0) {
    return (
      <div className="ui-page la" data-product="send">
        <PageHeader title={t('analytics.title')} description={t('analytics.desc')} />
        <EmptyState title={t('analytics.noDocsTitle')} body={t('analytics.noDocsBody')} product="send" action={{ label: t('nav.new'), href: '/app/send/new' }} />
      </div>
    );
  }

  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/send/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), doc: docId, ...extra })}`;
  const countryName = (() => {
    try {
      const dn = new Intl.DisplayNames([locale], { type: 'region' });
      return (c: string) => dn.of(c.toUpperCase()) ?? c;
    } catch {
      return (c: string) => c;
    }
  })();
  const deviceName = (d: string) => (['desktop', 'mobile', 'tablet'].includes(d) ? tv(`device_${d}` as never) : d);
  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="send"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        all.docList.length > 1 ? (
          <label className="ui-field">
            <span className="label">{t('analytics.doc')}</span>
            <select className="select" name="doc" defaultValue={docId ?? ''}>
              <option value="">{t('analytics.allDocs')}</option>
              {all.docList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(docId)}
      clearHref={base}
      empty={isSendAnalyticsEmpty(data)}
      emptyTitle={t('analytics.emptyTitle')}
      emptyBody={t('analytics.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${docId ?? ''}`}
      foot={t('analytics.note')}
    >
      <SendView f={f} d={data} countryName={countryName} deviceName={deviceName} />
    </AnalyticsPage>
  );
}

function SendView({ f, d, countryName, deviceName }: { f: Fmt; d: Data; countryName: (c: string) => string; deviceName: (d: string) => string }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const visits = k.visits.value ?? 0;
  const maxDoc = Math.max(1, ...d.docs.map((x) => x.visits));
  const bars = (items: Array<{ name: string; count: number }>, label: (n: string) => string) => {
    const total = items.reduce((s, i) => s + i.count, 0);
    const max = Math.max(1, ...items.map((i) => i.count));
    return items.map((i) => ({ key: i.name, label: label(i.name), value: f.num(i.count), extra: pctOf(f, i.count, total), share: i.count / max }));
  };
  const secMin = (s: number | null | undefined) => (s == null ? null : s / 60);
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.visits')} kpi={k.visits} spark={d.perDay.map((p) => p.visits)} better="up" />
        <KpiTile f={f} i={1} label={f.t('analytics.viewers')} kpi={k.viewers} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.avgTime')} kpi={{ value: secMin(k.avgSeconds.value), prev: secMin(k.avgSeconds.prev) }} kind="duration" better="up" />
        <KpiTile f={f} i={3} label={f.t('analytics.completion')} kpi={k.completion} kind="percent" better="up" />
        <KpiTile f={f} i={4} label={f.t('analytics.downloads')} kpi={k.downloads} />
      </Kpis>
      <Panel title={f.t('analytics.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[{ name: f.t('analytics.visits'), values: d.perDay.map((p) => p.visits) }]}
          summary={chartAria(f, f.t('analytics.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('analytics.byDoc')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.docs
              .filter((x) => x.visits > 0)
              .slice(0, 8)
              .map((x) => ({
                key: x.id,
                label: x.title,
                value: f.t('analytics.visitsN', { n: x.visits }),
                extra: pctOf(f, x.visits, visits),
                sub: [f.t('analytics.viewersN', { n: x.viewers }), f.k('before', { value: f.num(x.prevVisits) })].join(' · '),
                share: x.visits / maxDoc,
              }))}
          />
        </Panel>
        <Panel title={f.t('analytics.whenVisits')}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('analytics.peak', p)} />
        </Panel>
      </PanelGrid>
      <PanelGrid>
        <Panel title={f.t('analytics.countries')}>
          <BarList rows={bars(d.countries, countryName)} empty={f.k('noneInPeriod')} />
        </Panel>
        <Panel title={f.t('analytics.devices')}>
          <BarList tone="ink" rows={bars(d.devices, deviceName)} empty={f.k('noneInPeriod')} />
        </Panel>
      </PanelGrid>
      <Panel title={f.t('analytics.docsTable')}>
        <DataTable
          rows={d.docs}
          rowKey={(x) => x.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'doc', label: f.t('analytics.doc'), wide: true, cell: (x) => <Link href={`/app/send/documents/${x.id}?tab=activity`}>{x.title}</Link> },
            { key: 'visits', label: f.t('analytics.visits'), num: true, cell: (x) => f.num(x.visits) },
            { key: 'viewers', label: f.t('analytics.viewers'), num: true, hideNarrow: true, cell: (x) => f.num(x.viewers) },
            { key: 'time', label: f.t('analytics.avgTime'), num: true, hideNarrow: true, cell: (x) => (x.visits ? f.dur(Math.round((x.seconds / x.visits / 60) * 10) / 10) : '—') },
            { key: 'completion', label: f.t('analytics.completion'), num: true, cell: (x) => (x.completion == null ? '—' : f.pct(x.completion)) },
          ]}
        />
      </Panel>
    </>
  );
}
