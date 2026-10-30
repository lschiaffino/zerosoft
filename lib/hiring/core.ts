/**
 * Hiring: ajustes de la página de empleos, puestos, etapas, equipo de
 * contratación y las reglas de acceso contra la base. Server-only.
 *
 * Privacidad: los datos de un candidato solo los ve quien está en el equipo
 * de contratación de un puesto al que se postuló (recruiter o hiring manager;
 * el interviewer, solo si le asignaron evaluarlo) y los admins. Toda lectura
 * de candidatos pasa por visibleAppsSql / appAccess.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db';
import { listOwnerSpacePeople } from '../workspace';
import { getWorkspace } from '../workspace';
import {
  HiringError,
  MAX_CRITERIA,
  MAX_QUESTIONS,
  MAX_STAGES,
  STAGE_KINDS,
  TEAM_ROLES,
  canManageJob,
  canSeeApplication,
  criterionSchema,
  defaultStages,
  questionSchema,
  slugify,
  type Criterion,
  type HiringActor,
  type JobStatus,
  type Question,
  type StageKind,
  type TeamRole,
} from './types';
import { z } from 'zod';
import { jobTemplate } from './builtin';

export const nowIso = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------- Ajustes ----------

export interface SettingsRow {
  workspace_id: string;
  handle: string;
  company: string;
  intro: string;
  color: string | null;
  locale: string;
  published: number;
  retention_months: number;
  consent_text: string;
  auto_ack: number;
  members_create_jobs: number;
  created_at: string;
  updated_at: string;
}

export const RESERVED_CAREERS_HANDLES = new Set(['api', 'app', 'admin', 'new', 'careers', 'jobs', 'www', 'uploads', 'sitemap', 'robots', 'static', 'assets', 'zerosoft', 'offer', 'privacy']);
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export async function getSettings(ws: string): Promise<SettingsRow | null> {
  return ((await getDb().prepare('SELECT * FROM hiring_settings WHERE workspace_id = ?').get(ws)) as SettingsRow | undefined) ?? null;
}

/** Ajustes del workspace (los crea la primera vez con el nombre del workspace como handle). */
export async function ensureSettings(ws: string, locale = 'en'): Promise<SettingsRow> {
  const existing = await getSettings(ws);
  if (existing) return existing;
  const db = getDb();
  const team = await getWorkspace(ws).catch(() => null);
  const user = (await db.prepare('SELECT name, handle FROM users WHERE id = ?').get(ws)) as { name: string | null; handle: string | null } | undefined;
  const company = (team?.name || user?.name || 'Company').slice(0, 80);
  let root = slugify(user?.handle || company).slice(0, 30);
  if (root.length < 2) root = 'jobs';
  if (RESERVED_CAREERS_HANDLES.has(root)) root = `${root}-jobs`;
  let handle = root;
  for (let i = 2; await db.prepare('SELECT 1 FROM hiring_settings WHERE handle = ?').get(handle); i++) handle = `${root}-${i}`;
  const ts = nowIso();
  await db
    .prepare(
      `INSERT OR IGNORE INTO hiring_settings (workspace_id, handle, company, intro, color, locale, published, retention_months, consent_text, auto_ack, created_at, updated_at)
       VALUES (?, ?, ?, '', NULL, ?, 0, 12, '', 1, ?, ?)`,
    )
    .run(ws, handle, company, ['en', 'es', 'pt'].includes(locale) ? locale : 'en', ts, ts);
  return (await getSettings(ws))!;
}

export const settingsSchema = z.object({
  handle: z.string().trim().toLowerCase().optional(),
  company: z.string().trim().min(1).max(80).optional(),
  intro: z.string().trim().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  published: z.boolean().optional(),
  retentionMonths: z.number().int().min(0).max(120).optional(),
  consentText: z.string().trim().max(1000).optional(),
  autoAck: z.boolean().optional(),
  membersCreateJobs: z.boolean().optional(),
});

