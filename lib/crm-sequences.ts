/**
 * CRM — secuencias de ventas: pasos ordenados (email, tarea, espera), días
 * hábiles y ventana de envío en la zona horaria de la secuencia. Las
 * inscripciones avanzan desde el cron (app/api/cron/tick, cada hora: esa es la
 * granularidad real de los envíos) con lock por fila (compare-and-set sobre
 * locked_until), así dos ticks concurrentes nunca procesan la misma.
 * Salidas automáticas: respuesta del contacto (sync de Gmail), reunión
 * agendada en Cal (lib/crm-integrations.ts) o baja (link al pie).
 * Server-only.
 */
import { getDb, type CrmSequenceEnrollmentRow, type CrmSequenceRow, type CrmSequenceStepRow } from './db';
import { createActivity } from './crm';
import {
  dbNow,
  getEmailTemplate,
  gmailSender,
  isUnsubscribed,
  loadTemplateContext,
  renderEmailTemplate,
  sendCrmEmail,
} from './crm-email';

export const STEP_TYPES = ['email', 'task', 'wait'] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const ENROLLMENT_STATUSES = ['active', 'paused', 'finished', 'exited'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export interface SequenceStepInput {
  id?: string;
  type: StepType;
  waitDays?: number;
  templateId?: string | null;
  subject?: string;
  body?: string;
  newThread?: boolean;
}

export interface SequenceInput {
  name: string;
  timezone?: string;
  windowStart?: string;
  windowEnd?: string;
  businessDays?: boolean;
  steps?: SequenceStepInput[];
}

export interface SequenceListRow extends CrmSequenceRow {
  step_count: number;
  active_count: number;
  total_count: number;
}

export const UNSUBSCRIBE_LABEL = 'Unsubscribe';
const LOCK_MS = 5 * 60_000;
const MAX_STEPS_PER_RUN = 10;

// ---------- Tiempo: zonas horarias, días hábiles y ventana ----------

export interface ScheduleConfig {
  timezone: string;
  windowStart: string; // HH:MM
  windowEnd: string; // HH:MM
  businessDays: boolean;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function hm(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return 0;
  return Math.min(Number(m[1]), 24) * 60 + Math.min(Number(m[2]), 59);
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: number; // 0 = domingo
}

function localParts(date: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour) % 24,
    mm: Number(p.minute),
    weekday: weekdays.indexOf(String(p.weekday)),
  };
}

/** Fecha/hora local de `tz` → instante UTC (corrige el offset, DST incluido). */
export function zonedToUtc(y: number, m: number, d: number, minutes: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    ts += guess - asUtc;
  }
  return new Date(ts);
}

function addLocalDays(p: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number; weekday: number } {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), weekday: dt.getUTCDay() };
}

const isWeekend = (weekday: number): boolean => weekday === 0 || weekday === 6;

/** Primer instante >= from dentro de la ventana de envío (y en día hábil si aplica). */
export function nextSendSlot(from: Date, cfg: ScheduleConfig): Date {
  const tz = isValidTimezone(cfg.timezone) ? cfg.timezone : 'UTC';
  let start = hm(cfg.windowStart);
  let end = hm(cfg.windowEnd);
  if (end <= start) {
    start = 0;
    end = 24 * 60;
  }
  const today = localParts(from, tz);
  for (let i = 0; i < 15; i++) {
    const day = addLocalDays(today, i);
    if (cfg.businessDays && isWeekend(day.weekday)) continue;
    const open = zonedToUtc(day.y, day.m, day.d, start, tz);
    const close = zonedToUtc(day.y, day.m, day.d, end, tz);
    if (from < open) return open;
    if (from < close) return from;
  }
  return from;
}

/** Espera de N días (hábiles si aplica) manteniendo la hora local. */
export function addWaitDays(from: Date, days: number, cfg: ScheduleConfig): Date {
  const n = Math.max(0, Math.floor(days));
  if (n === 0) return from;
  if (!cfg.businessDays) return new Date(from.getTime() + n * 86_400_000);
  const tz = isValidTimezone(cfg.timezone) ? cfg.timezone : 'UTC';
  const p = localParts(from, tz);
  let day: { y: number; m: number; d: number; weekday: number } = { ...p };
  let left = n;
  while (left > 0) {
    day = addLocalDays(day, 1);
    if (!isWeekend(day.weekday)) left -= 1;
  }
  return zonedToUtc(day.y, day.m, day.d, p.hh * 60 + p.mm, tz);
}

