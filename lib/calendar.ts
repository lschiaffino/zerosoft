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
  type CalendarEventHostRow,
  type CalendarReminderRow,
} from './db';
import { googleBusyRanges } from './google-calendar';
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
import {
  ensureDefaultSchedule,
  loadScheduleForEngine,
  scheduleBelongsTo,
  windowsForDate,
  type ScheduleOverride,
  type ScheduleRule,
} from './calendar-schedules';
import { clearPendingWorkflowRuns, clearWorkflowRuns, hasWorkflowSteps, scheduleWorkflowRuns } from './calendar-workflows';

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
  // Mismo formato que starts_at (toISOString): comparar contra 'YYYY-MM-DD HH:MM:SS'
  // deja afuera el domingo, porque 'T' ordena después que ' '.
  const fmt = (d: Date) => d.toISOString();
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
  // El horario por defecto se crea con la zona del workspace (UTC hasta que
  // la configuran): si sigue en la zona anterior, se muda con ella para que
  // la página pública no ofrezca horas corridas.
  if (payload.timezone !== undefined && payload.timezone !== user.timezone) {
    await getDb()
      .prepare(
        'UPDATE calendar_schedules SET timezone = ?, updated_at = ? WHERE user_id = ? AND is_default = 1 AND timezone = ?',
      )
      .run(payload.timezone, now(), userId, user.timezone);
  }
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

export async function getEventTypeById(id: string): Promise<EventTypeWithRules | undefined> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_event_types WHERE id = ?')
    .get(id)) as CalendarEventTypeRow | undefined;
  return row ? decorateEventType(row) : undefined;
}

/** Lookup público: /book/<handle>/<slug>. */
export async function getEventTypeByHandle(
  handle: string,
  slug: string,
): Promise<EventTypeWithRules | undefined> {
  const row = (await getDb()
    .prepare(
      `SELECT e.* FROM calendar_event_types e JOIN users u ON u.id = e.user_id
       WHERE u.handle = ? AND e.slug = ? AND e.active = 1`,
    )
    .get(handle.toLowerCase(), slug)) as CalendarEventTypeRow | undefined;
  return row ? decorateEventType(row) : undefined;
}

/** Perfil público /book/<handle>: la persona y sus tipos de evento activos. */
export async function getPublicProfile(
  handle: string,
): Promise<{ name: string; handle: string; eventTypes: EventTypeWithRules[] } | null> {
  const user = (await getDb()
    .prepare('SELECT id, name, email, handle FROM users WHERE handle = ?')
    .get(handle.toLowerCase())) as { id: string; name: string | null; email: string; handle: string } | undefined;
  if (!user) return null;
  return {
    name: user.name || user.handle,
    handle: user.handle,
    eventTypes: await listEventTypes(user.id, { activeOnly: true }),
  };
}

/**
 * Links viejos /book/<slug> (antes de los handles): resuelve al event type más
 * antiguo con ese slug, que es al que ya apuntaban. Devuelve el path nuevo.
 * Solo cuentan los event types creados antes de la migración de handles (los
 * únicos que tuvieron un link /book/<slug>), y nunca si <slug> es el handle de
 * alguien: si no, cualquier cuenta podría tapar el perfil de otra creando un
 * evento con ese slug.
 */
export async function legacyBookPath(slug: string): Promise<string | null> {
  if (await handleTaken(slug)) return null;
  const row = (await getDb()
    .prepare(
      `SELECT u.handle FROM calendar_event_types e JOIN users u ON u.id = e.user_id
       WHERE e.slug = ? AND e.active = 1 AND u.handle IS NOT NULL
         AND e.created_at < (SELECT applied_at FROM schema_migrations WHERE id = '005_user_handles')
       ORDER BY e.created_at ASC LIMIT 1`,
    )
    .get(slug)) as { handle: string } | undefined;
  return row ? `/book/${row.handle}/${slug}` : null;
}

/** Hay un usuario con ese handle público. */
export async function handleTaken(handle: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT 1 AS one FROM users WHERE handle = ?').get(handle.toLowerCase())) as
    | { one: number }
    | undefined;
  return row?.one === 1;
}

