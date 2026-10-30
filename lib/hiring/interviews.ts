/**
 * Hiring: entrevistas con Cal. Cada entrevista crea su propio tipo de evento
 * de Cal: secreto (oculto del perfil), de un solo uso y colectivo, con los
 * evaluadores de esa postulación como anfitriones. El link de auto-agenda
 * solo ofrece horarios en que están todos libres y no lleva datos del
 * candidato en la URL (el slug es aleatorio). Cal manda la confirmación con la
 * invitación al calendario y los recordatorios. Como el tipo de evento es de
 * esa entrevista, su reserva es la del candidato (syncInterviews). Server-only.
 */
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db';
import { createEventType } from '../calendar';
import type { EventTypeCreatePayload } from '../calendar-schema';
import { HiringError, type HiringActor } from './types';
import { appBase, ensureSettings, listStages, newId, nowIso, stageDto } from './core';
import { addEvent } from './events';
import { personName, requireManageApp } from './candidates';
import { resolveTemplate, sendCandidateEmail } from './comms';

export const scheduleSchema = z.object({
  stageId: z.string().max(80).optional(),
  durationMin: z.number().int().min(15).max(240).default(45),
  sendEmail: z.boolean().default(true),
  templateId: z.string().max(80).nullable().default(null),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

export interface InterviewDto {
  id: string;
  stageId: string;
  status: 'invited' | 'scheduled' | 'cancelled';
  startsAt: string | null;
  endsAt: string | null;
  link: string | null;
  createdAt: string;
}

async function ownerHandle(ws: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(ws)) as { handle: string | null } | undefined;
  return row?.handle ?? null;
}

function bookingLink(handle: string, slug: string, locale: string): string {
  return `${appBase()}/${locale}/book/${handle}/${slug}`;
}

/**
 * Link de auto-agenda para el candidato (y el email de invitación, si se
 * pide). Los anfitriones son los evaluadores de la etapa o, si no hay, los
 * interviewers del puesto.
 */
export async function createSchedulingLink(actor: HiringActor, appId: string, input: z.infer<typeof scheduleSchema>): Promise<{ interview: InterviewDto; link: string }> {
  const { app, job, candidate } = await requireManageApp(actor, appId);
  const db = getDb();
  const stages = await listStages(job.id);
  const stage = stages.find((s) => s.id === (input.stageId ?? app.stage_id));
  if (!stage) throw new HiringError('invalid_stage');
  const handle = await ownerHandle(actor.ws);
  if (!handle) throw new HiringError('cal_handle_missing', 409);
  const evaluators = ((await db.prepare('SELECT user_id FROM hiring_evaluators WHERE application_id = ? AND stage_id = ?').all(app.id, stage.id)) as Array<{ user_id: string }>).map((r) => r.user_id);
  const interviewers = evaluators.length
    ? evaluators
    : ((await db.prepare("SELECT user_id FROM hiring_job_members WHERE job_id = ? AND role IN ('interviewer','hiring_manager')").all(job.id)) as Array<{ user_id: string }>).map((r) => r.user_id);
  const hosts = interviewers.length ? interviewers : [actor.person];

  const payload = {
    slug: `interview-${randomBytes(8).toString('hex')}`,
    title: `${stage.name}: ${job.title}`.slice(0, 120),
    durationMin: input.durationMin,
    hidden: true,
    active: true,
    singleUse: true,
    scheduling: 'collective',
    hostIds: hosts,
    description: '',
  } as unknown as EventTypeCreatePayload;
  let eventType;
  try {
    eventType = await createEventType(actor.ws, payload);
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw new HiringError(`cal_${String((err as { code: string }).code)}`, 400);
    throw err;
  }

  const settings = await ensureSettings(actor.ws);
  const locale = input.locale ?? settings.locale;
  const link = bookingLink(handle, eventType.slug, locale);
  const id = newId('hiv');
  await db
    .prepare("INSERT INTO hiring_interviews (id, application_id, stage_id, event_type_id, status, created_by, created_at) VALUES (?, ?, ?, ?, 'invited', ?, ?)")
    .run(id, app.id, stage.id, eventType.id, actor.person, nowIso());
  await addEvent(actor.ws, candidate.id, app.id, 'interview', actor.person, { status: 'invited', stage: stage.name });
  if (input.sendEmail) {
    const tpl = await resolveTemplate(actor.ws, 'interview', settings, input.templateId);
    await sendCandidateEmail(actor.ws, { candidate, job, applicationId: app.id, senderName: await personName(actor.person), extra: { schedulingLink: link } }, tpl, actor.person, { kind: 'interview' });
  }
  return { interview: { id, stageId: stage.id, status: 'invited', startsAt: null, endsAt: null, link, createdAt: nowIso() }, link };
}

/** Busca en Cal la reserva del candidato para cada invitación abierta y actualiza horario y estado. */
export async function syncInterviews(ws: string, appId?: string): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT i.id, i.application_id, i.event_type_id, i.booking_id, i.status, i.starts_at, i.created_at, i.stage_id, c.email, c.id AS candidate_id
       FROM hiring_interviews i JOIN hiring_applications a ON a.id = i.application_id JOIN hiring_candidates c ON c.id = a.candidate_id
       WHERE a.workspace_id = ? ${appId ? 'AND i.application_id = ?' : ''} AND i.status != 'cancelled' ORDER BY i.created_at DESC LIMIT 200`,
    )
    .all(...(appId ? [ws, appId] : [ws]))) as Array<Record<string, string | null>>;
  let changed = 0;
  for (const r of rows) {
    const booking = (await db
      .prepare(
        r.booking_id
          ? 'SELECT id, starts_at, ends_at, status FROM calendar_bookings WHERE id = ?'
          : `SELECT id, starts_at, ends_at, status FROM calendar_bookings WHERE event_type_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(...(r.booking_id ? [r.booking_id] : [r.event_type_id!]))) as
      | { id: string; starts_at: string; ends_at: string; status: string }
      | undefined;
    if (!booking) continue;
    const status = booking.status === 'cancelled' ? 'cancelled' : 'scheduled';
    if (r.booking_id === booking.id && r.status === status && r.starts_at === booking.starts_at) continue;
    const res = await db
      .prepare('UPDATE hiring_interviews SET booking_id = ?, starts_at = ?, ends_at = ?, status = ? WHERE id = ? AND (booking_id IS NULL OR booking_id = ?)')
      .run(booking.id, booking.starts_at, booking.ends_at, status, r.id, booking.id);
    if (!res.changes) continue;
    changed++;
    const stage = (await db.prepare('SELECT name FROM hiring_stages WHERE id = ?').get(r.stage_id)) as { name: string } | undefined;
    await addEvent(ws, String(r.candidate_id), String(r.application_id), 'interview', null, { status, stage: stage?.name ?? '', startsAt: booking.starts_at });
  }
  return changed;
}