function scheduleOf(seq: CrmSequenceRow): ScheduleConfig {
  return {
    timezone: seq.timezone,
    windowStart: seq.window_start,
    windowEnd: seq.window_end,
    businessDays: seq.business_days === 1,
  };
}

// ---------- CRUD ----------

export async function listSequences(userId: string): Promise<SequenceListRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM crm_sequence_steps st WHERE st.sequence_id = s.id) AS step_count,
         (SELECT COUNT(*) FROM crm_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active_count,
         (SELECT COUNT(*) FROM crm_sequence_enrollments e WHERE e.sequence_id = s.id) AS total_count
       FROM crm_sequences s WHERE s.user_id = ? AND s.archived = 0
       ORDER BY s.updated_at DESC`,
    )
    .all(userId)) as SequenceListRow[];
  return rows.map((r) => ({
    ...r,
    step_count: Number(r.step_count),
    active_count: Number(r.active_count),
    total_count: Number(r.total_count),
  }));
}

export async function getSequence(
  userId: string,
  id: string,
): Promise<{ sequence: CrmSequenceRow; steps: CrmSequenceStepRow[] } | null> {
  const db = getDb();
  const sequence = (await db.prepare('SELECT * FROM crm_sequences WHERE id = ? AND user_id = ?').get(id, userId)) as
    | CrmSequenceRow
    | undefined;
  if (!sequence) return null;
  const steps = (await db
    .prepare('SELECT * FROM crm_sequence_steps WHERE sequence_id = ? ORDER BY position ASC')
    .all(id)) as CrmSequenceStepRow[];
  return { sequence, steps };
}

async function replaceSteps(userId: string, sequenceId: string, steps: SequenceStepInput[]): Promise<void> {
  const db = getDb();
  const existing = (await db.prepare('SELECT id FROM crm_sequence_steps WHERE sequence_id = ?').all(sequenceId)) as Array<{
    id: string;
  }>;
  const keep = new Set<string>();
  for (const [i, s] of steps.entries()) {
    let templateId = s.templateId ?? null;
    if (templateId && !(await getEmailTemplate(userId, templateId))) templateId = null;
    const fields = [
      i,
      s.type,
      s.type === 'wait' ? Math.max(0, Math.min(365, Math.floor(s.waitDays ?? 1))) : 0,
      s.type === 'email' ? templateId : null,
      s.subject ?? '',
      s.body ?? '',
      s.newThread ? 1 : 0,
    ];
    // Se conservan los ids de pasos existentes: las estadísticas por paso dependen de ellos.
    if (s.id && existing.some((e) => e.id === s.id)) {
      keep.add(s.id);
      await db
        .prepare(
          'UPDATE crm_sequence_steps SET position = ?, type = ?, wait_days = ?, template_id = ?, subject = ?, body = ?, new_thread = ? WHERE id = ?',
        )
        .run(...fields, s.id);
    } else {
      await db
        .prepare(
          'INSERT INTO crm_sequence_steps (id, sequence_id, position, type, wait_days, template_id, subject, body, new_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(crypto.randomUUID(), sequenceId, ...fields);
    }
  }
  for (const e of existing) {
    if (!keep.has(e.id)) await db.prepare('DELETE FROM crm_sequence_steps WHERE id = ?').run(e.id);
  }
}

export async function createSequence(userId: string, actorId: string, input: SequenceInput): Promise<CrmSequenceRow> {
  const id = crypto.randomUUID();
  const ts = dbNow();
  await getDb()
    .prepare(
      `INSERT INTO crm_sequences (id, user_id, created_by, name, timezone, window_start, window_end, business_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      actorId,
      input.name,
      input.timezone && isValidTimezone(input.timezone) ? input.timezone : 'UTC',
      input.windowStart ?? '09:00',
      input.windowEnd ?? '17:00',
      input.businessDays === false ? 0 : 1,
      ts,
      ts,
    );
  if (input.steps?.length) await replaceSteps(userId, id, input.steps);
  return (await getSequence(userId, id))!.sequence;
}

