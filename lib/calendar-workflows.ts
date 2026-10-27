/**
 * Cal — workflows por tipo de evento (como los de Calendly y Cal.com). Cada
 * paso tiene:
 *
 * - disparador (`trigger`): relativo al inicio (`start`, offset < 0 = antes,
 *   > 0 = después), relativo al fin (`end`, solo después), o un hecho de la
 *   reserva: `booked` (al confirmarse), `cancelled`, `rescheduled` y
 *   `no_show`, con una demora opcional (offset ≥ 0);
 * - canal (`channel`): email al invitado o al anfitrión, SMS (Twilio del
 *   workspace, lib/calendar-sms.ts) o webhook (POST JSON a una URL pública);
 * - asunto y cuerpo con variables ({{guest.name}}, {{event.title}}, {{start}},
 *   {{link}}, {{manage}}, {{reconfirm}}…).
 *
 * Por reserva se programa una corrida por paso (calendar_workflow_runs): los
 * relativos al inicio y al fin al confirmarse, los de un hecho cuando pasa.
 * El cron (/api/calendar/reminders/due, dentro de /api/cron/minute) despacha
 * las vencidas; cada corrida se reclama con un UPDATE condicional sobre
 * sent_at, así dos crons a la vez no la mandan dos veces. Este módulo solo
 * importa db/email/sms para no crear ciclos con lib/calendar.ts.
 */