/** Entrevistas de una postulación (con el link de auto-agenda mientras no esté reservada). */
export async function listInterviews(ws: string, appId: string): Promise<InterviewDto[]> {
  await syncInterviews(ws, appId).catch(() => 0);
  const db = getDb();
  const handle = await ownerHandle(ws);
  const settings = await ensureSettings(ws);
  const rows = (await db
    .prepare('SELECT i.*, t.slug FROM hiring_interviews i LEFT JOIN calendar_event_types t ON t.id = i.event_type_id WHERE i.application_id = ? ORDER BY i.created_at DESC')
    .all(appId)) as Array<Record<string, string | null>>;
  return rows.map((r) => ({
    id: String(r.id),
    stageId: String(r.stage_id),
    status: (r.status as InterviewDto['status']) ?? 'invited',
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    link: r.status === 'invited' && handle && r.slug ? bookingLink(handle, r.slug, settings.locale) : null,
    createdAt: String(r.created_at),
  }));
}

export async function syncAllInterviews(limitWorkspaces = 50): Promise<number> {
  const rows = (await getDb()
    .prepare("SELECT DISTINCT a.workspace_id FROM hiring_interviews i JOIN hiring_applications a ON a.id = i.application_id WHERE i.status = 'invited' LIMIT ?")
    .all(limitWorkspaces)) as Array<{ workspace_id: string }>;
  let n = 0;
  for (const r of rows) n += await syncInterviews(r.workspace_id).catch(() => 0);
  return n;
}

export { stageDto };
