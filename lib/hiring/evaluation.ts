/**
 * Hiring: scorecards por etapa (criterios con nota de 1 a 4 y una
 * recomendación), evaluadores asignados y recordatorios de feedback.
 * Server-only.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { sendEmail, appSender } from '../email';
import { HiringError, OVERALL, RATING_MAX, RATING_MIN, type HiringActor } from './types';
import { appBase, listStages, newId, nowIso, stageDto } from './core';
import { addEvent, notifyTeam } from './events';
import { requireManageApp, requireVisibleApp } from './candidates';

export const scorecardSchema = z.object({
  stageId: z.string().min(1).max(80),
  ratings: z.record(z.string(), z.number().int().min(RATING_MIN).max(RATING_MAX)).default({}),
  overall: z.enum(OVERALL),
  notes: z.string().max(10_000).default(''),
});

/**
 * Envía (o reemplaza) el scorecard de la persona para una etapa. Solo quien
 * está asignado a evaluar o gestiona el puesto. Los criterios tienen que ser
 * los de la etapa.
 */
export async function submitScorecard(actor: HiringActor, appId: string, input: z.infer<typeof scorecardSchema>): Promise<{ id: string }> {
  const { app, access } = await requireVisibleApp(actor, appId);
  const db = getDb();
  const assigned = (await db.prepare('SELECT stage_id FROM hiring_evaluators WHERE application_id = ? AND user_id = ?').get(app.id, actor.person)) as { stage_id: string } | undefined;
  if (!assigned && !access.manage) throw new HiringError('forbidden', 403);
  const stage = (await listStages(app.job_id)).map(stageDto).find((s) => s.id === input.stageId);
  if (!stage) throw new HiringError('invalid_stage');
  if (!stage.criteria.length) throw new HiringError('stage_without_scorecard');
  const valid = new Set(stage.criteria.map((c) => c.id));
  for (const k of Object.keys(input.ratings)) if (!valid.has(k)) throw new HiringError('invalid_criterion');
  const ts = nowIso();
  const existing = (await db.prepare('SELECT id FROM hiring_scorecards WHERE application_id = ? AND stage_id = ? AND user_id = ?').get(app.id, stage.id, actor.person)) as
    | { id: string }
    | undefined;
  const id = existing?.id ?? newId('hsc');
  if (existing) {
    await db.prepare('UPDATE hiring_scorecards SET ratings = ?, overall = ?, notes = ?, submitted_at = ? WHERE id = ?').run(JSON.stringify(input.ratings), input.overall, input.notes, ts, id);
  } else {
    await db
      .prepare('INSERT INTO hiring_scorecards (id, application_id, stage_id, user_id, ratings, overall, notes, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, app.id, stage.id, actor.person, JSON.stringify(input.ratings), input.overall, input.notes, ts);
  }
  await addEvent(actor.ws, app.candidate_id, app.id, 'score', actor.person, { stage: stage.name, overall: input.overall, updated: Boolean(existing) });
  return { id };
}

export const evaluatorsSchema = z.object({ stageId: z.string().min(1).max(80), userIds: z.array(z.string().min(1).max(80)).max(30) });

/** Asigna a mano quién evalúa (personas del equipo del puesto). */
export async function setEvaluators(actor: HiringActor, appId: string, input: z.infer<typeof evaluatorsSchema>): Promise<void> {
  const { app, candidate, job } = await requireManageApp(actor, appId);
  const db = getDb();
  const stages = (await listStages(app.job_id)).map(stageDto);
  const stage = stages.find((s) => s.id === input.stageId);
  if (!stage) throw new HiringError('invalid_stage');
  const team = new Set(((await db.prepare('SELECT user_id FROM hiring_job_members WHERE job_id = ?').all(app.job_id)) as Array<{ user_id: string }>).map((r) => r.user_id));
  for (const u of input.userIds) if (!team.has(u)) throw new HiringError('not_on_team');
  const before = new Set(((await db.prepare('SELECT user_id FROM hiring_evaluators WHERE application_id = ?').all(app.id)) as Array<{ user_id: string }>).map((r) => r.user_id));
  await db.prepare('DELETE FROM hiring_evaluators WHERE application_id = ?').run(app.id);
  const ts = nowIso();
  for (const u of new Set(input.userIds)) {
    await db.prepare('INSERT INTO hiring_evaluators (application_id, user_id, stage_id, requested_at) VALUES (?, ?, ?, ?)').run(app.id, u, stage.id, ts);
  }
  const added = input.userIds.filter((u) => !before.has(u) && u !== actor.person);
  await notifyTeam(added, { title: `${candidate.name} · ${stage.name}`, body: job.title, href: `/app/hiring/candidates/${candidate.id}?app=${app.id}`, sourceId: app.id });
}

export interface PendingEvaluation {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  jobTitle: string;
  stageName: string;
  requestedAt: string;
}

/** Lo que me falta evaluar (inicio de Hiring). */
export async function myPendingEvaluations(actor: HiringActor): Promise<PendingEvaluation[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT e.application_id, e.requested_at, a.candidate_id, c.name AS candidate_name, j.title AS job_title, s.name AS stage_name
       FROM hiring_evaluators e JOIN hiring_applications a ON a.id = e.application_id JOIN hiring_candidates c ON c.id = a.candidate_id
       JOIN hiring_jobs j ON j.id = a.job_id JOIN hiring_stages s ON s.id = e.stage_id
       JOIN hiring_job_members m ON m.job_id = a.job_id AND m.user_id = e.user_id
       WHERE e.user_id = ? AND a.workspace_id = ? AND a.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM hiring_scorecards sc WHERE sc.application_id = e.application_id AND sc.user_id = e.user_id AND sc.stage_id = e.stage_id)
       ORDER BY e.requested_at LIMIT 50`,
    )
    .all(actor.person, actor.ws)) as Array<Record<string, string>>;
  return rows.map((r) => ({
    applicationId: r.application_id,
    candidateId: r.candidate_id,
    candidateName: r.candidate_name,
    jobTitle: r.job_title,
    stageName: r.stage_name,
    requestedAt: r.requested_at,
  }));
}

const REMINDER_AFTER_MS = 24 * 3_600_000;

/**
 * Recordatorio de feedback: a quien tiene un scorecard pendiente hace más de
 * 24 h (o desde que terminó la entrevista agendada), una vez. Se reclama cada
 * fila con compare-and-set en reminded_at. El aviso no lleva datos del
 * candidato fuera de la app: el email dice cuántos faltan y linkea.
 */
export async function sendFeedbackReminders(now = new Date(), limit = 100): Promise<{ reminded: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - REMINDER_AFTER_MS).toISOString();
  const rows = (await db
    .prepare(
      `SELECT e.application_id, e.user_id, e.stage_id, a.candidate_id, c.name AS candidate_name, j.title AS job_title, u.email
       FROM hiring_evaluators e JOIN hiring_applications a ON a.id = e.application_id JOIN hiring_candidates c ON c.id = a.candidate_id
       JOIN hiring_jobs j ON j.id = a.job_id JOIN users u ON u.id = e.user_id
       WHERE e.reminded_at IS NULL AND a.status = 'active' AND e.requested_at < ?
         AND NOT EXISTS (SELECT 1 FROM hiring_interviews i WHERE i.application_id = e.application_id AND i.stage_id = e.stage_id AND i.ends_at IS NOT NULL AND i.ends_at > ?)
         AND NOT EXISTS (SELECT 1 FROM hiring_scorecards sc WHERE sc.application_id = e.application_id AND sc.user_id = e.user_id AND sc.stage_id = e.stage_id)
       LIMIT ?`,
    )
    .all(cutoff, now.toISOString(), limit)) as Array<Record<string, string>>;
  let reminded = 0;
  for (const r of rows) {
    const claim = await db.prepare('UPDATE hiring_evaluators SET reminded_at = ? WHERE application_id = ? AND user_id = ? AND reminded_at IS NULL').run(now.toISOString(), r.application_id, r.user_id);
    if (!claim.changes) continue;
    const href = `/app/hiring/candidates/${r.candidate_id}?app=${r.application_id}`;
    await notifyTeam([r.user_id], { title: `${r.candidate_name} · ${r.job_title}`, body: 'scorecard', href, sourceId: r.application_id });
    await sendEmail({
      to: r.email,
      from: appSender(),
      subject: 'A scorecard is waiting for your feedback',
      text: `You have a scorecard to submit in Hiring.\n\nOpen it: ${appBase()}/en${href}`,
    }).catch(() => null);
    reminded++;
  }
  return { reminded };
}