/** Path público de un event type (sin locale). */
export async function bookPathFor(eventType: Pick<CalendarEventTypeRow, 'user_id' | 'slug'>): Promise<string | null> {
  const row = (await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(eventType.user_id)) as
    | { handle: string | null }
    | undefined;
  return row?.handle ? `/book/${row.handle}/${eventType.slug}` : null;
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

  // Horario: el pedido (si es del workspace) o el horario por defecto, que se
  // crea (lunes a viernes 9 a 17 en la zona del workspace) si no hay ninguno.
  let scheduleId: string | null = null;
  if (payload.scheduleId) {
    if (!(await scheduleBelongsTo(userId, payload.scheduleId))) throw new CalendarError('invalid_schedule', 400);
    scheduleId = payload.scheduleId;
  } else if (payload.scheduleId === undefined) {
    const calUser = await getOrCreateCalendarUser(userId);
    scheduleId = (await ensureDefaultSchedule(userId, calUser.timezone)).id;
  }

  await assertTeamAndHosts(userId, payload.teamId, payload.hostIds);

  await getDb()
    .prepare(
      `INSERT INTO calendar_event_types
       (id, user_id, team_id, slug, title, duration_min, location, description, color, active, booking_rules, fields,
        brand_color, welcome_message, logo_url, single_use, created_at, updated_at, schedule_id, price_cents, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      payload.brandColor ?? null,
      payload.welcomeMessage ?? '',
      payload.logoUrl ?? null,
      booleanToInt(payload.singleUse) ?? 0,
      ts,
      ts,
      scheduleId,
      payload.priceCents ?? 0,
      payload.currency ?? 'usd',
    );
  if (payload.hostIds) await setEventHosts(id, payload.hostIds);
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
  await assertTeamAndHosts(userId, payload.teamId, payload.hostIds);

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
  if (payload.brandColor !== undefined) {
    sets.push('brand_color = ?');
    values.push(payload.brandColor ?? null);
  }
  if (payload.welcomeMessage !== undefined) {
    sets.push('welcome_message = ?');
    values.push(payload.welcomeMessage);
  }
  if (payload.logoUrl !== undefined) {
    sets.push('logo_url = ?');
    values.push(payload.logoUrl ?? null);
  }
  if (payload.singleUse !== undefined) {
    sets.push('single_use = ?');
    values.push(booleanToInt(payload.singleUse)!);
  }
  if (payload.scheduleId !== undefined) {
    if (payload.scheduleId && !(await scheduleBelongsTo(userId, payload.scheduleId))) {
      throw new CalendarError('invalid_schedule', 400);
    }
    sets.push('schedule_id = ?');
    values.push(payload.scheduleId ?? null);
  }
  if (payload.priceCents !== undefined) {
    sets.push('price_cents = ?');
    values.push(payload.priceCents);
  }
  if (payload.currency !== undefined) {
    sets.push('currency = ?');
    values.push(payload.currency);
  }
  if (sets.length === 0 && payload.hostIds === undefined) return existing;

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(now());
    values.push(id);

    await getDb()
      .prepare(`UPDATE calendar_event_types SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }
  if (payload.hostIds) await setEventHosts(id, payload.hostIds);
  return getEventType(userId, id);
}

export async function deleteEventType(userId: string, id: string): Promise<boolean> {
  const existing = await getEventType(userId, id);
  if (!existing) return false;
  // Las reservas caen en cascada con el tipo de evento: con reservas por
  // venir (confirmadas o esperando un pago) se cancelan antes, así los
  // invitados reciben el aviso, se reembolsa lo cobrado y Google se limpia.
  const upcoming = await getDb()
    .prepare(
      `SELECT 1 AS one FROM calendar_bookings
       WHERE event_type_id = ? AND status IN ('confirmed', 'pending') AND ends_at > ? LIMIT 1`,
    )
    .get(id, new Date().toISOString());
  if (upcoming) throw new CalendarError('has_upcoming_bookings', 409);
  await getDb().prepare('DELETE FROM calendar_event_types WHERE id = ?').run(id);
  return true;
}

// ---------- Hosts (team scheduling / round-robin) ----------

/**
 * El team de un event type tiene que ser del workspace (su owner es `userId`)
 * y cada host, el owner o un miembro de alguno de sus teams. Sin esto, un
 * PATCH podría listar los miembros de otro workspace o asignarles reservas.
 */
async function assertTeamAndHosts(
  userId: string,
  teamId: string | null | undefined,
  hostIds: string[] | undefined,
): Promise<void> {
  const db = getDb();
  if (teamId) {
    const team = await db.prepare('SELECT 1 AS one FROM teams WHERE id = ? AND owner_id = ?').get(teamId, userId);
    if (!team) throw new CalendarError('invalid_input', 400);
  }
  for (const hostId of new Set(hostIds ?? [])) {
    if (hostId === userId) continue;
    const member = await db
      .prepare(
        `SELECT 1 AS one FROM team_members m JOIN teams t ON t.id = m.team_id
         WHERE t.owner_id = ? AND m.user_id = ?`,
      )
      .get(userId, hostId);
    if (!member) throw new CalendarError('invalid_input', 400);
  }
}

export interface EventHostWithUser extends CalendarEventHostRow {
  email: string;
  name: string | null;
}

export async function listEventHosts(eventTypeId: string): Promise<EventHostWithUser[]> {
  return (await getDb()
    .prepare(
      `SELECT h.*, u.email, u.name
       FROM calendar_event_hosts h JOIN users u ON u.id = h.user_id
       WHERE h.event_type_id = ? ORDER BY h.position ASC, h.created_at ASC`,
    )
    .all(eventTypeId)) as EventHostWithUser[];
}

/** Reemplaza el pool de hosts; el orden del array define el orden round-robin. */
export async function setEventHosts(eventTypeId: string, userIds: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM calendar_event_hosts WHERE event_type_id = ?').run(eventTypeId);
  const ins = db.prepare(
    `INSERT INTO calendar_event_hosts (id, event_type_id, user_id, position)
     VALUES (?, ?, ?, ?)`,
  );
  const seen = new Set<string>();
  let position = 0;
  for (const userId of userIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    await ins.run(crypto.randomUUID(), eventTypeId, userId, position);
    position += 1;
  }
  // Si el pool cambia, el cursor puede quedar fuera de rango: se normaliza.
  await db
    .prepare('UPDATE calendar_event_types SET rr_cursor = 0 WHERE id = ? AND rr_cursor >= ?')
    .run(eventTypeId, Math.max(position, 1));
}

/**
 * Asigna el próximo host del pool en orden round-robin (cursor persistente en
 * calendar_event_types.rr_cursor) y avanza el cursor. Devuelve null si el
 * evento no tiene hosts. Simplificación: el check de slot no es atómico con el
 * avance del cursor, así que dos bookings concurrentes pueden repetir host.
 */
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
  // Reglas propias del evento: dejan de usar el horario reutilizable.
  await db.prepare('UPDATE calendar_event_types SET schedule_id = NULL WHERE id = ?').run(eventTypeId);
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

