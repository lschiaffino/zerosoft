import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';
import { getChatRangeReport, parseReportRange } from '@/lib/chat-inbox';
import { formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function formatMinutes(mins: number | null, locale: string): string {
  if (mins == null) return '—';
  if (mins < 60) return `${formatNumber(Math.round(mins), locale)} min`;
  const hours = mins / 60;
  if (hours < 24) return `${formatNumber(Math.round(hours * 10) / 10, locale)} h`;
  return `${formatNumber(Math.round((hours / 24) * 10) / 10, locale)} d`;
}

function formatCsat(avg: number | null, locale: string): string {
  return avg != null ? `${formatNumber(Math.round(avg * 10) / 10, locale)} / 5` : '—';
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
  const presetFrom = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const csvHref = `/api/chat/reports?format=csv&from=${range.fromDate}&to=${range.toDate}`;

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('reports.title')}</h1>
          <p className="app-sub muted">{t('reports.subtitle')}</p>
        </div>
        <a className="btn btn-small" href={csvHref} download>
          {t('reports.exportCsv')}
        </a>
      </div>

      <form className="chat-report-range" method="get">
        <label className="chat-report-field">
          <span className="mono muted">{t('reports.from')}</span>
          <input type="date" name="from" defaultValue={range.fromDate} max={today} className="input" />
        </label>
        <label className="chat-report-field">
          <span className="mono muted">{t('reports.to')}</span>
          <input type="date" name="to" defaultValue={range.toDate} max={today} className="input" />
        </label>
        <button type="submit" className="btn btn-small">
          {t('reports.apply')}
        </button>
        <span className="chat-report-presets">
          {PRESETS.map((d) => {
            const active = range.toDate === today && range.fromDate === presetFrom(d);
            return (
              <a
                key={d}
                href={`?from=${presetFrom(d)}&to=${today}`}
                className={`chat-report-preset mono${active ? ' active' : ''}`}
                aria-current={active ? 'true' : undefined}
              >
                {t('reports.lastDays', { days: d })}
              </a>
            );
          })}
        </span>
      </form>

      <section className="chat-section">
        <div className="chat-stats chat-stats-4">
          <div className="chat-stat">
            <span className="chat-stat-num">{formatNumber(totals.conversations, locale)}</span>
            <span className="chat-stat-label mono">{t('reports.conversations')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">{formatMinutes(totals.avgFirstResponseMinutes, locale)}</span>
            <span className="chat-stat-label mono">{t('settings.avgFirstResponse')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">{formatMinutes(totals.avgResolutionMinutes, locale)}</span>
            <span className="chat-stat-label mono">{t('settings.avgResolution')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">{formatCsat(totals.csatAverage, locale)}</span>
            <span className="chat-stat-label mono">
              {t('csat.average')} · {t('reports.responses', { count: totals.csatCount })}
            </span>
          </div>
        </div>
      </section>

      <section className="chat-section">
        <div className="chat-section-head">
          <p className="section-label">{t('reports.byAgent')}</p>
        </div>
        {report.agents.length === 0 ? (
          <p className="muted">{t('reports.empty')}</p>
        ) : (
          <div className="chat-report-table-wrap">
            <table className="chat-report-table">
              <thead>
                <tr>
                  <th>{t('reports.agent')}</th>
                  <th className="num">{t('reports.conversations')}</th>
                  <th className="num">{t('reports.firstResponse')}</th>
                  <th className="num">{t('reports.resolution')}</th>
                  <th className="num">{t('reports.resolved')}</th>
                  <th className="num">CSAT</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <tr key={a.agentId ?? 'unassigned'}>
                    <td>{a.agentId ? a.name || a.email : <span className="muted">{t('conversation.unassigned')}</span>}</td>
                    <td className="num mono">{formatNumber(a.conversations, locale)}</td>
                    <td className="num mono">{formatMinutes(a.avgFirstResponseMinutes, locale)}</td>
                    <td className="num mono">{formatMinutes(a.avgResolutionMinutes, locale)}</td>
                    <td className="num mono">{formatNumber(a.resolvedCount, locale)}</td>
                    <td className="num mono">
                      {formatCsat(a.csatAverage, locale)}
                      {a.csatCount > 0 && <span className="muted"> ({a.csatCount})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted chat-section-sub chat-stats-note">{t('reports.note')}</p>
      </section>
    </div>
  );
}
