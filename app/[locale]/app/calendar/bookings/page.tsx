import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listUserBookings } from '@/lib/calendar';
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
  const from = hasFilters ? f.from : new Date().toISOString().slice(0, 10);
  const bookings = await listUserBookings(user.id, {
    q: f.q,
    status: f.status,
    from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59.999Z`) : undefined,
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
        initialFilters={{ q: f.q ?? '', status: f.status ?? '', from: from ?? '', to: f.to ?? '' }}
      />
    </div>
  );
}