import { getDb, getUserById, type CalendarWorkflowStepRow } from './db';
import { escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import { safeFetch } from './safe-fetch';
import { sendCalSms } from './calendar-sms';
import type { WorkflowStepPayload } from './calendar-schema';

export const WORKFLOW_TRIGGERS = ['start', 'end', 'booked', 'cancelled', 'rescheduled', 'no_show'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];
export const WORKFLOW_CHANNELS = ['email', 'sms', 'webhook'] as const;
export type WorkflowChannel = (typeof WORKFLOW_CHANNELS)[number];

/** Disparadores que son un hecho de la reserva (la corrida se programa cuando pasa). */
export const EVENT_TRIGGERS: ReadonlySet<WorkflowTrigger> = new Set(['booked', 'cancelled', 'rescheduled', 'no_show']);

export interface WorkflowStep {
  id: string;
  trigger: WorkflowTrigger;
  channel: WorkflowChannel;
  recipient: 'guest' | 'host';
  offsetMin: number;
  subject: string;
  body: string;
  /** URL del webhook ('' en email y SMS). */
  target: string;
}

function asTrigger(v: string | null | undefined): WorkflowTrigger {
  return (WORKFLOW_TRIGGERS as readonly string[]).includes(v ?? '') ? (v as WorkflowTrigger) : 'start';
}

function asChannel(v: string | null | undefined): WorkflowChannel {
  return (WORKFLOW_CHANNELS as readonly string[]).includes(v ?? '') ? (v as WorkflowChannel) : 'email';
}

function toStep(r: CalendarWorkflowStepRow): WorkflowStep {
  return {
    id: r.id,
    trigger: asTrigger(r.trigger),
    channel: asChannel(r.channel),
    recipient: r.recipient,
    offsetMin: r.offset_min,
    subject: r.subject,
    body: r.body,
    target: r.target ?? '',
  };
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

/**
 * El evento tiene recordatorios propios (pasos relativos al inicio o al fin):
 * reemplazan al recordatorio fijo de 24 h. Un paso de "al reservar" o "al
 * cancelar" solo no lo saca.
 */
export async function hasWorkflowSteps(eventTypeId: string): Promise<boolean> {
  return !!(await getDb()
    .prepare("SELECT 1 AS one FROM calendar_workflow_steps WHERE event_type_id = ? AND trigger IN ('start', 'end') LIMIT 1")
    .get(eventTypeId));
}

/** Pasos a guardar: normaliza lo que no aplica a su canal o disparador. */
export function normalizeSteps(steps: WorkflowStepPayload[]): Array<Omit<WorkflowStep, 'id'>> {
  return steps.map((s) => {
    const trigger = s.trigger ?? 'start';
    const channel = s.channel ?? 'email';
    return {
      trigger,
      channel,
      // Un webhook no tiene destinatario: se guarda como del anfitrión.
      recipient: channel === 'webhook' ? 'host' : s.recipient,
      // Fin y hechos de la reserva: solo hacia adelante.
      offsetMin: trigger === 'start' ? s.offsetMin : Math.max(0, s.offsetMin),
      subject: channel === 'email' ? s.subject : '',
      body: channel === 'webhook' ? '' : s.body,
      target: channel === 'webhook' ? (s.target ?? '') : '',
    };
  });
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
    `INSERT INTO calendar_workflow_steps (id, event_type_id, position, recipient, offset_min, subject, body, trigger, channel, target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const clean = normalizeSteps(steps);
  for (let i = 0; i < clean.length; i++) {
    const s = clean[i];
    await ins.run(crypto.randomUUID(), eventTypeId, i, s.recipient, s.offsetMin, s.subject, s.body, s.trigger, s.channel, s.target);
  }
  if (await hasWorkflowSteps(eventTypeId)) {
    // El recordatorio fijo de 24h queda reemplazado por los pasos.
    await db
      .prepare(
        `DELETE FROM calendar_reminders WHERE sent_at IS NULL AND booking_id IN (
           SELECT id FROM calendar_bookings WHERE event_type_id = ?)`,
      )
      .run(eventTypeId);
  } else {
    // Sin recordatorios propios vuelve el fijo de 24h (lo mismo que
    // scheduleBookingReminder) para las reservas confirmadas que todavía no
    // lo tienen y a las que les falta más de un día.
    const upcoming = (await db
      .prepare(
        `SELECT b.id, b.starts_at FROM calendar_bookings b
         WHERE b.event_type_id = ? AND b.status = 'confirmed' AND b.starts_at > ?
           AND NOT EXISTS (SELECT 1 FROM calendar_reminders r WHERE r.booking_id = b.id AND r.kind = 'reminder_24h')`,
      )
      .all(eventTypeId, new Date(now.getTime() + REMINDER_24H_MS).toISOString())) as Array<{ id: string; starts_at: string }>;
    const insReminder = db.prepare(
      `INSERT INTO calendar_reminders (id, booking_id, kind, send_at) VALUES (?, ?, 'reminder_24h', ?)`,
    );
    for (const b of upcoming) {
      await insReminder.run(crypto.randomUUID(), b.id, new Date(new Date(b.starts_at).getTime() - REMINDER_24H_MS).toISOString());
    }
  }
  if (clean.length > 0) {
    const upcoming = (await db
      .prepare(
        `SELECT id FROM calendar_bookings WHERE event_type_id = ? AND status = 'confirmed' AND starts_at >= ?`,
      )
      .all(eventTypeId, new Date(now.getTime() - 30 * 86_400_000).toISOString())) as Array<{ id: string }>;
    for (const b of upcoming) await scheduleWorkflowRuns(b.id, now);
  }
  return listWorkflowSteps(userId, eventTypeId);
}

// ---------- Programación ----------

/**
 * Momento de envío de cada paso relativo al inicio o al fin de una reunión;
 * descarta los que ya pasaron y los de hechos de la reserva.
 */
export function computeRunTimes(
  start: Date,
  steps: Array<Pick<WorkflowStep, 'id' | 'offsetMin'> & { trigger?: WorkflowTrigger }>,
  now = new Date(),
  end?: Date,
): Array<{ stepId: string; sendAt: Date }> {
  return steps
    .filter((s) => (s.trigger ?? 'start') === 'start' || (s.trigger === 'end' && end))
    .map((s) => {
      const base = s.trigger === 'end' && end ? end : start;
      return { stepId: s.id, sendAt: new Date(base.getTime() + s.offsetMin * 60_000) };
    })
    .filter((r) => r.sendAt.getTime() > now.getTime());
}

/** Programa las corridas relativas al inicio y al fin de una reserva confirmada (idempotente por paso). */
export async function scheduleWorkflowRuns(bookingId: string, now = new Date()): Promise<number> {
  const booking = (await getDb()
    .prepare("SELECT event_type_id, starts_at, ends_at FROM calendar_bookings WHERE id = ? AND status = 'confirmed'")
    .get(bookingId)) as { event_type_id: string; starts_at: string; ends_at: string } | undefined;
  if (!booking) return 0;
  const steps = (await getDb()
    .prepare('SELECT * FROM calendar_workflow_steps WHERE event_type_id = ? ORDER BY position')
    .all(booking.event_type_id)) as CalendarWorkflowStepRow[];
  const runs = computeRunTimes(new Date(booking.starts_at), steps.map(toStep), now, new Date(booking.ends_at));
  const ins = getDb().prepare(
    'INSERT OR IGNORE INTO calendar_workflow_runs (id, step_id, booking_id, send_at) VALUES (?, ?, ?, ?)',
  );
  for (const r of runs) await ins.run(crypto.randomUUID(), r.stepId, bookingId, r.sendAt.toISOString());
  return runs.length;
}

/**
 * Pasó algo con la reserva (se confirmó, se canceló, se reprogramó o el
 * invitado no vino): programa los pasos de ese disparador, ahora + su demora.
 * Una reprogramación borra antes las corridas (clearWorkflowRuns), así cada
 * vez que se mueve vuelve a avisar.
 */
export async function scheduleTriggeredRuns(bookingId: string, trigger: WorkflowTrigger, now = new Date()): Promise<number> {
  if (!EVENT_TRIGGERS.has(trigger)) return 0;
  const booking = (await getDb().prepare('SELECT event_type_id FROM calendar_bookings WHERE id = ?').get(bookingId)) as
    | { event_type_id: string }
    | undefined;
  if (!booking) return 0;
  const steps = (await getDb()
    .prepare('SELECT * FROM calendar_workflow_steps WHERE event_type_id = ? AND trigger = ? ORDER BY position')
    .all(booking.event_type_id, trigger)) as CalendarWorkflowStepRow[];
  const ins = getDb().prepare(
    'INSERT OR IGNORE INTO calendar_workflow_runs (id, step_id, booking_id, send_at) VALUES (?, ?, ?, ?)',
  );
  for (const s of steps) {
    await ins.run(crypto.randomUUID(), s.id, bookingId, new Date(now.getTime() + Math.max(0, s.offset_min) * 60_000).toISOString());
  }
  return steps.length;
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
  'guest.phone',
  'host.name',
  'event.title',
  'start',
  'end',
  'link',
  'manage',
  'reconfirm',
  'cancel_reason',
] as const;

/** Reemplaza {{variable}}; las desconocidas quedan como están para que se note el error. */
export function renderWorkflowTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z._]+)\s*\}\}/gi, (whole, key: string) => (key in vars ? vars[key] : whole));
}

/**
 * Teléfono del invitado para un SMS: el que dejó para que lo llamen o, si
 * no, la primera respuesta que parece un teléfono internacional (+…).
 */
export function guestPhone(booking: { location_kind: string; location: string; answers: string }): string {
  if (booking.location_kind === 'phone_host' && booking.location) return booking.location;
  try {
    const answers = JSON.parse(booking.answers || '{}') as Record<string, unknown>;
    for (const v of Object.values(answers)) {
      if (typeof v === 'string' && /^\+[0-9 ().-]{6,32}$/.test(v.trim())) return v.trim();
    }
  } catch {
    // Respuestas rotas: sin teléfono.
  }
  return '';
}

// ---------- Despacho (cron) ----------

interface DueRunRow {
  id: string;
  booking_id: string;
  send_at: string;
  trigger: string;
  channel: string;
  target: string;
  recipient: 'guest' | 'host';
  subject: string;
  body: string;
  invitee_name: string;
  invitee_email: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  locale: string;
  status: string;
  cancel_reason: string | null;
  manage_token: string | null;
  meeting_url: string | null;
  host_user_id: string | null;
  location_kind: string;
  location: string;
  answers: string;
  owner_id: string;
  event_type_id: string;
  event_slug: string;
  event_title: string;
  event_location: string;
  brand_color: string | null;
  logo_url: string | null;
  host_timezone: string | null;
  host_conferencing: string | null;
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/**
 * Si un paso vencido todavía tiene sentido. Un paso "antes" que el cron
 * levanta tarde (el envío se atrasó unos minutos) sale igual mientras la
 * reunión no haya empezado; solo se descarta si ya empezó. Los pasos
 * "después" y los de hechos de la reserva salen siempre.
 */
export function shouldSendWorkflowRun(run: { send_at: string; starts_at: string; trigger?: string }, now: Date): boolean {
  if (run.trigger && run.trigger !== 'start') return true;
  const start = Date.parse(run.starts_at);
  const isBefore = Date.parse(run.send_at) < start;
  return !isBefore || now.getTime() < start;
}

/** El estado en que tiene que estar la reserva para que su paso salga. */
const STATUS_FOR_TRIGGER = `(
  (s.trigger IN ('start', 'end', 'booked', 'rescheduled') AND b.status = 'confirmed')
  OR (s.trigger = 'cancelled' AND b.status = 'cancelled')
  OR (s.trigger = 'no_show' AND b.status = 'no_show')
)`;

type SendOutcome = 'sent' | 'failed' | 'skipped';

export async function processDueWorkflowRuns(
  now = new Date(),
  limit = 100,
): Promise<{ total: number; sent: number; failed: number; skipped: number }> {
  const due = (await getDb()
    .prepare(
      `SELECT r.id, r.booking_id, r.send_at, s.trigger, s.channel, s.target, s.recipient, s.subject, s.body,
              b.invitee_name, b.invitee_email, b.starts_at, b.ends_at, b.timezone, b.locale, b.status, b.cancel_reason,
              b.manage_token, b.meeting_url, b.host_user_id, b.location_kind, b.location, b.answers,
              e.user_id AS owner_id, e.id AS event_type_id, e.slug AS event_slug, e.title AS event_title,
              COALESCE(NULLIF(b.location, ''), e.location) AS event_location, e.brand_color, e.logo_url,
              cu.timezone AS host_timezone, cu.conferencing AS host_conferencing
       FROM calendar_workflow_runs r
       JOIN calendar_workflow_steps s ON s.id = r.step_id
       JOIN calendar_bookings b ON b.id = r.booking_id
       JOIN calendar_event_types e ON e.id = b.event_type_id
       LEFT JOIN calendar_users cu ON cu.user_id = COALESCE(b.host_user_id, e.user_id)
       WHERE r.sent_at IS NULL AND r.failed_at IS NULL AND r.send_at <= ? AND ${STATUS_FOR_TRIGGER}
       ORDER BY r.attempts ASC, r.send_at ASC
       LIMIT ?`,
    )
    .all(now.toISOString(), limit)) as DueRunRow[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const run of due) {
    // Se reclama antes de mandar: si otro cron ya la tomó, se sigue de largo.
    if (!(await claimRun(run.id))) continue;
    if (!shouldSendWorkflowRun(run, now)) {
      skipped += 1;
      continue;
    }
    const outcome = await dispatchRun(run).catch((): SendOutcome => 'failed');
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'skipped') skipped += 1;
    else {
      await markRunFailed(run.id);
      failed += 1;
    }
  }
  return { total: due.length, sent, failed, skipped };
}

async function dispatchRun(run: DueRunRow): Promise<SendOutcome> {
  const host = await getUserById(run.host_user_id ?? run.owner_id);
  const toGuest = run.recipient === 'guest';
  const tz = toGuest ? run.timezone : (run.host_timezone ?? run.timezone);
  const lang = run.locale === 'es' || run.locale === 'pt' ? run.locale : 'en';
  const manage = run.manage_token ? `${baseUrl()}/${lang}/book/manage/${run.manage_token}` : '';
  const phone = guestPhone(run);
  const vars: Record<string, string> = {
    'guest.name': run.invitee_name,
    'guest.email': run.invitee_email,
    'guest.phone': phone,
    'host.name': host?.name ?? host?.email ?? '',
    'event.title': run.event_title,
    start: `${formatWhen(new Date(run.starts_at), tz, lang)} (${tz})`,
    end: `${formatWhen(new Date(run.ends_at), tz, lang)} (${tz})`,
    link: run.meeting_url || run.event_location || (toGuest ? manage : ''),
    // El link de gestión es la credencial del invitado: no va al anfitrión.
    manage: toGuest ? manage : '',
    reconfirm: toGuest && manage ? `${manage}?reconfirm=1` : '',
    cancel_reason: run.cancel_reason ?? '',
  };

  if (run.channel === 'webhook') return dispatchWebhook(run, vars);

  if (run.channel === 'sms') {
    let to = toGuest ? phone : '';
    if (!toGuest) {
      try {
        to = String((JSON.parse(run.host_conferencing || '{}') as { phone?: string }).phone ?? '');
      } catch {
        to = '';
      }
    }
    // Sin teléfono (o sin Twilio) no hay a quién mandarlo: se saltea sin reintentar.
    if (!to) return 'skipped';
    const res = await sendCalSms(run.owner_id, to, renderWorkflowTemplate(run.body, vars));
    if (res.ok) return 'sent';
    return res.retry ? 'failed' : 'skipped';
  }

  const to = toGuest ? run.invitee_email : host?.email;
  if (!to) return 'skipped';
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
  return res.ok ? 'sent' : 'failed';
}

/** Paso webhook: POST JSON con la reserva a una URL pública (sin seguir redirects a otra parte). */
async function dispatchWebhook(run: DueRunRow, vars: Record<string, string>): Promise<SendOutcome> {
  if (!/^https?:\/\//i.test(run.target)) return 'skipped';
  const payload = {
    event: `workflow.${run.trigger}`,
    sentAt: new Date().toISOString(),
    booking: {
      id: run.booking_id,
      status: run.status,
      startsAt: run.starts_at,
      endsAt: run.ends_at,
      timezone: run.timezone,
      invitee: { name: run.invitee_name, email: run.invitee_email, phone: vars['guest.phone'] || null },
      meetingUrl: run.meeting_url,
      location: run.location || null,
      cancelReason: run.cancel_reason,
      eventType: { id: run.event_type_id, slug: run.event_slug, title: run.event_title },
    },
  };
  const res = await safeFetch(
    run.target,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'zerosoft-cal-workflows/1.0', 'x-zerosoft-event': payload.event },
      body: JSON.stringify(payload),
    },
    8000,
  ).catch(() => null);
  return res && res.status < 300 ? 'sent' : 'failed';
}

/** Intentos de envío de un paso antes de abandonarlo (falla siempre: email inválido, rechazo del proveedor). */
export const MAX_WORKFLOW_RUN_ATTEMPTS = 5;

/**
 * Suma un intento fallido y libera el claim (sent_at vuelve a NULL) para que
 * el próximo cron lo reintente; al llegar al máximo el paso queda abandonado
 * (failed_at) y deja de reintentarse.
 */
async function markRunFailed(id: string): Promise<void> {
  await getDb()
    .prepare(
      `UPDATE calendar_workflow_runs SET sent_at = NULL, attempts = attempts + 1,
         failed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END
       WHERE id = ?`,
    )
    .run(MAX_WORKFLOW_RUN_ATTEMPTS, new Date().toISOString(), id);
}

/** Compare-and-set sobre sent_at: true solo para quien tomó la corrida. */
async function claimRun(id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE calendar_workflow_runs SET sent_at = ? WHERE id = ? AND sent_at IS NULL')
    .run(new Date().toISOString(), id);
  return res.changes === 1;
}
