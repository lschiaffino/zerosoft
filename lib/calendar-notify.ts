import { getCalendarUser, getEventTypeById } from './calendar';
import { getUserById, type CalendarBookingRow } from './db';
import { escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import { buildIcs } from './ics';

/**
 * Emails de Cal para invitado y host, siempre con un .ics (Agregar al
 * calendario / Cancelado) y, para el invitado, el link para cancelar o
 * reprogramar sin cuenta.
 */

type Kind = 'created' | 'cancelled' | 'rescheduled';

export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export function manageUrl(booking: Pick<CalendarBookingRow, 'manage_token'>, locale = 'en'): string {
  return `${appBaseUrl()}/${locale}/book/manage/${booking.manage_token}`;
}

/** SEQUENCE del .ics: sube con cada modificación del booking. */
function sequenceOf(booking: CalendarBookingRow): number {
  return Math.floor(new Date(booking.updated_at).getTime() / 1000) - 1_700_000_000;
}

type Locale = 'en' | 'es' | 'pt';

interface KindCopy {
  guestSubject: string;
  hostSubject: string;
  heading: string;
  guestLine: string;
  hostLine: string;
}

/** Textos por idioma del invitado (el host recibe el mismo idioma: es su cliente). */
const COPY: Record<Locale, Record<Kind, KindCopy> & { hi: string; where: string; reason: string; manage: string; manageText: string }> = {
  en: {
    hi: 'Hi {name},',
    where: 'Location',
    reason: 'Reason',
    manage: 'Need to change something? <a href="{url}">Reschedule or cancel</a>.',
    manageText: 'Reschedule or cancel: {url}',
    created: {
      guestSubject: 'Booking confirmed: {event}',
      hostSubject: 'New booking: {event} — {guest}',
      heading: 'Booking confirmed',
      guestLine: 'your booking for <strong>{event}</strong> is confirmed.',
      hostLine: '<strong>{guest}</strong> ({email}) booked <strong>{event}</strong>.',
    },
    rescheduled: {
      guestSubject: 'Rescheduled: {event}',
      hostSubject: 'Rescheduled: {event} — {guest}',
      heading: 'Booking rescheduled',
      guestLine: '<strong>{event}</strong> has a new time.',
      hostLine: '<strong>{guest}</strong> ({email}) moved <strong>{event}</strong> to a new time.',
    },
    cancelled: {
      guestSubject: 'Cancelled: {event}',
      hostSubject: 'Cancelled: {event} — {guest}',
      heading: 'Booking cancelled',
      guestLine: '<strong>{event}</strong> was cancelled.',
      hostLine: '<strong>{guest}</strong> ({email}) — <strong>{event}</strong> was cancelled.',
    },
  },
  es: {
    hi: 'Hola {name},',
    where: 'Lugar',
    reason: 'Motivo',
    manage: '¿Necesitás cambiar algo? <a href="{url}">Reprogramar o cancelar</a>.',
    manageText: 'Reprogramar o cancelar: {url}',
    created: {
      guestSubject: 'Reserva confirmada: {event}',
      hostSubject: 'Nueva reserva: {event} — {guest}',
      heading: 'Reserva confirmada',
      guestLine: 'tu reserva para <strong>{event}</strong> está confirmada.',
      hostLine: '<strong>{guest}</strong> ({email}) reservó <strong>{event}</strong>.',
    },
    rescheduled: {
      guestSubject: 'Reprogramada: {event}',
      hostSubject: 'Reprogramada: {event} — {guest}',
      heading: 'Reserva reprogramada',
      guestLine: '<strong>{event}</strong> tiene un nuevo horario.',
      hostLine: '<strong>{guest}</strong> ({email}) movió <strong>{event}</strong> a otro horario.',
    },
    cancelled: {
      guestSubject: 'Cancelada: {event}',
      hostSubject: 'Cancelada: {event} — {guest}',
      heading: 'Reserva cancelada',
      guestLine: '<strong>{event}</strong> se canceló.',
      hostLine: '<strong>{guest}</strong> ({email}) — <strong>{event}</strong> se canceló.',
    },
  },
  pt: {
    hi: 'Olá {name},',
    where: 'Local',
    reason: 'Motivo',
    manage: 'Precisa mudar algo? <a href="{url}">Reagendar ou cancelar</a>.',
    manageText: 'Reagendar ou cancelar: {url}',
    created: {
      guestSubject: 'Reserva confirmada: {event}',
      hostSubject: 'Nova reserva: {event} — {guest}',
      heading: 'Reserva confirmada',
      guestLine: 'sua reserva para <strong>{event}</strong> está confirmada.',
      hostLine: '<strong>{guest}</strong> ({email}) reservou <strong>{event}</strong>.',
    },
    rescheduled: {
      guestSubject: 'Reagendada: {event}',
      hostSubject: 'Reagendada: {event} — {guest}',
      heading: 'Reserva reagendada',
      guestLine: '<strong>{event}</strong> tem um novo horário.',
      hostLine: '<strong>{guest}</strong> ({email}) mudou <strong>{event}</strong> para outro horário.',
    },
    cancelled: {
      guestSubject: 'Cancelada: {event}',
      hostSubject: 'Cancelada: {event} — {guest}',
      heading: 'Reserva cancelada',
      guestLine: '<strong>{event}</strong> foi cancelada.',
      hostLine: '<strong>{guest}</strong> ({email}) — <strong>{event}</strong> foi cancelada.',
    },
  },
};

function asLocale(l: string | null | undefined): Locale {
  return l === 'es' || l === 'pt' ? l : 'en';
}

const REFUND_REASON: Record<Locale, string> = {
  en: 'The payment arrived after the booking was released, so we refunded it in full.',
  es: 'El pago llegó cuando la reserva ya estaba liberada, así que lo reembolsamos completo.',
  pt: 'O pagamento chegou quando a reserva já estava liberada, então o reembolsamos por completo.',
};

/** Motivo del aviso de cancelación cuando un pago tardío se reembolsó. */
export function refundReason(locale: string | null | undefined): string {
  return REFUND_REASON[asLocale(locale)];
}

const CANCEL_REFUND_NOTE: Record<Locale, string> = {
  en: 'The payment was refunded in full.',
  es: 'El pago se reembolsó completo.',
  pt: 'O pagamento foi reembolsado por completo.',
};

/** Motivo del aviso de cancelación de una reserva paga que se reembolsó al cancelarla. */
export function cancelReasonWithRefund(reason: string | null, locale: string | null | undefined): string {
  const note = CANCEL_REFUND_NOTE[asLocale(locale)];
  return reason ? `${reason} — ${note}` : note;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export async function notifyBooking(
  booking: CalendarBookingRow,
  kind: Kind,
  opts: { locale?: string; reason?: string | null; skipHost?: boolean; onlyHost?: boolean } = {},
): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  const host = await getUserById(booking.host_user_id ?? eventType.user_id);
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const lang = asLocale(opts.locale ?? booking.locale);
  const L = COPY[lang];
  const copy = L[kind];
  const vars = {
    event: escapeHtml(eventType.title),
    guest: escapeHtml(booking.invitee_name),
    email: escapeHtml(booking.invitee_email),
  };
  const manage = booking.manage_token ? manageUrl(booking, lang) : null;

  const ics = buildIcs({
    uid: `${booking.id}@zerosoft.ai`,
    sequence: sequenceOf(booking),
    method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST',
    start,
    end,
    title: eventType.title,
    description: manage && kind !== 'cancelled' ? `Reschedule or cancel: ${manage}` : undefined,
    location: booking.meeting_url || eventType.location || undefined,
    organizer: { name: host?.name ?? 'zerosoft Cal', email: host?.email ?? 'calendar@zerosoft.ai' },
    attendee: { name: booking.invitee_name, email: booking.invitee_email },
  });
  const attachments = [
    { filename: kind === 'cancelled' ? 'cancel.ics' : 'invite.ics', content: ics, contentType: 'text/calendar' },
  ];

  const details = (tz: string) => {
    const lines = [`${escapeHtml(formatWhen(start, tz, lang))} (${escapeHtml(tz)})`];
    const where = booking.meeting_url || eventType.location;
    if (where) lines.push(`${L.where}: ${escapeHtml(where)}`);
    if (opts.reason) lines.push(`${L.reason}: ${escapeHtml(opts.reason)}`);
    return lines;
  };

  // Invitado
  const guestParagraphs = [
    `${fill(L.hi, { name: vars.guest })} ${fill(copy.guestLine, vars)}`,
    ...details(booking.timezone),
    ...(manage && kind !== 'cancelled' ? [fill(L.manage, { url: escapeHtml(manage) })] : []),
  ];
  if (!opts.onlyHost) {
    await sendEmail({
      to: booking.invitee_email,
      subject: stripTags(fill(copy.guestSubject, { ...vars, event: eventType.title })),
      text:
        guestParagraphs.slice(0, manage && kind !== 'cancelled' ? -1 : undefined).map(stripTags).join('\n\n') +
        (manage && kind !== 'cancelled' ? `\n\n${fill(L.manageText, { url: manage })}` : ''),
      html: renderBrandedHtml({
        heading: copy.heading,
        paragraphs: guestParagraphs,
        brandColor: eventType.brand_color,
        logoUrl: eventType.logo_url,
      }),
      attachments,
    });
  }

  // Host
  if (host && !opts.skipHost) {
    // El anfitrión ve la hora en su zona (la de su calendario o, si no tiene, la del dueño).
    const hostTz =
      (await getCalendarUser(host.id))?.timezone ||
      (await getCalendarUser(eventType.user_id))?.timezone ||
      booking.timezone;
    const hostParagraphs = [
      `${fill(L.hi, { name: escapeHtml(host.name ?? host.email) })} ${fill(copy.hostLine, vars)}`,
      ...details(hostTz),
    ];
    await sendEmail({
      to: host.email,
      subject: stripTags(fill(copy.hostSubject, { ...vars, event: eventType.title, guest: booking.invitee_name })),
      text: hostParagraphs.map(stripTags).join('\n\n'),
      html: renderBrandedHtml({ heading: copy.heading, paragraphs: hostParagraphs }),
      // Si la reserva ya está en su Google Calendar, un .ics la duplicaría.
      attachments: booking.google_event_id ? undefined : attachments,
    });
  }
}
