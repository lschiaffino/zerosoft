/**
 * Analytics (encuestas, errores, LLM, extras de web): esquemas y tipos
 * compartidos entre el servidor, la UI y los tests. Sin acceso a la base ni a
 * crypto: se puede importar desde componentes cliente.
 */
import { z } from 'zod';
import { flagKeySchema, propertyFilterSchema } from './types';

// ---------- Encuestas ----------

export const SURVEY_STATUSES = ['draft', 'running', 'paused', 'ended'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const SURVEY_QUESTION_TYPES = ['open', 'rating', 'single', 'multiple'] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const SURVEY_POSITIONS = ['bottom-right', 'bottom-left', 'center'] as const;
export const SURVEY_MAX_QUESTIONS = 5;
export const SURVEY_MAX_CHOICES = 10;
export const SURVEY_TEXT_CAP = 2000;

/** Solo #rrggbb: es lo único que llega al CSS del sitio del cliente. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const hexSchema = z.string().regex(HEX_COLOR);

export const surveyQuestionSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    type: z.enum(SURVEY_QUESTION_TYPES),
    text: z.string().trim().min(1).max(500),
    description: z.string().trim().max(500).default(''),
    scale: z.union([z.literal(5), z.literal(10)]).default(5),
    lowLabel: z.string().trim().max(60).default(''),
    highLabel: z.string().trim().max(60).default(''),
    choices: z.array(z.string().trim().min(1).max(120)).max(SURVEY_MAX_CHOICES).default([]),
    optional: z.boolean().default(false),
  })
  .refine((q) => !(q.type === 'single' || q.type === 'multiple') || (q.choices.length >= 2 && new Set(q.choices).size === q.choices.length), { message: 'invalid_choices' });
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

export const surveyAppearanceSchema = z.object({
  position: z.enum(SURVEY_POSITIONS).default('bottom-right'),
  background: hexSchema.default('#ffffff'),
  text: hexSchema.default('#111111'),
  button: hexSchema.default('#111111'),
  buttonText: hexSchema.default('#ffffff'),
  submitText: z.string().trim().min(1).max(40).default('Submit'),
  thankYou: z.string().trim().max(200).default(''),
});
export type SurveyAppearance = z.infer<typeof surveyAppearanceSchema>;

export const surveyTargetingSchema = z.object({
  urlContains: z.string().trim().max(300).default(''),
  flagKey: flagKeySchema.nullable().default(null),
  personFilter: propertyFilterSchema.pick({ key: true, op: true, value: true }).nullable().default(null),
  showOnce: z.boolean().default(true),
  delaySeconds: z.number().int().min(0).max(600).default(0),
  sampling: z.number().int().min(1).max(100).default(100),
});
export type SurveyTargeting = z.infer<typeof surveyTargetingSchema>;

const ms = z.number().int().min(0).max(4_102_444_800_000);

export const surveyPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(SURVEY_STATUSES).optional(),
  presentation: z.enum(['popover', 'api']).optional(),
  questions: z.array(surveyQuestionSchema).min(1).max(SURVEY_MAX_QUESTIONS).optional(),
  appearance: surveyAppearanceSchema.optional(),
  targeting: surveyTargetingSchema.optional(),
  startAt: ms.nullable().optional(),
  endAt: ms.nullable().optional(),
});
export type SurveyPatch = z.infer<typeof surveyPatchSchema>;

export interface SurveyDto {
  id: string;
  name: string;
  status: SurveyStatus;
  presentation: 'popover' | 'api';
  questions: SurveyQuestion[];
  appearance: SurveyAppearance;
  targeting: SurveyTargeting;
  startAt: number | null;
  endAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyListItem extends SurveyDto {
  responses: number;
}

/** Lo que recibe el sitio del cliente: sin nombre interno ni condiciones (se evalúan en el servidor). */
export interface PublicSurvey {
  id: string;
  type: 'popover' | 'api';
  questions: SurveyQuestion[];
  appearance: SurveyAppearance;
  urlContains: string;
  showOnce: boolean;
  delaySeconds: number;
}

export type SurveyQuestionResult =
  | { id: string; type: 'rating'; text: string; answered: number; invalid: number; scale: 5 | 10; distribution: number[]; average: number | null; nps: number | null; promoters: number; passives: number; detractors: number }
  | { id: string; type: 'single' | 'multiple'; text: string; answered: number; invalid: number; choices: Array<{ label: string; count: number }> }
  | { id: string; type: 'open'; text: string; answered: number; invalid: number; answers: Array<{ ts: number; distinctId: string; text: string }> };

export interface SurveyResults {
  shown: number;
  dismissed: number;
  sent: number;
  questions: SurveyQuestionResult[];
  truncated: boolean;
}

// ---------- Errores ----------

export const ISSUE_STATUSES = ['open', 'resolved', 'ignored'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssueEffectiveStatus = IssueStatus | 'regression';

export const ISSUE_FILTERS = ['active', 'regression', 'resolved', 'ignored', 'all'] as const;
export type IssueFilter = (typeof ISSUE_FILTERS)[number];

export const FINGERPRINT = /^[0-9a-f]{32}$/;

export const issuePatchSchema = z.object({
  projectId: z.string().max(64),
  status: z.enum(ISSUE_STATUSES).optional(),
  assigneeId: z.string().max(100).nullable().optional(),
});

export interface StackFrame {
  file: string;
  function: string;
  line: number | null;
  column: number | null;
}

export interface IssueRow {
  fingerprint: string;
  type: string;
  message: string;
  occurrences: number;
  people: number;
  firstSeen: number;
  lastSeen: number;
  status: IssueEffectiveStatus;
  assigneeId: string | null;
  spark: number[];
}

export interface IssueListResult {
  issues: IssueRow[];
  truncated: boolean;
}

export interface IssueOccurrence {
  id: number;
  ts: number;
  distinctId: string;
  personId: string | null;
  url: string | null;
  browser: string | null;
  os: string | null;
}

export interface IssueDetail {
  fingerprint: string;
  type: string;
  message: string;
  frames: StackFrame[];
  occurrences: number;
  people: number;
  firstSeen: number | null;
  lastSeen: number | null;
  status: IssueEffectiveStatus;
  assigneeId: string | null;
  buckets: string[];
  series: number[];
  recent: IssueOccurrence[];
  topPeople: Array<{ key: string; personId: string | null; count: number }>;
  truncated: boolean;
}

/** Dirección de un error: proyecto y huella van juntos (la huella sola no dice de quién es). */
export function issueRef(projectId: string, fingerprint: string): string {
  return `${projectId}~${fingerprint}`;
}

export function parseIssueRef(ref: string): { projectId: string; fingerprint: string } | null {
  let decoded = ref;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    return null;
  }
  const at = decoded.lastIndexOf('~');
  if (at <= 0) return null;
  const projectId = decoded.slice(0, at);
  const fingerprint = decoded.slice(at + 1);
  return projectId.length <= 64 && FINGERPRINT.test(fingerprint) ? { projectId, fingerprint } : null;
}

// ---------- LLM ----------

export interface LlmTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: number;
}