/**
 * Días (YYYY-MM-DD) de un mes con al menos un slot libre, en la zona del
 * invitado. Carga el event type, el horario y la ocupación de todo el mes una
 * sola vez y calcula cada día en memoria.
 */
export async function getAvailableDays(
  eventTypeId: string,
  timezone: string,
  month: string,
  opts: { excludeBookingId?: string } = {},
): Promise<string[]> {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return [];
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return [];
  const ctx = await loadSlotContext(eventTypeId, opts.excludeBookingId);
  if (!ctx) return [];
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const first = `${m[1]}-${m[2]}-01`;
  const monthStart = localToUtc(first, '00:00:00', timezone);
  const monthEnd = localToUtc(addDays(first, daysInMonth), '00:00:00', timezone);
  const busyByHost = await busyForHosts(
    ctx,
    new Date(monthStart.getTime() - 24 * 60 * 60 * 1000),
    new Date(monthEnd.getTime() + 24 * 60 * 60 * 1000),
    opts,
  );
  const today = localDate(new Date(), timezone);
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`;
    if (date < today) continue;
    if (slotsForDay(ctx, timezone, date, busyByHost).length > 0) days.push(date);
  }
  return days;
}

/** Fecha local YYYY-MM-DD de un instante en una zona horaria. */
export function localDate(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * El inicio pedido coincide con un slot ofrecido (mismo cálculo que ve el
 * invitado, en su día local). Devuelve el slot o null.
 */
export async function findOfferedSlot(
  eventTypeId: string,
  start: Date,
  timezone: string,
  opts: { excludeBookingId?: string } = {},
): Promise<TimeRange | null> {
  const slots = await getAvailableSlots(eventTypeId, timezone, localDate(start, timezone), opts);
  return slots.find((s) => Math.abs(s.start.getTime() - start.getTime()) < 60_000) ?? null;
}

/** Primer host libre para [start, end), recorriendo el pool desde el cursor round-robin. */
async function pickFreeHost(
  eventType: EventTypeWithRules,
  slot: TimeRange,
  excludeBookingId?: string,
): Promise<string | null> {
  const hosts = await candidateHosts(eventType);
  const calendarUser = await getCalendarUser(eventType.user_id);
  const buffered = applyBuffer(slot, eventType, calendarUser);
  const from = new Date(slot.start.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(slot.end.getTime() + 24 * 60 * 60 * 1000);
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[(eventType.rr_cursor + i) % hosts.length];
    const busy = await listBusyRanges(host, from, to, { excludeBookingId });
    if (!hasOverlap(buffered, busy)) return host;
  }
  return null;
}

/** El host asignado sigue libre en el horario de la reserva (sin contarla a ella). */
export async function hostSlotFree(booking: CalendarBookingRow): Promise<boolean> {
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return false;
  const slot = { start: new Date(booking.starts_at), end: new Date(booking.ends_at) };
  const calendarUser = await getCalendarUser(eventType.user_id);
  const busy = await listBusyRanges(
    booking.host_user_id ?? eventType.user_id,
    new Date(slot.start.getTime() - 24 * 60 * 60 * 1000),
    new Date(slot.end.getTime() + 24 * 60 * 60 * 1000),
    // Sin calendarios externos: la propia reserva sigue en el Google Calendar del host.
    { excludeBookingId: booking.id, internalOnly: true },
  );
  return !hasOverlap(applyBuffer(slot, eventType, calendarUser), busy);
}

/**
 * Condición SQL (para un WHERE) de que el host no tiene otra reserva viva que
 * se superponga con [start, end) ya con buffers. Va en el mismo INSERT/UPDATE
 * que toma el horario: la verificación y la escritura son atómicas, así dos
 * requests simultáneas con inicios distintos no se superponen (el índice
 * único solo cubre inicios idénticos). Args: host, ahora, fin, inicio, id excluido.
 */
const HOST_FREE_SQL = `NOT EXISTS (
  SELECT 1 FROM calendar_bookings o
  WHERE o.host_user_id = ? AND o.status IN ('confirmed', 'pending')
    AND (o.status = 'confirmed' OR o.hold_expires_at > ?)
    AND o.starts_at < ? AND o.ends_at > ? AND o.id != ?
)`;

async function hostFreeArgs(
  eventType: EventTypeWithRules,
  hostUserId: string,
  slot: TimeRange,
  excludeId: string,
): Promise<string[]> {
  const buffered = applyBuffer(slot, eventType, await getCalendarUser(eventType.user_id));
  return [hostUserId, new Date().toISOString(), iso(buffered.end), iso(buffered.start), excludeId];
}

function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String(err));
}

export function newManageToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * `hold`: la reserva queda 'pending' (sin confirmar) hasta que se pague o
 * venza `expiresAt`. Mientras tanto ocupa el horario. Los recordatorios, el
 * link de un solo uso y los avisos se disparan al confirmarla (confirmBooking).
 */
export interface BookingHold {
  expiresAt: Date;
  amountCents: number;
  currency: string;
}

export async function createBooking(
  payload: BookingCreatePayload,
  opts: { hold?: BookingHold } = {},
): Promise<CalendarBookingRow> {
  const eventType = await getEventTypeById(payload.eventTypeId);
  if (!eventType) throw new CalendarError('not_found', 404);
  if (eventType.single_use === 1 && eventType.used_at) throw new CalendarError('link_expired', 410);
  // Un solo uso con precio: used_at se marca al pagar, así que mientras un
  // hold siga vivo el link ya está tomado (si no, dos personas pagarían).
  if (eventType.single_use === 1) {
    const taken = await getDb()
      .prepare(
        `SELECT 1 AS one FROM calendar_bookings
         WHERE event_type_id = ? AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?)) LIMIT 1`,
      )
      .get(eventType.id, new Date().toISOString());
    if (taken) throw new CalendarError('link_expired', 410);
  }

  const start = new Date(payload.start);
  if (Number.isNaN(start.getTime())) throw new CalendarError('invalid_input', 400);

  const end = new Date(start.getTime() + eventType.duration_min * 60_000);
  const hostUserId = await pickFreeHost(eventType, { start, end });
  if (!hostUserId) throw new CalendarError('slot_unavailable', 409);
  // Un hold vencido que el cron todavía no canceló ya no ocupa el horario,
  // pero sí el índice único (host, inicio): se libera antes de insertar.
  await getDb()
    .prepare(
      `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired', updated_at = ?
       WHERE host_user_id = ? AND starts_at = ? AND status = 'pending' AND hold_expires_at <= ?`,
    )
    .run(now(), hostUserId, start.toISOString(), new Date().toISOString());
  const id = crypto.randomUUID();
  const ts = now();
  const freeArgs = await hostFreeArgs(eventType, hostUserId, { start, end }, id);
  let inserted: number;
  try {
    inserted = (await getDb()
      .prepare(
        `INSERT INTO calendar_bookings
         (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, timezone, status, answers, host_user_id, manage_token, locale, created_at, updated_at,
          payment_status, hold_expires_at, amount_cents, currency)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${HOST_FREE_SQL}`,
      )
      .run(
        id,
        payload.eventTypeId,
        payload.email,
        payload.name,
        start.toISOString(),
        end.toISOString(),
        payload.timezone ?? 'UTC',
        opts.hold ? 'pending' : 'confirmed',
        serializeJson(payload.answers, {}),
        hostUserId,
        newManageToken(),
        payload.locale ?? 'en',
        ts,
        ts,
        opts.hold ? 'pending' : 'none',
        opts.hold ? opts.hold.expiresAt.toISOString() : null,
        opts.hold?.amountCents ?? 0,
        opts.hold?.currency ?? '',
        ...freeArgs,
      )).changes;
  } catch (err) {
    // Otra request reservó el mismo host a la misma hora un instante antes.
    if (isUniqueViolation(err)) throw new CalendarError('slot_unavailable', 409);
    throw err;
  }
  // Otra reserva superpuesta (con otro inicio) entró entre la lectura y el INSERT.
  if (inserted === 0) throw new CalendarError('slot_unavailable', 409);
  if ((await listEventHosts(eventType.id)).length > 0) {
    await getDb()
      .prepare('UPDATE calendar_event_types SET rr_cursor = rr_cursor + 1 WHERE id = ?')
      .run(eventType.id);
  }
  if (!opts.hold) await onBookingConfirmed(id, eventType, start);
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

/** Efectos internos de una reserva que queda confirmada (al crearla o al pagarse). */
async function onBookingConfirmed(id: string, eventType: CalendarEventTypeRow, start: Date): Promise<void> {
  // Link de un solo uso: queda consumido al confirmarse el booking.
  if (eventType.single_use === 1) {
    await getDb()
      .prepare('UPDATE calendar_event_types SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(now(), eventType.id);
  }
  await scheduleBookingReminder(id, start);
}

/**
 * Confirma una reserva 'pending' (pago recibido). Idempotente: devuelve null
 * si ya no estaba pendiente (otro webhook la confirmó o venció). Un hold ya
 * vencido que el cron todavía no limpió dejó de ocupar el horario: se vence
 * acá y el pago pasa por revivePaidBooking, que revalida el horario.
 */
export async function confirmPendingBooking(
  id: string,
  payment: { sessionId?: string | null } = {},
): Promise<CalendarBookingRow | null> {
  let changes: number;
  try {
    changes = (
      await getDb()
        .prepare(
          `UPDATE calendar_bookings SET status = 'confirmed', payment_status = 'paid', hold_expires_at = NULL,
             stripe_session_id = COALESCE(?, stripe_session_id), updated_at = ?
           WHERE id = ? AND status = 'pending' AND (hold_expires_at IS NULL OR hold_expires_at > ?)`,
        )
        .run(payment.sessionId ?? null, now(), id, new Date().toISOString())
    ).changes;
  } catch (err) {
    // El horario ya lo ocupa otra reserva confirmada: el hold no se puede
    // confirmar y queda cancelado (quien cobra decide el reembolso).
    if (!isUniqueViolation(err)) throw err;
    await getDb()
      .prepare(
        `UPDATE calendar_bookings SET status = 'cancelled', cancel_reason = 'slot_taken', hold_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(now(), id);
    return null;
  }
  if (changes === 0) {
    await getDb()
      .prepare(
        `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired', updated_at = ?
         WHERE id = ? AND status = 'pending' AND hold_expires_at <= ?`,
      )
      .run(now(), id, new Date().toISOString());
    return null;
  }
  const booking = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
  const eventType = await getEventTypeById(booking.event_type_id);
  if (eventType) await onBookingConfirmed(id, eventType, new Date(booking.starts_at));
  return booking;
}

