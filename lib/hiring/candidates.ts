/**
 * Hiring: candidatos y postulaciones. Postularse desde la página de empleos
 * o cargar a mano (un candidato por email en el workspace: un segundo
 * ingreso con el mismo email se une al existente), mover de etapa, rechazar,
 * etiquetas, acciones en lote, perfil con línea de tiempo, borrado de datos y
 * la retención. Server-only.
 */
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db';
import { deleteUploads, saveUpload } from '../uploads';
import { pdfToText } from '../pdf-text';
import {
  EMAIL_RE,
  HiringError,
  MAX_TAGS,
  RESUME_MAX_BYTES,
  SOURCES,
  answerErrors,
  canManageJob,
  canSeeOthersScores,
  cleanAnswers,
  cutoffIso,
  failedKnockouts,
  normalizeEmail,
  sniffResume,
  type AppStatus,
  type HiringActor,
  type Question,
  type Source,
  type StageKind,
  type TeamRole,
} from './types';
import {
  appAccess,
  deleteApplicationRows,
  ensureSettings,
  getJobRow,
  getSettings,
  jobRole,
  listStages,
  newId,
  nowIso,
  parseJson,
  requireManage,
  stageDto,
  visibleAppsSql,
  type JobRow,
  type StageDto,
} from './core';
import { addEvent, emitHiring, eventDto, notifyTeam, runOnHire, teamIds, type EventRow } from './events';
import { privacyLinkFor, resolveTemplate, sendCandidateEmail } from './comms';

