import { getEventTypeById, type EventTypeWithRules } from './calendar';
import { emitEvent } from './events';
import { notifyBooking } from './calendar-notify';
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
): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return booking;
  const synced = await safely('google-move', () => syncGoogleEventTime(booking, eventType, previousHostId), booking);
  await safely('notify-rescheduled', () => notifyBooking(synced, 'rescheduled', { locale }), undefined);
  await safely('crm-rescheduled', () => recordBookingInCrm(eventType.user_id, 'rescheduled', synced, eventType.title), undefined);
  await emitEvent(eventType.user_id, 'booking.rescheduled', bookingPayload(synced, eventType));
  return synced;
}

export async function afterBookingCancelled(booking: CalendarBookingRow, reason: string | null): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  await safely('google-delete', () => deleteGoogleEventForBooking(booking, eventType), undefined);
  await safely('notify-cancelled', () => notifyBooking(booking, 'cancelled', { reason }), undefined);
  await safely('crm-cancelled', () => recordBookingInCrm(eventType.user_id, 'cancelled', booking, eventType.title, reason), undefined);
  await emitEvent(eventType.user_id, 'booking.cancelled', bookingPayload(booking, eventType));
}