/**
 * Pago que llegó después de que el hold venciera (cron, checkout expirado o
 * webhook demorado): si el horario sigue libre para algún host del evento, la
 * reserva se confirma de nuevo. Devuelve null si ya no hay lugar.
 */
export async function revivePaidBooking(
  id: string,
  payment: { sessionId?: string | null } = {},
): Promise<CalendarBookingRow | null> {
  const booking = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as
    | CalendarBookingRow
    | undefined;
  if (!booking || booking.status !== 'cancelled' || booking.cancel_reason !== 'payment_expired') return null;
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) return null;
  const start = new Date(booking.starts_at);
  if (start.getTime() < Date.now()) return null;
  const hostUserId = await pickFreeHost(eventType, { start, end: new Date(booking.ends_at) }, id);
  if (!hostUserId) return null;
  // Link de un solo uso: si otra reserva ya lo consumió, el pago no revive
  // esta (cae al reembolso). Se reclama el link de forma atómica antes de
  // confirmar y se libera si la confirmación no prospera.
  let claimed: string | null = null;
  if (eventType.single_use === 1) {
    claimed = now();
    const claim = await getDb()
      .prepare('UPDATE calendar_event_types SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(claimed, eventType.id);
    if (claim.changes === 0) return null;
  }
  const release = async () => {
    if (claimed === null) return;
    await getDb()
      .prepare('UPDATE calendar_event_types SET used_at = NULL WHERE id = ? AND used_at = ?')
      .run(eventType.id, claimed);
  };
  try {
    const freeArgs = await hostFreeArgs(eventType, hostUserId, { start, end: new Date(booking.ends_at) }, id);
    const res = await getDb()
      .prepare(
        `UPDATE calendar_bookings SET status = 'confirmed', payment_status = 'paid', hold_expires_at = NULL, cancel_reason = NULL,
           host_user_id = ?, stripe_session_id = COALESCE(?, stripe_session_id), updated_at = ?
         WHERE id = ? AND status = 'cancelled' AND cancel_reason = 'payment_expired' AND ${HOST_FREE_SQL}`,
      )
      .run(hostUserId, payment.sessionId ?? null, now(), id, ...freeArgs);
    if (res.changes === 0) {
      await release();
      return null;
    }
  } catch (err) {
    await release();
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  await onBookingConfirmed(id, eventType, start);
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

/** Vence los holds sin pagar: liberan el horario. Devuelve cuántos venció. */
export async function expireUnpaidHolds(at = new Date()): Promise<number> {
  const res = await getDb()
    .prepare(
      `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired', updated_at = ?
       WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?`,
    )
    .run(now(), at.toISOString());
  return res.changes;
}

/** Vence un hold puntual (Stripe avisó que el checkout expiró). */
export async function expirePendingBooking(id: string): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired', updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(now(), id);
  return res.changes > 0;
}

/** Reserva de un event type del usuario (como dueño o host asignado). */
export async function ownedBooking(userId: string, id: string): Promise<CalendarBookingRow | null> {
  const row = (await getDb()
    .prepare(
      `SELECT b.* FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE b.id = ? AND (e.user_id = ? OR b.host_user_id = ?)`,
    )
    .get(id, userId, userId)) as CalendarBookingRow | undefined;
  return row ?? null;
}

export async function getBookingByManageToken(token: string): Promise<CalendarBookingRow | undefined> {
  if (!token || token.length < 32) return undefined;
  return (await getDb()
    .prepare('SELECT * FROM calendar_bookings WHERE manage_token = ?')
    .get(token)) as CalendarBookingRow | undefined;
}

/**
 * Reprograma un booking confirmado a `newStart` (mismo event type). Verifica
 * disponibilidad ignorando el propio booking y rehace los recordatorios.
 */
export async function rescheduleBooking(id: string, newStart: Date): Promise<CalendarBookingRow> {
  const booking = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as
    | CalendarBookingRow
    | undefined;
  if (!booking) throw new CalendarError('not_found', 404);
  if (booking.status !== 'confirmed') throw new CalendarError('not_confirmed', 409);
  const eventType = await getEventTypeById(booking.event_type_id);
  if (!eventType) throw new CalendarError('not_found', 404);
  if (Number.isNaN(newStart.getTime()) || newStart.getTime() < Date.now()) throw new CalendarError('invalid_input', 400);

  const newEnd = new Date(newStart.getTime() + eventType.duration_min * 60_000);
  const hostUserId = await pickFreeHost(eventType, { start: newStart, end: newEnd }, id);
  if (!hostUserId) throw new CalendarError('slot_unavailable', 409);
  const freeArgs = await hostFreeArgs(eventType, hostUserId, { start: newStart, end: newEnd }, id);
  try {
    const res = await getDb()
      .prepare(
        `UPDATE calendar_bookings SET starts_at = ?, ends_at = ?, host_user_id = ?, rescheduled_from = ?, updated_at = ?
         WHERE id = ? AND ${HOST_FREE_SQL}`,
      )
      .run(newStart.toISOString(), newEnd.toISOString(), hostUserId, booking.starts_at, now(), id, ...freeArgs);
    if (res.changes === 0) throw new CalendarError('slot_unavailable', 409);
  } catch (err) {
    if (isUniqueViolation(err)) throw new CalendarError('slot_unavailable', 409);
    throw err;
  }
  await getDb().prepare('DELETE FROM calendar_reminders WHERE booking_id = ? AND sent_at IS NULL').run(id);
  // Todas las corridas, también las enviadas: con la fecha nueva cada paso
  // vuelve a salir (scheduleWorkflowRuns es idempotente por paso y reserva).
  await clearWorkflowRuns(id);
  await scheduleBookingReminder(id, newStart);
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
  // Al cancelar, se descartan los recordatorios pendientes del booking.
  if (payload.status === 'cancelled') {
    await getDb()
      .prepare('DELETE FROM calendar_reminders WHERE booking_id = ? AND sent_at IS NULL')
      .run(id);
    await clearPendingWorkflowRuns(id);
  }
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

// ---------- Reminders ----------

const REMINDER_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Programa el recordatorio 24h antes del booking. Si la reunión es en menos de
 * 24h no se programa: el email de confirmación acaba de llegar.
 */
async function scheduleBookingReminder(bookingId: string, start: Date): Promise<void> {
  // Con workflows configurados, los pasos del evento reemplazan al recordatorio fijo de 24h.
  const booking = (await getDb().prepare('SELECT event_type_id FROM calendar_bookings WHERE id = ?').get(bookingId)) as
    | { event_type_id: string }
    | undefined;
  if (booking && (await hasWorkflowSteps(booking.event_type_id))) {
    await scheduleWorkflowRuns(bookingId);
    return;
  }
  const sendAt = new Date(start.getTime() - REMINDER_24H_MS);
  if (sendAt.getTime() <= Date.now()) return;
  await getDb()
    .prepare(
      `INSERT INTO calendar_reminders (id, booking_id, kind, send_at)
       VALUES (?, ?, 'reminder_24h', ?)`,
    )
    .run(crypto.randomUUID(), bookingId, sendAt.toISOString());
}

export interface DueReminderRow extends CalendarReminderRow {
  invitee_email: string;
  invitee_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  event_title: string;
  event_location: string;
  meeting_url: string | null;
  manage_token: string | null;
  locale: string;
}

/**
 * Recordatorios vencidos de bookings que siguen confirmados. Los de reuniones
 * que ya empezaron se descartan (marcados como enviados): un reintento no
 * debe llegar después de la reunión.
 */
export async function listDueReminders(limit = 50): Promise<DueReminderRow[]> {
  const nowIso = new Date().toISOString();
  await getDb()
    .prepare(
      `UPDATE calendar_reminders SET sent_at = ?
       WHERE sent_at IS NULL AND send_at <= ?
         AND booking_id IN (SELECT id FROM calendar_bookings WHERE starts_at <= ?)`,
    )
    .run(nowIso, nowIso, nowIso);
  return (await getDb()
    .prepare(
      `SELECT r.*, b.invitee_email, b.invitee_name, b.starts_at, b.ends_at, b.timezone, b.manage_token, b.locale,
              b.meeting_url, e.title AS event_title, e.location AS event_location
       FROM calendar_reminders r
       JOIN calendar_bookings b ON b.id = r.booking_id
       JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE r.sent_at IS NULL AND r.send_at <= ? AND b.status = 'confirmed'
       ORDER BY r.send_at ASC
       LIMIT ?`,
    )
    .all(nowIso, limit)) as DueReminderRow[];
}

export async function markReminderSent(id: string): Promise<void> {
  await getDb()
    .prepare('UPDATE calendar_reminders SET sent_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

/**
 * Límites UTC de un filtro de fechas (YYYY-MM-DD) de reservas, tomando los
 * días en la zona del calendario del workspace: `to` incluye su día entero.
 */
export async function bookingDateBounds(
  userId: string,
  from: string | undefined,
  to: string | undefined,
): Promise<{ from?: Date; to?: Date; timezone: string }> {
  const timezone = (await getCalendarUser(userId))?.timezone || 'UTC';
  return {
    timezone,
    from: from && parseDate(from) ? localToUtc(from, '00:00:00', timezone) : undefined,
    to: to && parseDate(to) ? new Date(localToUtc(addDays(to, 1), '00:00:00', timezone).getTime() - 1) : undefined,
  };
}

export interface CalendarBookingRowWithEvent extends CalendarBookingRow {
  event_type_title: string;
  event_type_duration_min: number;
  host_email: string | null;
  host_name: string | null;
}

export async function listUserBookings(
  userId: string,
  opts: {
    status?: CalendarBookingRow['status'];
    from?: Date;
    to?: Date;
    /** Busca en nombre o email del invitado. */
    q?: string;
    limit?: number;
    /** Por inicio; por defecto la más nueva primero. */
    order?: 'asc' | 'desc';
  } = {},
): Promise<CalendarBookingRowWithEvent[]> {
  const conditions: string[] = ['e.user_id = ?'];
  const values: (string | number)[] = [userId];

  if (opts.status) {
    conditions.push('b.status = ?');
    values.push(opts.status);
  }
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push("(LOWER(b.invitee_name) LIKE ? ESCAPE '\\' OR LOWER(b.invitee_email) LIKE ? ESCAPE '\\')");
    values.push(like, like);
  }
  if (opts.from) {
    conditions.push('b.starts_at >= ?');
    values.push(opts.from.toISOString());
  }
  if (opts.to) {
    conditions.push('b.starts_at <= ?');
    values.push(opts.to.toISOString());
  }

  const sql = `SELECT b.*, e.title as event_type_title, e.duration_min as event_type_duration_min,
                      h.email as host_email, h.name as host_name
               FROM calendar_bookings b
               JOIN calendar_event_types e ON e.id = b.event_type_id
               LEFT JOIN users h ON h.id = b.host_user_id
               WHERE ${conditions.join(' AND ')}
               ORDER BY b.starts_at ${opts.order === 'asc' ? 'ASC' : 'DESC'}
               LIMIT ?`;
  values.push(Math.min(Math.max(opts.limit ?? 500, 1), 1000));
  return (await getDb().prepare(sql).all(...values)) as CalendarBookingRowWithEvent[];
}

// ---------- Availability engine ----------

export interface TimeRange {
  start: Date;
  end: Date;
}

interface CalendarBookingRules {
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  minNoticeHours?: number;
  maxFutureDays?: number;
  allowGuests?: boolean;
}

function iso(d: Date): string {
  return d.toISOString();
}

function datePartsInTz(d: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function localToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h = 0, min = 0, s = 0] = time.split(':').map(Number);
  const desiredMs = Date.UTC(y, m - 1, d, h, min, s);
  let utc = desiredMs;
  for (let i = 0; i < 5; i++) {
    const local = datePartsInTz(new Date(utc), tz);
    const localMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const diff = desiredMs - localMs;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

function parseDate(date: string): { year: number; month: number; day: number } | null {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = date.split('-').map(Number);
  return { year: y, month: mo, day: d };
}

function hasOverlap(range: TimeRange, ranges: TimeRange[]): boolean {
  return ranges.some((r) => range.start < r.end && range.end > r.start);
}

function getBookingRules(eventType: EventTypeWithRules): Partial<CalendarBookingRules> {
  return (eventType.bookingRulesParsed ?? {}) as Partial<CalendarBookingRules>;
}

export function applyBuffer(slot: TimeRange, eventType: EventTypeWithRules, calendarUser?: CalendarUserRow): TimeRange {
  const rules = getBookingRules(eventType);
  const before = rules.bufferBeforeMin ?? calendarUser?.buffer_before_min ?? 0;
  const after = rules.bufferAfterMin ?? calendarUser?.buffer_after_min ?? 0;
  return {
    start: new Date(slot.start.getTime() - before * 60_000),
    end: new Date(slot.end.getTime() + after * 60_000),
  };
}

/**
 * Fuentes externas de horarios ocupados (p. ej. Google Calendar). Se registran
 * desde otros módulos para no acoplar el motor a una integración concreta.
 */
export type ExternalBusyProvider = (userId: string, from: Date, to: Date) => Promise<TimeRange[]>;
const externalBusyProviders: ExternalBusyProvider[] = [googleBusyRanges];
export function registerBusyProvider(provider: ExternalBusyProvider): void {
  externalBusyProviders.push(provider);
}

/**
 * Horarios ocupados de una PERSONA (no de un event type): todas sus reservas
 * confirmadas en cualquier event type, sus bloqueos y calendarios externos.
 */
export async function listBusyRanges(
  userId: string,
  from: Date,
  to: Date,
  opts: { excludeBookingId?: string; internalOnly?: boolean } = {},
): Promise<TimeRange[]> {
  const db = getDb();
  const bookings = (await db
    .prepare(
      // host_user_id se completa siempre (backfill en la migración): filtrar
      // por la columna, sin COALESCE, deja usar el índice (host, inicio).
      `SELECT b.starts_at, b.ends_at FROM calendar_bookings b
       WHERE b.host_user_id = ? AND b.status IN ('confirmed', 'pending')
         AND (b.status = 'confirmed' OR b.hold_expires_at > ?)
         AND b.starts_at < ? AND b.ends_at > ? AND b.id != ?`,
    )
    .all(userId, new Date().toISOString(), iso(to), iso(from), opts.excludeBookingId ?? '')) as Array<{
    starts_at: string;
    ends_at: string;
  }>;
  const blocked = (await db
    .prepare('SELECT starts_at, ends_at FROM calendar_blocked_slots WHERE user_id = ? AND starts_at < ? AND ends_at > ?')
    .all(userId, iso(to), iso(from))) as Array<{ starts_at: string; ends_at: string }>;
  const ranges: TimeRange[] = [...bookings, ...blocked].map((r) => ({
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
  }));
  if (opts.internalOnly) return ranges;
  for (const provider of externalBusyProviders) {
    try {
      ranges.push(...(await provider(userId, from, to)));
    } catch {
      // Un calendario externo caído no puede dejar la agenda sin slots.
    }
  }
  return ranges;
}

/** Hosts candidatos: el pool round-robin, o el dueño del event type. */
async function candidateHosts(eventType: CalendarEventTypeRow): Promise<string[]> {
  const pool = await listEventHosts(eventType.id);
  return pool.length > 0 ? pool.map((h) => h.user_id) : [eventType.user_id];
}

/**
 * Todo lo que el motor necesita de un event type, cargado una vez: así la
 * vista del mes no repite las mismas queries por cada día.
 */
interface SlotContext {
  eventType: EventTypeWithRules;
  calendarUser?: CalendarUserRow;
  hosts: string[];
  weekly: ScheduleRule[];
  overrides: ScheduleOverride[];
  scheduleTimezone: string;
  minStart: Date;
  maxFutureDays: number;
}

/**
 * `excludeBookingId`: se calculan horarios para mover esa reserva (confirmada,
 * del mismo event type). Reprogramar no es una reserva nueva: vale aunque el
 * evento esté desactivado o sea un link de un solo uso ya consumido.
 */
async function loadSlotContext(eventTypeId: string, excludeBookingId?: string): Promise<SlotContext | null> {
  const eventType = await getEventTypeById(eventTypeId);
  if (!eventType) return null;
  if (!(excludeBookingId && (await isReschedulableBooking(excludeBookingId, eventTypeId)))) {
    if (eventType.active !== 1) return null;
    if (eventType.single_use === 1 && eventType.used_at) return null;
  }

  const calendarUser = await getCalendarUser(eventType.user_id);
  const rules = getBookingRules(eventType);
  const minNoticeHours = rules.minNoticeHours ?? calendarUser?.min_notice_hours ?? 0;

  // Horario reutilizable (zona propia + excepciones) o, si el evento no
  // tiene, sus reglas propias en la zona del dueño (comportamiento previo).
  const schedule = eventType.schedule_id ? await loadScheduleForEngine(eventType.schedule_id) : null;
  const weekly: ScheduleRule[] = schedule
    ? schedule.rules
    : (await listAvailability(eventTypeId)).map((r) => ({
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
      }));

  return {
    eventType,
    calendarUser,
    hosts: await candidateHosts(eventType),
    weekly,
    overrides: schedule?.overrides ?? [],
    scheduleTimezone: schedule?.timezone ?? calendarUser?.timezone ?? 'UTC',
    minStart: new Date(Date.now() + minNoticeHours * 60 * 60 * 1000),
    maxFutureDays: effectiveMaxFutureDays(eventType, calendarUser),
  };
}

/** La reserva existe, está confirmada y es de ese event type (se puede reprogramar). */
export async function isReschedulableBooking(bookingId: string, eventTypeId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(`SELECT 1 AS one FROM calendar_bookings WHERE id = ? AND event_type_id = ? AND status = 'confirmed'`)
    .get(bookingId, eventTypeId)) as { one: number } | undefined;
  return row?.one === 1;
}

/** Máximo de días para reservar: la regla del evento o, si no tiene, la del workspace. */
export function effectiveMaxFutureDays(eventType: EventTypeWithRules, calendarUser?: CalendarUserRow): number {
  return getBookingRules(eventType).maxFutureDays ?? calendarUser?.max_booking_days ?? 30;
}

/** Slots de `date` con la ocupación por host ya cargada (cubre al menos el día ±1). */
function slotsForDay(ctx: SlotContext, timezone: string, date: string, busyByHost: TimeRange[][]): TimeRange[] {
  const parsed = parseDate(date);
  if (!parsed) return [];
  const todayParts = datePartsInTz(new Date(), timezone);
  const maxDateMs = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day) + ctx.maxFutureDays * 24 * 60 * 60 * 1000;
  if (Date.UTC(parsed.year, parsed.month - 1, parsed.day) > maxDateMs) return [];

  return computeDaySlots({
    date,
    guestTimezone: timezone,
    scheduleTimezone: ctx.scheduleTimezone,
    weekly: ctx.weekly,
    overrides: ctx.overrides,
    durationMin: ctx.eventType.duration_min,
    minStart: ctx.minStart,
    isFree: (slot) => {
      const buffered = applyBuffer(slot, ctx.eventType, ctx.calendarUser);
      return busyByHost.some((busy) => !hasOverlap(buffered, busy));
    },
  });
}

/** Ocupación de cada host candidato en [from, to); un slot sirve si al menos uno está libre. */
function busyForHosts(ctx: SlotContext, from: Date, to: Date, opts: { excludeBookingId?: string }): Promise<TimeRange[][]> {
  return Promise.all(ctx.hosts.map((h) => listBusyRanges(h, from, to, opts)));
}

export async function getAvailableSlots(
  eventTypeId: string,
  timezone: string,
  date: string,
  opts: { excludeBookingId?: string } = {},
): Promise<TimeRange[]> {
  if (!parseDate(date)) return [];
  const ctx = await loadSlotContext(eventTypeId, opts.excludeBookingId);
  if (!ctx) return [];
  // Margen de 1 día por buffers.
  const dayStart = localToUtc(date, '00:00:00', timezone);
  const busyByHost = await busyForHosts(
    ctx,
    new Date(dayStart.getTime() - 24 * 60 * 60 * 1000),
    new Date(dayStart.getTime() + 48 * 60 * 60 * 1000),
    opts,
  );
  return slotsForDay(ctx, timezone, date, busyByHost);
}

/**
 * Núcleo puro del motor: slots de `date` (día local del invitado) a partir de
 * las horas semanales y excepciones de un horario en su propia zona. Recorre
 * los días locales del horario que tocan el día del invitado (±1), así
 * funciona con zonas distintas y con cambios de horario (DST): cada ventana
 * se convierte a UTC con la fecha concreta.
 */
export function computeDaySlots(input: {
  date: string;
  guestTimezone: string;
  scheduleTimezone: string;
  weekly: ScheduleRule[];
  overrides: ScheduleOverride[];
  durationMin: number;
  minStart: Date;
  isFree?: (slot: TimeRange) => boolean;
}): TimeRange[] {
  if (!parseDate(input.date)) return [];
  const tz = input.scheduleTimezone;
  const dayStart = localToUtc(input.date, '00:00:00', input.guestTimezone);
  const dayEnd = localToUtc(addDays(input.date, 1), '00:00:00', input.guestTimezone);
  const slotDuration = input.durationMin * 60_000;
  const slots: TimeRange[] = [];

  const first = datePartsInTz(new Date(dayStart.getTime() - 24 * 60 * 60 * 1000), tz);
  let localDay = `${first.year}-${String(first.month).padStart(2, '0')}-${String(first.day).padStart(2, '0')}`;
  for (let i = 0; i < 4; i++, localDay = addDays(localDay, 1)) {
    const [y, m, d] = localDay.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    for (const w of windowsForDate(localDay, dow, input.weekly, input.overrides)) {
      const winStart = localToUtc(localDay, w.startTime, tz);
      const winEnd = localToUtc(localDay, w.endTime, tz);
      for (let t = winStart.getTime(); t + slotDuration <= winEnd.getTime(); t += slotDuration) {
        const slot: TimeRange = { start: new Date(t), end: new Date(t + slotDuration) };
        // Cada slot pertenece al día local de su inicio (puede terminar pasada la medianoche).
        if (slot.start < dayStart || slot.start >= dayEnd) continue;
        if (slot.start < input.minStart) continue;
        if (input.isFree && !input.isFree(slot)) continue;
        slots.push(slot);
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  const unique: TimeRange[] = [];
  for (const s of slots) {
    if (unique.length > 0 && unique[unique.length - 1].start.getTime() === s.start.getTime()) continue;
    unique.push(s);
  }
  return unique;
}

/** YYYY-MM-DD + n días (calendario, sin zona). */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
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