export async function updateSequence(
  userId: string,
  id: string,
  input: Partial<SequenceInput>,
): Promise<{ sequence: CrmSequenceRow; steps: CrmSequenceStepRow[] } | null> {
  const current = await getSequence(userId, id);
  if (!current) return null;
  const s = current.sequence;
  await getDb()
    .prepare(
      'UPDATE crm_sequences SET name = ?, timezone = ?, window_start = ?, window_end = ?, business_days = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      input.name ?? s.name,
      input.timezone && isValidTimezone(input.timezone) ? input.timezone : s.timezone,
      input.windowStart ?? s.window_start,
      input.windowEnd ?? s.window_end,
      input.businessDays === undefined ? s.business_days : input.businessDays ? 1 : 0,
      dbNow(),
      id,
    );
  if (input.steps) await replaceSteps(userId, id, input.steps);
  return getSequence(userId, id);
}

export async function deleteSequence(userId: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM crm_sequences WHERE id = ? AND user_id = ?').run(id, userId)).changes > 0;
}

// ---------- Inscripciones ----------

export type EnrollSkipReason = 'not_found' | 'no_email' | 'unsubscribed' | 'already_enrolled';

export type EnrollResult =
  | { ok: true; enrolled: string[]; skipped: Array<{ contactId: string; reason: EnrollSkipReason }> }
  | { ok: false; error: 'not_found' | 'gmail_not_connected' | 'no_steps' | 'incomplete_steps' | 'invalid_sender' };

/** La persona que envía tiene que ser del workspace (owner o miembro del team). */
async function isWorkspacePersonId(userId: string, personId: string): Promise<boolean> {
  const { isWorkspacePerson } = await import('./crm-refs');
  return isWorkspacePerson(userId, personId);
}

/**
 * Remitente por defecto para inscripciones automáticas (workflow, Flow, API):
 * el owner del contacto si tiene Gmail con envío; si no, quien creó la
 * secuencia; si no, el dueño del workspace.
 */
export async function defaultSenderFor(userId: string, sequenceId: string, contactId: string): Promise<string> {
  const db = getDb();
  const contact = (await db.prepare('SELECT owner_id FROM crm_contacts WHERE id = ? AND user_id = ?').get(contactId, userId)) as
    | { owner_id: string | null }
    | undefined;
  const seq = (await db.prepare('SELECT created_by FROM crm_sequences WHERE id = ? AND user_id = ?').get(sequenceId, userId)) as
    | { created_by: string | null }
    | undefined;
  for (const candidate of [contact?.owner_id, seq?.created_by]) {
    if (candidate && (await isWorkspacePersonId(userId, candidate)) && (await gmailSender(candidate))) return candidate;
  }
  return seq?.created_by && (await isWorkspacePersonId(userId, seq.created_by)) ? seq.created_by : userId;
}

/**
 * Inscribe contactos. Los envíos salen del Gmail de `senderId` (tiene que
 * estar conectado con permiso de envío): si no, no se inscribe a nadie.
 */
export async function enrollContacts(
  userId: string,
  input: { sequenceId: string; contactIds: string[]; senderId: string; enrolledBy: string | null; now?: Date },
): Promise<EnrollResult> {
  const seq = await getSequence(userId, input.sequenceId);
  if (!seq || seq.sequence.archived) return { ok: false, error: 'not_found' };
  if (!seq.steps.length) return { ok: false, error: 'no_steps' };
  // Un email sin cuerpo ni template no se puede enviar.
  if (seq.steps.some((s) => s.type === 'email' && !s.body.trim() && !s.template_id)) {
    return { ok: false, error: 'incomplete_steps' };
  }
  if (!(await isWorkspacePersonId(userId, input.senderId))) return { ok: false, error: 'invalid_sender' };
  if (seq.steps.some((s) => s.type === 'email') && !(await gmailSender(input.senderId))) {
    return { ok: false, error: 'gmail_not_connected' };
  }
  const db = getDb();
  const enrolled: string[] = [];
  const skipped: Array<{ contactId: string; reason: EnrollSkipReason }> = [];
  const ts = dbNow(input.now);
  for (const contactId of [...new Set(input.contactIds)].slice(0, 500)) {
    const contact = (await db
      .prepare('SELECT id, email FROM crm_contacts WHERE id = ? AND user_id = ?')
      .get(contactId, userId)) as { id: string; email: string } | undefined;
    if (!contact) {
      skipped.push({ contactId, reason: 'not_found' });
      continue;
    }
    if (!contact.email) {
      skipped.push({ contactId, reason: 'no_email' });
      continue;
    }
    if (await isUnsubscribed(userId, contact.email)) {
      skipped.push({ contactId, reason: 'unsubscribed' });
      continue;
    }
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO crm_sequence_enrollments
           (id, user_id, sequence_id, contact_id, sender_id, enrolled_by, status, current_step, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), userId, input.sequenceId, contactId, input.senderId, input.enrolledBy, ts, ts, ts);
    if (res.changes) enrolled.push(contactId);
    else skipped.push({ contactId, reason: 'already_enrolled' });
  }
  return { ok: true, enrolled, skipped };
}

