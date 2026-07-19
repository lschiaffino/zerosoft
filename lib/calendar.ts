/**
 * Calendar — capa de queries (server-only).
 * Modelo de event types, availability, blocked slots y bookings.
 */
import {
  getDb,
  type CalendarUserRow,
  type CalendarEventTypeRow,
  type CalendarAvailabilityRow,
  type CalendarBookingRow,
  type CalendarBlockedSlotRow,
} from './db';
import type {
  CalendarConfigUpdatePayload,
  EventTypeCreatePayload,
  EventTypeUpdatePayload,
  AvailabilityBatchPayload,
  BlockedSlotCreatePayload,
  BlockedSlotUpdatePayload,
  BookingCreatePayload,
  BookingUpdatePayload,
} from './calendar-schema';

// ---------- Helpers ----------

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function weekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMon = (day + 6) % 7;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - diffToMon);
  mon.setUTCHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  sun.setUTCHours(23, 59, 59, 999);
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return { start: fmt(mon), end: fmt(sun) };
}

export function parseJson<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function serializeJson<T>(value: T | undefined, fallback: T): string {
  return JSON.stringify(value ?? fallback);
}

function booleanToInt(v: boolean | undefined): 0 | 1 | undefined {
  if (v === undefined) return undefined;
  return v ? 1 : 0;
}

// ---------- Config / calendar_users ----------

export async function getCalendarUser(userId: string): Promise<CalendarUserRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM calendar_users WHERE user_id = ?')
    .get(userId)) as CalendarUserRow | undefined;
}

export async function getOrCreateCalendarUser(userId: string): Promise<CalendarUserRow> {
  const existing = await getCalendarUser(userId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const ts = now();
  await getDb()
    .prepare(
      `INSERT INTO calendar_users
       (id, user_id, timezone, week_start, buffer_before_min, buffer_after_min, min_notice_hours, max_booking_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, 'UTC', 1, 0, 0, 0, 30, ts, ts);
  return (await getDb().prepare('SELECT * FROM calendar_users WHERE id = ?').get(id)) as CalendarUserRow;
}

export async function updateCalendarUser(
  userId: string,
  payload: CalendarConfigUpdatePayload,
): Promise<CalendarUserRow> {
  const user = await getOrCreateCalendarUser(userId);
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (payload.timezone !== undefined) {
    sets.push('timezone = ?');
    values.push(payload.timezone);
  }
  if (payload.weekStart !== undefined) {
    sets.push('week_start = ?');
    values.push(payload.weekStart);
  }
  if (payload.bufferBeforeMin !== undefined) {
    sets.push('buffer_before_min = ?');
    values.push(payload.bufferBeforeMin);
  }
  if (payload.bufferAfterMin !== undefined) {
    sets.push('buffer_after_min = ?');
    values.push(payload.bufferAfterMin);
  }
  if (payload.minNoticeHours !== undefined) {
    sets.push('min_notice_hours = ?');
    values.push(payload.minNoticeHours);
  }
  if (payload.maxBookingDays !== undefined) {
    sets.push('max_booking_days = ?');
    values.push(payload.maxBookingDays);
  }
  if (sets.length === 0) return user;

  sets.push('updated_at = ?');
  values.push(now());
  values.push(user.id);

  await getDb()
    .prepare(`UPDATE calendar_users SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return (await getDb().prepare('SELECT * FROM calendar_users WHERE id = ?').get(user.id)) as CalendarUserRow;
}

// ---------- Event types ----------

export interface EventTypeWithRules extends CalendarEventTypeRow {
  bookingRulesParsed: Record<string, unknown>;
  fieldsParsed: Array<Record<string, unknown>>;
}

function decorateEventType(row: CalendarEventTypeRow): EventTypeWithRules {
  return {
    ...row,
    bookingRulesParsed: parseJson<Record<string, unknown>>(row.booking_rules, {}),
    fieldsParsed: parseJson<Array<Record<string, unknown>>>(row.fields, []),
  };
}

export async function listEventTypes(
  userId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<EventTypeWithRules[]> {
  const sql = opts.activeOnly
    ? `SELECT * FROM calendar_event_types WHERE user_id = ? AND active = 1 ORDER BY created_at DESC`
    : `SELECT * FROM calendar_event_types WHERE user_id = ? ORDER BY created_at DESC`;
  const rows = (await getDb().prepare(sql).all(userId)) as CalendarEventTypeRow[];
  return rows.map(decorateEventType);
}

export async function getEventType(
  userId: string,
  id: string,
): Promise<EventTypeWithRules | undefined> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_event_types WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CalendarEventTypeRow | undefined;
  return row ? decorateEventType(row) : undefined;
}

export async function getEventTypeBySlug(slug: string): Promise<EventTypeWithRules | undefined> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_event_types WHERE slug = ? AND active = 1')
    .get(slug)) as CalendarEventTypeRow | undefined;
  return row ? decorateEventType(row) : undefined;
}

