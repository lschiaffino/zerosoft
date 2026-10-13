import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listEventTypes, countBookingsThisWeek, getOrCreateCalendarUser, listBlockedSlots } from '@/lib/calendar';
import { formatNumber } from '@/lib/utils';
import BlockedSlotsPanel from '@/components/calendar/BlockedSlotsPanel';
import EventTypesView from '@/components/calendar/EventTypesView';
import { publicOrigin, toListItems } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function CalendarLandingPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventTypes = await listEventTypes(user.id);
  const bookingsThisWeek = await countBookingsThisWeek(user.id);
  const config = await getOrCreateCalendarUser(user.id);
  const blockedSlots = await listBlockedSlots(user.id);
  const origin = publicOrigin((await headers()).get('host'));

  return (
    <div className="app-page cal-page">
      <EventTypesView
        title={t('overview.title')}
        items={toListItems(eventTypes)}
        handle={user.handle ?? ''}
        bookBase={`${origin}/${locale}/book`}
        summary={{ label: t('eventTypes.title'), viewAll: t('common.viewAll') }}
      >
        <div className="cal-stats">
          <Link href="/app/calendar/event-types" className="cal-stat">
            <span className="cal-stat-num">{formatNumber(eventTypes.length, locale)}</span>
            <span className="cal-stat-label mono">{t('overview.eventTypes')}</span>
          </Link>
          <Link href="/app/calendar/bookings" className="cal-stat">
            <span className="cal-stat-num">{formatNumber(bookingsThisWeek, locale)}</span>
            <span className="cal-stat-label mono">{t('overview.bookingsThisWeek')}</span>
          </Link>
          <Link href="/app/calendar/settings" className="cal-stat">
            <span className="cal-stat-num cal-stat-small">{config.timezone}</span>
            <span className="cal-stat-label mono">{t('overview.timezone')}</span>
          </Link>
        </div>
      </EventTypesView>

      <BlockedSlotsPanel initialSlots={blockedSlots} />
    </div>
  );
}
