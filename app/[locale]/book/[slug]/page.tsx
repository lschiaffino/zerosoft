import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getEventTypeBySlug, getCalendarUser } from '@/lib/calendar';
import PublicBookingPage from '@/components/calendar/PublicBookingPage';

export const dynamic = 'force-dynamic';

export default async function BookPage({
  params: { slug, locale },
}: {
  params: { slug: string; locale: string };
}) {
  const eventType = await getEventTypeBySlug(slug);
  if (!eventType) notFound();

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

  const calendarUser = await getCalendarUser(eventType.user_id);

  return (
    <PublicBookingPage
      eventType={eventType}
      locale={locale}
      weekStart={calendarUser?.week_start ?? 1}
    />
  );
}
