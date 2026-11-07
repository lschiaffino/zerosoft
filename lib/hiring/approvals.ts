/**
 * Hiring: cadenas de aprobación (puestos y ofertas). Pasos en orden: solo la
 * persona del paso actual puede decidir, y solo a ella se le avisa. Un rechazo
 * corta la cadena; volver a pedir arranca de cero. Las reglas puras están en
 * currentStep y chainState (tests/unit/hiring-extras.test.ts). Server-only.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { localized } from '../notification-copy';
import { ensureSettings, getJobRow, getSettings, newId, nowIso, parseJson, requireManage, type SettingsRow } from './core';
import { listOwnerSpacePeople } from '../workspace';
import { notifyTeam } from './events';
import { HiringError, type HiringActor } from './types';

export type ApprovalSubject = 'job' | 'offer';
export type StepStatus = 'pending' | 'approved' | 'rejected' | 'skipped';

export interface ApprovalStep {
  id: string;
  position: number;
  userId: string;
  name: string;
  status: StepStatus;
  note: string;
  decidedAt: string | null;
}

export type ChainState = 'none' | 'pending' | 'approved' | 'rejected';

export function chainState(steps: Array<Pick<ApprovalStep, 'status'>>): ChainState {
  if (!steps.length) return 'none';
  if (steps.some((s) => s.status === 'rejected')) return 'rejected';
  return steps.every((s) => s.status === 'approved' || s.status === 'skipped') ? 'approved' : 'pending';
}

/** El paso que falta decidir (null si la cadena terminó o la cortó un rechazo). */
export function currentStep<T extends Pick<ApprovalStep, 'status' | 'position'>>(steps: T[]): T | null {
  if (steps.some((s) => s.status === 'rejected')) return null;
  return [...steps].sort((a, b) => a.position - b.position).find((s) => s.status === 'pending') ?? null;
}