export interface EnrollmentListRow extends CrmSequenceEnrollmentRow {
  sequence_name: string;
  contact_name: string;
  contact_email: string;
  step_count: number;
}

export async function listEnrollments(
  userId: string,
  f: { sequenceId?: string; contactId?: string; status?: EnrollmentStatus; limit?: number },
): Promise<EnrollmentListRow[]> {
  const where = ['e.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.sequenceId) {
    where.push('e.sequence_id = ?');
    args.push(f.sequenceId);
  }
  if (f.contactId) {
    where.push('e.contact_id = ?');
    args.push(f.contactId);
  }
  if (f.status) {
    where.push('e.status = ?');
    args.push(f.status);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT e.*, s.name AS sequence_name,
         TRIM(c.first_name || ' ' || c.last_name) AS contact_name, c.email AS contact_email,
         (SELECT COUNT(*) FROM crm_sequence_steps st WHERE st.sequence_id = e.sequence_id) AS step_count
       FROM crm_sequence_enrollments e
       JOIN crm_sequences s ON s.id = e.sequence_id
       JOIN crm_contacts c ON c.id = e.contact_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE e.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, e.updated_at DESC
       LIMIT ?`,
    )
    .all(...args, Math.min(Math.max(f.limit ?? 200, 1), 1000))) as EnrollmentListRow[];
  return rows.map((r) => ({ ...r, step_count: Number(r.step_count) }));
}

export async function getEnrollment(userId: string, id: string): Promise<CrmSequenceEnrollmentRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM crm_sequence_enrollments WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmSequenceEnrollmentRow | undefined) ?? null;
}

/** pause / resume / exit manual de una inscripción. */
export async function setEnrollmentState(
  userId: string,
  id: string,
  action: 'pause' | 'resume' | 'exit',
  now = new Date(),
): Promise<CrmSequenceEnrollmentRow | null> {
  const enr = await getEnrollment(userId, id);
  if (!enr) return null;
  const db = getDb();
  const ts = dbNow(now);
  if (action === 'pause' && enr.status === 'active') {
    await db.prepare("UPDATE crm_sequence_enrollments SET status = 'paused', updated_at = ? WHERE id = ?").run(ts, id);
  } else if (action === 'resume' && enr.status === 'paused') {
    await db
      .prepare(
        "UPDATE crm_sequence_enrollments SET status = 'active', exit_reason = NULL, next_run_at = CASE WHEN next_run_at IS NULL OR next_run_at < ? THEN ? ELSE next_run_at END, updated_at = ? WHERE id = ?",
      )
      .run(ts, ts, ts, id);
  } else if (action === 'exit' && (enr.status === 'active' || enr.status === 'paused')) {
    await db
      .prepare("UPDATE crm_sequence_enrollments SET status = 'exited', exit_reason = 'manual', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(ts, ts, id);
  }
  return getEnrollment(userId, id);
}

export async function unenrollContact(userId: string, sequenceId: string, contactId: string): Promise<number> {
  const ts = dbNow();
  const res = await getDb()
    .prepare(
      `UPDATE crm_sequence_enrollments SET status = 'exited', exit_reason = 'manual', finished_at = ?, updated_at = ?
       WHERE user_id = ? AND sequence_id = ? AND contact_id = ? AND status IN ('active', 'paused')`,
    )
    .run(ts, ts, userId, sequenceId, contactId);
  return res.changes;
}

/**
 * Salida automática (respuesta, reunión, baja). Con 'replied' marca además
 * el último email de la secuencia como respondido (stats por paso).
 */
export async function exitEnrollmentsForContacts(
  userId: string,
  contactIds: string[],
  reason: 'replied' | 'meeting_booked' | 'unsubscribed',
  now = new Date(),
): Promise<number> {
  if (!contactIds.length) return 0;
  const db = getDb();
  const ph = contactIds.map(() => '?').join(',');
  const live = (await db
    .prepare(
      `SELECT id FROM crm_sequence_enrollments WHERE user_id = ? AND contact_id IN (${ph}) AND status IN ('active', 'paused')`,
    )
    .all(userId, ...contactIds)) as Array<{ id: string }>;
  const ts = dbNow(now);
  for (const { id } of live) {
    await db
      .prepare(
        `UPDATE crm_sequence_enrollments SET status = 'exited', exit_reason = ?, finished_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('active', 'paused')`,
      )
      .run(reason, ts, ts, id);
    if (reason === 'replied') {
      await db
        .prepare(
          `UPDATE crm_emails SET replied_at = ? WHERE id = (
             SELECT id FROM crm_emails WHERE enrollment_id = ? AND direction = 'out' ORDER BY sent_at DESC LIMIT 1)
           AND replied_at IS NULL`,
        )
        .run(ts, id);
    }
  }
  return live.length;
}

// ---------- Stats ----------

export interface StepStats {
  stepId: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

export async function sequenceStepStats(userId: string, sequenceId: string): Promise<StepStats[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT e.step_id AS stepId, COUNT(*) AS sent,
         SUM(CASE WHEN e.open_count > 0 THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN e.click_count > 0 THEN 1 ELSE 0 END) AS clicked,
         SUM(CASE WHEN e.replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied
       FROM crm_emails e
       JOIN crm_sequence_steps st ON st.id = e.step_id
       WHERE e.user_id = ? AND st.sequence_id = ? AND e.direction = 'out'
       GROUP BY e.step_id`,
    )
    .all(userId, sequenceId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    stepId: String(r.stepId),
    sent: Number(r.sent ?? 0),
    opened: Number(r.opened ?? 0),
    clicked: Number(r.clicked ?? 0),
    replied: Number(r.replied ?? 0),
  }));
}

