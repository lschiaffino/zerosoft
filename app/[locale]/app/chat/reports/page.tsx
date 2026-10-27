import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets, parseOfficeHours } from '@/lib/chat-data';
import { getChatRangeReport, parseReportRange } from '@/lib/chat-inbox';
import { getChatBreakdownReport, type BreakdownRow } from '@/lib/chat-reports';
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
  // Horas pico en la zona del horario de atención del primer widget que la tenga (si no, UTC).
  const timeZone = widgets.map((w) => parseOfficeHours(w.office_hours)?.timezone).find(Boolean) ?? 'UTC';
  const breakdown = await getChatBreakdownReport(widgets.map((w) => w.id), range, { timeZone });
  const pct = (n: number, d: number) => (d > 0 ? `${formatNumber(Math.round((n / d) * 100), locale)}%` : '–');
  const maxHour = Math.max(1, ...breakdown.hours.flat());
  const days = [1, 2, 3, 4, 5, 6, 0];
  const dayName = (d: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)));
  const exportHref = (format: 'csv' | 'json') => `/api/chat/export?format=${format}&from=${range.fromDate}&to=${range.toDate}`;
  const breakdownTable = (id: string, title: string, column: string, rows: BreakdownRow[], label: (r: BreakdownRow) => string) => (
    <section className="chat-pane" aria-labelledby={id}>
      <div className="chat-pane-head">
        <h2 id={id} className="ui-section-title">
          {title}
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="chat-quiet">{t('reports.breakdownEmpty')}</p>
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{column}</th>
                <th scope="col" className="num">
                  {t('reports.conversations')}
                </th>
                <th scope="col" className="num">
                  {t('reports.firstResponse')}
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
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{label(r)}</td>
                  <td className="num data" data-label={t('reports.conversations')}>
                    {formatNumber(r.conversations, locale)}
                  </td>
                  <td className="num data" data-label={t('reports.firstResponse')}>
                    {formatMinutes(r.avgFirstResponseMinutes, locale)}
                  </td>
                  <td className="num data" data-label={t('reports.resolved')}>
                    {formatNumber(r.resolved, locale)}
                  </td>
                  <td className="num data" data-label="CSAT">
                    {formatCsat(r.csatAverage, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
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
          <>
            <a className="btn btn-secondary" href={csvHref} download>
              {t('reports.exportCsv')}
            </a>
            <a className="btn btn-ghost" href={exportHref('csv')} download>
              {t('reports.exportConversations')}
            </a>
            <a className="btn btn-ghost" href={exportHref('json')} download>
              {t('reports.exportJson')}
            </a>
          </>
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
          <div className="table-wrap chat-stack">
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
                    <td className="num data" data-label={t('reports.conversations')}>
                      {formatNumber(a.conversations, locale)}
                    </td>
                    <td className="num data" data-label={t('reports.firstResponse')}>
                      {formatMinutes(a.avgFirstResponseMinutes, locale)}
                    </td>
                    <td className="num data" data-label={t('reports.resolution')}>
                      {formatMinutes(a.avgResolutionMinutes, locale)}
                    </td>
                    <td className="num data" data-label={t('reports.resolved')}>
                      {formatNumber(a.resolvedCount, locale)}
                    </td>
                    <td className="num data" data-label="CSAT">
                      <span>
                        {formatCsat(a.csatAverage, locale)}
                        {a.csatCount > 0 && <span className="chat-quiet"> ({a.csatCount})</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ui-help">{t('reports.note')}</p>
      </section>

      <section className="chat-pane" aria-labelledby="chat-report-bot">
        <div className="chat-pane-head">
          <h2 id="chat-report-bot" className="ui-section-title">
            {t('reports.botTitle')}
          </h2>
        </div>
        <dl className="chat-counts">
          <div className="chat-count">
            <dt>{t('reports.botConversations')}</dt>
            <dd className="data">{formatNumber(breakdown.bot.botConversations, locale)}</dd>
          </div>
          <div className="chat-count">
            <dt>{t('reports.botResolved')}</dt>
            <dd className="data">{formatNumber(breakdown.bot.botResolved, locale)}</dd>
          </div>
          <div className="chat-count">
            <dt>{t('reports.botRate')}</dt>
            <dd className="data">{pct(breakdown.bot.botResolved, breakdown.bot.botConversations)}</dd>
          </div>
          <div className="chat-count">
            <dt>{t('reports.botHandedOff')}</dt>
            <dd className="data">{formatNumber(breakdown.bot.handedOff, locale)}</dd>
          </div>
        </dl>
        <p className="ui-help">{t('reports.botNote')}</p>
      </section>

      <section className="chat-pane" aria-labelledby="chat-report-sla">
        <div className="chat-pane-head">
          <h2 id="chat-report-sla" className="ui-section-title">
            {t('reports.slaTitle')}
          </h2>
        </div>
        <dl className="chat-counts">
          <div className="chat-count">
            <dt>{t('reports.slaFirst')}</dt>
            <dd className="data">{pct(breakdown.sla.firstResponseMet, breakdown.sla.firstResponseMet + breakdown.sla.firstResponseBreached)}</dd>
          </div>
          <div className="chat-count">
            <dt>{t('reports.slaFirstBreached')}</dt>
            <dd className="data">{formatNumber(breakdown.sla.firstResponseBreached, locale)}</dd>
          </div>
          <div className="chat-count">
            <dt>{t('reports.slaResolution')}</dt>
            <dd className="data">{pct(breakdown.sla.resolutionMet, breakdown.sla.resolutionMet + breakdown.sla.resolutionBreached)}</dd>
          </div>
          <div className="chat-count">
            <dt>{t('reports.slaResolutionBreached')}</dt>
            <dd className="data">{formatNumber(breakdown.sla.resolutionBreached, locale)}</dd>
          </div>
        </dl>
        <p className="ui-help">{t('reports.slaNote')}</p>
      </section>

      {breakdownTable('chat-report-tags', t('reports.byTag'), t('reports.colTag'), breakdown.tags, (r) => r.label)}
      {breakdownTable('chat-report-widgets', t('reports.byWidget'), t('reports.colWidget'), breakdown.widgets, (r) => r.label)}
      {breakdown.teams.length > 0 && breakdownTable('chat-report-teams', t('reports.byTeam'), t('teams.label'), breakdown.teams, (r) => r.label)}
      {breakdownTable('chat-report-channels', t('reports.byChannel'), t('channels.label'), breakdown.channels, (r) => t(`channels.${r.key}`))}

      <section className="chat-pane" aria-labelledby="chat-report-hours">
        <div className="chat-pane-head">
          <h2 id="chat-report-hours" className="ui-section-title">
            {t('reports.hoursTitle')}
          </h2>
        </div>
        <div className="chat-hours-wrap">
          <table className="chat-hours">
            <caption className="sr-only">{t('reports.hoursCaption', { zone: breakdown.timeZone })}</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{t('reports.day')}</span>
                </th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} scope="col" className="data">
                    {h % 3 === 0 ? h : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d}>
                  <th scope="row">{dayName(d)}</th>
                  {breakdown.hours[d].map((n, h) => (
                    <td
                      key={h}
                      data-level={n === 0 ? 0 : Math.min(4, Math.ceil((n / maxHour) * 4))}
                      title={t('reports.hourCell', { day: dayName(d), hour: h, count: n })}
                    >
                      <span className="sr-only">{n}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ui-help">{t('reports.hoursNote', { zone: breakdown.timeZone })}</p>
      </section>
    </div>
  );
}
