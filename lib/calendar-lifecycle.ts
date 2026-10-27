import { getEventTypeById, reassignBookingsOfRemovedHost, type EventTypeWithRules } from './calendar';
import { emitEvent } from './events';
import { bookingGuests, cancelReasonWithRefund, notConfirmedReason, notifyBooking, refundReason } from './calendar-notify';
import { parseUtm } from './calendar-redirect';
import { recordBookingInCrm } from './crm-integrations';
import type { CalendarBookingRow } from './db';
import { createExternalForBooking, deleteExternalForBooking, syncExternalTime } from './calendar-external';
import { scheduleTriggeredRuns } from './calendar-workflows';

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
    /** Invitados extra que sumó el invitado. */
    guests: bookingGuests(booking),
    answers: (() => {
      try {
        return JSON.parse(booking.answers || '{}');
      } catch {
        return {};
      }
    })(),
    hostUserId: booking.host_user_id,
    meetingUrl: booking.meeting_url,
    /** Ubicación elegida por el invitado (null si el evento no ofrece opciones). */
    location: booking.location_kind ? { kind: booking.location_kind, value: booking.location } : null,
    /** Co-anfitriones de un evento colectivo. */
    coHostUserIds: (() => {
      try {
        const list: unknown = JSON.parse(booking.co_host_ids || '[]');
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    })(),
    rescheduledFrom: booking.rescheduled_from,
    cancelReason: booking.cancel_reason,
    /** none | pending | approved | declined: confirmación del anfitrión. */
    approval: booking.approval ?? 'none',
    /** utm_* de la página de reserva (vacío si no vinieron). */
    utm: parseUtm(booking.utm),
    payment:
      booking.payment_status && booking.payment_status !== 'none'
        ? { status: booking.payment_status, amountCents: booking.amount_cents, currency: booking.currency }
        : null,
    eventType: { id: eventType.id, slug: eventType.slug, title: eventType.title },
  };
}

/**
 * Reserva nueva. Si espera la confirmación del anfitrión, solo salen los
 * avisos de solicitud y el webhook booking.requested: el evento en Google, el
 * CRM y booking.created llegan al confirmarla (afterBookingApproved).
 */
export async function afterBookingCreated(booking: CalendarBookingRow, locale?: string): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return booking;
  if (booking.status === 'pending' && booking.approval === 'pending') {
    await safely('notify-requested', () => notifyBooking(booking, 'requested', { locale }), undefined);
    await emitEvent(eventType.user_id, 'booking.requested', bookingPayload(booking, eventType));
    return booking;
  }
  const synced = await safely('external-create', () => createExternalForBooking(booking, eventType), booking);
  await safely('notify-created', () => notifyBooking(synced, 'created', { locale }), undefined);
  await safely('workflow-booked', () => scheduleTriggeredRuns(synced.id, 'booked'), 0);
  await safely('crm-created', () => recordBookingInCrm(eventType.user_id, 'created', synced, eventType.title), undefined);
  await emitEvent(eventType.user_id, 'booking.created', bookingPayload(synced, eventType));
  return synced;
}

/**
 * El anfitrión confirmó la solicitud: lo mismo que una reserva nueva (los dos
 * reciben la confirmación con el .ics, que el anfitrión todavía no tenía).
 */
export function afterBookingApproved(booking: CalendarBookingRow): Promise<CalendarBookingRow> {
  return afterBookingCreated(booking, booking.locale);
}

/**
 * Solicitud rechazada por el anfitrión o vencida sin respuesta (`expired`):
 * aviso al invitado y webhook booking.cancelled.
 */
export async function afterBookingDeclined(
  booking: CalendarBookingRow,
  reason: string | null,
  opts: { expired?: boolean } = {},
): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  const notice = opts.expired ? notConfirmedReason(booking.locale) : reason;
  await safely('notify-declined', () => notifyBooking(booking, 'declined', { reason: notice }), undefined);
  await emitEvent(eventType.user_id, 'booking.cancelled', bookingPayload(booking, eventType));
  // Solo Flow: distingue el rechazo (o el vencimiento sin respuesta) de una cancelación.
  await emitEvent(eventType.user_id, 'booking.declined', { ...bookingPayload(booking, eventType), expired: opts.expired === true });
}

export async function afterBookingRescheduled(
  booking: CalendarBookingRow,
  previousHostId: string | null,
  locale?: string,
  opts: { byHost?: boolean } = {},
): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return booking;
  const synced = await safely('external-move', () => syncExternalTime(booking, eventType, previousHostId), booking);
  await safely('workflow-rescheduled', () => scheduleTriggeredRuns(synced.id, 'rescheduled'), 0);
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
  await safely('external-delete', () => deleteExternalForBooking(booking, eventType), undefined);
  await safely('workflow-cancelled', () => scheduleTriggeredRuns(booking.id, 'cancelled'), 0);
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
  await safely('workflow-no-show', () => scheduleTriggeredRuns(booking.id, 'no_show'), 0);
  await emitEvent(eventType.user_id, 'booking.no_show', bookingPayload(booking, eventType));
}

/** El invitado confirmó que va: webhook booking.reconfirmed (Flow y webhooks). */
export async function afterBookingReconfirmed(booking: CalendarBookingRow): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  await emitEvent(eventType.user_id, 'booking.reconfirmed', { ...bookingPayload(booking, eventType), reconfirmedAt: booking.reconfirmed_at });
}

/** Pago que llegó tarde y se reembolsó: la reserva sigue cancelada, se avisa al invitado y al anfitrión. */
export async function afterPaymentRefunded(booking: CalendarBookingRow): Promise<void> {
  await safely('notify-refunded', () => notifyBooking(booking, 'cancelled', { reason: refundReason(booking.locale) }), undefined);
  const eventType = await getEventTypeById(booking.event_type_id);
  if (eventType) await emitEvent(eventType.user_id, 'booking.refunded', bookingPayload(booking, eventType));
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
    const synced = await safely('external-reassign', () => syncExternalTime(booking, eventType, userId), booking);
    await safely('notify-host-assigned', () => notifyBooking(synced, 'created', { onlyHost: true }), undefined);
  }
}
