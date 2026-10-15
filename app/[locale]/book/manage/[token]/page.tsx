import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  effectiveMaxFutureDays,
  getBookingByManageToken,
  getCalendarUser,
  getEventTypeById,
} from '@/lib/calendar';
import { abandonCheckout, reconcileCheckout } from '@/lib/calendar-payments';
import { afterBookingCreated } from '@/lib/calendar-lifecycle';
import ManageBooking from '@/components/calendar/ManageBooking';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

// El token es una credencial: la página no se indexa ni manda referrer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ManageBookingPage(props: {
  params: Promise<{ token: string; locale: string }>;
  searchParams: Promise<{ session_id?: string; paid?: string; checkout?: string }>;
}) {
  const { token, locale } = await props.params;
  const { session_id: sessionId, paid, checkout } = await props.searchParams;
  let booking = await getBookingByManageToken(token);
  if (!booking) notFound();

  // Volvió de Checkout sin pagar: se libera el hold (y la sesión) para que
  // pueda elegir el mismo horario de nuevo, y vuelve a la página de reserva.
  if (checkout === 'cancelled' && booking.status === 'pending') {
    const path = await abandonCheckout(booking);
    if (path) redirect(`/${locale}${path}`);
    booking = (await getBookingByManageToken(token)) ?? booking;
  }

  // Vuelta de Stripe Checkout: si el webhook todavía no confirmó, se consulta la sesión.
  if (booking.status === 'pending' && sessionId) {
    const confirmed = await reconcileCheckout(booking, sessionId).catch(() => null);
    if (confirmed) booking = await afterBookingCreated(confirmed, confirmed.locale);
  }

  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) notFound();
  const calendarUser = await getCalendarUser(eventType.user_id);

  return (
    <ManageBooking
      token={token}
      locale={locale}
      eventType={eventType}
      weekStart={calendarUser?.week_start ?? 1}
      maxFutureDays={effectiveMaxFutureDays(eventType, calendarUser)}
      paidNotice={paid === '1'}
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