async function slugExists(
  userId: string,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      excludeId
        ? 'SELECT 1 AS one FROM calendar_event_types WHERE user_id = ? AND slug = ? AND id != ?'
        : 'SELECT 1 AS one FROM calendar_event_types WHERE user_id = ? AND slug = ?',
    )
    .get(userId, slug, ...(excludeId ? [excludeId] : []))) as { one: number } | undefined;
  return row?.one === 1;
}

export async function createEventType(
  userId: string,
  payload: EventTypeCreatePayload,
): Promise<EventTypeWithRules> {
  if (await slugExists(userId, payload.slug)) {
    throw new CalendarError('slug_taken', 409);
  }
  const id = crypto.randomUUID();
  const ts = now();
  const active = booleanToInt(payload.active) ?? 1;
  const bookingRules = serializeJson(payload.bookingRules, {});
  const fields = serializeJson(payload.fields, []);

  await getDb()
    .prepare(
      `INSERT INTO calendar_event_types
       (id, user_id, team_id, slug, title, duration_min, location, description, color, active, booking_rules, fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      payload.teamId ?? null,
      payload.slug,
      payload.title,
      payload.durationMin,
      payload.location ?? '',
      payload.description ?? '',
      payload.color ?? '#000000',
      active,
      bookingRules,
      fields,
      ts,
      ts,
    );
  const row = (await getDb().prepare('SELECT * FROM calendar_event_types WHERE id = ?').get(id)) as CalendarEventTypeRow;
  return decorateEventType(row);
}

export async function updateEventType(
  userId: string,
  id: string,
  payload: EventTypeUpdatePayload,
): Promise<EventTypeWithRules | undefined> {
  const existing = await getEventType(userId, id);
  if (!existing) return undefined;
  if (payload.slug && payload.slug !== existing.slug && (await slugExists(userId, payload.slug, id))) {
    throw new CalendarError('slug_taken', 409);
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (payload.slug !== undefined) {
    sets.push('slug = ?');
    values.push(payload.slug);
  }
  if (payload.title !== undefined) {
    sets.push('title = ?');
    values.push(payload.title);
  }
  if (payload.durationMin !== undefined) {
    sets.push('duration_min = ?');
    values.push(payload.durationMin);
  }
  if (payload.location !== undefined) {
    sets.push('location = ?');
    values.push(payload.location);
  }
  if (payload.description !== undefined) {
    sets.push('description = ?');
    values.push(payload.description);
  }
  if (payload.color !== undefined) {
    sets.push('color = ?');
    values.push(payload.color);
  }
  if (payload.active !== undefined) {
    sets.push('active = ?');
    values.push(booleanToInt(payload.active)!);
  }
  if (payload.bookingRules !== undefined) {
    sets.push('booking_rules = ?');
    values.push(serializeJson(payload.bookingRules, {}));
  }
  if (payload.fields !== undefined) {
    sets.push('fields = ?');
    values.push(serializeJson(payload.fields, []));
  }
  if (payload.teamId !== undefined) {
    sets.push('team_id = ?');
    values.push(payload.teamId ?? null);
  }
  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await getDb()
    .prepare(`UPDATE calendar_event_types SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return getEventType(userId, id);
}

export async function deleteEventType(userId: string, id: string): Promise<boolean> {
  const existing = await getEventType(userId, id);
  if (!existing) return false;
  await getDb().prepare('DELETE FROM calendar_event_types WHERE id = ?').run(id);
  return true;
}

// ---------- Availability ----------

export async function listAvailability(eventTypeId: string): Promise<CalendarAvailabilityRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM calendar_availability WHERE event_type_id = ? ORDER BY day_of_week, start_time')
    .all(eventTypeId)) as CalendarAvailabilityRow[];
}