export async function updateSettings(actor: HiringActor, input: z.infer<typeof settingsSchema>): Promise<SettingsRow> {
  if (!actor.admin) throw new HiringError('forbidden', 403);
  const cur = await ensureSettings(actor.ws);
  const db = getDb();
  if (input.handle !== undefined && input.handle !== cur.handle) {
    if (!HANDLE_RE.test(input.handle) || RESERVED_CAREERS_HANDLES.has(input.handle)) throw new HiringError('invalid_handle');
    if (await db.prepare('SELECT 1 FROM hiring_settings WHERE handle = ? AND workspace_id != ?').get(input.handle, actor.ws)) throw new HiringError('handle_taken', 409);
  }
  await db
    .prepare(
      `UPDATE hiring_settings SET handle = ?, company = ?, intro = ?, color = ?, locale = ?, published = ?, retention_months = ?, consent_text = ?, auto_ack = ?, members_create_jobs = ?, updated_at = ? WHERE workspace_id = ?`,
    )
    .run(
      input.handle ?? cur.handle,
      input.company ?? cur.company,
      input.intro ?? cur.intro,
      input.color === undefined ? cur.color : input.color,
      input.locale ?? cur.locale,
      input.published === undefined ? cur.published : input.published ? 1 : 0,
      input.retentionMonths ?? cur.retention_months,
      input.consentText ?? cur.consent_text,
      input.autoAck === undefined ? cur.auto_ack : input.autoAck ? 1 : 0,
      input.membersCreateJobs === undefined ? cur.members_create_jobs : input.membersCreateJobs ? 1 : 0,
      nowIso(),
      actor.ws,
    );
  return (await getSettings(actor.ws))!;
}

export function settingsDto(s: SettingsRow) {
  return {
    handle: s.handle,
    company: s.company,
    intro: s.intro,
    color: s.color,
    locale: s.locale,
    published: s.published === 1,
    retentionMonths: s.retention_months,
    consentText: s.consent_text,
    autoAck: s.auto_ack === 1,
    membersCreateJobs: s.members_create_jobs === 1,
  };
}
export type SettingsDto = ReturnType<typeof settingsDto>;

export function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

// ---------- Acceso ----------

export async function jobRole(jobId: string, person: string): Promise<TeamRole | null> {
  const row = (await getDb().prepare('SELECT role FROM hiring_job_members WHERE job_id = ? AND user_id = ?').get(jobId, person)) as { role: TeamRole } | undefined;
  return row?.role ?? null;
}

export interface AppAccess {
  jobRole: TeamRole | null;
  assigned: boolean;
  visible: boolean;
  manage: boolean;
}

export async function appAccess(actor: HiringActor, app: { id: string; job_id: string }): Promise<AppAccess> {
  const role = await jobRole(app.job_id, actor.person);
  const assigned = role === 'interviewer' ? Boolean(await getDb().prepare('SELECT 1 FROM hiring_evaluators WHERE application_id = ? AND user_id = ?').get(app.id, actor.person)) : false;
  return {
    jobRole: role,
    assigned,
    visible: canSeeApplication({ admin: actor.admin, jobRole: role, assigned }),
    manage: canManageJob({ admin: actor.admin, jobRole: role }),
  };
}

/**
 * Predicado SQL de postulaciones visibles (alias `a`). Admins: todo el
 * workspace. Resto: las de sus puestos como recruiter o hiring manager y las
 * que le asignaron evaluar.
 */
export function visibleAppsSql(actor: HiringActor, alias = 'a'): { sql: string; args: string[] } {
  if (actor.admin) return { sql: `${alias}.workspace_id = ?`, args: [actor.ws] };
  return {
    sql: `${alias}.workspace_id = ? AND (EXISTS (SELECT 1 FROM hiring_job_members m WHERE m.job_id = ${alias}.job_id AND m.user_id = ? AND m.role IN ('recruiter','hiring_manager'))
      OR EXISTS (SELECT 1 FROM hiring_evaluators e JOIN hiring_job_members mi ON mi.job_id = ${alias}.job_id AND mi.user_id = e.user_id WHERE e.application_id = ${alias}.id AND e.user_id = ?))`,
    args: [actor.ws, actor.person, actor.person],
  };
}

// ---------- Puestos ----------