export interface CandidateRow {
  id: string;
  workspace_id: string;
  email: string;
  name: string;
  phone: string;
  location: string;
  headline: string;
  links: string;
  tags: string;
  resume_url: string | null;
  resume_name: string | null;
  resume_mime: string | null;
  resume_text: string;
  ai_summary: string;
  ai_fields: string;
  consent_at: string | null;
  keep_consent: number;
  forget_token_hash: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRow {
  id: string;
  workspace_id: string;
  job_id: string;
  candidate_id: string;
  stage_id: string;
  status: AppStatus;
  source: Source;
  utm: string;
  referrer: string;
  answers: string;
  knocked_out: number;
  reject_reason: string;
  stage_changed_at: string;
  hired_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function candidateDto(c: CandidateRow) {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    phone: c.phone,
    location: c.location,
    headline: c.headline,
    links: parseJson<string[]>(c.links, []),
    tags: parseJson<string[]>(c.tags, []),
    hasResume: Boolean(c.resume_url),
    resumeName: c.resume_name,
    resumeMime: c.resume_mime,
    aiSummary: c.ai_summary,
    aiFields: parseJson<Record<string, unknown>>(c.ai_fields, {}),
    consentAt: c.consent_at,
    keepConsent: c.keep_consent === 1,
    lastActivityAt: c.last_activity_at,
    createdAt: c.created_at,
  };
}
export type CandidateDto = ReturnType<typeof candidateDto>;

export async function getCandidateRow(ws: string, id: string): Promise<CandidateRow | null> {
  return ((await getDb().prepare('SELECT * FROM hiring_candidates WHERE id = ? AND workspace_id = ?').get(id, ws)) as CandidateRow | undefined) ?? null;
}

export async function getApplicationRow(ws: string, id: string): Promise<ApplicationRow | null> {
  return ((await getDb().prepare('SELECT * FROM hiring_applications WHERE id = ? AND workspace_id = ?').get(id, ws)) as ApplicationRow | undefined) ?? null;
}

// ---------- Resume ----------

export interface ResumeFile {
  bytes: Buffer;
  filename: string;
}

/** Valida el resume por sus bytes y lo guarda en la carpeta privada de Hiring. */
export async function storeResume(file: ResumeFile): Promise<{ url: string; name: string; mime: string; text: string }> {
  if (file.bytes.length === 0 || file.bytes.length > RESUME_MAX_BYTES) throw new HiringError('resume_size', 413);
  const kind = sniffResume(new Uint8Array(file.bytes.subarray(0, 16)), file.filename);
  if (!kind) throw new HiringError('resume_type', 415);
  const safeName = (file.filename.replace(/[^\w.\- ]+/g, '_').slice(-100) || `resume.${kind.ext}`).replace(/\.[^.]*$/, '') + `.${kind.ext}`;
  const url = await saveUpload('hiring', safeName, kind.mime, file.bytes);
  let text = '';
  if (kind.ext === 'pdf') {
    try {
      text = pdfToText(file.bytes).replace(/\s+\n/g, '\n').slice(0, 30_000);
    } catch {
      text = '';
    }
  }
  return { url, name: safeName, mime: kind.mime, text };
}

// ---------- Alta ----------

interface UpsertInput {
  email: string;
  name: string;
  phone?: string;
  location?: string;
  headline?: string;
  links?: string[];
  tags?: string[];
  resume?: { url: string; name: string; mime: string; text: string } | null;
  consent?: boolean;
  keepConsent?: boolean;
}

/**
 * Busca al candidato por email (en minúsculas) en el workspace; si existe, se
 * une (completa lo vacío, reemplaza el resume si llega uno nuevo). Devuelve
 * si ya existía: así la app avisa del duplicado.
 */
export async function upsertCandidate(ws: string, input: UpsertInput): Promise<{ candidate: CandidateRow; duplicate: boolean; forgetToken: string }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HiringError('invalid_email');
  const db = getDb();
  const ts = nowIso();
  const forgetToken = randomBytes(24).toString('base64url');
  const existing = (await db.prepare('SELECT * FROM hiring_candidates WHERE workspace_id = ? AND email = ?').get(ws, email)) as CandidateRow | undefined;
  if (existing) {
    const oldResume = input.resume && existing.resume_url ? existing.resume_url : null;
    const tags = [...new Set([...parseJson<string[]>(existing.tags, []), ...(input.tags ?? [])])].slice(0, MAX_TAGS);
    await db
      .prepare(
        `UPDATE hiring_candidates SET name = ?, phone = ?, location = ?, headline = ?, links = ?, tags = ?,
          resume_url = ?, resume_name = ?, resume_mime = ?, resume_text = ?,
          consent_at = CASE WHEN ? = 1 THEN ? ELSE consent_at END, keep_consent = CASE WHEN ? = 1 THEN 1 ELSE keep_consent END,
          forget_token_hash = ?, last_activity_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.name || existing.name,
        existing.phone || input.phone || '',
        existing.location || input.location || '',
        existing.headline || input.headline || '',
        JSON.stringify([...new Set([...parseJson<string[]>(existing.links, []), ...(input.links ?? [])])].slice(0, 10)),
        JSON.stringify(tags),
        input.resume?.url ?? existing.resume_url,
        input.resume?.name ?? existing.resume_name,
        input.resume?.mime ?? existing.resume_mime,
        input.resume?.text ?? existing.resume_text,
        input.consent ? 1 : 0,
        ts,
        input.keepConsent ? 1 : 0,
        sha256(forgetToken),
        ts,
        ts,
        existing.id,
      );
    if (oldResume && oldResume !== input.resume?.url) await deleteUploads([oldResume]);
    return { candidate: (await getCandidateRow(ws, existing.id))!, duplicate: true, forgetToken };
  }
  const id = newId('cand');
  await db
    .prepare(
      `INSERT INTO hiring_candidates (id, workspace_id, email, name, phone, location, headline, links, tags, resume_url, resume_name, resume_mime, resume_text,
        consent_at, keep_consent, forget_token_hash, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ws,
      email,
      input.name.slice(0, 160),
      input.phone ?? '',
      input.location ?? '',
      input.headline ?? '',
      JSON.stringify((input.links ?? []).slice(0, 10)),
      JSON.stringify((input.tags ?? []).slice(0, MAX_TAGS)),
      input.resume?.url ?? null,
      input.resume?.name ?? null,
      input.resume?.mime ?? null,
      input.resume?.text ?? '',
      input.consent ? ts : null,
      input.keepConsent ? 1 : 0,
      sha256(forgetToken),
      ts,
      ts,
      ts,
    );
  return { candidate: (await getCandidateRow(ws, id))!, duplicate: false, forgetToken };
}

async function firstStage(jobId: string): Promise<StageDto> {
  const stages = await listStages(jobId);
  if (!stages.length) throw new HiringError('no_stages', 409);
  return stageDto(stages[0]);
}

interface ApplyCore {
  job: JobRow;
  candidate: CandidateRow;
  source: Source;
  utm: Record<string, string>;
  referrer: string;
  answers: Record<string, string>;
  knockouts: string[];
  createdBy: string | null;
}

/** Postulación nueva (o la existente si ya se había postulado a este puesto). */
async function createApplication(ws: string, input: ApplyCore): Promise<{ app: ApplicationRow; existing: boolean }> {
  const db = getDb();
  const prev = (await db.prepare('SELECT * FROM hiring_applications WHERE job_id = ? AND candidate_id = ?').get(input.job.id, input.candidate.id)) as ApplicationRow | undefined;
  if (prev) {
    await addEvent(ws, input.candidate.id, prev.id, 'reapplied', input.createdBy, { source: input.source });
    return { app: prev, existing: true };
  }
  const stage = await firstStage(input.job.id);
  const id = newId('app');
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO hiring_applications (id, workspace_id, job_id, candidate_id, stage_id, status, source, utm, referrer, answers, knocked_out, stage_changed_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ws, input.job.id, input.candidate.id, stage.id, input.source, JSON.stringify(input.utm), input.referrer.slice(0, 500), JSON.stringify(input.answers), input.knockouts.length ? 1 : 0, ts, input.createdBy, ts, ts);
  await addEvent(ws, input.candidate.id, id, 'applied', input.createdBy, { source: input.source, stage: stage.name, knockouts: input.knockouts, job: input.job.title });
  await notifyTeam(await teamIds(input.job.id, ['recruiter', 'hiring_manager'], input.createdBy), {
    title: `${input.candidate.name} · ${input.job.title}`,
    body: input.knockouts.length ? 'knock-out' : undefined,
    href: `/app/hiring/candidates/${input.candidate.id}?app=${id}`,
    sourceId: id,
  });
  await emitHiring(ws, 'hiring.candidate.applied', input.job.id, {
    candidate: { id: input.candidate.id, name: input.candidate.name, email: input.candidate.email },
    job: { id: input.job.id, title: input.job.title },
    application: { id, source: input.source, stage: stage.name, knockedOut: input.knockouts.length > 0 },
  });
  return { app: (await getApplicationRow(ws, id))!, existing: false };
}

export const publicApplySchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(40).default(''),
  linkedin: z.string().trim().max(300).default(''),
  answers: z.record(z.string(), z.string().max(5000)).default({}),
  consent: z.boolean(),
  keepConsent: z.boolean().default(false),
  utm: z.record(z.string(), z.string().max(200)).default({}),
  referrer: z.string().max(500).default(''),
  source: z.string().max(20).nullable().default(null),
});