export interface LlmModelRow extends LlmTotals {
  model: string;
  provider: string | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface LlmOverview {
  totals: LlmTotals;
  models: LlmModelRow[];
  buckets: string[];
  callsPerDay: number[];
  costPerDay: number[];
  truncated: boolean;
}

export interface LlmGeneration {
  id: number;
  ts: number;
  model: string;
  provider: string | null;
  traceId: string | null;
  distinctId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
  isError: boolean;
}

export interface LlmTrace {
  traceId: string;
  generations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: number;
  firstTs: number;
  lastTs: number;
}

export interface LlmGenerationDetail extends LlmGeneration {
  input: string | null;
  output: string | null;
  errorText: string | null;
}

// ---------- Web ----------

export const WEB_FILTER_KEYS = ['path', 'host', 'device', 'country', 'channel', 'referrer', 'utm', 'browser', 'os'] as const;
export type WebFilterKey = (typeof WEB_FILTER_KEYS)[number];

export const webFilterSchema = z.object({
  key: z.enum(WEB_FILTER_KEYS),
  value: z.string().min(1).max(500),
});
export type WebFilter = z.infer<typeof webFilterSchema>;

export const CHANNEL_KEYS = ['direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'referral', 'email'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const VITAL_METRICS = ['LCP', 'INP', 'CLS', 'FCP'] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];
export type VitalRating = 'good' | 'needs_improvement' | 'poor';

/** Umbrales de web.dev: hasta `good` está bien, más de `poor` está mal. */
export const VITAL_THRESHOLDS: Record<VitalMetric, { good: number; poor: number; max: number }> = {
  LCP: { good: 2500, poor: 4000, max: 120_000 },
  INP: { good: 200, poor: 500, max: 120_000 },
  CLS: { good: 0.1, poor: 0.25, max: 50 },
  FCP: { good: 1800, poor: 3000, max: 120_000 },
};

export function vitalRating(metric: VitalMetric, value: number): VitalRating {
  const t = VITAL_THRESHOLDS[metric];
  return value <= t.good ? 'good' : value > t.poor ? 'poor' : 'needs_improvement';
}

export interface VitalSummary {
  metric: VitalMetric;
  p75: number | null;
  samples: number;
  rating: VitalRating | null;
}

export interface VitalsResult {
  metrics: VitalSummary[];
  pages: Array<{ path: string; samples: number; metrics: VitalSummary[] }>;
  samples: number;
  truncated: boolean;
}
