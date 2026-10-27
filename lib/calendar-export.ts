/**
 * Cal — export CSV de reservas y de la analítica (como el export de Calendly).
 * Las celdas pasan por toCsv de lib/robots-csv.ts (neutraliza fórmulas y
 * escapa comillas y saltos). Las horas van en ISO UTC y además en la zona del
 * calendario del workspace, para que la planilla se lea sin convertir. Puro.
 */
import { toCsv } from './robots-csv';
import { parseUtm } from './calendar-redirect';
import type { CalendarBookingRowWithEvent } from './calendar';
import type { BookingAnalytics } from './calendar-analytics';

function local(iso: string, tz: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE da "2026-10-27 14:30:00": se ordena bien en cualquier planilla.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function json<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return (JSON.parse(raw || '') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export const BOOKINGS_CSV_HEAD = [
  'booking_id',
  'event_type',
  'status',
  'start_local',
  'end_local',
  'start_utc',
  'end_utc',
  'invitee_name',
  'invitee_email',
  'invitee_timezone',
  'guests',
  'host',
  'location',
  'meeting_url',
  'answers',
  'cancel_reason',
  'no_show',
  'reconfirmed_at',
  'payment_status',
  'amount',
  'currency',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'booked_by_team',
  'created_at',
] as const;

export function bookingsCsv(rows: CalendarBookingRowWithEvent[], timezone: string): string {
  return toCsv(
    BOOKINGS_CSV_HEAD,
    rows.map((b) => {
      const utm = parseUtm(b.utm);
      const answers = json<Record<string, unknown>>(b.answers, {});
      return [
        b.id,
        b.event_type_title,
        b.status,
        local(b.starts_at, timezone),
        local(b.ends_at, timezone),
        b.starts_at,
        b.ends_at,
        b.invitee_name,
        b.invitee_email,
        b.timezone,
        json<string[]>(b.guests, []).join('; '),
        b.host_name || b.host_email || '',
        b.location || '',
        b.meeting_url || '',
        Object.entries(answers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
          .join(' | '),
        b.cancel_reason || '',
        b.status === 'no_show' ? 'yes' : '',
        b.reconfirmed_at || '',
        b.payment_status === 'none' ? '' : b.payment_status,
        b.amount_cents ? (b.amount_cents / 100).toFixed(2) : '',
        b.currency || '',
        utm.utm_source ?? '',
        utm.utm_medium ?? '',
        utm.utm_campaign ?? '',
        b.booked_by ? 'yes' : '',
        b.created_at,
      ];
    }),
  );
}

/** Analítica en un CSV: totales, por día y por tipo de evento (una sección por bloque). */
export function analyticsCsv(a: BookingAnalytics, range: { fromDate: string; toDate: string }): string {
  const totals = toCsv(
    ['from', 'to', 'created', 'confirmed', 'cancelled', 'no_show', 'pending', 'cancel_rate', 'no_show_rate'],
    [
      [
        range.fromDate,
        range.toDate,
        a.created,
        a.confirmed,
        a.cancelled,
        a.noShow,
        a.pending,
        a.cancelRate === null ? '' : a.cancelRate.toFixed(4),
        a.noShowRate === null ? '' : a.noShowRate.toFixed(4),
      ],
    ],
  );
  const byDay = toCsv(['date', 'created'], a.byDay.map((d) => [d.date, d.count]));
  const byType = toCsv(['event_type', 'created', 'cancelled', 'no_show'], a.byEventType.map((e) => [e.title, e.created, e.cancelled, e.noShow]));
  const byHost = toCsv(['host', 'created', 'cancelled', 'no_show'], (a.byHost ?? []).map((h) => [h.name, h.created, h.cancelled, h.noShow]));
  return `${totals}\r\n${byDay}\r\n${byType}\r\n${byHost}`;
}
