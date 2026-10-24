import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listPeople } from '@/lib/groups';
import { groupsAnalytics } from '@/lib/groups-analytics';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90];

/** Métricas: volumen, primera respuesta, tickets, por persona y por grupo. */
export default async function GroupsAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ days?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const people = await listPeople(user.id, user.team?.id ?? null);
  const a = await groupsAnalytics(user.id, days, people);
  const dur = (min: number | null) => {
    if (min == null) return '—';
    if (min < 60) return t('time.minLong', { n: min });
    if (min < 1440) return t('time.hoursLong', { n: Math.round((min / 60) * 10) / 10 });
    return t('time.daysLong', { n: Math.round((min / 1440) * 10) / 10 });
  };
  const max = Math.max(1, ...a.perDay.map((d) => d.inbound + d.outbound));
  const empty = a.totals.inbound + a.totals.outbound === 0 && a.tickets.created === 0;

  return (
    <div className="ui-page">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.desc')}
        actions={
          <nav className="gr-periods" aria-label={t('analytics.period')}>
            {PERIODS.map((p) => (
              <Link key={p} href={`/app/groups/analytics?days=${p}`} className={`btn btn-sm ${p === days ? 'btn-primary' : 'btn-secondary'}`} aria-current={p === days ? 'page' : undefined}>
                {t('analytics.days', { n: p })}
              </Link>
            ))}
          </nav>
        }
      />
      {empty ? (
        <EmptyState title={t('analytics.emptyTitle')} body={t('analytics.emptyBody')} product="groups" />
      ) : (
        <>
          <div className="gr-stats">
            <div>
              <span className="label">{t('analytics.inbound')}</span>
              <strong className="num">{a.totals.inbound}</strong>
            </div>
            <div>
              <span className="label">{t('analytics.outbound')}</span>
              <strong className="num">{a.totals.outbound}</strong>
            </div>
            <div>
              <span className="label">{t('analytics.activeChats')}</span>
              <strong className="num">{a.totals.activeChats}</strong>
            </div>
            <div>
              <span className="label">{t('analytics.firstResponse')}</span>
              <strong>{dur(a.firstResponse.medianMin)}</strong>
            </div>
            <div>
              <span className="label">{t('analytics.awaiting')}</span>
              <strong className="num">{a.totals.awaiting}</strong>
            </div>
            <div>
              <span className="label">{t('analytics.tickets')}</span>
              <strong className="num">
                {a.tickets.open}/{a.tickets.created}
              </strong>
            </div>
            <div>
              <span className="label">{t('analytics.resolution')}</span>
              <strong>{dur(a.tickets.medianResolutionMin)}</strong>
            </div>
            <div>
              <span className="label">{t('analytics.breached')}</span>
              <strong className="num">{a.tickets.breached}</strong>
            </div>
          </div>

          <section className="gr-detail-section">
            <h2 className="gr-detail-title">{t('analytics.volume')}</h2>
            <div className="gr-bars" role="img" aria-label={t('analytics.volumeAria', { inbound: a.totals.inbound, outbound: a.totals.outbound })}>
              {a.perDay.map((d) => (
                <span key={d.day} className="gr-bar" title={`${d.day}: ${d.inbound} / ${d.outbound}`}>
                  <i className="gr-bar-out" style={{ height: `${(d.outbound / max) * 100}%` }} />
                  <i className="gr-bar-in" style={{ height: `${(d.inbound / max) * 100}%` }} />
                </span>
              ))}
            </div>
            <p className="ui-help gr-legend">
              <span className="gr-key gr-key-in" /> {t('analytics.inbound')} <span className="gr-key gr-key-out" /> {t('analytics.outbound')}
            </p>
          </section>

          <section className="gr-detail-section">
            <h2 className="gr-detail-title">{t('analytics.byAgent')}</h2>
            {a.perAgent.length === 0 ? (
              <p className="ui-help">{t('analytics.noAgents')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table gr-table">
                  <thead>
                    <tr>
                      <th>{t('analytics.person')}</th>
                      <th className="num">{t('analytics.replies')}</th>
                      <th className="num">{t('analytics.firstResponse')}</th>
                      <th className="num">{t('analytics.resolved')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.perAgent.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="num">{p.replies}</td>
                        <td className="num">{dur(p.medianFirstResponseMin)}</td>
                        <td className="num">{p.ticketsResolved}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="gr-detail-section">
            <h2 className="gr-detail-title">{t('analytics.byChat')}</h2>
            <div className="table-wrap">
              <table className="table gr-table">
                <thead>
                  <tr>
                    <th>{t('analytics.chat')}</th>
                    <th className="num">{t('analytics.inbound')}</th>
                    <th className="num">{t('analytics.outbound')}</th>
                    <th className="num">{t('analytics.firstResponse')}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.perChat.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/app/groups/inbox/${c.id}`}>{c.name}</Link>
                      </td>
                      <td className="num">{c.inbound}</td>
                      <td className="num">{c.outbound}</td>
                      <td className="num">{dur(c.medianFirstResponseMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="ui-help">
            {t('analytics.note')}{' '}
            <a href={`/api/groups/export?type=chats`}>{t('analytics.exportChats')}</a> · <a href={`/api/groups/export?type=tickets`}>{t('analytics.exportTickets')}</a>
          </p>
        </>
      )}
    </div>
  );
}
