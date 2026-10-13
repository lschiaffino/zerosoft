/**
 * Cal — horarios reutilizables (nombre, zona horaria, horas semanales) que se
 * asignan a tipos de evento, más excepciones por fecha (día no disponible u
 * horas distintas ese día). Todo con userId primero: un horario es del
 * workspace que lo creó.
 */
import {
  getDb,
  type CalendarScheduleRow,
  type CalendarScheduleRuleRow,
  type CalendarScheduleOverrideRow,
} from './db';
import type { ScheduleCreatePayload, ScheduleUpdatePayload } from './calendar-schema';

export interface ScheduleRule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface ScheduleOverride {
  date: string;
  startTime: string | null;
  endTime: string | null;
}

export interface ScheduleDetail extends CalendarScheduleRow {
  rules: ScheduleRule[];
  overrides: ScheduleOverride[];
  eventTypeCount: number;
}

export class ScheduleError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

/** Lunes a viernes 9 a 17: el horario con el que arranca un workspace. */
export const DEFAULT_WEEKLY_RULES: ScheduleRule[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '17:00',
}));

function ts(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\..*$/, '');
}

// ---------- Cálculo puro ----------

/**
 * Ventanas de disponibilidad (horas locales del horario) de una fecha.
 * Si hay excepciones para esa fecha mandan ellas: una sin horas bloquea el
 * día entero; las que tienen horas reemplazan las semanales.
 */
export function windowsForDate(
  date: string,
  dayOfWeek: number,
  rules: ScheduleRule[],
  overrides: ScheduleOverride[],
): Array<{ startTime: string; endTime: string }> {
  const forDate = overrides.filter((o) => o.date === date);
  if (forDate.length > 0) {
    if (forDate.some((o) => !o.startTime || !o.endTime)) return [];
    return forDate
      .map((o) => ({ startTime: o.startTime as string, endTime: o.endTime as string }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return rules
    .filter((r) => r.dayOfWeek === dayOfWeek)
    .map((r) => ({ startTime: r.startTime, endTime: r.endTime }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// ---------- Lectura ----------

async function rulesOf(scheduleId: string): Promise<ScheduleRule[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM calendar_schedule_rules WHERE schedule_id = ? ORDER BY day_of_week, start_time')
    .all(scheduleId)) as CalendarScheduleRuleRow[];
  return rows.map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time }));
}

async function overridesOf(scheduleId: string): Promise<ScheduleOverride[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM calendar_schedule_overrides WHERE schedule_id = ? ORDER BY date, start_time')
    .all(scheduleId)) as CalendarScheduleOverrideRow[];
  return rows.map((o) => ({ date: o.date, startTime: o.start_time, endTime: o.end_time }));
}

async function detail(row: CalendarScheduleRow): Promise<ScheduleDetail> {
  const count = (await getDb()
    .prepare('SELECT COUNT(*) AS c FROM calendar_event_types WHERE schedule_id = ?')
    .get(row.id)) as { c: number } | undefined;
  return {
    ...row,
    rules: await rulesOf(row.id),
    overrides: await overridesOf(row.id),
    eventTypeCount: Number(count?.c ?? 0),
  };
}

export async function listSchedules(userId: string): Promise<ScheduleDetail[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM calendar_schedules WHERE user_id = ? ORDER BY is_default DESC, name, created_at')
    .all(userId)) as CalendarScheduleRow[];
  return Promise.all(rows.map(detail));
}

export async function getSchedule(userId: string, id: string): Promise<ScheduleDetail | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_schedules WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CalendarScheduleRow | undefined;
  return row ? detail(row) : null;
}

/** Para el motor de slots (público): sin chequeo de dueño, el event type ya lo resolvió. */
export async function loadScheduleForEngine(
  id: string,
): Promise<{ timezone: string; rules: ScheduleRule[]; overrides: ScheduleOverride[] } | null> {
  const row = (await getDb().prepare('SELECT * FROM calendar_schedules WHERE id = ?').get(id)) as
    | CalendarScheduleRow
    | undefined;
  if (!row) return null;
  return { timezone: row.timezone, rules: await rulesOf(id), overrides: await overridesOf(id) };
}