export interface JobRow {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  department: string;
  location: string;
  workplace: string;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: string;
  salary_public: number;
  description: string;
  questions: string;
  status: JobStatus;
  template: string;
  created_by: string | null;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageRow {
  id: string;
  job_id: string;
  name: string;
  kind: StageKind;
  position: number;
  criteria: string;
  cal_event_type_id: string | null;
  created_at: string;
}

export function stageDto(s: StageRow) {
  return { id: s.id, name: s.name, kind: s.kind, position: s.position, criteria: parseJson<Criterion[]>(s.criteria, []) };
}
export type StageDto = ReturnType<typeof stageDto>;

export function jobDto(j: JobRow) {
  return {
    id: j.id,
    slug: j.slug,
    title: j.title,
    department: j.department,
    location: j.location,
    workplace: j.workplace,
    employmentType: j.employment_type,
    salaryMin: j.salary_min,
    salaryMax: j.salary_max,
    salaryCurrency: j.salary_currency,
    salaryPeriod: j.salary_period,
    salaryPublic: j.salary_public === 1,
    description: j.description,
    questions: parseJson<Question[]>(j.questions, []),
    status: j.status,
    publishedAt: j.published_at,
    closedAt: j.closed_at,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}
export type JobDto = ReturnType<typeof jobDto>;

export async function getJobRow(ws: string, id: string): Promise<JobRow | null> {
  return ((await getDb().prepare('SELECT * FROM hiring_jobs WHERE id = ? AND workspace_id = ?').get(id, ws)) as JobRow | undefined) ?? null;
}

export async function listStages(jobId: string): Promise<StageRow[]> {
  return (await getDb().prepare('SELECT * FROM hiring_stages WHERE job_id = ? ORDER BY position, created_at').all(jobId)) as StageRow[];
}

export interface TeamMember {
  userId: string;
  role: TeamRole;
  name: string | null;
  email: string;
}

export async function listTeam(jobId: string): Promise<TeamMember[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.user_id, m.role, u.name, u.email FROM hiring_job_members m JOIN users u ON u.id = m.user_id WHERE m.job_id = ?
       ORDER BY CASE m.role WHEN 'hiring_manager' THEN 0 WHEN 'recruiter' THEN 1 ELSE 2 END, u.name`,
    )
    .all(jobId)) as Array<{ user_id: string; role: TeamRole; name: string | null; email: string }>;
  return rows.map((r) => ({ userId: r.user_id, role: r.role, name: r.name, email: r.email }));
}

export interface JobListItem extends JobDto {
  myRole: TeamRole | null;
  /** Candidatos activos (solo si la persona ve el pipeline del puesto). */
  activeCount: number | null;
  canManage: boolean;
}

export async function listJobs(actor: HiringActor, opts: { status?: string; q?: string } = {}): Promise<JobListItem[]> {
  const where = ['j.workspace_id = ?'];
  const args: Array<string> = [actor.ws];
  if (opts.status && opts.status !== 'all') {
    where.push('j.status = ?');
    args.push(opts.status);
  } else if (!opts.status) {
    where.push("j.status != 'archived'");
  }
  if (opts.q?.trim()) {
    where.push('(j.title LIKE ? OR j.department LIKE ? OR j.location LIKE ?)');
    const like = `%${opts.q.trim().slice(0, 100)}%`;
    args.push(like, like, like);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT j.*, (SELECT role FROM hiring_job_members m WHERE m.job_id = j.id AND m.user_id = ?) AS my_role,
              (SELECT COUNT(*) FROM hiring_applications a WHERE a.job_id = j.id AND a.status = 'active') AS active_count
       FROM hiring_jobs j WHERE ${where.join(' AND ')}
       ORDER BY CASE j.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END, j.updated_at DESC LIMIT 500`,
    )
    .all(actor.person, ...args)) as Array<JobRow & { my_role: TeamRole | null; active_count: number }>;
  return rows.map((r) => {
    const manage = canManageJob({ admin: actor.admin, jobRole: r.my_role });
    return { ...jobDto(r), myRole: r.my_role, activeCount: manage ? Number(r.active_count) : null, canManage: manage };
  });
}

export interface JobDetail {
  job: JobDto;
  stages: StageDto[];
  team: TeamMember[];
  myRole: TeamRole | null;
  canManage: boolean;
}

export async function getJob(actor: HiringActor, id: string): Promise<JobDetail | null> {
  const row = await getJobRow(actor.ws, id);
  if (!row) return null;
  const [stages, team, role] = await Promise.all([listStages(id), listTeam(id), jobRole(id, actor.person)]);
  return { job: jobDto(row), stages: stages.map(stageDto), team, myRole: role, canManage: canManageJob({ admin: actor.admin, jobRole: role }) };
}

