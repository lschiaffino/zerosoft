import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listUserBookings } from '@/lib/calendar';
import BookingsList from '@/components/calendar/BookingsList';

export const dynamic = 'force-dynamic';

export default async function BookingsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const bookings = await listUserBookings(user.id);

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('bookings.title')}</h1>
        <Link href="/app/calendar" className="btn btn-ghost btn-small">
          {t('common.back')}
        </Link>
      </div>

      <BookingsList bookings={bookings} locale={locale} />
    </div>
  );
}
