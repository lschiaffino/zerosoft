import { getEventTypeById, reassignBookingsOfRemovedHost, type EventTypeWithRules } from './calendar';
import { emitEvent } from './events';
import { cancelReasonWithRefund, notifyBooking, refundReason } from './calendar-notify';
import { recordBookingInCrm } from './crm-integrations';
import type { CalendarBookingRow } from './db';
import {
  createGoogleEventForBooking,
  deleteGoogleEventForBooking,
  syncGoogleEventTime,
} from './google-calendar';

/**
 * Efectos de cada cambio de una reserva, en un solo lugar: calendario externo
 * del host, emails (+ .ics), contacto + reunión en el CRM y webhooks. Ninguno puede romper la
 * reserva: los errores se registran y se sigue.
 */

async function safely<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[cal:${label}]`, err);
    return fallback;
  }
}

/** Payload público de una reserva para webhooks y la API v1. */
export function bookingPayload(booking: CalendarBookingRow, eventType: Pick<EventTypeWithRules, 'id' | 'slug' | 'title'>) {
  return {
    id: booking.id,
    status: booking.status,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    timezone: booking.timezone,
    invitee: { name: booking.invitee_name, email: booking.invitee_email },
    answers: (() => {
      try {
        return JSON.parse(booking.answers || '{}');
      } catch {
        return {};
      }
    })(),
    hostUserId: booking.host_user_id,
    meetingUrl: booking.meeting_url,
    rescheduledFrom: booking.rescheduled_from,
    cancelReason: booking.cancel_reason,
    payment:
      booking.payment_status && booking.payment_status !== 'none'
        ? { status: booking.payment_status, amountCents: booking.amount_cents, currency: booking.currency }
        : null,
    eventType: { id: eventType.id, slug: eventType.slug, title: eventType.title },
  };
}

export async function afterBookingCreated(booking: CalendarBookingRow, locale?: string): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return booking;
  const synced = await safely('google-create', () => createGoogleEventForBooking(booking, eventType), booking);
  await safely('notify-created', () => notifyBooking(synced, 'created', { locale }), undefined);
  await safely('crm-created', () => recordBookingInCrm(eventType.user_id, 'created', synced, eventType.title), undefined);
  await emitEvent(eventType.user_id, 'booking.created', bookingPayload(synced, eventType));
  return synced;
}

export async function afterBookingRescheduled(
  booking: CalendarBookingRow,
  previousHostId: string | null,
  locale?: string,
  opts: { byHost?: boolean } = {},
): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return booking;
  const synced = await safely('google-move', () => syncGoogleEventTime(booking, eventType, previousHostId), booking);
  // Round-robin: el host original estaba ocupado en el horario nuevo y la
  // reserva pasó a otro. El anterior recibe la cancelación (con el horario
  // que tenía) y el nuevo la reserva, aunque la haya movido un anfitrión.
  const hostChanged = previousHostId !== null && previousHostId !== synced.host_user_id;
  // Si la movió el anfitrión, solo se avisa al invitado (el anfitrión ya lo sabe).
  await safely(
    'notify-rescheduled',
    () => notifyBooking(synced, 'rescheduled', { locale, skipHost: opts.byHost || hostChanged }),
    undefined,
  );
  if (hostChanged) {
    const oldStart = synced.rescheduled_from ?? synced.starts_at;
    const durationMs = new Date(synced.ends_at).getTime() - new Date(synced.starts_at).getTime();
    const previous: CalendarBookingRow = {
      ...synced,
      host_user_id: previousHostId,
      starts_at: oldStart,
      ends_at: new Date(new Date(oldStart).getTime() + durationMs).toISOString(),
      google_event_id: null,
    };
    await safely('notify-host-released', () => notifyBooking(previous, 'cancelled', { locale, onlyHost: true }), undefined);
    await safely('notify-host-assigned', () => notifyBooking(synced, 'created', { locale, onlyHost: true }), undefined);
  }
  await safely('crm-rescheduled', () => recordBookingInCrm(eventType.user_id, 'rescheduled', synced, eventType.title), undefined);
  await emitEvent(eventType.user_id, 'booking.rescheduled', bookingPayload(synced, eventType));
  return synced;
}

export async function afterBookingCancelled(booking: CalendarBookingRow, reason: string | null): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  await safely('google-delete', () => deleteGoogleEventForBooking(booking, eventType), undefined);
  // Reserva paga reembolsada al cancelarla: el aviso lo dice.
  const notice = booking.payment_status === 'refunded' ? cancelReasonWithRefund(reason, booking.locale) : reason;
  await safely('notify-cancelled', () => notifyBooking(booking, 'cancelled', { reason: notice }), undefined);
  await safely('crm-cancelled', () => recordBookingInCrm(eventType.user_id, 'cancelled', booking, eventType.title, reason), undefined);
  await emitEvent(eventType.user_id, 'booking.cancelled', bookingPayload(booking, eventType));
}

/**
 * El invitado no se presentó (lo marca el anfitrión o la API v1): webhook
 * booking.no_show y trigger de Flow, para que un seguimiento pueda reaccionar.
 */
export async function afterBookingNoShow(booking: CalendarBookingRow): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  await emitEvent(eventType.user_id, 'booking.no_show', bookingPayload(booking, eventType));
}

/** Pago que llegó tarde y se reembolsó: la reserva sigue cancelada, se avisa al invitado y al anfitrión. */
export async function afterPaymentRefunded(booking: CalendarBookingRow): Promise<void> {
  await safely('notify-refunded', () => notifyBooking(booking, 'cancelled', { reason: refundReason(booking.locale) }), undefined);
}

/**
 * Un miembro salió del team: sus reservas por venir pasan a otro host (o al
 * dueño). El evento de Google se mueve al calendario del nuevo host y este
 * recibe el aviso; al que salió no le llega nada más con datos del invitado.
 */
export async function reassignRemovedHostBookings(ownerId: string, userId: string): Promise<void> {
  const moved = await reassignBookingsOfRemovedHost(ownerId, userId);
  for (const booking of moved) {
    // Un hold todavía sin pagar se avisa al confirmarse (afterBookingCreated).
    if (booking.status !== 'confirmed') continue;
    const eventType = await getEventTypeById(booking.event_type_id);
    if (!eventType) continue;
    const synced = await safely('google-reassign', () => syncGoogleEventTime(booking, eventType, userId), booking);
    await safely('notify-host-assigned', () => notifyBooking(synced, 'created', { onlyHost: true }), undefined);
  }
}
