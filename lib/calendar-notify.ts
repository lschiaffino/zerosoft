import { getCalendarUser, getEventTypeById } from './calendar';
import { getUserById, type CalendarBookingRow } from './db';
import { escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import { buildIcs } from './ics';

/**
 * Emails de Cal para invitado y host, siempre con un .ics (Agregar al
 * calendario / Cancelado) y, para el invitado, el link para cancelar o
 * reprogramar sin cuenta.
 */

/**
 * requested: la reserva espera que el anfitrión la confirme (sin .ics: todavía
 * no hay reunión); declined: el anfitrión la rechazó o no la confirmó a tiempo
 * (solo al invitado).
 */
type Kind = 'created' | 'cancelled' | 'rescheduled' | 'requested' | 'declined';

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
const COPY: Record<
  Locale,
  Record<Kind, KindCopy> & {
    hi: string;
    where: string;
    reason: string;
    manage: string;
    manageText: string;
    withdraw: string;
    withdrawText: string;
    review: string;
    reviewText: string;
    /** Primer párrafo del email a un invitado extra. */
    guestOf: Record<'created' | 'rescheduled' | 'cancelled', string>;
  }
> = {
  en: {
    hi: 'Hi {name},',
    where: 'Location',
    reason: 'Reason',
    manage: 'Need to change something? <a href="{url}">Reschedule or cancel</a>.',
    manageText: 'Reschedule or cancel: {url}',
    withdraw: 'Changed your mind? <a href="{url}">Withdraw the request</a>.',
    withdrawText: 'Withdraw the request: {url}',
    review: 'Confirm or decline it in <a href="{url}">your bookings</a>. Until then the time stays held.',
    reviewText: 'Confirm or decline it in your bookings: {url}',
    guestOf: {
      created: '<strong>{guest}</strong> ({email}) added you to <strong>{event}</strong>.',
      rescheduled: '<strong>{event}</strong>, where <strong>{guest}</strong> added you, has a new time.',
      cancelled: '<strong>{event}</strong>, where <strong>{guest}</strong> added you, was cancelled.',
    },
    requested: {
      guestSubject: 'Booking request received: {event}',
      hostSubject: 'Booking request: {event} from {guest}',
      heading: 'Waiting for confirmation',
      guestLine: 'we sent your request for <strong>{event}</strong> to the host. You will get another email when they confirm it.',
      hostLine: '<strong>{guest}</strong> ({email}) asked to book <strong>{event}</strong>.',
    },
    declined: {
      guestSubject: 'Booking not confirmed: {event}',
      hostSubject: 'Booking declined: {event}',
      heading: 'Booking not confirmed',
      guestLine: 'the host could not confirm your request for <strong>{event}</strong>. You can pick another time from the booking page.',
      hostLine: '<strong>{guest}</strong> ({email}): the request for <strong>{event}</strong> was declined.',
    },
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
    withdraw: '¿Cambiaste de idea? <a href="{url}">Retirar la solicitud</a>.',
    withdrawText: 'Retirar la solicitud: {url}',
    review: 'Confirmala o rechazala en <a href="{url}">tus reservas</a>. Mientras tanto el horario queda reservado.',
    reviewText: 'Confirmala o rechazala en tus reservas: {url}',
    guestOf: {
      created: '<strong>{guest}</strong> ({email}) te sumó a <strong>{event}</strong>.',
      rescheduled: '<strong>{event}</strong>, a la que te sumó <strong>{guest}</strong>, tiene un nuevo horario.',
      cancelled: '<strong>{event}</strong>, a la que te sumó <strong>{guest}</strong>, se canceló.',
    },
    requested: {
      guestSubject: 'Recibimos tu solicitud: {event}',
      hostSubject: 'Solicitud de reserva: {event} de {guest}',
      heading: 'Esperando confirmación',
      guestLine: 'le mandamos tu solicitud para <strong>{event}</strong> al anfitrión. Te va a llegar otro email cuando la confirme.',
      hostLine: '<strong>{guest}</strong> ({email}) pidió reservar <strong>{event}</strong>.',
    },
    declined: {
      guestSubject: 'Reserva no confirmada: {event}',
      hostSubject: 'Reserva rechazada: {event}',
      heading: 'Reserva no confirmada',
      guestLine: 'el anfitrión no pudo confirmar tu solicitud para <strong>{event}</strong>. Podés elegir otro horario en la página de reservas.',
      hostLine: '<strong>{guest}</strong> ({email}): la solicitud para <strong>{event}</strong> se rechazó.',
    },
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
    withdraw: 'Mudou de ideia? <a href="{url}">Retirar a solicitação</a>.',
    withdrawText: 'Retirar a solicitação: {url}',
    review: 'Confirme ou recuse em <a href="{url}">suas reservas</a>. Até lá o horário fica reservado.',
    reviewText: 'Confirme ou recuse em suas reservas: {url}',
    guestOf: {
      created: '<strong>{guest}</strong> ({email}) adicionou você a <strong>{event}</strong>.',
      rescheduled: '<strong>{event}</strong>, para a qual <strong>{guest}</strong> adicionou você, tem um novo horário.',
      cancelled: '<strong>{event}</strong>, para a qual <strong>{guest}</strong> adicionou você, foi cancelada.',
    },
    requested: {
      guestSubject: 'Recebemos sua solicitação: {event}',
      hostSubject: 'Solicitação de reserva: {event} de {guest}',
      heading: 'Aguardando confirmação',
      guestLine: 'enviamos sua solicitação para <strong>{event}</strong> ao anfitrião. Você vai receber outro email quando ele confirmar.',
      hostLine: '<strong>{guest}</strong> ({email}) pediu para reservar <strong>{event}</strong>.',
    },
    declined: {
      guestSubject: 'Reserva não confirmada: {event}',
      hostSubject: 'Reserva recusada: {event}',
      heading: 'Reserva não confirmada',
      guestLine: 'o anfitrião não pôde confirmar sua solicitação para <strong>{event}</strong>. Você pode escolher outro horário na página de reservas.',
      hostLine: '<strong>{guest}</strong> ({email}): a solicitação para <strong>{event}</strong> foi recusada.',
    },
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

/** Invitados extra guardados en la reserva (emails). */
export function bookingGuests(booking: Pick<CalendarBookingRow, 'guests'>): string[] {
  try {
    const list: unknown = JSON.parse(booking.guests || '[]');
    return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string' && g.includes('@')) : [];
  } catch {
    return [];
  }
}

function asLocale(l: string | null | undefined): Locale {
  return l === 'es' || l === 'pt' ? l : 'en';
}

const REFUND_REASON: Record<Locale, string> = {
  en: 'The payment arrived after the booking was released, so we refunded it in full.',
  es: 'El pago llegó cuando la reserva ya estaba liberada, así que lo reembolsamos completo.',
  pt: 'O pagamento chegou quando a reserva já estava liberada, então o reembolsamos por completo.',
};

const NOT_CONFIRMED_REASON: Record<Locale, string> = {
  en: 'The host did not confirm it before the start time.',
  es: 'El anfitrión no la confirmó antes del horario de inicio.',
  pt: 'O anfitrião não a confirmou antes do horário de início.',
};

/** Motivo del aviso cuando una solicitud venció sin que el anfitrión la confirmara. */
export function notConfirmedReason(locale: string | null | undefined): string {
  return NOT_CONFIRMED_REASON[asLocale(locale)];
}

/** Reservas del anfitrión que esperan su confirmación (link de los emails). */
export function pendingBookingsUrl(locale = 'en'): string {
  return `${appBaseUrl()}/${locale}/app/calendar/bookings?status=pending`;
}

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
  const guests = bookingGuests(booking);
  const L = COPY[lang];
  const copy = L[kind];
  const vars = {
    event: escapeHtml(eventType.title),
    guest: escapeHtml(booking.invitee_name),
    email: escapeHtml(booking.invitee_email),
  };
  // Sin reunión confirmada (solicitud, rechazo o una solicitud que se retiró)
  // no va .ics: el invitado nunca recibió la invitación.
  const noInvite = kind === 'requested' || kind === 'declined' || (kind === 'cancelled' && booking.approval === 'pending');
  const manage = booking.manage_token && kind !== 'declined' && kind !== 'cancelled' ? manageUrl(booking, lang) : null;
  const manageCopy = kind === 'requested' ? { html: L.withdraw, text: L.withdrawText } : { html: L.manage, text: L.manageText };

  const ics = buildIcs({
    uid: `${booking.id}@zerosoft.ai`,
    sequence: sequenceOf(booking),
    method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST',
    start,
    end,
    title: eventType.title,
    description: manage ? `Reschedule or cancel: ${manage}` : undefined,
    location: booking.meeting_url || eventType.location || undefined,
    organizer: { name: host?.name ?? 'zerosoft Cal', email: host?.email ?? 'calendar@zerosoft.ai' },
    attendee: { name: booking.invitee_name, email: booking.invitee_email },
    guests,
  });
  const attachments = noInvite
    ? undefined
    : [{ filename: kind === 'cancelled' ? 'cancel.ics' : 'invite.ics', content: ics, contentType: 'text/calendar' }];

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
    ...(manage ? [fill(manageCopy.html, { url: escapeHtml(manage) })] : []),
  ];
  if (!opts.onlyHost) {
    await sendEmail({
      to: booking.invitee_email,
      subject: stripTags(fill(copy.guestSubject, { ...vars, event: eventType.title })),
      text:
        guestParagraphs.slice(0, manage ? -1 : undefined).map(stripTags).join('\n\n') +
        (manage ? `\n\n${fill(manageCopy.text, { url: manage })}` : ''),
      html: renderBrandedHtml({
        heading: copy.heading,
        paragraphs: guestParagraphs,
        brandColor: eventType.brand_color,
        logoUrl: eventType.logo_url,
      }),
      attachments,
    });
  }

  // Invitados extra: reciben la invitación (y sus cambios) con el mismo .ics,
  // sin el link de gestión, que es del invitado principal.
  if (!opts.onlyHost && !noInvite && guests.length > 0) {
    const guestLine = fill(L.guestOf[kind === 'cancelled' ? 'cancelled' : kind === 'rescheduled' ? 'rescheduled' : 'created'], vars);
    const paragraphs = [guestLine, ...details(booking.timezone)];
    for (const to of guests) {
      await sendEmail({
        to,
        subject: stripTags(fill(copy.guestSubject, { ...vars, event: eventType.title })),
        text: paragraphs.map(stripTags).join('\n\n'),
        html: renderBrandedHtml({
          heading: copy.heading,
          paragraphs,
          brandColor: eventType.brand_color,
          logoUrl: eventType.logo_url,
        }),
        attachments,
      });
    }
  }

  // Host (un rechazo lo decidió él: no se le avisa).
  if (host && !opts.skipHost && kind !== 'declined') {
    // El anfitrión ve la hora en su zona (la de su calendario o, si no tiene, la del dueño).
    const hostTz =
      (await getCalendarUser(host.id))?.timezone ||
      (await getCalendarUser(eventType.user_id))?.timezone ||
      booking.timezone;
    const review = kind === 'requested' ? pendingBookingsUrl(lang) : null;
    const hostParagraphs = [
      `${fill(L.hi, { name: escapeHtml(host.name ?? host.email) })} ${fill(copy.hostLine, vars)}`,
      ...details(hostTz),
      ...(review ? [fill(L.review, { url: escapeHtml(review) })] : []),
    ];
    await sendEmail({
      to: host.email,
      subject: stripTags(fill(copy.hostSubject, { ...vars, event: eventType.title, guest: booking.invitee_name })),
      text:
        hostParagraphs.slice(0, review ? -1 : undefined).map(stripTags).join('\n\n') +
        (review ? `\n\n${fill(L.reviewText, { url: review })}` : ''),
      html: renderBrandedHtml({ heading: copy.heading, paragraphs: hostParagraphs }),
      // Si la reserva ya está en su Google Calendar, un .ics la duplicaría.
      attachments: booking.google_event_id ? undefined : attachments,
    });
  }
}