/** Postulación desde la página de empleos. El resume es obligatorio y se valida por sus bytes. */
export async function applyPublic(handle: string, jobSlug: string, input: z.infer<typeof publicApplySchema>, resume: ResumeFile | null) {
  const db = getDb();
  const settings = (await db.prepare('SELECT * FROM hiring_settings WHERE handle = ? AND published = 1').get(handle.toLowerCase())) as Awaited<ReturnType<typeof getSettings>> | undefined;
  if (!settings) throw new HiringError('not_found', 404);
  const job = (await db.prepare("SELECT * FROM hiring_jobs WHERE workspace_id = ? AND slug = ? AND status = 'published'").get(settings.workspace_id, jobSlug)) as JobRow | undefined;
  if (!job) throw new HiringError('not_found', 404);
  if (!input.consent) throw new HiringError('consent_required');
  if (!EMAIL_RE.test(input.email)) throw new HiringError('invalid_email');
  const questions = parseJson<Question[]>(job.questions, []);
  const answers = cleanAnswers(questions, input.answers);
  const errors = answerErrors(questions, answers);
  if (errors.length) throw new HiringError('invalid_answers', 400, { fields: errors });
  if (!resume) throw new HiringError('resume_required');
  const stored = await storeResume(resume);
  const utm = Object.fromEntries(Object.entries(input.utm).filter(([k]) => /^utm_(source|medium|campaign|term|content)$/.test(k)));
  const source = input.source && (SOURCES as readonly string[]).includes(input.source) && input.source !== 'manual' ? (input.source as Source) : utm.utm_source?.toLowerCase().includes('linkedin') || /linkedin\./i.test(input.referrer) ? 'linkedin' : utm.utm_source?.toLowerCase().includes('referr') ? 'referral' : 'careers';
  const links = input.linkedin && /^https?:\/\//i.test(input.linkedin) ? [input.linkedin] : [];
  const { candidate, duplicate, forgetToken } = await upsertCandidate(settings.workspace_id, {
    email: input.email,
    name: input.name,
    phone: input.phone,
    links,
    resume: stored,
    consent: true,
    keepConsent: input.keepConsent,
  });
  const knockouts = failedKnockouts(questions, answers);
  const { app, existing } = await createApplication(settings.workspace_id, { job, candidate, source, utm, referrer: input.referrer, answers, knockouts, createdBy: null });
  if (settings.auto_ack === 1 && !existing) {
    const tpl = await resolveTemplate(settings.workspace_id, 'ack', settings);
    await sendCandidateEmail(
      settings.workspace_id,
      { candidate, job, applicationId: app.id, senderName: settings.company, extra: { privacyLink: privacyLinkFor(settings.handle, forgetToken) } },
      tpl,
      null,
      { kind: 'ack' },
    ).catch(() => null);
  }
  return { applicationId: app.id, duplicate, existing };
}

export const manualAddSchema = z.object({
  jobId: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(120).optional(),
  headline: z.string().trim().max(200).optional(),
  source: z.enum(SOURCES).default('manual'),
  tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS).optional(),
});

/** Carga manual (recruiter, hiring manager o admin). Si el email ya existe, se une al candidato. */
export async function addCandidateManually(actor: HiringActor, input: z.infer<typeof manualAddSchema>, resume: ResumeFile | null) {
  const job = await requireManage(actor, input.jobId);
  const stored = resume ? await storeResume(resume) : null;
  const { candidate, duplicate } = await upsertCandidate(actor.ws, { ...input, resume: stored });
  const { app, existing } = await createApplication(actor.ws, { job, candidate, source: input.source, utm: {}, referrer: '', answers: {}, knockouts: [], createdBy: actor.person });
  return { candidateId: candidate.id, applicationId: app.id, duplicate, existing };
}

// ---------- Listados ----------

export interface ApplicationListItem {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  tags: string[];
  jobId: string;
  jobTitle: string;
  stageId: string;
  stageName: string;
  stageKind: StageKind;
  status: AppStatus;
  source: Source;
  knockedOut: boolean;
  createdAt: string;
  stageChangedAt: string;
}

export interface ListFilter {
  q?: string;
  jobId?: string;
  stageId?: string;
  status?: string;
  source?: string;
  tag?: string;
  knockedOut?: boolean;
  limit?: number;
}

