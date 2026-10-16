import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getEventTypeByHandle, getCalendarUser, effectiveMaxFutureDays } from '@/lib/calendar';
import PublicBookingPage from '@/components/calendar/PublicBookingPage';
import { paymentsEnabled } from '@/lib/calendar-payments';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

export default async function BookPage(
  props: {
    params: Promise<{ handle: string; slug: string; locale: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const { handle, slug, locale } = params;

  const eventType = await getEventTypeByHandle(handle, slug);
  if (!eventType) notFound();

  // Pre-fill opcional del invitado (links generados desde el CRM).
  const prefillName = typeof searchParams.name === 'string' ? searchParams.name.slice(0, 200) : '';
  const prefillEmail = typeof searchParams.email === 'string' ? searchParams.email.slice(0, 200) : '';

  // Link de un solo uso ya consumido: no se permite reservar de nuevo.
  if (eventType.single_use === 1 && eventType.used_at) {
    const t = await getTranslations({ locale, namespace: 'calendar' });
    return (
      <div className="booking-page">
        <div className="booking-card booking-expired">
          <span
            className="calendar-event-dot-large"
            style={{ backgroundColor: eventType.brand_color ?? eventType.color }}
            aria-hidden
          />
          <h1 className="booking-title">{t('booking.expiredTitle')}</h1>
          <p className="muted">{t('booking.expiredSub')}</p>
        </div>
      </div>
    );
  }

  // Evento pago sin Stripe listo (clave + webhook): se avisa antes del form en
  // vez de fallar al enviar la reserva.
  if (eventType.price_cents > 0 && !(await paymentsEnabled(eventType.user_id))) {
    const t = await getTranslations({ locale, namespace: 'calendar' });
    return (
      <div className="booking-page">
        <div className="booking-card booking-expired">
          <span
            className="calendar-event-dot-large"
            style={{ backgroundColor: eventType.brand_color ?? eventType.color }}
            aria-hidden
          />
          <h1 className="booking-title">{t('booking.unavailableTitle')}</h1>
          <p className="muted">{t('booking.unavailableSub')}</p>
        </div>
      </div>
    );
  }

  const calendarUser = await getCalendarUser(eventType.user_id);

  return (
    <PublicBookingPage
      eventType={eventType}
      locale={locale}
      weekStart={calendarUser?.week_start ?? 1}
      maxFutureDays={effectiveMaxFutureDays(eventType, calendarUser)}
      prefillName={prefillName}
      prefillEmail={prefillEmail}
    />
  );
}
