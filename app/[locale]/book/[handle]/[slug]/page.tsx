import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getEventTypeByHandle, getCalendarUser, getWorkspaceBrand, effectiveMaxFutureDays } from '@/lib/calendar';
import PublicBookingPage, { BookingInfo } from '@/components/calendar/PublicBookingPage';
import { resolveBrand } from '@/components/calendar/cal-utils';
import { paymentsEnabled } from '@/lib/calendar-payments';
import { sanitizeUtm } from '@/lib/calendar-redirect';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

export default async function BookPage(props: {
  params: Promise<{ handle: string; slug: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { handle, slug, locale } = await props.params;

  const eventType = await getEventTypeByHandle(handle, slug);
  if (!eventType) notFound();
  // Marca del workspace; el color y el logo del evento, si los tiene, la reemplazan.
  const brand = resolveBrand(await getWorkspaceBrand(eventType.user_id), eventType);

  // Pre-fill opcional del invitado (links generados desde el CRM).
  const prefillName = typeof searchParams.name === 'string' ? searchParams.name.slice(0, 200) : '';
  const prefillEmail = typeof searchParams.email === 'string' ? searchParams.email.slice(0, 200) : '';
  // utm_* del link (campañas): viajan con la reserva y llegan al anfitrión y a los webhooks.
  const utm = sanitizeUtm(searchParams) as Record<string, string>;

  // Link de un solo uso ya consumido, o evento pago sin Stripe listo (clave +
  // webhook): se avisa antes del form en vez de fallar al enviar la reserva.
  const closed =
    eventType.single_use === 1 && eventType.used_at
      ? 'expired'
      : eventType.price_cents > 0 && !(await paymentsEnabled(eventType.user_id))
        ? 'unavailable'
        : null;
  if (closed) {
    const t = await getTranslations({ locale, namespace: 'calendar' });
    return (
      <div className="bk" style={{ '--bk': brand.color, '--bk-on': brand.on } as React.CSSProperties}>
        <div className="bk-card">
          <BookingInfo
            hostName={brand.name}
            logoUrl={brand.logoUrl}
            title={eventType.title}
          />
          <div className="bk-main">
            <section className="bk-done">
              <h2 className="bk-h2">{t(`booking.${closed}Title`)}</h2>
              <p className="bk-muted">{t(`booking.${closed}Sub`)}</p>
            </section>
          </div>
        </div>
      </div>
    );
  }

  const calendarUser = await getCalendarUser(eventType.user_id);

  return (
    <PublicBookingPage
      eventType={eventType}
      locale={locale}
      brand={brand}
      weekStart={calendarUser?.week_start ?? 1}
      maxFutureDays={effectiveMaxFutureDays(eventType, calendarUser)}
      prefillName={prefillName}
      prefillEmail={prefillEmail}
      utm={utm}
    />
  );
}
