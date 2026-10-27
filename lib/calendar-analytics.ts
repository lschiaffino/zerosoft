/**
 * Cal — analítica de reservas del workspace (server-only para la carga; el
 * cálculo es puro y se testea aparte).
 *
 * Todo se cuenta sobre las reservas CREADAS en el rango (días en la zona del
 * calendario del workspace): cuántas entraron, cuántas se cancelaron y
 * cuántas quedaron como no-show. Los horarios populares salen del inicio de
 * las reservas que siguen en pie (confirmadas o no-show), en esa misma zona.
 * Los holds de pago que vencieron sin pagarse no cuentan: nunca fueron una
 * reserva.
 */
import { getDb } from './db';

export interface AnalyticsBookingRow {
  created_at: string;
  starts_at: string;
  status: string;
  payment_status: string | null;
  event_type_id: string;
  event_type_title: string;
  /** Anfitrión asignado (para el reparto por persona). */
  host_user_id?: string | null;
  host_name?: string | null;
}

export interface BookingAnalytics {
  created: number;
  cancelled: number;
  noShow: number;
  /** Confirmadas que ya pasaron o están por venir (no canceladas ni no-show). */
  confirmed: number;
  /** Esperando pago o confirmación del anfitrión. */
  pending: number;
  /** 0..1 sobre las creadas (null sin reservas). */
  cancelRate: number | null;
  noShowRate: number | null;
  /** Reservas creadas por día del rango (YYYY-MM-DD, zona del workspace). */
  byDay: Array<{ date: string; count: number }>;
  /** [día de la semana 0=domingo][hora 0..23] → reservas que empiezan ahí. */
  heatmap: number[][];
  /** Los horarios (día + hora) más reservados, de mayor a menor. */
  topSlots: Array<{ dow: number; hour: number; count: number }>;
  /** Por tipo de evento, de más a menos reservas. */
  byEventType: Array<{ id: string; title: string; created: number; cancelled: number; noShow: number }>;
  /** Por anfitrión, de más a menos reservas. */
  byHost: Array<{ id: string; name: string; created: number; cancelled: number; noShow: number }>;
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC, como guarda created_at) o ISO → Date. */
function parseDbDate(v: string): Date {
  return new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
}

function partsInTz(d: Date, tz: string): { date: string; dow: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dow: Math.max(0, dows.indexOf(get('weekday'))),
    hour: Number(get('hour')) % 24,
  };
}

function daysBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return out;
  for (let t = start; t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Cuenta reservas ya filtradas por rango de creación. Puro. */
export function computeBookingAnalytics(
  rows: AnalyticsBookingRow[],
  opts: { fromDate: string; toDate: string; timezone: string },
): BookingAnalytics {
  const live = rows.filter((r) => !(r.status === 'cancelled' && r.payment_status === 'expired'));
  const days = daysBetween(opts.fromDate, opts.toDate);
  const perDay = new Map(days.map((d) => [d, 0]));
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const byType = new Map<string, { id: string; title: string; created: number; cancelled: number; noShow: number }>();
  const byHost = new Map<string, { id: string; name: string; created: number; cancelled: number; noShow: number }>();
  let cancelled = 0;
  let noShow = 0;
  let pending = 0;

  for (const r of live) {
    const day = partsInTz(parseDbDate(r.created_at), opts.timezone).date;
    if (perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const type = byType.get(r.event_type_id) ?? { id: r.event_type_id, title: r.event_type_title, created: 0, cancelled: 0, noShow: 0 };
    const hostKey = r.host_user_id ?? '';
    const host = byHost.get(hostKey) ?? { id: hostKey, name: r.host_name || '', created: 0, cancelled: 0, noShow: 0 };
    type.created++;
    host.created++;
    if (r.status === 'cancelled') {
      cancelled++;
      type.cancelled++;
      host.cancelled++;
    } else if (r.status === 'no_show') {
      noShow++;
      type.noShow++;
      host.noShow++;
    } else if (r.status === 'pending') {
      pending++;
    }
    byType.set(r.event_type_id, type);
    byHost.set(hostKey, host);
    if (r.status === 'confirmed' || r.status === 'no_show') {
      const start = partsInTz(parseDbDate(r.starts_at), opts.timezone);
      heatmap[start.dow][start.hour]++;
    }
  }

  const topSlots: BookingAnalytics['topSlots'] = [];
  heatmap.forEach((hours, dow) =>
    hours.forEach((count, hour) => {
      if (count > 0) topSlots.push({ dow, hour, count });
    }),
  );
  topSlots.sort((a, b) => b.count - a.count || a.dow - b.dow || a.hour - b.hour);

  const created = live.length;
  return {
    created,
    cancelled,
    noShow,
    pending,
    confirmed: created - cancelled - noShow - pending,
    cancelRate: created ? cancelled / created : null,
    noShowRate: created ? noShow / created : null,
    byDay: days.map((date) => ({ date, count: perDay.get(date) ?? 0 })),
    heatmap,
    topSlots: topSlots.slice(0, 5),
    byEventType: [...byType.values()].sort((a, b) => b.created - a.created || a.title.localeCompare(b.title)),
    byHost: [...byHost.values()].sort((a, b) => b.created - a.created || a.name.localeCompare(b.name)),
  };
}

/** 'YYYY-MM-DD HH:MM:SS' en UTC (el formato de created_at). */
function dbStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Reservas de los event types del workspace creadas en [from, to]. Con
 * `hostId`, solo las de esa persona (anfitriona o co-anfitriona) y con
 * `eventTypeId`, solo las de ese tipo de evento.
 */
export async function loadAnalyticsRows(
  userId: string,
  from: Date,
  to: Date,
  opts: { hostId?: string | null; eventTypeId?: string | null } = {},
): Promise<AnalyticsBookingRow[]> {
  const where = ['e.user_id = ?', 'b.created_at >= ?', 'b.created_at <= ?'];
  const args: string[] = [userId, dbStamp(from), dbStamp(to)];
  if (opts.hostId) {
    where.push("(b.host_user_id = ? OR (b.co_host_ids != '[]' AND EXISTS (SELECT 1 FROM json_each(b.co_host_ids) j WHERE j.value = ?)))");
    args.push(opts.hostId, opts.hostId);
  }
  if (opts.eventTypeId) {
    where.push('b.event_type_id = ?');
    args.push(opts.eventTypeId);
  }
  return (await getDb()
    .prepare(
      `SELECT b.created_at, b.starts_at, b.status, b.payment_status, b.event_type_id, e.title AS event_type_title,
              b.host_user_id, COALESCE(NULLIF(h.name, ''), h.email) AS host_name
       FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       LEFT JOIN users h ON h.id = b.host_user_id
       WHERE ${where.join(' AND ')}
       LIMIT 20000`,
    )
    .all(...args)) as AnalyticsBookingRow[];
}

/** Personas que atendieron reservas del workspace (para el filtro "por persona"). */
export async function analyticsHosts(userId: string): Promise<Array<{ id: string; name: string }>> {
  return (await getDb()
    .prepare(
      `SELECT DISTINCT b.host_user_id AS id, COALESCE(NULLIF(h.name, ''), h.email) AS name
       FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       JOIN users h ON h.id = b.host_user_id
       WHERE e.user_id = ? AND b.host_user_id IS NOT NULL
       ORDER BY name LIMIT 200`,
    )
    .all(userId)) as Array<{ id: string; name: string }>;
}

/** Rango del reporte: días YYYY-MM-DD válidos, `to` hoy por defecto y 30 días hacia atrás. */
export function parseAnalyticsRange(
  from: string | undefined,
  to: string | undefined,
  today: string,
): { fromDate: string; toDate: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const ok = (v: string | undefined): v is string => !!v && day.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  let toDate = ok(to) ? to : today;
  if (toDate > today) toDate = today;
  const defFrom = new Date(Date.parse(`${toDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  let fromDate = ok(from) ? from : defFrom;
  if (fromDate > toDate) fromDate = toDate;
  // Hasta un año por vista.
  const minFrom = new Date(Date.parse(`${toDate}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  if (fromDate < minFrom) fromDate = minFrom;
  return { fromDate, toDate };
}
