/**
 * Cal — workflows de recordatorio por tipo de evento. Cada paso manda un
 * email al invitado o al anfitrión X minutos antes (offset < 0) o después
 * (offset > 0) del inicio, con asunto y cuerpo propios y variables
 * ({{guest.name}}, {{event.title}}, {{start}}, {{link}}…).
 *
 * Por reserva confirmada se programa una corrida por paso
 * (calendar_workflow_runs); el cron de recordatorios
 * (/api/calendar/reminders/due, dentro de /api/cron/tick) despacha las
 * vencidas. Este módulo solo importa db/email para no crear ciclos con
 * lib/calendar.ts.
 */
import { getDb, getUserById, type CalendarWorkflowStepRow } from './db';
import { escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import type { WorkflowStepPayload } from './calendar-schema';

export interface WorkflowStep {
  id: string;
  recipient: 'guest' | 'host';
  offsetMin: number;
  subject: string;
  body: string;
}

function toStep(r: CalendarWorkflowStepRow): WorkflowStep {
  return { id: r.id, recipient: r.recipient, offsetMin: r.offset_min, subject: r.subject, body: r.body };
}

async function ownsEventType(userId: string, eventTypeId: string): Promise<boolean> {
  return !!(await getDb()
    .prepare('SELECT 1 AS one FROM calendar_event_types WHERE id = ? AND user_id = ?')
    .get(eventTypeId, userId));
}

const REMINDER_24H_MS = 24 * 60 * 60 * 1000;

// ---------- Pasos ----------

/** null si el tipo de evento no es del workspace. */
export async function listWorkflowSteps(userId: string, eventTypeId: string): Promise<WorkflowStep[] | null> {
  if (!(await ownsEventType(userId, eventTypeId))) return null;
  const rows = (await getDb()
    .prepare('SELECT * FROM calendar_workflow_steps WHERE event_type_id = ? ORDER BY position, created_at')
    .all(eventTypeId)) as CalendarWorkflowStepRow[];
  return rows.map(toStep);
}

export async function hasWorkflowSteps(eventTypeId: string): Promise<boolean> {
  return !!(await getDb()
    .prepare('SELECT 1 AS one FROM calendar_workflow_steps WHERE event_type_id = ? LIMIT 1')
    .get(eventTypeId));
}

/**
 * Reemplaza los pasos del tipo de evento y reprograma las corridas
 * pendientes de sus reservas confirmadas que todavía no pasaron.
 */
export async function setWorkflowSteps(
  userId: string,
  eventTypeId: string,
  steps: WorkflowStepPayload[],
  now = new Date(),
): Promise<WorkflowStep[] | null> {
  if (!(await ownsEventType(userId, eventTypeId))) return null;
  const db = getDb();
  // Los pasos se reemplazan enteros: sus corridas (pendientes y enviadas) se
  // borran con ellos y las pendientes se vuelven a programar abajo. Un paso
  // que ya se envió para una reserva puede volver a salir si cambió.
  await db
    .prepare(
      `DELETE FROM calendar_workflow_runs WHERE step_id IN (
         SELECT id FROM calendar_workflow_steps WHERE event_type_id = ?)`,
    )
    .run(eventTypeId);
  await db.prepare('DELETE FROM calendar_workflow_steps WHERE event_type_id = ?').run(eventTypeId);
  const ins = db.prepare(
    `INSERT INTO calendar_workflow_steps (id, event_type_id, position, recipient, offset_min, subject, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await ins.run(crypto.randomUUID(), eventTypeId, i, s.recipient, s.offsetMin, s.subject, s.body);
  }
  if (steps.length > 0) {
    // El recordatorio fijo de 24h queda reemplazado por los pasos.
    await db
      .prepare(
        `DELETE FROM calendar_reminders WHERE sent_at IS NULL AND booking_id IN (
           SELECT id FROM calendar_bookings WHERE event_type_id = ?)`,
      )
      .run(eventTypeId);
    const upcoming = (await db
      .prepare(
        `SELECT id FROM calendar_bookings WHERE event_type_id = ? AND status = 'confirmed' AND starts_at >= ?`,
      )
      .all(eventTypeId, new Date(now.getTime() - 30 * 86_400_000).toISOString())) as Array<{ id: string }>;
    for (const b of upcoming) await scheduleWorkflowRuns(b.id, now);
  } else {
    // Sin pasos vuelve el recordatorio fijo de 24h (lo mismo que
    // scheduleBookingReminder) para las reservas confirmadas que todavía no
    // lo tienen y a las que les falta más de un día.
    const upcoming = (await db
      .prepare(
        `SELECT b.id, b.starts_at FROM calendar_bookings b
         WHERE b.event_type_id = ? AND b.status = 'confirmed' AND b.starts_at > ?
           AND NOT EXISTS (SELECT 1 FROM calendar_reminders r WHERE r.booking_id = b.id AND r.kind = 'reminder_24h')`,
      )
      .all(eventTypeId, new Date(now.getTime() + REMINDER_24H_MS).toISOString())) as Array<{ id: string; starts_at: string }>;
    const ins = db.prepare(
      `INSERT INTO calendar_reminders (id, booking_id, kind, send_at) VALUES (?, ?, 'reminder_24h', ?)`,
    );
    for (const b of upcoming) {
      await ins.run(crypto.randomUUID(), b.id, new Date(new Date(b.starts_at).getTime() - REMINDER_24H_MS).toISOString());
    }
  }
  return listWorkflowSteps(userId, eventTypeId);
}

// ---------- Programación ----------

/** Momento de envío de cada paso para una reunión que empieza en `start`; descarta los que ya pasaron. */
export function computeRunTimes(
  start: Date,
  steps: Array<Pick<WorkflowStep, 'id' | 'offsetMin'>>,
  now = new Date(),
): Array<{ stepId: string; sendAt: Date }> {
  return steps
    .map((s) => ({ stepId: s.id, sendAt: new Date(start.getTime() + s.offsetMin * 60_000) }))
    .filter((r) => r.sendAt.getTime() > now.getTime());
}

/** Programa las corridas de una reserva confirmada (idempotente por paso). */
export async function scheduleWorkflowRuns(bookingId: string, now = new Date()): Promise<number> {
  const booking = (await getDb()
    .prepare("SELECT event_type_id, starts_at FROM calendar_bookings WHERE id = ? AND status = 'confirmed'")
    .get(bookingId)) as { event_type_id: string; starts_at: string } | undefined;
  if (!booking) return 0;
  const steps = (await getDb()
    .prepare('SELECT * FROM calendar_workflow_steps WHERE event_type_id = ? ORDER BY position')
    .all(booking.event_type_id)) as CalendarWorkflowStepRow[];
  const runs = computeRunTimes(new Date(booking.starts_at), steps.map(toStep), now);
  const ins = getDb().prepare(
    'INSERT OR IGNORE INTO calendar_workflow_runs (id, step_id, booking_id, send_at) VALUES (?, ?, ?, ?)',
  );
  for (const r of runs) await ins.run(crypto.randomUUID(), r.stepId, bookingId, r.sendAt.toISOString());
  return runs.length;
}

export async function clearPendingWorkflowRuns(bookingId: string): Promise<void> {
  await getDb().prepare('DELETE FROM calendar_workflow_runs WHERE booking_id = ? AND sent_at IS NULL').run(bookingId);
}

/** Borra todas las corridas (también las enviadas): al reprogramar, cada paso vuelve a salir para la fecha nueva. */
export async function clearWorkflowRuns(bookingId: string): Promise<void> {
  await getDb().prepare('DELETE FROM calendar_workflow_runs WHERE booking_id = ?').run(bookingId);
}

// ---------- Plantillas ----------

export const WORKFLOW_VARIABLES = [
  'guest.name',
  'guest.email',
  'host.name',
  'event.title',
  'start',
  'link',
  'manage',
] as const;

/** Reemplaza {{variable}}; las desconocidas quedan como están para que se note el error. */
export function renderWorkflowTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z.]+)\s*\}\}/gi, (whole, key: string) => (key in vars ? vars[key] : whole));
}

// ---------- Despacho (cron) ----------

interface DueRunRow {
  id: string;
  booking_id: string;
  recipient: 'guest' | 'host';
  subject: string;
  body: string;
  invitee_name: string;
  invitee_email: string;
  starts_at: string;
  timezone: string;
  locale: string;
  manage_token: string | null;
  meeting_url: string | null;
  host_user_id: string | null;
  owner_id: string;
  event_title: string;
  event_location: string;
  brand_color: string | null;
  logo_url: string | null;
  host_timezone: string | null;
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export async function processDueWorkflowRuns(
  now = new Date(),
  limit = 100,
): Promise<{ total: number; sent: number; failed: number }> {
  const due = (await getDb()
    .prepare(
      `SELECT r.id, r.booking_id, s.recipient, s.subject, s.body,
              b.invitee_name, b.invitee_email, b.starts_at, b.timezone, b.locale, b.manage_token, b.meeting_url, b.host_user_id,
              e.user_id AS owner_id, e.title AS event_title, e.location AS event_location, e.brand_color, e.logo_url,
              cu.timezone AS host_timezone
       FROM calendar_workflow_runs r
       JOIN calendar_workflow_steps s ON s.id = r.step_id
       JOIN calendar_bookings b ON b.id = r.booking_id
       JOIN calendar_event_types e ON e.id = b.event_type_id
       LEFT JOIN calendar_users cu ON cu.user_id = COALESCE(b.host_user_id, e.user_id)
       WHERE r.sent_at IS NULL AND r.send_at <= ? AND b.status = 'confirmed'
       ORDER BY r.send_at ASC
       LIMIT ?`,
    )
    .all(now.toISOString(), limit)) as DueRunRow[];

  let sent = 0;
  let failed = 0;
  for (const run of due) {
    const host = await getUserById(run.host_user_id ?? run.owner_id);
    const toGuest = run.recipient === 'guest';
    const to = toGuest ? run.invitee_email : host?.email;
    if (!to) {
      await markRunSent(run.id);
      continue;
    }
    const tz = toGuest ? run.timezone : (run.host_timezone ?? run.timezone);
    const lang = run.locale === 'es' || run.locale === 'pt' ? run.locale : 'en';
    const manage = run.manage_token ? `${baseUrl()}/${lang}/book/manage/${run.manage_token}` : '';
    const vars: Record<string, string> = {
      'guest.name': run.invitee_name,
      'guest.email': run.invitee_email,
      'host.name': host?.name ?? host?.email ?? '',
      'event.title': run.event_title,
      start: `${formatWhen(new Date(run.starts_at), tz, lang)} (${tz})`,
      link: run.meeting_url || run.event_location || (toGuest ? manage : ''),
      // El link de gestión es la credencial del invitado: no va al anfitrión.
      manage: toGuest ? manage : '',
    };
    const subject = renderWorkflowTemplate(run.subject, vars).replace(/[\r\n]+/g, ' ');
    const text = renderWorkflowTemplate(run.body, vars);
    const htmlVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));
    const paragraphs = renderWorkflowTemplate(escapeHtml(run.body), htmlVars)
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, '<br>'));
    const res = await sendEmail({
      to,
      subject,
      text,
      html: renderBrandedHtml({
        heading: subject,
        paragraphs,
        brandColor: toGuest ? run.brand_color : null,
        logoUrl: toGuest ? run.logo_url : null,
      }),
    });
    if (res.ok) {
      await markRunSent(run.id);
      sent += 1;
    } else {
      failed += 1;
    }
  }
  return { total: due.length, sent, failed };
}

async function markRunSent(id: string): Promise<void> {
  await getDb().prepare('UPDATE calendar_workflow_runs SET sent_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
