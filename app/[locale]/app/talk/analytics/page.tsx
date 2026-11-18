import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { resolveTalkActor } from '@/lib/talk-guests';
import { cachedTalkAnalytics, isTalkAnalyticsEmpty, type TalkAnalytics } from '@/lib/talk-analytics';
import { localDay, periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; channel?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'talk' });
  return { title: `${t('report.title')} · Talk` };
}

/**
 * Talk, analítica (/app/talk/analytics): mensajes, respuestas, quién escribe y
 * cuándo, reacciones y huddles de los canales que la persona puede leer, con
 * el kit de analítica (el formato de Lines).
 */
export default async function TalkAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale, `/${locale}/app/talk/analytics`);
  const [t, tk, tz, actor] = await Promise.all([getTranslations({ locale, namespace: 'talk' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz(), resolveTalkActor(user)]);
  const period = periodChoice(sp);
  const q = { days: period.days, from: period.from, to: period.to, tz };
  const all = await cachedTalkAnalytics(actor, undefined, q);
  // Solo un canal que la persona ve.
  const channel = sp.channel && all.channelList.some((x) => x.id === sp.channel) ? sp.channel : undefined;
  const data = channel ? await cachedTalkAnalytics(actor, channel, q) : all;
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/talk/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), channel, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('report.title')}
      description={t('report.desc')}
      product="talk"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        all.channelList.length > 0 ? (
          <label className="ui-field">
            <span className="label">{t('report.channel')}</span>
            <select className="select" name="channel" defaultValue={channel ?? ''}>
              <option value="">{t('report.allChannels')}</option>
              {all.channelList.map((x) => (
                <option key={x.id} value={x.id}>
                  #{x.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(channel)}
      clearHref={base}
      empty={isTalkAnalyticsEmpty(data)}
      emptyTitle={all.channelCount === 0 ? t('report.noChannelsTitle') : t('report.emptyTitle')}
      emptyBody={all.channelCount === 0 ? t('report.noChannelsBody') : t('report.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${channel ?? ''}`}
      foot={t('report.note')}
    >
      <TalkView f={f} d={data} channelHref={(id) => href({ channel: id })} filtered={Boolean(channel)} />
    </AnalyticsPage>
  );
}

function TalkView({ f, d, channelHref, filtered }: { f: Fmt; d: TalkAnalytics; channelHref: (id: string) => string; filtered: boolean }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const messages = k.messages.value ?? 0;
  const maxPerson = Math.max(1, ...d.people.map((p) => p.messages));
  const maxKind = Math.max(1, ...d.kinds.map((x) => x.messages));
  const someone = f.t('report.someone');
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('report.messages')} kpi={k.messages} spark={d.perDay.map((p) => p.messages)} better="up" />
        <KpiTile f={f} i={1} label={f.t('report.replies')} kpi={k.replies} spark={k.replies.value ? d.perDay.map((p) => p.replies) : undefined} better="up" />
        <KpiTile f={f} i={2} label={f.t('report.people')} kpi={k.people} better="up" />
        <KpiTile f={f} i={3} label={f.t('report.reactions')} kpi={k.reactions} spark={k.reactions.value ? d.perDay.map((p) => p.reactions) : undefined} />
        <KpiTile f={f} i={4} label={f.t('report.huddles')} kpi={k.huddles} />
        <KpiTile f={f} i={5} label={f.t('report.huddleTime')} kpi={k.huddleMinutes} kind="duration" />
      </Kpis>
      <Panel title={f.t('report.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            { name: f.t('report.messages'), values: d.perDay.map((p) => p.messages) },
            { name: f.t('report.replies'), values: d.perDay.map((p) => p.replies) },
            { name: f.t('report.reactions'), values: d.perDay.map((p) => p.reactions) },
          ]}
          summary={chartAria(f, f.t('report.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('report.whoPosts')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.people
              .filter((p) => p.messages > 0)
              .slice(0, 8)
              .map((p) => ({
                key: p.id,
                label: p.name || someone,
                value: f.t('report.messagesN', { n: p.messages }),
                extra: messages ? pctOf(f, p.messages, messages) : undefined,
                sub: [f.t('report.conversationsN', { n: p.channels }), f.t('report.repliesN', { n: p.replies }), f.k('before', { value: f.num(p.prevMessages) })].join(' · '),
                share: p.messages / maxPerson,
              }))}
          />
        </Panel>
        <Panel title={f.t('report.whenPosted')}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('report.peak', p)} />
        </Panel>
      </PanelGrid>
      {!filtered && (
        <Panel title={f.t('report.byKind')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.kinds.map((x) => ({
              key: x.kind,
              label: f.t(`report.kinds.${x.kind}`),
              value: f.t('report.messagesN', { n: x.messages }),
              extra: messages ? pctOf(f, x.messages, messages) : undefined,
              sub: f.t('report.conversationsN', { n: x.channels }),
              share: x.messages / maxKind,
            }))}
          />
        </Panel>
      )}
      <Panel title={f.t('report.byChannel')}>
        <DataTable
          rows={d.channels}
          rowKey={(c) => c.id}
          empty={f.k('noneInPeriod')}
          columns={[
            {
              key: 'channel',
              label: f.t('report.channel'),
              wide: true,
              cell: (c) => (filtered ? <Link href={`/app/talk/${c.id}`}>#{c.name}</Link> : <Link href={channelHref(c.id)}>#{c.name}</Link>),
            },
            { key: 'messages', label: f.t('report.messages'), num: true, cell: (c) => f.num(c.messages) },
            { key: 'posters', label: f.t('report.posters'), num: true, cell: (c) => f.num(c.posters) },
            { key: 'replies', label: f.t('report.replies'), num: true, hideNarrow: true, cell: (c) => f.num(c.replies) },
            { key: 'reactions', label: f.t('report.reactions'), num: true, hideNarrow: true, cell: (c) => f.num(c.reactions) },
            { key: 'members', label: f.t('report.members'), num: true, hideNarrow: true, cell: (c) => f.num(c.members) },
            { key: 'last', label: f.t('report.lastMessage'), hideNarrow: true, cell: (c) => (c.lastAt ? f.day(localDay(c.lastAt, d.range.tz)) : '—') },
          ]}
        />
      </Panel>
    </>
  );
}
