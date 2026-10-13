import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listUserBookings } from '@/lib/calendar';
import BookingsList from '@/components/calendar/BookingsList';

export const dynamic = 'force-dynamic';

export default async function BookingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const bookings = await listUserBookings(user.id);

  return (
    <div className="app-page cal-page">
      <div className="page-head">
        <h1 className="app-title">{t('bookings.title')}</h1>
      </div>

      <BookingsList bookings={bookings} locale={locale} />
    </div>
  );
}