export async function setAvailability(
  eventTypeId: string,
  payload: AvailabilityBatchPayload,
): Promise<CalendarAvailabilityRow[]> {
  const db = getDb();
  await db.prepare('DELETE FROM calendar_availability WHERE event_type_id = ?').run(eventTypeId);
  const ins = db.prepare(
    `INSERT INTO calendar_availability (id, event_type_id, day_of_week, start_time, end_time)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const rule of payload.rules) {
    await ins.run(crypto.randomUUID(), eventTypeId, rule.dayOfWeek, rule.startTime, rule.endTime);
  }
  return listAvailability(eventTypeId);
}

export async function addAvailabilityRule(
  eventTypeId: string,
  rule: { dayOfWeek: number; startTime: string; endTime: string },
): Promise<CalendarAvailabilityRow> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO calendar_availability (id, event_type_id, day_of_week, start_time, end_time)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, eventTypeId, rule.dayOfWeek, rule.startTime, rule.endTime);
  return (await getDb().prepare('SELECT * FROM calendar_availability WHERE id = ?').get(id)) as CalendarAvailabilityRow;
}

export async function deleteAvailabilityRule(eventTypeId: string, availabilityId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM calendar_availability WHERE id = ? AND event_type_id = ?')
    .run(availabilityId, eventTypeId);
  return res.changes > 0;
}

// ---------- Blocked slots ----------

export async function listBlockedSlots(userId: string): Promise<CalendarBlockedSlotRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM calendar_blocked_slots WHERE user_id = ? ORDER BY starts_at DESC')
    .all(userId)) as CalendarBlockedSlotRow[];
}

export async function getBlockedSlot(
  userId: string,
  id: string,
): Promise<CalendarBlockedSlotRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM calendar_blocked_slots WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CalendarBlockedSlotRow | undefined;
}

export async function createBlockedSlot(
  userId: string,
  payload: BlockedSlotCreatePayload,
): Promise<CalendarBlockedSlotRow> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO calendar_blocked_slots (id, user_id, starts_at, ends_at, reason)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, payload.startsAt, payload.endsAt, payload.reason ?? null);
  return (await getDb().prepare('SELECT * FROM calendar_blocked_slots WHERE id = ?').get(id)) as CalendarBlockedSlotRow;
}

export async function updateBlockedSlot(
  userId: string,
  id: string,
  payload: BlockedSlotUpdatePayload,
): Promise<CalendarBlockedSlotRow | undefined> {
  const existing = await getBlockedSlot(userId, id);
  if (!existing) return undefined;
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (payload.startsAt !== undefined) {
    sets.push('starts_at = ?');
    values.push(payload.startsAt);
  }
  if (payload.endsAt !== undefined) {
    sets.push('ends_at = ?');
    values.push(payload.endsAt);
  }
  if (payload.reason !== undefined) {
    sets.push('reason = ?');
    values.push(payload.reason ?? null);
  }
  if (sets.length === 0) return existing;

  values.push(id);

  await getDb()
    .prepare(`UPDATE calendar_blocked_slots SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return getBlockedSlot(userId, id);
}

export async function deleteBlockedSlot(userId: string, id: string): Promise<boolean> {
  const existing = await getBlockedSlot(userId, id);
  if (!existing) return false;
  await getDb().prepare('DELETE FROM calendar_blocked_slots WHERE id = ?').run(id);
  return true;
}

// ---------- Bookings ----------

export async function listBookings(eventTypeId: string): Promise<CalendarBookingRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM calendar_bookings WHERE event_type_id = ? ORDER BY starts_at DESC')
    .all(eventTypeId)) as CalendarBookingRow[];
}

export async function countBookingsThisWeek(userId: string): Promise<number> {
  const { start, end } = weekRange();
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM calendar_bookings b
       JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND b.status = 'confirmed' AND b.starts_at >= ? AND b.starts_at <= ?`,
    )
    .get(userId, start, end)) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

export async function createBooking(payload: BookingCreatePayload): Promise<CalendarBookingRow> {
  const id = crypto.randomUUID();
  const ts = now();
  await getDb()
    .prepare(
      `INSERT INTO calendar_bookings
       (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, timezone, status, answers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      payload.eventTypeId,
      payload.inviteeEmail,
      payload.inviteeName,
      payload.startsAt,
      payload.endsAt,
      payload.timezone ?? 'UTC',
      'confirmed',
      serializeJson(payload.answers, {}),
      ts,
      ts,
    );
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

export async function updateBooking(
  id: string,
  payload: BookingUpdatePayload,
): Promise<CalendarBookingRow | undefined> {
  const existing = (await getDb()
    .prepare('SELECT * FROM calendar_bookings WHERE id = ?')
    .get(id)) as CalendarBookingRow | undefined;
  if (!existing) return undefined;

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (payload.status !== undefined) {
    sets.push('status = ?');
    values.push(payload.status);
  }
  if (payload.cancelReason !== undefined) {
    sets.push('cancel_reason = ?');
    values.push(payload.cancelReason ?? null);
  }
  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await getDb()
    .prepare(`UPDATE calendar_bookings SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

// ---------- Errors ----------

export class CalendarError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
