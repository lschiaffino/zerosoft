import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getEventTypeByHandle, getCalendarUser, getWorkspaceBrand, effectiveMaxFutureDays, parseOneOffTimes } from '@/lib/calendar';
import PublicBookingPage, { BookingInfo } from '@/components/calendar/PublicBookingPage';
import { resolveBrand } from '@/components/calendar/cal-utils';
import { paymentsEnabled } from '@/lib/calendar-payments';
import { sanitizeUtm } from '@/lib/calendar-redirect';
import { parseQuestions, prefillAnswers } from '@/lib/calendar-questions';
import { publicLocationsJson } from '@/lib/calendar-locations';
import PublicPageExtras from '@/components/calendar/PublicPageExtras';
import { parseHostToken } from '@/lib/calendar-host-token';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

/** Los tipos secretos, de un solo uso o de encuestas se reservan por link: no se indexan. */
export async function generateMetadata(props: { params: Promise<{ handle: string; slug: string }> }): Promise<Metadata> {
  const { handle, slug } = await props.params;
  const eventType = await getEventTypeByHandle(handle, slug);
  if (!eventType) return {};
  const privateLink = eventType.hidden === 1 || eventType.single_use === 1 || eventType.kind === 'poll';
  return privateLink ? { robots: { index: false, follow: false } } : {};
}

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
  // Respuestas que trae el link (p. ej. desde un routing form): prellenan las preguntas con el mismo nombre.
  const prefilled = prefillAnswers(parseQuestions(eventType.fieldsParsed), searchParams);

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
        <PublicPageExtras workspaceId={eventType.user_id} />
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
  // Reunión única: el calendario llega hasta el último horario ofrecido.
  const offered = parseOneOffTimes(eventType.one_off_times);
  const oneOffDays = offered
    ? Math.max(1, Math.ceil(((offered[offered.length - 1]?.getTime() ?? Date.now()) - Date.now()) / 86_400_000) + 1)
    : null;

  return (
    <>
      <PublicPageExtras workspaceId={eventType.user_id} />
      <PublicBookingPage
        eventType={{ ...eventType, locations: publicLocationsJson(eventType.locations) }}
        locale={locale}
        brand={brand}
        weekStart={calendarUser?.week_start ?? 1}
        maxFutureDays={oneOffDays ?? effectiveMaxFutureDays(eventType, calendarUser)}
        prefillName={prefillName}
        prefillEmail={prefillEmail}
        prefillAnswers={prefilled}
        utm={utm}
        routingSubmissionId={typeof searchParams.rsid === 'string' ? searchParams.rsid.slice(0, 64) : undefined}
        hostId={typeof searchParams.host === 'string' && parseHostToken(searchParams.host) ? searchParams.host : undefined}
      />
    </>
  );
}
