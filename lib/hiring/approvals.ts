/**
 * Hiring: cadenas de aprobación (puestos y ofertas). Pasos en orden: solo la
 * persona del paso actual puede decidir, y solo a ella se le avisa. Un rechazo
 * corta la cadena; volver a pedir arranca de cero. Las reglas puras están en
 * currentStep y chainState (tests/unit/hiring-extras.test.ts). Server-only.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { localized } from '../notification-copy';
import { ensureSettings, getJobRow, newId, nowIso, parseJson, requireManage, type SettingsRow } from './core';
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

/** Arranca la cadena (borra la anterior). `creator` no se aprueba a sí misma: su paso queda salteado. */
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
  await db.prepare('DELETE FROM hiring_approvals WHERE workspace_id = ? AND subject_type = ? AND subject_id = ?').run(ws, subject, subjectId);
  const ts = nowIso();
  let position = 0;
  for (const userId of approvers) {
    await db
      .prepare('INSERT INTO hiring_approvals (id, workspace_id, subject_type, subject_id, position, user_id, status, note, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(newId('hap'), ws, subject, subjectId, position++, userId, userId === creator ? 'skipped' : 'pending', '', ts);
  }
  await joinTeam(jobId, approvers);
  const steps = await listChain(ws, subject, subjectId);
  const next = currentStep(steps);
  if (next) await notifyTeam([next.userId], { title: notice.title, body: localized('hiringApprovalWaiting'), href: notice.href, sourceId: subjectId });
  return steps;
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
  if (decision === 'reject' && !note.trim()) throw new HiringError('reason_required');
  const ts = nowIso();
  const res = await getDb()
    .prepare("UPDATE hiring_approvals SET status = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(decision === 'approve' ? 'approved' : 'rejected', note.trim().slice(0, 500), ts, step.id);
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
    await db.prepare('UPDATE hiring_jobs SET approval_status = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), jobId);
    return { status: state, steps };
  }
  const state = await decideStep(actor, 'job', jobId, input.action, input.note, notice);
  await db.prepare('UPDATE hiring_jobs SET approval_status = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), jobId);
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