// ---------- Procesamiento (cron) ----------

async function claimEnrollment(id: string, now: Date): Promise<boolean> {
  const ts = dbNow(now);
  const res = await getDb()
    .prepare(
      `UPDATE crm_sequence_enrollments SET locked_until = ?
       WHERE id = ? AND status = 'active' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(dbNow(new Date(now.getTime() + LOCK_MS)), id, ts);
  return res.changes > 0;
}

async function saveEnrollment(
  id: string,
  patch: Partial<Pick<CrmSequenceEnrollmentRow, 'status' | 'exit_reason' | 'current_step' | 'next_run_at' | 'thread_id' | 'last_message_id' | 'thread_subject' | 'finished_at'>>,
  now: Date,
  release = true,
): Promise<void> {
  const sets = Object.keys(patch).map((k) => `${k} = ?`);
  if (release) sets.push('locked_until = NULL');
  await getDb()
    .prepare(`UPDATE crm_sequence_enrollments SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`)
    .run(...(Object.values(patch) as Array<string | number | null>), dbNow(now), id);
}

export type ProcessOutcome = 'waiting' | 'finished' | 'exited' | 'paused' | 'retry' | 'skipped';

/** Avanza una inscripción ya bloqueada. Exportado para tests. */
export async function processEnrollment(
  enr: CrmSequenceEnrollmentRow,
  now = new Date(),
  sent: { count: number } = { count: 0 },
): Promise<ProcessOutcome> {
  const db = getDb();
  const seq = await getSequence(enr.user_id, enr.sequence_id);
  if (!seq) {
    await saveEnrollment(enr.id, { status: 'exited', exit_reason: 'sequence_deleted', finished_at: dbNow(now) }, now);
    return 'exited';
  }
  const contact = (await db
    .prepare('SELECT id, email, company_id FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(enr.contact_id, enr.user_id)) as { id: string; email: string; company_id: string | null } | undefined;
  if (!contact) return 'skipped';
  const cfg = scheduleOf(seq.sequence);
  const state = { ...enr };

  for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
    const step = seq.steps[state.current_step];
    if (!step) {
      await saveEnrollment(enr.id, { status: 'finished', current_step: state.current_step, next_run_at: null, finished_at: dbNow(now) }, now);
      return 'finished';
    }
    if (step.type === 'wait') {
      const next = addWaitDays(now, step.wait_days, cfg);
      await saveEnrollment(enr.id, { current_step: state.current_step + 1, next_run_at: dbNow(next) }, now);
      return 'waiting';
    }
    const ctx = await loadTemplateContext(enr.user_id, { contactId: contact.id, senderId: enr.sender_id });
    let subjectTpl = step.subject;
    let bodyTpl = step.body;
    if (step.template_id) {
      const tpl = await getEmailTemplate(enr.user_id, step.template_id);
      if (tpl) {
        subjectTpl = subjectTpl || tpl.subject;
        bodyTpl = bodyTpl || tpl.body;
      }
    }
    if (step.type === 'task') {
      const task = await createActivity(enr.user_id, {
        type: 'task',
        subject: renderEmailTemplate(subjectTpl || seq.sequence.name, ctx).text.slice(0, 500),
        body: renderEmailTemplate(bodyTpl, ctx).text.slice(0, 5000),
        dueAt: dbNow(now),
        contactId: contact.id,
        companyId: contact.company_id,
        ownerId: enr.sender_id,
      }).catch(() => null);
      // La cola de trabajo muestra de qué secuencia viene el paso manual.
      if (task) {
        await db.prepare('UPDATE crm_activities SET sequence_id = ? WHERE id = ?').run(seq.sequence.id, task.id).catch(() => null);
      }
      state.current_step += 1;
      continue;
    }
    // email
    const slot = nextSendSlot(now, cfg);
    if (slot.getTime() > now.getTime() + 60_000) {
      await saveEnrollment(enr.id, { current_step: state.current_step, next_run_at: dbNow(slot) }, now);
      return 'waiting';
    }
    if (await isUnsubscribed(enr.user_id, contact.email)) {
      await saveEnrollment(enr.id, { status: 'exited', exit_reason: 'unsubscribed', finished_at: dbNow(now) }, now);
      return 'exited';
    }
    const reply = Boolean(state.thread_id) && step.new_thread !== 1;
    const rendered = renderEmailTemplate(subjectTpl, ctx).text.trim();
    const subject = reply && state.thread_subject ? `Re: ${state.thread_subject.replace(/^re:\s*/i, '')}` : rendered || seq.sequence.name;
    const sender = (await db.prepare('SELECT email FROM users WHERE id = ?').get(enr.sender_id)) as { email: string } | undefined;
    const res = await sendCrmEmail(enr.user_id, {
      senderId: enr.sender_id,
      senderEmail: sender?.email ?? '',
      contactId: contact.id,
      to: contact.email,
      subject,
      body: renderEmailTemplate(bodyTpl, ctx).text,
      threadId: reply ? state.thread_id : null,
      inReplyTo: reply ? state.last_message_id : null,
      requireGmail: true,
      unsubscribeLabel: UNSUBSCRIBE_LABEL,
      enrollmentId: enr.id,
      stepId: step.id,
    });
    if (!res.ok) {
      if (res.error === 'gmail_not_connected') {
        await saveEnrollment(enr.id, { status: 'paused', exit_reason: 'gmail_not_connected' }, now);
        return 'paused';
      }
      await saveEnrollment(enr.id, { next_run_at: dbNow(new Date(now.getTime() + 3_600_000)) }, now);
      return 'retry';
    }
    state.thread_id = res.email.thread_id;
    state.last_message_id = res.email.message_id || state.last_message_id;
    if (!reply) state.thread_subject = subject;
    state.current_step += 1;
    await saveEnrollment(
      enr.id,
      {
        current_step: state.current_step,
        thread_id: state.thread_id,
        last_message_id: state.last_message_id,
        thread_subject: state.thread_subject,
        next_run_at: dbNow(now),
      },
      now,
      false, // sigue bloqueada: el próximo paso se procesa en esta misma pasada
    );
    sent.count += 1;
  }
  await saveEnrollment(enr.id, { current_step: state.current_step, next_run_at: dbNow(now) }, now);
  return 'waiting';
}

/**
 * Procesa las inscripciones vencidas (acotado por `limit`). Cada una se toma
 * con compare-and-set: un segundo tick concurrente la saltea.
 */
export async function processSequences(opts: { limit?: number; now?: Date } = {}): Promise<{ processed: number; sent: number }> {
  const now = opts.now ?? new Date();
  const ts = dbNow(now);
  const due = (await getDb()
    .prepare(
      `SELECT * FROM crm_sequence_enrollments
       WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
         AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY next_run_at ASC LIMIT ?`,
    )
    .all(ts, ts, Math.min(Math.max(opts.limit ?? 100, 1), 500))) as CrmSequenceEnrollmentRow[];
  let processed = 0;
  const sent = { count: 0 };
  for (const enr of due) {
    if (!(await claimEnrollment(enr.id, now))) continue;
    try {
      await processEnrollment(enr, now, sent);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sequences] enrollment failed', enr.id, err);
      await getDb().prepare('UPDATE crm_sequence_enrollments SET locked_until = NULL WHERE id = ?').run(enr.id);
    }
    processed += 1;
  }
  return { processed, sent: sent.count };
}
