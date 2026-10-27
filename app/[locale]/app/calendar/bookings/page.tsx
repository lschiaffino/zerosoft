import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { bookingDateBounds, listEventHosts, listEventTypes, listUserBookings, localDate } from '@/lib/calendar';
import { locationKey, parseLocations } from '@/lib/calendar-locations';
import { hostToken } from '@/lib/calendar-host-token';
import type { OnBehalfEventType } from '@/components/calendar/ScheduleOnBehalfModal';
import { bookingListQuerySchema } from '@/lib/calendar-schema';
import PageHeader from '@/components/ui/PageHeader';
import BookingsList from '@/components/calendar/BookingsList';
import { formatTimezone } from '@/components/calendar/cal-utils';

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
  const today = localDate(new Date(), timezone);
  const from = hasFilters ? f.from : today;
  const bounds = await bookingDateBounds(user.id, from, f.to);
  const bookings = await listUserBookings(user.id, {
    q: f.q,
    status: f.status,
    from: bounds.from,
    to: bounds.to,
    // Con fecha "desde": la más cercana primero (como la API).
    order: from ? 'asc' : 'desc',
  });

  // "Nueva reserva": un admin agenda para cualquier anfitrión; un member, en los eventos que atiende.
  const admin = isWorkspaceAdmin(user);
  const me = realUserId(user);
  const onBehalf: OnBehalfEventType[] = [];
  for (const e of await listEventTypes(user.id, { activeOnly: true })) {
    if (e.single_use === 1 && e.used_at) continue;
    const pool = await listEventHosts(e.id);
    const hosts = pool.length > 0 ? pool.map((h) => ({ id: h.user_id, name: h.name?.trim() || h.email })) : [];
    if (!admin && !(pool.length > 0 ? pool.some((h) => h.user_id === me) : e.user_id === me)) continue;
    onBehalf.push({
      id: e.id,
      title: e.title,
      durationMin: e.duration_min,
      hosts: (admin ? hosts : hosts.filter((h) => h.id === me)).map((h) => ({ token: hostToken(h.id), name: h.name })),
      locations: parseLocations(e.locations).map((o, i) => ({
        key: locationKey(o, i),
        label: o.kind === 'in_person' || o.kind === 'link' ? o.value : t(`location.kind.${o.kind}`),
        needsPhone: o.kind === 'phone_host',
      })),
    });
  }

  return (
    <div className="ui-page">
      <PageHeader title={t('bookings.title')} description={t('bookings.lead', { timezone: formatTimezone(timezone, locale) })} />
      <BookingsList
        bookings={bookings}
        locale={locale}
        timezone={timezone}
        defaultFrom={today}
        initialFilters={{ q: f.q ?? '', status: f.status ?? '', from: from ?? '', to: f.to ?? '' }}
        eventTypes={onBehalf}
        canChooseHost={admin}
      />
    </div>
  );
}