/** Postulaciones visibles para la persona (pipeline en lista, candidatos, Cmd+K, asistente). */
export async function listApplications(actor: HiringActor, f: ListFilter = {}): Promise<ApplicationListItem[]> {
  const vis = visibleAppsSql(actor);
  const where = [vis.sql];
  const args: Array<string | number> = [...vis.args];
  if (f.jobId) {
    where.push('a.job_id = ?');
    args.push(f.jobId);
  }
  if (f.stageId) {
    where.push('a.stage_id = ?');
    args.push(f.stageId);
  }
  if (f.status && f.status !== 'all') {
    where.push('a.status = ?');
    args.push(f.status);
  }
  if (f.source) {
    where.push('a.source = ?');
    args.push(f.source);
  }
  if (f.knockedOut) where.push('a.knocked_out = 1');
  if (f.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)');
    args.push(f.tag);
  }
  if (f.q?.trim()) {
    const like = `%${f.q.trim().slice(0, 100)}%`;
    where.push('(c.name LIKE ? OR c.email LIKE ? OR c.headline LIKE ? OR c.tags LIKE ?)');
    args.push(like, like, like, like);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.candidate_id, a.job_id, a.stage_id, a.status, a.source, a.knocked_out, a.created_at, a.stage_changed_at,
              c.name, c.email, c.tags, j.title AS job_title, s.name AS stage_name, s.kind AS stage_kind
       FROM hiring_applications a JOIN hiring_candidates c ON c.id = a.candidate_id JOIN hiring_jobs j ON j.id = a.job_id
       LEFT JOIN hiring_stages s ON s.id = a.stage_id
       WHERE ${where.join(' AND ')} ORDER BY a.stage_changed_at DESC LIMIT ?`,
    )
    .all(...args, Math.min(f.limit ?? 500, 1000))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    candidateId: String(r.candidate_id),
    name: String(r.name),
    email: String(r.email),
    tags: parseJson<string[]>(r.tags, []),
    jobId: String(r.job_id),
    jobTitle: String(r.job_title),
    stageId: String(r.stage_id),
    stageName: String(r.stage_name ?? ''),
    stageKind: String(r.stage_kind ?? 'review') as StageKind,
    status: String(r.status) as AppStatus,
    source: String(r.source) as Source,
    knockedOut: Number(r.knocked_out) === 1,
    createdAt: String(r.created_at),
    stageChangedAt: String(r.stage_changed_at),
  }));
}

/** Tags usados en candidatos visibles (para el filtro). */
export async function visibleTags(actor: HiringActor): Promise<string[]> {
  const vis = visibleAppsSql(actor);
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT t.value AS tag FROM hiring_applications a JOIN hiring_candidates c ON c.id = a.candidate_id, json_each(c.tags) t
       WHERE ${vis.sql} ORDER BY t.value LIMIT 200`,
    )
    .all(...vis.args)) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

// ---------- Perfil ----------

export interface ScorecardDto {
  id: string;
  stageId: string;
  userId: string;
  userName: string | null;
  ratings: Record<string, number>;
  overall: string;
  notes: string;
  submittedAt: string;
}

export interface ProfileApplication {
  id: string;
  job: { id: string; title: string; slug: string; status: string };
  stages: StageDto[];
  stageId: string;
  status: AppStatus;
  source: Source;
  utm: Record<string, string>;
  answers: Array<{ id: string; label: string; value: string; knockout: boolean }>;
  knockedOut: boolean;
  rejectReason: string;
  createdAt: string;
  myRole: TeamRole | null;
  canManage: boolean;
  /** Scorecards que la persona puede ver (las ajenas, solo después de enviar la suya si es interviewer). */
  scorecards: ScorecardDto[];
  othersHidden: number;
  myScorecardStages: string[];
  evaluators: Array<{ userId: string; name: string | null; stageId: string; submitted: boolean }>;
  amEvaluator: boolean;
}

export async function scorecardsFor(appId: string): Promise<ScorecardDto[]> {
  const rows = (await getDb()
    .prepare('SELECT s.*, u.name AS user_name FROM hiring_scorecards s LEFT JOIN users u ON u.id = s.user_id WHERE s.application_id = ? ORDER BY s.submitted_at')
    .all(appId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    stageId: String(r.stage_id),
    userId: String(r.user_id),
    userName: (r.user_name as string | null) ?? null,
    ratings: parseJson<Record<string, number>>(r.ratings, {}),
    overall: String(r.overall),
    notes: String(r.notes ?? ''),
    submittedAt: String(r.submitted_at),
  }));
}

/** Scorecards visibles para la persona en una postulación. */
export function visibleScorecards(all: ScorecardDto[], opts: { admin: boolean; jobRole: TeamRole | null; person: string }): { visible: ScorecardDto[]; hidden: number } {
  const submittedOwn = all.some((s) => s.userId === opts.person);
  if (canSeeOthersScores({ admin: opts.admin, jobRole: opts.jobRole, submittedOwn })) return { visible: all, hidden: 0 };
  const own = all.filter((s) => s.userId === opts.person);
  return { visible: own, hidden: all.length - own.length };
}

export interface CandidateProfile {
  candidate: CandidateDto;
  applications: ProfileApplication[];
  timeline: ReturnType<typeof eventDto>[];
  canDelete: boolean;
}

