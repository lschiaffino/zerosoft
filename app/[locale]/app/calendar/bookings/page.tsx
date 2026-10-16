import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { bookingDateBounds, listUserBookings, localDate } from '@/lib/calendar';
import { bookingListQuerySchema } from '@/lib/calendar-schema';
import BookingsList from '@/components/calendar/BookingsList';

export const dynamic = 'force-dynamic';

export default async function BookingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  // Sin filtros en la URL: próximas (desde hoy).
  const hasFilters = ['q', 'status', 'from', 'to'].some((k) => sp[k] !== undefined);
  const parsed = bookingListQuerySchema.safeParse(
    hasFilters ? { q: sp.q, status: sp.status || undefined, from: sp.from || undefined, to: sp.to || undefined } : {},
  );
  const f = parsed.success ? parsed.data : {};
  // Días en la zona del calendario del workspace (también el "hoy" por defecto).
  const { timezone } = await bookingDateBounds(user.id, undefined, undefined);
  const from = hasFilters ? f.from : localDate(new Date(), timezone);
  const bounds = await bookingDateBounds(user.id, from, f.to);
  const bookings = await listUserBookings(user.id, {
    q: f.q,
    status: f.status,
    from: bounds.from,
    to: bounds.to,
    // Con fecha "desde": la más cercana primero (como la API).
    order: from ? 'asc' : 'desc',
  });

  return (
    <div className="app-page cal-page">
      <div className="page-head">
        <h1 className="app-title">{t('bookings.title')}</h1>
      </div>

      <BookingsList
        bookings={bookings}
        locale={locale}
        timezone={timezone}
        initialFilters={{ q: f.q ?? '', status: f.status ?? '', from: from ?? '', to: f.to ?? '' }}
      />
    </div>
  );
}
