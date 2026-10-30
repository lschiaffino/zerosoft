/**
 * Hiring: tipos, constantes y reglas puras (sin DB). Lo comparten el
 * servidor, los componentes y los tests.
 */
import { z } from 'zod';

export class HiringError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'HiringError';
  }
}

/** Quién hace el pedido: ws = owner del workspace, person = la persona real. */
export interface HiringActor {
  ws: string;
  person: string;
  /** Owner o admin del workspace: ve todo. */
  admin: boolean;
}

export const JOB_STATUSES = ['draft', 'published', 'closed', 'archived'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const WORKPLACES = ['onsite', 'hybrid', 'remote'] as const;
export type Workplace = (typeof WORKPLACES)[number];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'temporary', 'internship'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const SALARY_PERIODS = ['year', 'month', 'hour'] as const;
export const TEAM_ROLES = ['recruiter', 'hiring_manager', 'interviewer'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
/** Tipo de etapa: decide qué hace la app al entrar (pedir scorecards, agendar, ofertar, contratar). */
export const STAGE_KINDS = ['applied', 'review', 'interview', 'offer', 'hired'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const APP_STATUSES = ['active', 'rejected', 'hired', 'withdrawn'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];
export const SOURCES = ['careers', 'referral', 'linkedin', 'manual', 'email', 'other'] as const;
export type Source = (typeof SOURCES)[number];
export const OVERALL = ['strong_no', 'no', 'yes', 'strong_yes'] as const;
export type Overall = (typeof OVERALL)[number];
export const TEMPLATE_KINDS = ['ack', 'rejection', 'interview', 'offer', 'custom', 'offer_letter', 'job'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const OFFER_STATUSES = ['pending_approval', 'approved', 'sent', 'accepted', 'declined', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const QUESTION_TYPES = ['text', 'textarea', 'yesno', 'select', 'number'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const MAX_QUESTIONS = 20;
export const MAX_STAGES = 12;
export const MAX_CRITERIA = 10;
export const MAX_TAGS = 20;
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

// ---------- Preguntas y knock-out ----------

export const questionSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().trim().min(1).max(300),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  /**
   * Knock-out: la respuesta que se espera. yesno → 'yes' | 'no'; select →
   * opciones aceptadas; number → mínimo. Una respuesta distinta marca la
   * postulación para revisión: nunca se rechaza sola.
   */
  knockout: z
    .object({ accepted: z.array(z.string().trim().max(120)).max(20).default([]), min: z.number().nullable().default(null) })
    .nullable()
    .default(null),
});
export type Question = z.infer<typeof questionSchema>;

export type Answers = Record<string, string>;

/** Respuestas que faltan (obligatorias vacías) o con formato inválido. */
export function answerErrors(questions: Question[], answers: Answers): string[] {
  const out: string[] = [];
  for (const q of questions) {
    const v = (answers[q.id] ?? '').trim();
    if (!v) {
      if (q.required) out.push(q.id);
      continue;
    }
    if (q.type === 'yesno' && v !== 'yes' && v !== 'no') out.push(q.id);
    else if (q.type === 'select' && !q.options.includes(v)) out.push(q.id);
    else if (q.type === 'number' && !Number.isFinite(Number(v))) out.push(q.id);
    else if (v.length > 5000) out.push(q.id);
  }
  return out;
}

/** Preguntas knock-out que la respuesta no cumple (ids). Sin respuesta en una knock-out = no cumple. */
export function failedKnockouts(questions: Question[], answers: Answers): string[] {
  const out: string[] = [];
  for (const q of questions) {
    if (!q.knockout) continue;
    const v = (answers[q.id] ?? '').trim();
    if (q.type === 'number') {
      const min = q.knockout.min;
      if (min == null) continue;
      if (!v || !Number.isFinite(Number(v)) || Number(v) < min) out.push(q.id);
      continue;
    }
    const accepted = q.knockout.accepted;
    if (accepted.length === 0) continue;
    if (!accepted.includes(v)) out.push(q.id);
  }
  return out;
}

/** Solo las respuestas a preguntas del puesto, recortadas. */
export function cleanAnswers(questions: Question[], raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const q of questions) {
    const v = raw[q.id];
    if (typeof v === 'string' && v.trim()) out[q.id] = v.trim().slice(0, 5000);
  }
  return out;
}

// ---------- Etapas y scorecards ----------

export const criterionSchema = z.object({ id: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/), label: z.string().trim().min(1).max(160) });
export type Criterion = z.infer<typeof criterionSchema>;

export interface StageSpec {
  name: string;
  kind: StageKind;
  criteria: Criterion[];
}

const C = (id: string, label: string): Criterion => ({ id, label });

/** Etapas por defecto de un puesto nuevo (en el idioma del workspace). */
export function defaultStages(locale: string): StageSpec[] {
  const l = locale === 'es' ? 1 : locale === 'pt' ? 2 : 0;
  const n = (en: string, es: string, pt: string) => [en, es, pt][l];
  return [
    { name: n('Applied', 'Postulados', 'Candidatos'), kind: 'applied', criteria: [] },
    {
      name: n('Phone screen', 'Primera llamada', 'Triagem'),
      kind: 'review',
      criteria: [C('communication', n('Communication', 'Comunicación', 'Comunicação')), C('motivation', n('Motivation', 'Motivación', 'Motivação'))],
    },
    {
      name: n('Interview', 'Entrevista', 'Entrevista'),
      kind: 'interview',
      criteria: [
        C('skills', n('Role skills', 'Habilidades del puesto', 'Habilidades da vaga')),
        C('problem_solving', n('Problem solving', 'Resolución de problemas', 'Resolução de problemas')),
        C('collaboration', n('Collaboration', 'Trabajo en equipo', 'Colaboração')),
      ],
    },
    { name: n('Offer', 'Oferta', 'Oferta'), kind: 'offer', criteria: [] },
    { name: n('Hired', 'Contratados', 'Contratados'), kind: 'hired', criteria: [] },
  ];
}

export const RATING_MIN = 1;
export const RATING_MAX = 4;

/**
 * ¿Puede ver los scorecards de los demás en esta postulación? Admins,
 * recruiters y hiring managers del puesto, siempre. Un interviewer, solo
 * después de enviar el suyo (para no influirse con lo que puso otro).
 */
export function canSeeOthersScores(opts: { admin: boolean; jobRole: TeamRole | null; submittedOwn: boolean }): boolean {
  if (opts.admin) return true;
  if (opts.jobRole === 'recruiter' || opts.jobRole === 'hiring_manager') return true;
  if (opts.jobRole === 'interviewer') return opts.submittedOwn;
  return false;
}

/**
 * ¿Puede ver la postulación (y con ella el candidato)? Admins todo; recruiter
 * y hiring manager, las de su puesto; un interviewer, solo las que le
 * asignaron para evaluar. Nadie más.
 */
export function canSeeApplication(opts: { admin: boolean; jobRole: TeamRole | null; assigned: boolean }): boolean {
  if (opts.admin) return true;
  if (opts.jobRole === 'recruiter' || opts.jobRole === 'hiring_manager') return true;
  return opts.jobRole === 'interviewer' && opts.assigned;
}

/** Manejar el puesto y sus candidatos (mover, rechazar, emails, ofertas). */
export function canManageJob(opts: { admin: boolean; jobRole: TeamRole | null }): boolean {
  return opts.admin || opts.jobRole === 'recruiter' || opts.jobRole === 'hiring_manager';
}

/** Aprobar una oferta: el hiring manager del puesto o un admin. El recruiter la prepara, no la aprueba. */
export function canApproveOffer(opts: { admin: boolean; jobRole: TeamRole | null }): boolean {
  return opts.admin || opts.jobRole === 'hiring_manager';
}

// ---------- Texto ----------

export function slugify(input: string): string {
  const s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'job';
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** {{candidate.name}} y compañía. Lo desconocido queda vacío. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

export const TEMPLATE_VARIABLES = [
  'candidate.name',
  'candidate.firstName',
  'job.title',
  'company',
  'sender.name',
  'schedulingLink',
  'offerLink',
  'privacyLink',
] as const;

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Resume aceptado por sus bytes: PDF, DOCX (zip) o DOC (OLE). null si no es ninguno. */
export function sniffResume(bytes: Uint8Array, filename: string): { mime: string; ext: string } | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' };
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 && ext === 'docx') {
    return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  }
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && ext === 'doc') return { mime: 'application/msword', ext: 'doc' };
  return null;
}

/** Fuente de una postulación desde utm_source / referrer (careers page por defecto). */
export function sourceFrom(utm: Record<string, string>, referrer: string, explicit?: string | null): Source {
  if (explicit && (SOURCES as readonly string[]).includes(explicit)) return explicit as Source;
  const s = `${utm.utm_source ?? ''} ${referrer}`.toLowerCase();
  if (s.includes('linkedin')) return 'linkedin';
  if (s.includes('referral') || s.includes('referido')) return 'referral';
  return 'careers';
}

export function cutoffIso(months: number, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}