/** Perfil completo, o null si la persona no ve ninguna postulación del candidato. */
export async function getCandidateProfile(actor: HiringActor, candidateId: string): Promise<CandidateProfile | null> {
  const c = await getCandidateRow(actor.ws, candidateId);
  if (!c) return null;
  const db = getDb();
  const apps = (await db.prepare('SELECT * FROM hiring_applications WHERE candidate_id = ? ORDER BY created_at DESC').all(candidateId)) as ApplicationRow[];
  const out: ProfileApplication[] = [];
  let manageAll = apps.length > 0;
  for (const a of apps) {
    const access = await appAccess(actor, a);
    if (!access.manage) manageAll = false;
    if (!access.visible) continue;
    const job = (await getJobRow(actor.ws, a.job_id))!;
    const stages = (await listStages(a.job_id)).map(stageDto);
    const questions = parseJson<Question[]>(job.questions, []);
    const answers = parseJson<Record<string, string>>(a.answers, {});
    const all = await scorecardsFor(a.id);
    const { visible, hidden } = visibleScorecards(all, { admin: actor.admin, jobRole: access.jobRole, person: actor.person });
    const evals = (await db
      .prepare('SELECT e.user_id, e.stage_id, u.name FROM hiring_evaluators e LEFT JOIN users u ON u.id = e.user_id WHERE e.application_id = ? ORDER BY e.requested_at')
      .all(a.id)) as Array<{ user_id: string; stage_id: string; name: string | null }>;
    const failed = failedKnockouts(questions, answers);
    out.push({
      id: a.id,
      job: { id: job.id, title: job.title, slug: job.slug, status: job.status },
      stages,
      stageId: a.stage_id,
      status: a.status,
      source: a.source,
      utm: parseJson<Record<string, string>>(a.utm, {}),
      answers: questions.filter((q) => answers[q.id]).map((q) => ({ id: q.id, label: q.label, value: answers[q.id], knockout: failed.includes(q.id) })),
      knockedOut: a.knocked_out === 1,
      rejectReason: a.reject_reason,
      createdAt: a.created_at,
      myRole: access.jobRole,
      canManage: access.manage,
      scorecards: visible,
      othersHidden: hidden,
      myScorecardStages: all.filter((s) => s.userId === actor.person).map((s) => s.stageId),
      evaluators: evals.map((e) => ({ userId: e.user_id, name: e.name, stageId: e.stage_id, submitted: all.some((s) => s.userId === e.user_id && s.stageId === e.stage_id) })),
      amEvaluator: evals.some((e) => e.user_id === actor.person),
    });
  }
  if (!out.length) return null;
  const visibleIds = new Set(out.map((a) => a.id));
  const hiddenScoreApps = new Set(out.filter((a) => a.othersHidden > 0).map((a) => a.id));
  const events = (await db
    .prepare('SELECT e.*, u.name AS actor_name FROM hiring_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.candidate_id = ? ORDER BY e.created_at DESC LIMIT 300')
    .all(candidateId)) as EventRow[];
  const timeline = events
    .filter((e) => !e.application_id || visibleIds.has(e.application_id))
    // Antes de enviar su scorecard, un interviewer no ve la nota de los demás ni en la línea de tiempo.
    .filter((e) => !(e.kind === 'score' && e.application_id && hiddenScoreApps.has(e.application_id) && e.actor_id !== actor.person))
    .map(eventDto);
  return { candidate: candidateDto(c), applications: out, timeline, canDelete: actor.admin || manageAll };
}

/** Postulación con acceso de gestión (o 404/403). */
export async function requireManageApp(actor: HiringActor, appId: string): Promise<{ app: ApplicationRow; job: JobRow; candidate: CandidateRow }> {
  const app = await getApplicationRow(actor.ws, appId);
  if (!app) throw new HiringError('not_found', 404);
  const access = await appAccess(actor, app);
  if (!access.visible) throw new HiringError('not_found', 404);
  if (!access.manage) throw new HiringError('forbidden', 403);
  return { app, job: (await getJobRow(actor.ws, app.job_id))!, candidate: (await getCandidateRow(actor.ws, app.candidate_id))! };
}

export async function requireVisibleApp(actor: HiringActor, appId: string) {
  const app = await getApplicationRow(actor.ws, appId);
  if (!app) throw new HiringError('not_found', 404);
  const access = await appAccess(actor, app);
  if (!access.visible) throw new HiringError('not_found', 404);
  return { app, access, job: (await getJobRow(actor.ws, app.job_id))!, candidate: (await getCandidateRow(actor.ws, app.candidate_id))! };
}

/** Candidato visible (alguna postulación visible) o 404. */
export async function requireVisibleCandidate(actor: HiringActor, candidateId: string): Promise<CandidateRow> {
  const c = await getCandidateRow(actor.ws, candidateId);
  if (!c) throw new HiringError('not_found', 404);
  const apps = (await getDb().prepare('SELECT id, job_id FROM hiring_applications WHERE candidate_id = ?').all(candidateId)) as Array<{ id: string; job_id: string }>;
  for (const a of apps) if ((await appAccess(actor, a)).visible) return c;
  throw new HiringError('not_found', 404);
}

async function canManageCandidate(actor: HiringActor, candidateId: string): Promise<boolean> {
  if (actor.admin) return true;
  const apps = (await getDb().prepare('SELECT id, job_id FROM hiring_applications WHERE candidate_id = ?').all(candidateId)) as Array<{ id: string; job_id: string }>;
  for (const a of apps) if ((await appAccess(actor, a)).manage) return true;
  return false;
}

// ---------- Cambios ----------