export async function listChain(ws: string, subject: ApprovalSubject, subjectId: string): Promise<ApprovalStep[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.position, a.user_id, a.status, a.note, a.decided_at, COALESCE(u.name, u.email) AS name
       FROM hiring_approvals a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.workspace_id = ? AND a.subject_type = ? AND a.subject_id = ? ORDER BY a.position`,
    )
    .all(ws, subject, subjectId)) as Array<Record<string, string | number | null>>;
  return rows.map((r) => ({
    id: String(r.id),
    position: Number(r.position),
    userId: String(r.user_id),
    name: String(r.name ?? ''),
    status: String(r.status) as StepStatus,
    note: String(r.note ?? ''),
    decidedAt: (r.decided_at as string | null) ?? null,
  }));
}

export function approversOf(s: SettingsRow, subject: ApprovalSubject): string[] {
  return parseJson<string[]>(subject === 'job' ? s.job_approvers : s.offer_approvers, []);
}

/** Quien aprueba tiene que poder ver el puesto: entra al equipo como hiring manager si no estaba. */
async function joinTeam(jobId: string, ids: string[]): Promise<void> {
  const ts = nowIso();
  for (const id of ids) await getDb().prepare('INSERT OR IGNORE INTO hiring_job_members (job_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(jobId, id, 'hiring_manager', ts);
}

/**
 * Pasos reales de una cadena: solo quienes siguen en el workspace con Hiring.
 * `creator` no se aprueba a sí misma: su paso queda salteado. Si con eso nadie más
 * revisa, se suma al owner (o a otro admin): sin ellos, no se puede pedir.
 */
export async function resolveSteps(ws: string, approvers: string[], creator: string): Promise<Array<{ userId: string; status: StepStatus; note: string }>> {
  const people = await listOwnerSpacePeople(ws, { app: 'hiring' });
  const active = new Set([ws, ...people.map((p) => p.id)]);
  const steps = approvers.filter((id) => active.has(id)).map((userId) => ({ userId, status: (userId === creator ? 'skipped' : 'pending') as StepStatus, note: '' }));
  if (steps.some((st) => st.status === 'pending')) return steps;
  const other = creator !== ws ? ws : people.find((p) => p.id !== creator && (p.role === 'admin' || p.role === 'owner'))?.id;
  if (!other) throw new HiringError('no_other_approver', 409);
  return [...steps.filter((st) => st.userId !== other), { userId: other, status: 'pending', note: 'fallback' }];
}

/** Arranca la cadena (borra la anterior). */
export async function startChain(
  ws: string,
  subject: ApprovalSubject,
  subjectId: string,
  jobId: string,
  approvers: string[],
  creator: string,
  notice: { title: string; href: string },
): Promise<ApprovalStep[]> {
  const db = getDb();
  const planned = await resolveSteps(ws, approvers, creator);
  await db.prepare('DELETE FROM hiring_approvals WHERE workspace_id = ? AND subject_type = ? AND subject_id = ?').run(ws, subject, subjectId);
  const ts = nowIso();
  let position = 0;
  for (const st of planned) {
    await db
      .prepare('INSERT INTO hiring_approvals (id, workspace_id, subject_type, subject_id, position, user_id, requested_by, status, note, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(newId('hap'), ws, subject, subjectId, position++, st.userId, creator, st.status, st.note, ts);
  }
  await joinTeam(jobId, planned.map((st) => st.userId));
  const steps = await listChain(ws, subject, subjectId);
  const next = currentStep(steps);
  if (next) await notifyTeam([next.userId], { title: notice.title, body: localized('hiringApprovalWaiting'), href: notice.href, sourceId: subjectId });
  return steps;
}

/**
 * Alguien que aprobaba dejó el workspace o perdió Hiring: su paso pasa al owner (o
 * a otro admin si el owner fue quien pidió, porque nadie se aprueba a sí mismo). Si
 * no hay nadie, queda sin aprobador y a quien pidió se le dice qué hacer. Sale de los
 * ajustes y de los equipos de los puestos.
 */
export async function reassignApprover(ws: string, userId: string): Promise<void> {
  const db = getDb();
  const rows = (await db.prepare("SELECT id, subject_type, subject_id, requested_by FROM hiring_approvals WHERE workspace_id = ? AND user_id = ? AND status = 'pending'").all(ws, userId)) as Array<{ id: string; subject_type: string; subject_id: string; requested_by: string | null }>;
  const people = await listOwnerSpacePeople(ws, { app: 'hiring' });
  const notified = new Set<string>();
  for (const r of rows) {
    const candidates = [ws, ...people.filter((p) => p.id !== userId && (p.role === 'admin' || p.role === 'owner')).map((p) => p.id)];
    const steps = await listChain(ws, r.subject_type as ApprovalSubject, r.subject_id);
    const other = steps.some((st) => st.status === 'pending' && st.userId !== userId);
    if (other) {
      await db.prepare("UPDATE hiring_approvals SET status = 'skipped' WHERE id = ?").run(r.id);
      continue;
    }
    const to = candidates.find((id) => id !== r.requested_by);
    if (to) {
      await db.prepare("UPDATE hiring_approvals SET user_id = ?, note = 'reassigned' WHERE id = ?").run(to, r.id);
      notified.add(to);
    } else {
      await db.prepare("UPDATE hiring_approvals SET note = 'no_approver' WHERE id = ?").run(r.id);
      if (r.requested_by) notified.add(r.requested_by);
    }
  }
  if (notified.size) await notifyTeam([...notified], { title: 'Hiring', body: localized('hiringApprovalWaiting'), href: '/app/hiring', sourceId: userId });
  const s = await getSettings(ws);
  if (s) {
    const drop = (raw: string) => JSON.stringify(parseJson<string[]>(raw, []).filter((id) => id !== userId));
    await db.prepare('UPDATE hiring_settings SET job_approvers = ?, offer_approvers = ? WHERE workspace_id = ?').run(drop(s.job_approvers), drop(s.offer_approvers), ws);
  }
  // Ya no ve esos puestos: sale de los equipos y deja de evaluar.
  await db.prepare('DELETE FROM hiring_evaluators WHERE user_id = ? AND application_id IN (SELECT id FROM hiring_applications WHERE workspace_id = ?)').run(userId, ws);
  await db.prepare('DELETE FROM hiring_job_members WHERE user_id = ? AND job_id IN (SELECT id FROM hiring_jobs WHERE workspace_id = ?)').run(userId, ws);
}

/** Decide el paso actual: compare-and-set sobre la fila, para que dos clics no avancen dos pasos. */
export async function decideStep(
  actor: HiringActor,
  subject: ApprovalSubject,
  subjectId: string,
  decision: 'approve' | 'reject',
  note: string,
  notice: { title: string; href: string },
): Promise<ChainState> {
  const steps = await listChain(actor.ws, subject, subjectId);
  const step = currentStep(steps);
  if (!step) throw new HiringError('invalid_state', 409);
  if (step.userId !== actor.person) throw new HiringError('not_your_step', 403);
  const requester = (await getDb().prepare('SELECT requested_by FROM hiring_approvals WHERE id = ?').get(step.id)) as { requested_by: string | null } | undefined;
  if (requester?.requested_by === actor.person) throw new HiringError('no_other_approver', 409);
  if (decision === 'reject' && !note.trim()) throw new HiringError('reason_required');
  const ts = nowIso();
  const res = await getDb()
    .prepare("UPDATE hiring_approvals SET status = ?, note = ?, decided_at = ? WHERE id = ? AND workspace_id = ? AND status = 'pending'")
    .run(decision === 'approve' ? 'approved' : 'rejected', note.trim().slice(0, 500), ts, step.id, actor.ws);
  if (!res.changes) throw new HiringError('invalid_state', 409);
  const after = await listChain(actor.ws, subject, subjectId);
  const next = currentStep(after);
  if (next) await notifyTeam([next.userId], { title: notice.title, body: localized('hiringApprovalWaiting'), href: notice.href, sourceId: subjectId });
  return chainState(after);
}

// ---------- Puestos ----------

export const jobApprovalSchema = z.object({ action: z.enum(['request', 'approve', 'reject']), note: z.string().trim().max(500).default('') });

/** Pedir aprobación para publicar (quien gestiona el puesto), aprobar o rechazar (el paso actual). */
export async function actOnJobApproval(actor: HiringActor, jobId: string, input: z.infer<typeof jobApprovalSchema>): Promise<{ status: string; steps: ApprovalStep[] }> {
  const job = await getJobRow(actor.ws, jobId);
  if (!job) throw new HiringError('not_found', 404);
  const notice = { title: job.title, href: `/app/hiring/jobs/${jobId}/edit` };
  const db = getDb();
  if (input.action === 'request') {
    await requireManage(actor, jobId);
    const approvers = approversOf(await ensureSettings(actor.ws), 'job');
    if (!approvers.length) throw new HiringError('approvals_off', 409);
    const steps = await startChain(actor.ws, 'job', jobId, jobId, approvers, actor.person, notice);
    const state = chainState(steps);
    await db.prepare('UPDATE hiring_jobs SET approval_status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(state, nowIso(), jobId, actor.ws);
    return { status: state, steps };
  }
  const state = await decideStep(actor, 'job', jobId, input.action, input.note, notice);
  await db.prepare('UPDATE hiring_jobs SET approval_status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(state, nowIso(), jobId, actor.ws);
  if (state !== 'pending' && job.created_by && job.created_by !== actor.person) {
    await notifyTeam([job.created_by], { title: job.title, body: localized(state === 'approved' ? 'hiringApprovalDone' : 'hiringApprovalRejected'), href: notice.href, sourceId: jobId });
  }
  return { status: state, steps: await listChain(actor.ws, 'job', jobId) };
}

/** Lo que espera mi decisión (inicio de Hiring). */
export async function myPendingApprovals(actor: HiringActor): Promise<Array<{ subject: ApprovalSubject; id: string; title: string; href: string }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.subject_type, a.subject_id, a.position FROM hiring_approvals a
       WHERE a.workspace_id = ? AND a.user_id = ? AND a.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM hiring_approvals b WHERE b.workspace_id = a.workspace_id AND b.subject_type = a.subject_type AND b.subject_id = a.subject_id AND (b.status = 'rejected' OR (b.status = 'pending' AND b.position < a.position)))
       ORDER BY a.created_at LIMIT 30`,
    )
    .all(actor.ws, actor.person)) as Array<{ subject_type: ApprovalSubject; subject_id: string }>;
  const out: Array<{ subject: ApprovalSubject; id: string; title: string; href: string }> = [];
  for (const r of rows) {
    if (r.subject_type === 'job') {
      const job = await getJobRow(actor.ws, r.subject_id);
      if (job) out.push({ subject: 'job', id: job.id, title: job.title, href: `/app/hiring/jobs/${job.id}/edit` });
    } else {
      const o = (await getDb()
        .prepare('SELECT o.id, o.title, a.id AS app_id, a.candidate_id, c.name FROM hiring_offers o JOIN hiring_applications a ON a.id = o.application_id JOIN hiring_candidates c ON c.id = a.candidate_id WHERE o.id = ? AND o.workspace_id = ?')
        .get(r.subject_id, actor.ws)) as { id: string; title: string; app_id: string; candidate_id: string; name: string } | undefined;
      if (o) out.push({ subject: 'offer', id: o.id, title: `${o.name} · ${o.title}`, href: `/app/hiring/candidates/${o.candidate_id}?app=${o.app_id}` });
    }
  }
  return out;
}
