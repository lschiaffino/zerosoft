import { getEventTypeById } from './calendar';
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

const COPY: Record<Kind, { guestSubject: string; hostSubject: string; heading: string; guestLine: string; hostLine: string }> = {
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
};

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export async function notifyBooking(
  booking: CalendarBookingRow,
  kind: Kind,
  opts: { locale?: string; reason?: string | null } = {},
): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  const host = await getUserById(booking.host_user_id ?? eventType.user_id);
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const copy = COPY[kind];
  const vars = {
    event: escapeHtml(eventType.title),
    guest: escapeHtml(booking.invitee_name),
    email: escapeHtml(booking.invitee_email),
  };
  const manage = booking.manage_token ? manageUrl(booking, opts.locale) : null;

  const ics = buildIcs({
    uid: `${booking.id}@zerosoft.ai`,
    sequence: sequenceOf(booking),
    method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST',
    start,
    end,
    title: eventType.title,
    description: manage && kind !== 'cancelled' ? `Reschedule or cancel: ${manage}` : undefined,
    location: booking.meeting_url || eventType.location || undefined,
    organizer: { name: host?.name ?? 'Zerosoft Cal', email: host?.email ?? 'calendar@zerosoft.ai' },
    attendee: { name: booking.invitee_name, email: booking.invitee_email },
  });
  const attachments = [
    { filename: kind === 'cancelled' ? 'cancel.ics' : 'invite.ics', content: ics, contentType: 'text/calendar' },
  ];

  const details = (tz: string) => {
    const lines = [`${escapeHtml(formatWhen(start, tz))} (${escapeHtml(tz)})`];
    const where = booking.meeting_url || eventType.location;
    if (where) lines.push(`Location: ${escapeHtml(where)}`);
    if (opts.reason) lines.push(`Reason: ${escapeHtml(opts.reason)}`);
    return lines;
  };

  // Invitado
  const guestParagraphs = [
    `Hi ${vars.guest}, ${fill(copy.guestLine, vars)}`,
    ...details(booking.timezone),
    ...(manage && kind !== 'cancelled'
      ? [`Need to change something? <a href="${escapeHtml(manage)}">Reschedule or cancel</a>.`]
      : []),
  ];
  await sendEmail({
    to: booking.invitee_email,
    subject: stripTags(fill(copy.guestSubject, { ...vars, event: eventType.title })),
    text: guestParagraphs.map(stripTags).join('\n\n') + (manage && kind !== 'cancelled' ? `\n\n${manage}` : ''),
    html: renderBrandedHtml({
      heading: copy.heading,
      paragraphs: guestParagraphs,
      brandColor: eventType.brand_color,
      logoUrl: eventType.logo_url,
    }),
    attachments,
  });

  // Host
  if (host) {
    const hostParagraphs = [
      `Hi ${escapeHtml(host.name ?? host.email)}, ${fill(copy.hostLine, vars)}`,
      ...details(booking.timezone),
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