/** Asigna evaluadores al entrar a una etapa con criterios: el equipo del puesto (interviewers y hiring manager). */
async function requestEvaluations(ws: string, app: ApplicationRow, stage: StageDto, job: JobRow, candidateName: string, actorId: string | null): Promise<void> {
  if (!stage.criteria.length) return;
  const ids = await teamIds(job.id, ['interviewer', 'hiring_manager']);
  const db = getDb();
  const ts = nowIso();
  const fresh: string[] = [];
  for (const userId of ids) {
    const res = await db
      .prepare(
        `INSERT INTO hiring_evaluators (application_id, user_id, stage_id, requested_at, reminded_at) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(application_id, user_id) DO UPDATE SET stage_id = excluded.stage_id, requested_at = excluded.requested_at, reminded_at = NULL
         WHERE hiring_evaluators.stage_id != excluded.stage_id`,
      )
      .run(app.id, userId, stage.id, ts);
    if (res.changes) fresh.push(userId);
  }
  await notifyTeam(
    fresh.filter((u) => u !== actorId),
    { title: `${candidateName} · ${stage.name}`, body: job.title, href: `/app/hiring/candidates/${app.candidate_id}?app=${app.id}`, sourceId: app.id },
  );
  void ws;
}

/** Mueve la postulación de etapa. Entrar a "Contratados" la marca contratada y corre el gancho de contratación. */
export async function moveApplication(actor: HiringActor, appId: string, stageId: string): Promise<ApplicationRow> {
  const { app, job, candidate } = await requireManageApp(actor, appId);
  const stages = (await listStages(job.id)).map(stageDto);
  const to = stages.find((s) => s.id === stageId);
  if (!to) throw new HiringError('invalid_stage');
  if (app.stage_id === stageId && app.status !== 'rejected') return app;
  const from = stages.find((s) => s.id === app.stage_id);
  const ts = nowIso();
  const hired = to.kind === 'hired';
  const db = getDb();
  await db
    .prepare(
      `UPDATE hiring_applications SET stage_id = ?, stage_changed_at = ?, updated_at = ?,
        status = CASE WHEN ? = 1 THEN 'hired' WHEN status IN ('hired','rejected') THEN 'active' ELSE status END,
        hired_at = CASE WHEN ? = 1 THEN COALESCE(hired_at, ?) ELSE NULL END,
        rejected_at = CASE WHEN ? = 1 THEN rejected_at ELSE NULL END
       WHERE id = ?`,
    )
    .run(stageId, ts, ts, hired ? 1 : 0, hired ? 1 : 0, ts, 0, app.id);
  await addEvent(actor.ws, candidate.id, app.id, 'stage', actor.person, { from: from?.name ?? '', to: to.name, toKind: to.kind });
  await requestEvaluations(actor.ws, app, to, job, candidate.name, actor.person);
  await emitHiring(actor.ws, 'hiring.candidate.stage_changed', job.id, {
    candidate: { id: candidate.id, name: candidate.name, email: candidate.email },
    job: { id: job.id, title: job.title },
    application: { id: app.id },
    from: from ? { id: from.id, name: from.name, kind: from.kind } : null,
    to: { id: to.id, name: to.name, kind: to.kind },
  });
  if (hired && app.status !== 'hired') await markHired(actor.ws, app.id, actor.person);
  return (await getApplicationRow(actor.ws, app.id))!;
}

/** Contratación: evento de Flow hiring.candidate.hired y el gancho onHire (People). */
export async function markHired(ws: string, appId: string, actorId: string | null): Promise<void> {
  const db = getDb();
  const app = (await getApplicationRow(ws, appId))!;
  const job = (await getJobRow(ws, app.job_id))!;
  const c = (await getCandidateRow(ws, app.candidate_id))!;
  const offer = (await db.prepare("SELECT title, salary, currency, start_date FROM hiring_offers WHERE application_id = ? AND status = 'accepted' ORDER BY updated_at DESC LIMIT 1").get(appId)) as
    | { title: string; salary: number | null; currency: string; start_date: string | null }
    | undefined;
  await addEvent(ws, c.id, appId, 'hired', actorId, { job: job.title });
  const payload = {
    workspaceId: ws,
    applicationId: appId,
    hiredAt: app.hired_at ?? nowIso(),
    hiredBy: actorId,
    candidate: { id: c.id, name: c.name, email: c.email, phone: c.phone, location: c.location },
    job: { id: job.id, title: job.title, department: job.department, location: job.location, workplace: job.workplace, employmentType: job.employment_type },
    offer: offer ? { title: offer.title, salary: offer.salary, currency: offer.currency, startDate: offer.start_date } : null,
  };
  await emitHiring(ws, 'hiring.candidate.hired', job.id, { candidate: payload.candidate, job: payload.job, offer: payload.offer, hiredAt: payload.hiredAt });
  await runOnHire(payload);
}

export const rejectSchema = z.object({ reason: z.string().trim().max(300).default(''), sendEmail: z.boolean().default(false), templateId: z.string().max(80).nullable().default(null) });