export const jobInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  department: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  workplace: z.enum(['onsite', 'hybrid', 'remote']).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'temporary', 'internship']).optional(),
  salaryMin: z.number().int().min(0).max(100_000_000).nullable().optional(),
  salaryMax: z.number().int().min(0).max(100_000_000).nullable().optional(),
  salaryCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  salaryPeriod: z.enum(['year', 'month', 'hour']).optional(),
  salaryPublic: z.boolean().optional(),
  description: z.string().max(20_000).optional(),
  questions: z.array(questionSchema).max(MAX_QUESTIONS).optional(),
  status: z.enum(['draft', 'published', 'closed', 'archived']).optional(),
  template: z.string().trim().max(60).optional(),
});
export type JobInput = z.infer<typeof jobInputSchema>;

async function uniqueSlug(ws: string, title: string, exceptId?: string): Promise<string> {
  const root = slugify(title);
  const db = getDb();
  let slug = root;
  for (let i = 2; ; i++) {
    const hit = (await db.prepare('SELECT id FROM hiring_jobs WHERE workspace_id = ? AND slug = ?').get(ws, slug)) as { id: string } | undefined;
    if (!hit || hit.id === exceptId) return slug;
    slug = `${root}-${i}`;
  }
}

function checkSalary(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null && min > max) throw new HiringError('invalid_salary');
}

function checkQuestions(qs: Question[]) {
  const ids = new Set<string>();
  for (const q of qs) {
    if (ids.has(q.id)) throw new HiringError('duplicate_question');
    ids.add(q.id);
    if (q.type === 'select' && q.options.length === 0) throw new HiringError('question_options');
  }
}

/** Crea un puesto (borrador). Quien lo crea queda como recruiter. Con `template`, arranca de una plantilla integrada o del workspace. */
/** Crear puestos: admins, o cualquiera con Hiring si un admin lo habilita en Ajustes. */
export function canCreateJobs(actor: HiringActor, settings: Pick<SettingsRow, 'members_create_jobs'>): boolean {
  return actor.admin || settings.members_create_jobs === 1;
}

