import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { voiceOwner } from '@/lib/voice';
import { cachedVoiceAnalytics, isVoiceAnalyticsEmpty, type VoiceAnalytics, type VoiceKindFilter } from '@/lib/voice-analytics';
import { localDay, periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; kind?: string };

/** Apps con nombre propio en voice.dictation.apps (el resto, "other"). */
const APP_KEYS = new Set(['docs', 'notes', 'crm', 'track', 'chat', 'talk', 'voice', 'calendar', 'board', 'groups', 'flow', 'desktop', 'other']);

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'voice' });
  return { title: `${t('report.title')} · Voice` };
}

/**
 * Voice, analítica (/app/voice/analytics): las reuniones y los dictados de
 * quien mira, con el kit de analítica (el formato de Lines). Voice es privado
 * de cada persona: nadie ve acá lo de otra.
 */
export default async function VoiceAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale, `/${locale}/app/voice/analytics`);
  const [t, tk, tz] = await Promise.all([getTranslations({ locale, namespace: 'voice' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz()]);
  const period = periodChoice(sp);
  const kind: VoiceKindFilter | undefined = sp.kind === 'meeting' || sp.kind === 'dictation' ? sp.kind : undefined;
  const data = await cachedVoiceAnalytics(voiceOwner(user), kind, { days: period.days, from: period.from, to: period.to, tz });
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/voice/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), kind, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('report.title')}
      description={t('report.desc')}
      product="voice"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        <label className="ui-field">
          <span className="label">{t('report.kind')}</span>
          <select className="select" name="kind" defaultValue={kind ?? ''}>
            <option value="">{t('report.allKinds')}</option>
            <option value="meeting">{t('report.onlyMeetings')}</option>
            <option value="dictation">{t('report.onlyDictation')}</option>
          </select>
        </label>
      }
      filtered={period.custom || Boolean(kind)}
      clearHref={base}
      empty={isVoiceAnalyticsEmpty(data)}
      emptyTitle={data.sessionCount === 0 ? t('report.noSessionsTitle') : t('report.emptyTitle')}
      emptyBody={data.sessionCount === 0 ? t('report.noSessionsBody') : t('report.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${kind ?? ''}`}
      foot={t('report.note')}
    >
      <VoiceView f={f} d={data} kind={kind} />
    </AnalyticsPage>
  );
}

function VoiceView({ f, d, kind }: { f: Fmt; d: VoiceAnalytics; kind: VoiceKindFilter | undefined }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const words = k.words.value ?? 0;
  const maxApp = Math.max(1, ...d.apps.map((a) => a.words));
  const meetings = kind !== 'dictation';
  const dictation = kind !== 'meeting';
  const appName = (app: string) => f.t(`dictation.apps.${APP_KEYS.has(app) ? app : 'other'}`);
  const heat = (
    <Panel title={f.t('report.whenRecorded')}>
      <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('report.peak', p)} />
    </Panel>
  );
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('report.meetings')} kpi={k.meetings} spark={meetings ? d.perDay.map((p) => p.meetings) : undefined} better="up" />
        <KpiTile f={f} i={1} label={f.t('report.meetingTime')} kpi={k.meetingMinutes} kind="duration" />
        <KpiTile f={f} i={2} label={f.t('report.notes')} kpi={k.notes} better="up" />
        <KpiTile f={f} i={3} label={f.t('report.dictations')} kpi={k.dictations} spark={dictation ? d.perDay.map((p) => p.dictations) : undefined} better="up" />
        <KpiTile f={f} i={4} label={f.t('report.words')} kpi={k.words} better="up" />
        <KpiTile f={f} i={5} label={f.t('report.wpm')} kpi={k.wpm} />
      </Kpis>
      <Panel title={f.t('report.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            ...(meetings ? [{ name: f.t('report.meetings'), values: d.perDay.map((p) => p.meetings) }] : []),
            ...(dictation ? [{ name: f.t('report.dictations'), values: d.perDay.map((p) => p.dictations) }] : []),
          ]}
          summary={chartAria(f, f.t('report.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      {!dictation && heat}
      {dictation && (
        <PanelGrid>
          {heat}
          <Panel title={f.t('report.byApp')}>
            <BarList
              empty={f.k('noneInPeriod')}
              rows={d.apps
                .filter((a) => a.words + a.dictations > 0)
                .slice(0, 8)
                .map((a) => ({
                  key: a.app,
                  label: appName(a.app),
                  value: f.t('report.wordsN', { n: a.words }),
                  extra: words ? pctOf(f, a.words, words) : undefined,
                  sub: [f.t('report.dictationsN', { n: a.dictations }), f.k('before', { value: f.num(a.prevWords) })].join(' · '),
                  share: a.words / maxApp,
                }))}
            />
          </Panel>
        </PanelGrid>
      )}
      {meetings && (
        <Panel title={f.t('report.byMeeting')}>
          <DataTable
            rows={d.meetings}
            rowKey={(m) => m.id}
            empty={f.k('noneInPeriod')}
            columns={[
              { key: 'meeting', label: f.t('report.meeting'), wide: true, cell: (m) => <Link href={`/app/voice/meetings/${m.id}`}>{m.title || f.t('meetings.untitled')}</Link> },
              { key: 'when', label: f.t('report.when'), cell: (m) => f.day(localDay(m.at, d.range.tz)) },
              { key: 'length', label: f.t('report.length'), num: true, cell: (m) => f.dur(m.minutes) },
              { key: 'words', label: f.t('report.transcriptWords'), num: true, hideNarrow: true, cell: (m) => f.num(m.words) },
              { key: 'notes', label: f.t('report.aiNotes'), hideNarrow: true, cell: (m) => (m.notes ? f.t('report.yes') : '—') },
              { key: 'linked', label: f.t('report.linked'), hideNarrow: true, cell: (m) => (m.linked ? f.t('report.yes') : '—') },
            ]}
          />
        </Panel>
      )}
    </>
  );
}