/** Rechazo hecho por una persona (con email de rechazo opcional desde una plantilla). */
export async function rejectApplication(actor: HiringActor, appId: string, input: z.infer<typeof rejectSchema>): Promise<ApplicationRow> {
  const { app, job, candidate } = await requireManageApp(actor, appId);
  const ts = nowIso();
  await getDb().prepare("UPDATE hiring_applications SET status = 'rejected', reject_reason = ?, rejected_at = ?, updated_at = ? WHERE id = ?").run(input.reason, ts, ts, app.id);
  await addEvent(actor.ws, candidate.id, app.id, 'rejected', actor.person, { reason: input.reason });
  if (input.sendEmail) {
    const settings = await ensureSettings(actor.ws);
    const tpl = await resolveTemplate(actor.ws, 'rejection', settings, input.templateId);
    await sendCandidateEmail(actor.ws, { candidate, job, applicationId: app.id, senderName: await personName(actor.person) }, tpl, actor.person, { kind: 'rejection' });
  }
  return (await getApplicationRow(actor.ws, app.id))!;
}

export async function reactivateApplication(actor: HiringActor, appId: string): Promise<ApplicationRow> {
  const { app, candidate } = await requireManageApp(actor, appId);
  if (app.status !== 'rejected') return app;
  await getDb().prepare("UPDATE hiring_applications SET status = 'active', reject_reason = '', rejected_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), app.id);
  await addEvent(actor.ws, candidate.id, app.id, 'reactivated', actor.person, {});
  return (await getApplicationRow(actor.ws, app.id))!;
}

export async function personName(id: string): Promise<string> {
  const row = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(id)) as { name: string | null; email: string } | undefined;
  return row?.name || row?.email || '';
}

export async function addNote(actor: HiringActor, appId: string, body: string): Promise<void> {
  const { app } = await requireVisibleApp(actor, appId);
  const text = body.trim().slice(0, 10_000);
  if (!text) throw new HiringError('empty_note');
  await addEvent(actor.ws, app.candidate_id, app.id, 'note', actor.person, { body: text });
}

export const candidatePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(120).optional(),
  headline: z.string().trim().max(200).optional(),
  links: z.array(z.string().trim().url().max(300)).max(10).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS).optional(),
  keepConsent: z.boolean().optional(),
});

export async function updateCandidate(actor: HiringActor, id: string, patch: z.infer<typeof candidatePatchSchema>): Promise<CandidateDto> {
  const c = await requireVisibleCandidate(actor, id);
  if (!(await canManageCandidate(actor, id))) throw new HiringError('forbidden', 403);
  const oldTags = parseJson<string[]>(c.tags, []);
  const tags = patch.tags ? [...new Set(patch.tags)] : oldTags;
  await getDb()
    .prepare('UPDATE hiring_candidates SET name = ?, phone = ?, location = ?, headline = ?, links = ?, tags = ?, keep_consent = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.name ?? c.name,
      patch.phone ?? c.phone,
      patch.location ?? c.location,
      patch.headline ?? c.headline,
      patch.links ? JSON.stringify(patch.links) : c.links,
      JSON.stringify(tags),
      patch.keepConsent === undefined ? c.keep_consent : patch.keepConsent ? 1 : 0,
      nowIso(),
      id,
    );
  const added = tags.filter((t) => !oldTags.includes(t));
  const removed = oldTags.filter((t) => !tags.includes(t));
  if (added.length || removed.length) await addEvent(actor.ws, id, null, 'tag', actor.person, { added, removed });
  return candidateDto((await getCandidateRow(actor.ws, id))!);
}

export const bulkSchema = z.object({
  ids: z.array(z.string().min(1).max(80)).min(1).max(200),
  action: z.enum(['move', 'reject', 'tag']),
  stageId: z.string().max(80).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  reason: z.string().trim().max(300).optional(),
  sendEmail: z.boolean().optional(),
  templateId: z.string().max(80).nullable().optional(),
});

/** Acciones en lote sobre postulaciones: cada una con su propio chequeo de acceso. */
export async function bulkApplications(actor: HiringActor, input: z.infer<typeof bulkSchema>): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const id of input.ids) {
    try {
      if (input.action === 'move') {
        if (!input.stageId) throw new HiringError('invalid_stage');
        // En lote, la etapa se elige por nombre en puestos distintos: la del mismo puesto con ese id, o la de igual nombre.
        const app = await getApplicationRow(actor.ws, id);
        if (!app) throw new HiringError('not_found', 404);
        const stages = await listStages(app.job_id);
        const target = stages.find((s) => s.id === input.stageId);
        if (!target) throw new HiringError('invalid_stage');
        await moveApplication(actor, id, target.id);
      } else if (input.action === 'reject') {
        await rejectApplication(actor, id, { reason: input.reason ?? '', sendEmail: input.sendEmail ?? false, templateId: input.templateId ?? null });
      } else {
        if (!input.tag) throw new HiringError('invalid_tag');
        const { app, candidate } = await requireManageApp(actor, id);
        const tags = parseJson<string[]>(candidate.tags, []);
        if (!tags.includes(input.tag)) {
          await getDb().prepare('UPDATE hiring_candidates SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...tags, input.tag].slice(0, MAX_TAGS)), nowIso(), candidate.id);
          await addEvent(actor.ws, candidate.id, app.id, 'tag', actor.person, { added: [input.tag], removed: [] });
        }
      }
      done++;
    } catch {
      failed++;
    }
  }
  return { done, failed };
}

// ---------- Borrado y retención ----------