export async function createJob(actor: HiringActor, input: JobInput, locale = 'en'): Promise<JobDetail> {
  const settings = await ensureSettings(actor.ws, locale);
  if (!canCreateJobs(actor, settings)) throw new HiringError('forbidden', 403);
  let base: Partial<JobInput> = {};
  if (input.template) {
    const builtin = jobTemplate(settings.locale, input.template) ?? jobTemplate(locale, input.template);
    if (builtin) base = { department: builtin.department, employmentType: builtin.employmentType, description: builtin.description, questions: builtin.questions };
    else {
      const t = (await getDb().prepare("SELECT subject, body FROM hiring_templates WHERE id = ? AND workspace_id = ? AND kind = 'job'").get(input.template, actor.ws)) as
        | { subject: string; body: string }
        | undefined;
      if (t) {
        const saved = parseJson<Partial<JobInput>>(t.body, {});
        base = { department: saved.department, employmentType: saved.employmentType, description: saved.description, questions: saved.questions, workplace: saved.workplace };
      }
    }
  }
  const merged = { ...base, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as JobInput;
  checkSalary(merged.salaryMin, merged.salaryMax);
  const questions = merged.questions ?? [];
  checkQuestions(questions);
  const id = newId('job');
  const ts = nowIso();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO hiring_jobs (id, workspace_id, slug, title, department, location, workplace, employment_type, salary_min, salary_max, salary_currency, salary_period,
        salary_public, description, questions, status, template, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.ws,
      await uniqueSlug(actor.ws, merged.title),
      merged.title,
      merged.department ?? '',
      merged.location ?? '',
      merged.workplace ?? 'onsite',
      merged.employmentType ?? 'full_time',
      merged.salaryMin ?? null,
      merged.salaryMax ?? null,
      merged.salaryCurrency ?? 'USD',
      merged.salaryPeriod ?? 'year',
      merged.salaryPublic ? 1 : 0,
      merged.description ?? '',
      JSON.stringify(questions),
      input.template ?? '',
      actor.person,
      ts,
      ts,
    );
  await db.prepare('INSERT INTO hiring_job_members (job_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(id, actor.person, 'recruiter', ts);
  let pos = 0;
  for (const s of defaultStages(settings.locale)) {
    await db
      .prepare('INSERT INTO hiring_stages (id, job_id, name, kind, position, criteria, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('stg'), id, s.name, s.kind, pos++, JSON.stringify(s.criteria), ts);
  }
  if (input.status && input.status !== 'draft') await updateJob(actor, id, { status: input.status });
  return (await getJob(actor, id))!;
}

export async function requireManage(actor: HiringActor, jobId: string): Promise<JobRow> {
  const job = await getJobRow(actor.ws, jobId);
  if (!job) throw new HiringError('not_found', 404);
  if (!canManageJob({ admin: actor.admin, jobRole: await jobRole(jobId, actor.person) })) throw new HiringError('forbidden', 403);
  return job;
}

export async function updateJob(actor: HiringActor, id: string, patch: Partial<JobInput>): Promise<JobDetail> {
  const cur = await requireManage(actor, id);
  const next = {
    title: patch.title ?? cur.title,
    department: patch.department ?? cur.department,
    location: patch.location ?? cur.location,
    workplace: patch.workplace ?? cur.workplace,
    employment_type: patch.employmentType ?? cur.employment_type,
    salary_min: patch.salaryMin === undefined ? cur.salary_min : patch.salaryMin,
    salary_max: patch.salaryMax === undefined ? cur.salary_max : patch.salaryMax,
    salary_currency: patch.salaryCurrency ?? cur.salary_currency,
    salary_period: patch.salaryPeriod ?? cur.salary_period,
    salary_public: patch.salaryPublic === undefined ? cur.salary_public : patch.salaryPublic ? 1 : 0,
    description: patch.description ?? cur.description,
    questions: patch.questions ? JSON.stringify(patch.questions) : cur.questions,
    status: patch.status ?? cur.status,
  };
  checkSalary(next.salary_min, next.salary_max);
  if (patch.questions) checkQuestions(patch.questions);
  if (next.status === 'published' && !next.description.trim()) throw new HiringError('description_required');
  const ts = nowIso();
  const slug = patch.title && patch.title !== cur.title && cur.status === 'draft' ? await uniqueSlug(actor.ws, patch.title, id) : cur.slug;
  await getDb()
    .prepare(
      `UPDATE hiring_jobs SET slug = ?, title = ?, department = ?, location = ?, workplace = ?, employment_type = ?, salary_min = ?, salary_max = ?, salary_currency = ?,
        salary_period = ?, salary_public = ?, description = ?, questions = ?, status = ?,
        published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN ? ELSE published_at END,
        closed_at = CASE WHEN ? IN ('closed','archived') THEN COALESCE(closed_at, ?) WHEN ? = 'published' THEN NULL ELSE closed_at END,
        updated_at = ? WHERE id = ?`,
    )
    .run(
      slug,
      next.title,
      next.department,
      next.location,
      next.workplace,
      next.employment_type,
      next.salary_min,
      next.salary_max,
      next.salary_currency,
      next.salary_period,
      next.salary_public,
      next.description,
      next.questions,
      next.status,
      next.status,
      ts,
      next.status,
      ts,
      next.status,
      ts,
      id,
    );
  return (await getJob(actor, id))!;
}

/** Borra el puesto y sus postulaciones (los candidatos quedan, con sus otras postulaciones). */
export async function deleteJob(actor: HiringActor, id: string): Promise<void> {
  await requireManage(actor, id);
  const db = getDb();
  const apps = (await db.prepare('SELECT id FROM hiring_applications WHERE job_id = ?').all(id)) as Array<{ id: string }>;
  for (const a of apps) await deleteApplicationRows(a.id);
  await db.prepare('DELETE FROM hiring_stages WHERE job_id = ?').run(id);
  await db.prepare('DELETE FROM hiring_job_members WHERE job_id = ?').run(id);
  await db.prepare('DELETE FROM hiring_jobs WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

export async function deleteApplicationRows(appId: string): Promise<void> {
  const db = getDb();
  // Los tipos de evento de Cal de sus entrevistas dejan de aceptar reservas.
  await db.prepare("UPDATE calendar_event_types SET active = 0 WHERE kind = 'hiring' AND id IN (SELECT event_type_id FROM hiring_interviews WHERE application_id = ?)").run(appId);
  for (const t of ['hiring_evaluators', 'hiring_scorecards', 'hiring_interviews', 'hiring_offers']) await db.prepare(`DELETE FROM ${t} WHERE application_id = ?`).run(appId);
  await db.prepare('DELETE FROM hiring_events WHERE application_id = ?').run(appId);
  await db.prepare('DELETE FROM hiring_applications WHERE id = ?').run(appId);
}

export const teamSchema = z.array(z.object({ userId: z.string().min(1).max(80), role: z.enum(TEAM_ROLES) })).max(50);

/** Reemplaza el equipo del puesto. Solo personas del workspace con Hiring. */
export async function setTeam(actor: HiringActor, jobId: string, members: z.infer<typeof teamSchema>): Promise<TeamMember[]> {
  await requireManage(actor, jobId);
  const people = new Set((await listOwnerSpacePeople(actor.ws, { app: 'hiring' })).map((p) => p.id));
  const seen = new Set<string>();
  for (const m of members) {
    if (!people.has(m.userId)) throw new HiringError('invalid_member');
    if (seen.has(m.userId)) throw new HiringError('duplicate_member');
    seen.add(m.userId);
  }
  const db = getDb();
  const ts = nowIso();
  await db.prepare('DELETE FROM hiring_job_members WHERE job_id = ?').run(jobId);
  for (const m of members) await db.prepare('INSERT INTO hiring_job_members (job_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(jobId, m.userId, m.role, ts);
  // Quien sale del equipo deja de evaluar (y de ver) las postulaciones del puesto.
  await db
    .prepare(
      `DELETE FROM hiring_evaluators WHERE application_id IN (SELECT id FROM hiring_applications WHERE job_id = ?)
       AND user_id NOT IN (SELECT user_id FROM hiring_job_members WHERE job_id = ?)`,
    )
    .run(jobId, jobId);
  return listTeam(jobId);
}

export const stagesSchema = z
  .array(z.object({ id: z.string().max(60).optional(), name: z.string().trim().min(1).max(60), kind: z.enum(STAGE_KINDS), criteria: z.array(criterionSchema).max(MAX_CRITERIA).default([]) }))
  .min(2)
  .max(MAX_STAGES);

/** Reemplaza las etapas: la primera es "applied" y tiene que haber una "hired". No se borra una etapa con candidatos. */
export async function setStages(actor: HiringActor, jobId: string, stages: z.infer<typeof stagesSchema>): Promise<StageDto[]> {
  await requireManage(actor, jobId);
  if (stages[0].kind !== 'applied' || stages.filter((s) => s.kind === 'applied').length !== 1) throw new HiringError('stages_applied_first');
  if (stages.filter((s) => s.kind === 'hired').length !== 1) throw new HiringError('stages_one_hired');
  const db = getDb();
  const current = await listStages(jobId);
  const keep = new Set(stages.map((s) => s.id).filter(Boolean));
  for (const s of current) {
    if (keep.has(s.id)) continue;
    const used = await db.prepare('SELECT 1 FROM hiring_applications WHERE stage_id = ? LIMIT 1').get(s.id);
    if (used) throw new HiringError('stage_not_empty', 409, { stage: s.name });
  }
  const ts = nowIso();
  for (const s of current) if (!keep.has(s.id)) await db.prepare('DELETE FROM hiring_stages WHERE id = ?').run(s.id);
  let pos = 0;
  for (const s of stages) {
    const exists = s.id && current.some((c) => c.id === s.id);
    if (exists) {
      await db.prepare('UPDATE hiring_stages SET name = ?, kind = ?, position = ?, criteria = ? WHERE id = ? AND job_id = ?').run(s.name, s.kind, pos++, JSON.stringify(s.criteria), s.id!, jobId);
    } else {
      await db
        .prepare('INSERT INTO hiring_stages (id, job_id, name, kind, position, criteria, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId('stg'), jobId, s.name, s.kind, pos++, JSON.stringify(s.criteria), ts);
    }
  }
  await db.prepare('UPDATE hiring_jobs SET updated_at = ? WHERE id = ?').run(ts, jobId);
  return (await listStages(jobId)).map(stageDto);
}

/** Personas del workspace con Hiring (para armar el equipo). */
export async function hiringPeople(ws: string) {
  return listOwnerSpacePeople(ws, { app: 'hiring' });
}
