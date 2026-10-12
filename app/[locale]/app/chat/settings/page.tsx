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

export default async function ChatSettingsPage(
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
          <h1 className="app-title">{t('settings.title')}</h1>
          <p className="app-sub muted">{t('settings.subtitle')}</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('sla.title')}</p>
        </div>
        <div className="stat-cards">
          <div className="panel stat-card">
            <span className="stat-num">{formatMinutes(report.avgFirstResponseMinutes, locale)}</span>
            <span className="stat-label">{t('settings.avgFirstResponse')}</span>
          </div>
          <div className="panel stat-card">
            <span className="stat-num">
              {report.firstResponseWithinSlaPercent != null
                ? `${formatNumber(report.firstResponseWithinSlaPercent, locale)}%`
                : '—'}
            </span>
            <span className="stat-label">{t('settings.withinSla')}</span>
          </div>
          <div className="panel stat-card">
            <span className="stat-num">{formatMinutes(report.avgResolutionMinutes, locale)}</span>
            <span className="stat-label">{t('settings.avgResolution')}</span>
          </div>
          <div className="panel stat-card">
            <span className="stat-num">{formatNumber(report.resolvedCount, locale)}</span>
            <span className="stat-label">{t('settings.resolvedCount')}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('csat.title')}</p>
        </div>
        <div className="stat-cards">
          <div className="panel stat-card">
            <span className="stat-num">
              {report.csatAverage != null
                ? `${formatNumber(Math.round(report.csatAverage * 10) / 10, locale)} / 5`
                : '—'}
            </span>
            <span className="stat-label">{t('csat.average')}</span>
          </div>
          <div className="panel stat-card">
            <span className="stat-num">{formatNumber(report.csatCount, locale)}</span>
            <span className="stat-label">{t('csat.responses')}</span>
          </div>
        </div>
        <p className="muted chat-settings-note">{t('csat.note')}</p>
      </section>
    </div>
  );
}
