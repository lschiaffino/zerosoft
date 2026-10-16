import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';
import { getChatRangeReport, parseReportRange } from '@/lib/chat-inbox';
import { formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

function formatMinutes(mins: number | null, locale: string): string {
  if (mins == null) return '–';
  if (mins < 60) return `${formatNumber(Math.round(mins), locale)} min`;
  const hours = mins / 60;
  if (hours < 24) return `${formatNumber(Math.round(hours * 10) / 10, locale)} h`;
  return `${formatNumber(Math.round((hours / 24) * 10) / 10, locale)} d`;
}

function formatCsat(avg: number | null, locale: string): string {
  return avg != null ? `${formatNumber(Math.round(avg * 10) / 10, locale)} / 5` : '–';
}

const PRESETS = [7, 30, 90] as const;

export default async function ChatReportsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const range = parseReportRange(sp.from, sp.to);
  const report = await getChatRangeReport(widgets.map((w) => w.id), range);
  const { totals } = report;
  const today = new Date().toISOString().slice(0, 10);
  const presetFrom = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const csvHref = `/api/chat/reports?format=csv&from=${range.fromDate}&to=${range.toDate}`;

  const kpis = [
    { key: 'conv', label: t('reports.conversations'), value: formatNumber(totals.conversations, locale) },
    { key: 'first', label: t('settings.avgFirstResponse'), value: formatMinutes(totals.avgFirstResponseMinutes, locale) },
    { key: 'res', label: t('settings.avgResolution'), value: formatMinutes(totals.avgResolutionMinutes, locale) },
    {
      key: 'csat',
      label: t('reports.csatLabel', { count: totals.csatCount }),
      value: formatCsat(totals.csatAverage, locale),
    },
  ];

  return (
    <div className="ui-page">
      <PageHeader
        title={t('reports.title')}
        description={t('reports.subtitle')}
        actions={
          <a className="btn btn-secondary" href={csvHref} download>
            {t('reports.exportCsv')}
          </a>
        }
      />

      <form className="chat-range" method="get" aria-label={t('reports.range')}>
        <nav className="btn-group" aria-label={t('reports.presets')}>
          {PRESETS.map((d) => {
            const active = range.toDate === today && range.fromDate === presetFrom(d);
            return (
              <a
                key={d}
                href={`?from=${presetFrom(d)}&to=${today}`}
                className="btn btn-sm"
                aria-current={active ? 'true' : undefined}
              >
                {t('reports.lastDays', { days: d })}
              </a>
            );
          })}
        </nav>
        <div className="chat-range-custom">
          <div className="ui-field">
            <label className="label" htmlFor="report-from">
              {t('reports.from')}
            </label>
            <input id="report-from" type="date" name="from" defaultValue={range.fromDate} max={today} className="input data" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="report-to">
              {t('reports.to')}
            </label>
            <input id="report-to" type="date" name="to" defaultValue={range.toDate} max={today} className="input data" />
          </div>
          <button type="submit" className="btn btn-secondary">
            {t('reports.apply')}
          </button>
        </div>
      </form>

      <dl className="chat-counts">
        {kpis.map((k) => (
          <div key={k.key} className="chat-count">
            <dt>{k.label}</dt>
            <dd className="data">{k.value}</dd>
          </div>
        ))}
      </dl>

      <section className="chat-pane" aria-labelledby="chat-report-agents">
        <div className="chat-pane-head">
          <h2 id="chat-report-agents" className="ui-section-title">
            {t('reports.byAgent')}
          </h2>
        </div>
        {report.agents.length === 0 ? (
          <EmptyState quiet title={t('reports.empty')} body={t('reports.emptyBody')} product="chat" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('reports.agent')}</th>
                  <th scope="col" className="num">
                    {t('reports.conversations')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.firstResponse')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.resolution')}
                  </th>
                  <th scope="col" className="num">
                    {t('reports.resolved')}
                  </th>
                  <th scope="col" className="num">
                    CSAT
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <tr key={a.agentId ?? 'unassigned'}>
                    <td>{a.agentId ? a.name || a.email : <span className="chat-quiet">{t('conversation.unassigned')}</span>}</td>
                    <td className="num data">{formatNumber(a.conversations, locale)}</td>
                    <td className="num data">{formatMinutes(a.avgFirstResponseMinutes, locale)}</td>
                    <td className="num data">{formatMinutes(a.avgResolutionMinutes, locale)}</td>
                    <td className="num data">{formatNumber(a.resolvedCount, locale)}</td>
                    <td className="num data">
                      {formatCsat(a.csatAverage, locale)}
                      {a.csatCount > 0 && <span className="chat-quiet"> ({a.csatCount})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ui-help">{t('reports.note')}</p>
      </section>
    </div>
  );
}
