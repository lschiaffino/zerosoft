import { getEventTypeById } from './calendar';
import { notifyBooking } from './calendar-notify';
import type { CalendarBookingRow } from './db';
import {
  createGoogleEventForBooking,
  deleteGoogleEventForBooking,
  syncGoogleEventTime,
} from './google-calendar';

/**
 * Efectos de cada cambio de una reserva, en un solo lugar: calendario externo
 * del host, emails (+ .ics) y, más adelante, webhooks. Ninguno puede romper la
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

export async function afterBookingCreated(booking: CalendarBookingRow, locale?: string): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return booking;
  const synced = await safely('google-create', () => createGoogleEventForBooking(booking, eventType), booking);
  await safely('notify-created', () => notifyBooking(synced, 'created', { locale }), undefined);
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
  return synced;
}

export async function afterBookingCancelled(booking: CalendarBookingRow, reason: string | null): Promise<void> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return;
  await safely('google-delete', () => deleteGoogleEventForBooking(booking, eventType), undefined);
  await safely('notify-cancelled', () => notifyBooking(booking, 'cancelled', { reason }), undefined);
}
