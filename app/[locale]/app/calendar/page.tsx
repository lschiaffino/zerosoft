import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listEventTypes, countBookingsThisWeek, getOrCreateCalendarUser, listBlockedSlots } from '@/lib/calendar';
import { formatNumber } from '@/lib/utils';
import BlockedSlotsPanel from '@/components/calendar/BlockedSlotsPanel';

export const dynamic = 'force-dynamic';

export default async function CalendarLandingPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventTypes = await listEventTypes(user.id);
  const bookingsThisWeek = await countBookingsThisWeek(user.id);
  const config = await getOrCreateCalendarUser(user.id);
  const blockedSlots = await listBlockedSlots(user.id);

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('overview.title')}</h1>
        <Link href="/app/calendar/event-types/new" className="btn btn-solid btn-small">
          {t('eventTypes.newCta')}
        </Link>
      </div>

      <div className="stat-cards">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(eventTypes.length, locale)}</span>
          <span className="stat-label">{t('overview.eventTypes')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(bookingsThisWeek, locale)}</span>
          <span className="stat-label">{t('overview.bookingsThisWeek')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num stat-num-small">{config.timezone}</span>
          <span className="stat-label">{t('overview.timezone')}</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('eventTypes.title')}</p>
          <Link href="/app/calendar/event-types" className="mono panel-more">
            {t('common.viewAll')} →
          </Link>
        </div>
        {eventTypes.length === 0 ? (
          <div className="empty-inline">
            <p className="empty-zeros mono" aria-hidden>
              0 0 0
            </p>
            <p className="muted">{t('eventTypes.emptySub')}</p>
            <Link href="/app/calendar/event-types/new" className="btn btn-solid btn-small">
              {t('eventTypes.emptyCta')}
            </Link>
          </div>
        ) : (
          <ul className="calendar-event-list">
            {eventTypes.map((et) => (
              <li key={et.id}>
                <Link href={`/app/calendar/event-types/${et.id}`} className="calendar-event-row">
                  <span
                    className="calendar-event-dot"
                    style={{ backgroundColor: et.color }}
                    aria-hidden
                  />
                  <span className="calendar-event-title">{et.title}</span>
                  <span className="mono calendar-event-slug">/{et.slug}</span>
                  <span className="muted">
                    {et.duration_min} {t('eventTypes.minutes')}
                  </span>
                  {!et.active && <span className="badge">{t('eventTypes.inactive')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BlockedSlotsPanel initialSlots={blockedSlots} />
    </div>
  );
}