export async function getDefaultSchedule(userId: string): Promise<CalendarScheduleRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_schedules WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1')
    .get(userId)) as CalendarScheduleRow | undefined;
  return row ?? null;
}

// ---------- Escritura ----------

async function replaceRules(scheduleId: string, rules: ScheduleRule[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM calendar_schedule_rules WHERE schedule_id = ?').run(scheduleId);
  const ins = db.prepare(
    'INSERT INTO calendar_schedule_rules (id, schedule_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
  );
  for (const r of rules) await ins.run(crypto.randomUUID(), scheduleId, r.dayOfWeek, r.startTime, r.endTime);
}

async function replaceOverrides(
  scheduleId: string,
  overrides: Array<{ date: string; startTime?: string | null; endTime?: string | null }>,
): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM calendar_schedule_overrides WHERE schedule_id = ?').run(scheduleId);
  const ins = db.prepare(
    'INSERT INTO calendar_schedule_overrides (id, schedule_id, date, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
  );
  for (const o of overrides) {
    await ins.run(crypto.randomUUID(), scheduleId, o.date, o.startTime || null, o.endTime || null);
  }
}

async function setDefault(userId: string, id: string): Promise<void> {
  await getDb().prepare('UPDATE calendar_schedules SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?').run(id, userId);
}

export async function createSchedule(userId: string, payload: ScheduleCreatePayload): Promise<ScheduleDetail> {
  const id = crypto.randomUUID();
  const now = ts();
  const first = !(await getDefaultSchedule(userId));
  await getDb()
    .prepare(
      `INSERT INTO calendar_schedules (id, user_id, name, timezone, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, userId, payload.name, payload.timezone, now, now);
  await replaceRules(id, payload.rules ?? DEFAULT_WEEKLY_RULES);
  if (payload.overrides) await replaceOverrides(id, payload.overrides);
  if (first || payload.isDefault) await setDefault(userId, id);
  return (await getSchedule(userId, id)) as ScheduleDetail;
}

export async function updateSchedule(
  userId: string,
  id: string,
  payload: ScheduleUpdatePayload,
): Promise<ScheduleDetail | null> {
  const existing = await getSchedule(userId, id);
  if (!existing) return null;
  const sets: string[] = [];
  const values: string[] = [];
  if (payload.name !== undefined) {
    sets.push('name = ?');
    values.push(payload.name);
  }
  if (payload.timezone !== undefined) {
    sets.push('timezone = ?');
    values.push(payload.timezone);
  }
  sets.push('updated_at = ?');
  values.push(ts());
  await getDb()
    .prepare(`UPDATE calendar_schedules SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...values, id, userId);
  if (payload.rules) await replaceRules(id, payload.rules);
  if (payload.overrides) await replaceOverrides(id, payload.overrides);
  if (payload.isDefault) await setDefault(userId, id);
  return getSchedule(userId, id);
}

/** No se borra un horario que usan tipos de evento: primero hay que moverlos a otro. */
export async function deleteSchedule(userId: string, id: string): Promise<boolean> {
  const existing = await getSchedule(userId, id);
  if (!existing) return false;
  if (existing.eventTypeCount > 0) throw new ScheduleError('schedule_in_use', 409);
  await getDb().prepare('DELETE FROM calendar_schedules WHERE id = ? AND user_id = ?').run(id, userId);
  if (existing.is_default === 1) {
    const next = await getDefaultSchedule(userId);
    if (next) await setDefault(userId, next.id);
  }
  return true;
}

/** Horario por defecto del workspace; si no tiene ninguno, crea lunes a viernes 9 a 17 en su zona. */
export async function ensureDefaultSchedule(userId: string, timezone = 'UTC'): Promise<CalendarScheduleRow> {
  const existing = await getDefaultSchedule(userId);
  if (existing) return existing;
  const created = await createSchedule(userId, { name: 'Horario principal', timezone, isDefault: true });
  return created;
}

/** El horario es del workspace (para asignarlo a un tipo de evento). */
export async function scheduleBelongsTo(userId: string, scheduleId: string): Promise<boolean> {
  const row = await getDb()
    .prepare('SELECT 1 AS one FROM calendar_schedules WHERE id = ? AND user_id = ?')
    .get(scheduleId, userId);
  return !!row;
}
