import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets, getChatReport } from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function formatMinutes(mins: number | null, locale: string): string {
  if (mins == null) return '—';
  if (mins < 60) return `${formatNumber(Math.round(mins), locale)} min`;
  const hours = mins / 60;
  if (hours < 24) return `${formatNumber(Math.round(hours * 10) / 10, locale)} h`;
  return `${formatNumber(Math.round((hours / 24) * 10) / 10, locale)} d`;
}

export default async function ChatReportsPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const report = await getChatReport(widgets.map((w) => w.id));

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('reports.title')}</h1>
          <p className="app-sub muted">{t('reports.subtitle')}</p>
        </div>
      </div>

      <section className="chat-section">
        <div className="chat-section-head">
          <p className="section-label">{t('sla.title')}</p>
        </div>
        <div className="chat-stats chat-stats-4">
          <div className="chat-stat">
            <span className="chat-stat-num">{formatMinutes(report.avgFirstResponseMinutes, locale)}</span>
            <span className="chat-stat-label mono">{t('settings.avgFirstResponse')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">
              {report.firstResponseWithinSlaPercent != null
                ? `${formatNumber(report.firstResponseWithinSlaPercent, locale)}%`
                : '—'}
            </span>
            <span className="chat-stat-label mono">{t('settings.withinSla')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">{formatMinutes(report.avgResolutionMinutes, locale)}</span>
            <span className="chat-stat-label mono">{t('settings.avgResolution')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">{formatNumber(report.resolvedCount, locale)}</span>
            <span className="chat-stat-label mono">{t('settings.resolvedCount')}</span>
          </div>
        </div>
      </section>

      <section className="chat-section">
        <div className="chat-section-head">
          <p className="section-label">{t('csat.title')}</p>
        </div>
        <div className="chat-stats chat-stats-4">
          <div className="chat-stat">
            <span className="chat-stat-num">
              {report.csatAverage != null
                ? `${formatNumber(Math.round(report.csatAverage * 10) / 10, locale)} / 5`
                : '—'}
            </span>
            <span className="chat-stat-label mono">{t('csat.average')}</span>
          </div>
          <div className="chat-stat">
            <span className="chat-stat-num">{formatNumber(report.csatCount, locale)}</span>
            <span className="chat-stat-label mono">{t('csat.responses')}</span>
          </div>
        </div>
        <p className="muted chat-section-sub chat-stats-note">{t('csat.note')}</p>
      </section>
    </div>
  );
}
