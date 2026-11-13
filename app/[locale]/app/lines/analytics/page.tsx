import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { analyticsFilterOptions, cachedLinesAnalytics } from '@/lib/groups-analytics';
import { ANALYTICS_TABS, analyticsTab, isEmptyData, type AnalyticsTab } from '@/lib/groups-analytics-shared';
import { periodChoice } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { pageViewer } from '@/lib/groups-page';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { AnalyticsPage, analyticsFmt } from '@/components/analytics-kit/kit';
import { AnalyticsView } from '@/components/groups/analytics/views';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { tab?: string; days?: string; from?: string; to?: string; label?: string; number?: string; agent?: string };

/**
 * Reportes de Lines: un tablero con pestañas (?tab=). Cada pestaña carga solo
 * sus datos, con lo que la persona puede ver (lib/groups-analytics.ts).
 */
export default async function LinesAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const tk = await getTranslations({ locale, namespace: 'analyticsKit' });
  const viewer = await pageViewer(user);
  const tz = await viewerTz();
  const tab = analyticsTab(sp.tab);
  const options = await analyticsFilterOptions(user.id, viewer);

  const period = periodChoice(sp);
  const filters = {
    from: period.from,
    to: period.to,
    // Solo ids que la persona puede elegir: una línea que no ve no se filtra (ni se consulta).
    labelId: options.labels.some((l) => l.id === sp.label) ? sp.label : undefined,
    numberId: options.numbers.some((n) => n.id === sp.number) ? sp.number : undefined,
    agentId: options.people.some((p) => p.id === sp.agent) ? sp.agent : undefined,
  };
  const custom = period.custom;
  const filtered = custom || Boolean(filters.labelId || filters.numberId || filters.agentId);
  const data = await cachedLinesAnalytics(user.id, viewer, tab, { days: period.days, tz, ...filters }, options);
  const range = data.range;

  const query = (extra: Record<string, string | undefined>, opts: { keepRange?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (tab !== 'overview') q.set('tab', tab);
    if (opts.keepRange !== false) {
      if (custom) {
        q.set('from', range.from);
        q.set('to', range.to);
      } else if (period.days !== 30) q.set('days', String(period.days));
    }
    if (filters.labelId) q.set('label', filters.labelId);
    if (filters.numberId) q.set('number', filters.numberId);
    if (filters.agentId) q.set('agent', filters.agentId);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  };
  const href = (extra: Record<string, string | undefined>, opts?: { keepRange?: boolean }) => `/app/lines/analytics${query(extra, opts)}`;

  const f = analyticsFmt({ locale, tz: range.tz, t: (key, values) => t(key as never, values as never), k: (key, values) => tk(key as never, values as never) });
  const empty = isEmptyData(data);
  const tabLabel = (k: AnalyticsTab) => t(`analytics.tabs.${k}`);

  return (
    <AnalyticsPage
      f={f}
      title={t('analytics.title')}
      description={t('analytics.desc')}
      product="groups"
      range={range}
      period={period}
      periodHref={(p) => href({ days: p === 30 ? undefined : String(p) }, { keepRange: false })}
      exportHref={`/api/groups/analytics${query({ tab })}`}
      formAction={`/${locale}/app/lines/analytics`}
      hidden={{ tab: tab !== 'overview' ? tab : undefined }}
      filtered={filtered}
      clearHref={tab === 'overview' ? '/app/lines/analytics' : `/app/lines/analytics?tab=${tab}`}
      filters={
        <>
          {options.numbers.length > 1 && (
            <label className="ui-field">
              <span className="label">{t('analytics.number')}</span>
              <select className="select" name="number" defaultValue={filters.numberId ?? ''}>
                <option value="">{t('analytics.allNumbers')}</option>
                {options.numbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {options.people.length > 1 && (
            <label className="ui-field">
              <span className="label">{t('analytics.agent')}</span>
              <select className="select" name="agent" defaultValue={filters.agentId ?? ''}>
                <option value="">{t('analytics.allAgents')}</option>
                {options.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ui-field">
            <span className="label">{t('inbox.label')}</span>
            <select className="select" name="label" defaultValue={filters.labelId ?? ''}>
              <option value="">{t('inbox.labelAll')}</option>
              {options.labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      // Las pestañas de siempre (?tab=, conservan los filtros): un clic antes de hidratar o que el router descarta navega igual.
      tabs={<SettingsTabs mode="query" param="tab" layout="top" label={t('analytics.tabsLabel')} className="la-tabs" items={ANALYTICS_TABS.map((k) => ({ key: k, label: tabLabel(k) }))} />}
      empty={empty}
      emptyTitle={t(`analytics.empty.${tab}Title`)}
      emptyBody={t(`analytics.empty.${tab}Body`)}
      emptyFilteredBody={t('analytics.emptyFilteredBody')}
      contentKey={tab}
      foot={
        <>
          {t('analytics.exportMore')} <a href={`/api/groups/export?type=chats`}>{t('analytics.exportChats')}</a> · <a href={`/api/groups/export?type=tickets`}>{t('analytics.exportTickets')}</a>
        </>
      }
    >
      <AnalyticsView f={f} data={data} />
    </AnalyticsPage>
  );
}
