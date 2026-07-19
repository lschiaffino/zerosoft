import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getCrmOverview, type ActivityListRow } from '@/lib/crm';
import { formatDate, formatNumber } from '@/lib/utils';
import WonLostChart from '@/components/crm/WonLostChart';

export const dynamic = 'force-dynamic';

/** Glifo por tipo de actividad (sistema monocromo, sin deps de iconos). */
const ACTIVITY_ICONS: Record<string, string> = {
  note: '✎',
  task: '□',
  call: '☎',
  meeting: '◷',
  email: '✉',
};

function money(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Link al registro asociado de una actividad (contacto > deal > empresa). */
function recordHref(a: ActivityListRow): string {
  if (a.contact_id) return `/app/crm/contacts/${a.contact_id}`;
  if (a.deal_id) return `/app/crm/deals/${a.deal_id}`;
  if (a.company_id) return `/app/crm/companies/${a.company_id}`;
  return '/app/crm/tasks';
}

function recordName(a: ActivityListRow): string {
  return a.contact_name ?? a.deal_name ?? a.company_name ?? '';
}

export default async function CrmOverviewPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const o = await getCrmOverview(user.id);

  const allZero =
    o.totalContacts === 0 &&
    o.openDealsCount === 0 &&
    o.wonThisMonth.count === 0 &&
    o.recentActivities.length === 0;

  if (allZero) {
    return (
      <div className="app-page">
        <h1 className="app-title">{t('overview.title')}</h1>
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0
          </p>
          <p className="muted">{t('overview.empty')}</p>
          <Link href="/app/crm/contacts/new" className="btn btn-solid btn-small">
            {t('overview.emptyCta')}
          </Link>
        </div>
      </div>
    );
  }

  const funnelMax = Math.max(...o.funnel.map((s) => s.count), 1);

  return (
    <div className="app-page">
      <h1 className="app-title">{t('overview.title')}</h1>

      <div className="stat-cards stat-cards-6">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.totalContacts, locale)}</span>
          <span className="stat-label">{t('overview.totalContacts')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.openDealsCount, locale)}</span>
          <span className="stat-label">{t('overview.openDeals')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num stat-num-small">{money(o.openDealsAmount, locale)}</span>
          <span className="stat-label">{t('overview.openAmount')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num stat-num-small">{money(o.forecastWeighted, locale)}</span>
          <span className="stat-label">{t('overview.forecast')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.wonThisMonth.count, locale)}</span>
          <span className="stat-label">
            {t('overview.wonMonth')} · {money(o.wonThisMonth.amount, locale)}
          </span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.tasksDueToday, locale)}</span>
          <span className="stat-label">{t('overview.tasksToday')}</span>
        </div>
      </div>

      <div className="overview-grid">
        <section className="panel">
          <p className="section-label">{t('overview.funnel')}</p>
          {o.funnel.length === 0 ? (
            <p className="muted breakdown-empty">{t('overview.empty')}</p>
          ) : (
            <div className="breakdown">
              {o.funnel.map((s) => (
                <div className="breakdown-row funnel-row" key={s.id}>
                  <span className="breakdown-name mono" title={s.name}>
                    {s.name}
                  </span>
                  <span className="breakdown-track">
                    <span
                      className="breakdown-bar"
                      style={{ width: `${Math.max((s.count / funnelMax) * 100, s.count ? 2 : 0)}%` }}
                    />
                  </span>
                  <span className="breakdown-count mono">
                    {s.count} · {money(s.amount, locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel chart-panel">
          <p className="section-label">{t('overview.wonLost')}</p>
          <WonLostChart
            data={o.wonLostByMonth}
            wonLabel={t('overview.won')}
            lostLabel={t('overview.lost')}
          />
        </section>
      </div>

      <div className="overview-grid">
        <section className="panel">
          <div className="panel-head">
            <p className="section-label">{t('overview.upcomingTasks')}</p>
            <Link href="/app/crm/tasks" className="mono panel-more">
              {t('common.viewAll')} →
            </Link>
          </div>
          {o.upcomingTasks.length === 0 ? (
            <p className="muted">{t('tasks.empty')}</p>
          ) : (
            <ul className="recent-list">
              {o.upcomingTasks.map((task) => (
                <li key={task.id}>
                  <Link href={recordHref(task)} className="recent-row crm-row">
                    <span className="recent-name">{task.subject || t('enums.activityType.task')}</span>
                    <span className="muted recent-meta">{recordName(task)}</span>
                    <span className="mono recent-date">
                      {task.due_at ? formatDate(task.due_at, locale) : t('tasks.noDue')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <p className="section-label">{t('overview.recentActivity')}</p>
          {o.recentActivities.length === 0 ? (
            <p className="muted">{t('contacts.detail.emptyTimeline')}</p>
          ) : (
            <ul className="recent-list">
              {o.recentActivities.map((a) => (
                <li key={a.id}>
                  <Link href={recordHref(a)} className="recent-row crm-row">
                    <span className="recent-name">
                      <span className="act-icon" aria-hidden>
                        {ACTIVITY_ICONS[a.type] ?? '·'}
                      </span>
                      {a.subject || t(`enums.activityType.${a.type}`)}
                    </span>
                    <span className="muted recent-meta">{recordName(a)}</span>
                    <span className="mono recent-date">{formatDate(a.created_at, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('overview.closingThisMonth')}</p>
          <Link href="/app/crm/deals" className="mono panel-more">
            {t('common.viewAll')} →
          </Link>
        </div>
        {o.closingThisMonth.length === 0 ? (
          <p className="muted">{t('overview.noClosing')}</p>
        ) : (
          <ul className="recent-list">
            {o.closingThisMonth.map((d) => (
              <li key={d.id}>
                <Link href={`/app/crm/deals/${d.id}`} className="recent-row crm-row">
                  <span className="recent-name">{d.name}</span>
                  <span className="muted recent-meta">{d.stage_name ?? ''}</span>
                  <span className="mono recent-date">
                    {money(d.amount, locale)}
                    {d.close_date
                      ? ` · ${formatDate(`${d.close_date.slice(0, 10)}T00:00:00Z`, locale)}`
                      : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
