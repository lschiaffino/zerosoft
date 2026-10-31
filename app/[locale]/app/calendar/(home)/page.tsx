import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { viewerScope } from '@/lib/calendar-access';
import { bookingDateBounds, countUpcomingBookings, listEventTypes, listUserBookings } from '@/lib/calendar';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import EventTypesView, { NewEventTypeButton } from '@/components/calendar/EventTypesView';
import { publicOrigin, toListItems } from '@/components/calendar/event-type-items';
import { parseDbUtc } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function CalendarLandingPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  // Un member ve solo las reservas que atiende (owner y admins, todas).
  const hostId = viewerScope(user) ?? undefined;
  const [eventTypes, nextWeek] = await Promise.all([listEventTypes(user.id), countUpcomingBookings(user.id, 7, new Date(), hostId)]);
  const { timezone } = await bookingDateBounds(user.id, undefined, undefined);
  const upcoming = await listUserBookings(user.id, { status: 'confirmed', from: new Date(), order: 'asc', limit: 5, hostId });
  const origin = publicOrigin((await headers()).get('host'));
  const active = eventTypes.filter((e) => e.active === 1).length;

  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone });

  return (
    <div className="ui-page cal-overview">
      <PageHeader title={t('overview.title')} description={t('overview.lead')} actions={<NewEventTypeButton />} />

      <p className="cal-summary">
        <Link href="/app/calendar/bookings" className="cal-summary-link">
          {t('overview.nextWeek', { n: nextWeek })}
        </Link>
        <span aria-hidden="true"> · </span>
        <Link href="/app/calendar/event-types" className="cal-summary-link">
          {t('overview.activeOf', { active, total: eventTypes.length })}
        </Link>
      </p>

      <section className="cal-block" aria-labelledby="cal-upcoming">
        <div className="cal-block-head">
          <h2 id="cal-upcoming" className="cal-block-title">
            {t('overview.upcoming')}
          </h2>
          <Link href="/app/calendar/bookings" className="cal-inline-link">
            {t('overview.allBookings')}
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <EmptyState quiet title={t('overview.noUpcoming')} body={t('overview.noUpcomingBody')} />
        ) : (
          <ul className="cal-up-list">
            {upcoming.map((b) => (
              <li key={b.id} className="cal-up-row">
                <span className="cal-up-when">
                  <span className="cal-up-day">{day.format(parseDbUtc(b.starts_at))}</span>
                  <span className="data">{time.format(parseDbUtc(b.starts_at))}</span>
                </span>
                <span className="cal-bk-guest">
                  <strong>{b.invitee_name}</strong>
                  <span className="cal-muted">{b.invitee_email}</span>
                </span>
                <span className="cal-bk-event">
                  <span>{b.event_type_title}</span>
                  <span className="cal-muted">{t('editor.minutes', { n: b.event_type_duration_min })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cal-block" aria-labelledby="cal-types">
        <div className="cal-block-head">
          <h2 id="cal-types" className="cal-block-title">
            {t('eventTypes.title')}
          </h2>
          <Link href="/app/calendar/event-types" className="cal-inline-link">
            {t('common.viewAll')}
          </Link>
        </div>
        <EventTypesView items={toListItems(eventTypes)} handle={user.handle ?? ''} bookBase={`${origin}/${locale}/book`} limit={5} />
      </section>
    </div>
  );
}
