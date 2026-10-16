import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import {
  bookingDateBounds,
  countBookingsThisWeek,
  getOrCreateCalendarUser,
  listBlockedSlots,
  listEventTypes,
  listUserBookings,
} from '@/lib/calendar';
import { formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import BlockedSlotsPanel from '@/components/calendar/BlockedSlotsPanel';
import EventTypesView, { NewEventTypeButton } from '@/components/calendar/EventTypesView';
import { publicOrigin, toListItems } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function CalendarLandingPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const [eventTypes, bookingsThisWeek, config] = await Promise.all([
    listEventTypes(user.id),
    countBookingsThisWeek(user.id),
    getOrCreateCalendarUser(user.id),
  ]);
  // Los bloqueos son de la persona (como Google Calendar), no del dueño del workspace.
  const blockedSlots = await listBlockedSlots(realUserId(user));
  const { timezone } = await bookingDateBounds(user.id, undefined, undefined);
  const upcoming = await listUserBookings(user.id, { status: 'confirmed', from: new Date(), order: 'asc', limit: 5 });
  const origin = publicOrigin((await headers()).get('host'));

  const when = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone });

  return (
    <div className="ui-page cal-overview">
      <PageHeader title={t('overview.title')} description={t('overview.lead')} actions={<NewEventTypeButton />} />

      <dl className="cal-stats">
        <div>
          <dt>{t('overview.bookingsThisWeek')}</dt>
          <dd>
            <Link href="/app/calendar/bookings" className="cal-stat-value data">
              {formatNumber(bookingsThisWeek, locale)}
            </Link>
          </dd>
        </div>
        <div>
          <dt>{t('overview.activeEventTypes')}</dt>
          <dd>
            <Link href="/app/calendar/event-types" className="cal-stat-value data">
              {formatNumber(eventTypes.filter((e) => e.active === 1).length, locale)}
              <span className="cal-stat-of">/ {formatNumber(eventTypes.length, locale)}</span>
            </Link>
          </dd>
        </div>
        <div>
          <dt>{t('overview.timezone')}</dt>
          <dd>
            <Link href="/app/calendar/settings" className="cal-stat-value cal-stat-tz">
              {config.timezone.replace(/_/g, ' ')}
            </Link>
          </dd>
        </div>
      </dl>

      <section className="cal-block" aria-labelledby="cal-upcoming">
        <div className="cal-block-head">
          <h2 id="cal-upcoming" className="cal-block-title">
            {t('overview.upcoming')}
          </h2>
          <Link href="/app/calendar/bookings" className="cal-inline-link">
            {t('overview.allBookings')}
          </Link>
        </div>
        <DataTable
          caption={t('overview.upcoming')}
          rows={upcoming}
          rowKey={(b) => b.id}
          compact
          empty={<EmptyState quiet title={t('overview.noUpcoming')} body={t('overview.noUpcomingBody')} />}
          columns={[
            { key: 'when', header: t('overview.colWhen'), cell: (b) => when.format(new Date(b.starts_at)), data: true, width: '200px' },
            { key: 'guest', header: t('overview.colGuest'), cell: (b) => b.invitee_name },
            { key: 'event', header: t('overview.colEvent'), cell: (b) => b.event_type_title },
            { key: 'email', header: t('booking.email'), cell: (b) => b.invitee_email, data: true },
          ]}
        />
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

      <BlockedSlotsPanel initialSlots={blockedSlots} />
    </div>
  );
}
