import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBookingByManageToken, getCalendarUser, getEventTypeById } from '@/lib/calendar';
import ManageBooking from '@/components/calendar/ManageBooking';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

// El token es una credencial: la página no se indexa ni manda referrer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ManageBookingPage(props: { params: Promise<{ token: string; locale: string }> }) {
  const { token, locale } = await props.params;
  const booking = await getBookingByManageToken(token);
  if (!booking) notFound();
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) notFound();
  const calendarUser = await getCalendarUser(eventType.user_id);

  return (
    <ManageBooking
      token={token}
      locale={locale}
      eventType={eventType}
      weekStart={calendarUser?.week_start ?? 1}
      booking={{
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        timezone: booking.timezone,
        status: booking.status,
        name: booking.invitee_name,
        email: booking.invitee_email,
      }}
    />
  );
}