/** Borra todo lo del candidato (postulaciones, línea de tiempo, scorecards, ofertas y el resume). */
export async function deleteCandidateRows(ws: string, candidateId: string): Promise<boolean> {
  const db = getDb();
  const c = await getCandidateRow(ws, candidateId);
  if (!c) return false;
  const apps = (await db.prepare('SELECT id FROM hiring_applications WHERE candidate_id = ?').all(candidateId)) as Array<{ id: string }>;
  for (const a of apps) await deleteApplicationRows(a.id);
  await db.prepare('DELETE FROM hiring_events WHERE candidate_id = ?').run(candidateId);
  await db.prepare('DELETE FROM hiring_candidates WHERE id = ? AND workspace_id = ?').run(candidateId, ws);
  if (c.resume_url) await deleteUploads([c.resume_url]);
  return true;
}

/** Pedido de borrado desde la app: admin, o quien gestiona todas las postulaciones del candidato. */
export async function deleteCandidate(actor: HiringActor, candidateId: string): Promise<void> {
  await requireVisibleCandidate(actor, candidateId);
  if (!actor.admin) {
    const apps = (await getDb().prepare('SELECT id, job_id FROM hiring_applications WHERE candidate_id = ?').all(candidateId)) as Array<{ id: string; job_id: string }>;
    for (const a of apps) if (!canManageJob({ admin: false, jobRole: await jobRole(a.job_id, actor.person) })) throw new HiringError('forbidden', 403);
  }
  await deleteCandidateRows(actor.ws, candidateId);
}

/** Pedido de borrado del propio candidato con el link del email (token de un solo uso). */
export async function forgetByToken(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return false;
  const row = (await getDb().prepare('SELECT id, workspace_id FROM hiring_candidates WHERE forget_token_hash = ?').get(sha256(token))) as { id: string; workspace_id: string } | undefined;
  if (!row) return false;
  return deleteCandidateRows(row.workspace_id, row.id);
}

const PURGE_CLAIM_TTL_MS = 15 * 60_000;

/**
 * Retención: borra candidatos sin actividad hace más de N meses (ajuste del
 * workspace; 0 = nunca), salvo que hayan aceptado quedar para futuras
 * búsquedas o estén contratados. Cada fila se reclama con compare-and-set
 * (purge_claimed_at) para que dos corridas del cron no la borren dos veces.
 */
export async function purgeExpiredCandidates(now = new Date(), limit = 50): Promise<{ purged: number }> {
  const db = getDb();
  const settings = (await db.prepare('SELECT workspace_id, retention_months FROM hiring_settings WHERE retention_months > 0').all()) as Array<{ workspace_id: string; retention_months: number }>;
  let purged = 0;
  const stale = new Date(now.getTime() - PURGE_CLAIM_TTL_MS).toISOString();
  for (const s of settings) {
    const cutoff = cutoffIso(s.retention_months, now);
    const rows = (await db
      .prepare(
        `SELECT id FROM hiring_candidates c WHERE c.workspace_id = ? AND c.last_activity_at < ? AND c.keep_consent = 0
           AND (c.purge_claimed_at IS NULL OR c.purge_claimed_at < ?)
           AND NOT EXISTS (SELECT 1 FROM hiring_applications a WHERE a.candidate_id = c.id AND a.status = 'hired')
         LIMIT ?`,
      )
      .all(s.workspace_id, cutoff, stale, limit - purged)) as Array<{ id: string }>;
    for (const r of rows) {
      const claim = await db
        .prepare(
          `UPDATE hiring_candidates SET purge_claimed_at = ? WHERE id = ? AND last_activity_at < ? AND keep_consent = 0 AND (purge_claimed_at IS NULL OR purge_claimed_at < ?)`,
        )
        .run(now.toISOString(), r.id, cutoff, stale);
      if (!claim.changes) continue;
      if (await deleteCandidateRows(s.workspace_id, r.id)) purged++;
    }
    if (purged >= limit) break;
  }
  return { purged };
}

// ---------- Búsqueda ----------

export interface HiringSearchHit {
  kind: 'job' | 'candidate';
  id: string;
  label: string;
  meta: string;
  href: string;
}

/** Cmd+K: puestos (cualquiera con Hiring) y candidatos solo si la persona los ve. */
export async function searchHiring(actor: HiringActor, q: string): Promise<HiringSearchHit[]> {
  const query = q.trim().slice(0, 100);
  if (!query) return [];
  const like = `%${query}%`;
  const jobs = (await getDb()
    .prepare("SELECT id, title, department, status FROM hiring_jobs WHERE workspace_id = ? AND status != 'archived' AND (title LIKE ? OR department LIKE ?) ORDER BY updated_at DESC LIMIT 6")
    .all(actor.ws, like, like)) as Array<{ id: string; title: string; department: string; status: string }>;
  const apps = await listApplications(actor, { q: query, limit: 30 });
  const seen = new Set<string>();
  const cands: HiringSearchHit[] = [];
  for (const a of apps) {
    if (seen.has(a.candidateId)) continue;
    seen.add(a.candidateId);
    cands.push({ kind: 'candidate', id: a.candidateId, label: a.name, meta: `${a.jobTitle} · ${a.stageName}`, href: `/app/hiring/candidates/${a.candidateId}` });
    if (cands.length >= 8) break;
  }
  return [...jobs.map((j) => ({ kind: 'job' as const, id: j.id, label: j.title, meta: [j.department, j.status].filter(Boolean).join(' · '), href: `/app/hiring/jobs/${j.id}` })), ...cands];
}
