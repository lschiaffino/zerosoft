/**
 * Lead scoring — reglas, schemas y evaluación pura (sin DB). Lo usan la UI de
 * ajustes y lib/crm-scoring.ts.
 *
 * Regla de propiedad: { field, op, value } sobre el contacto (custom: 'custom.<name>').
 * Regla de actividad: { activity, days, min } → suma si hubo al menos `min`
 * ocurrencias en los últimos `days` días.
 */
import { z } from 'zod';

export const SCORE_PROPERTY_FIELDS = [
  'lifecycleStage',
  'leadStatus',
  'source',
  'jobTitle',
  'email',
  'phone',
  'city',
  'country',
  'website',
] as const;

export const SCORE_OPS = ['equals', 'not_equals', 'contains', 'gt', 'lt', 'is_set', 'is_not_set'] as const;
export type ScoreOp = (typeof SCORE_OPS)[number];

export const SCORE_ACTIVITIES = [
  'email_opened',
  'email_clicked',
  'email_replied',
  'meeting_booked',
  'form_submitted',
  'call_logged',
  'note_logged',
] as const;
export type ScoreActivity = (typeof SCORE_ACTIVITIES)[number];

export interface PropertyRuleConfig {
  field: string;
  op: ScoreOp;
  value: string;
}

export interface ActivityRuleConfig {
  activity: ScoreActivity;
  days: number;
  min: number;
}

export interface ScoreRule {
  id: string;
  name: string;
  kind: 'property' | 'activity';
  config: PropertyRuleConfig | ActivityRuleConfig;
  points: number;
  enabled: boolean;
  position: number;
}

export interface ScoreBreakdownItem {
  ruleId: string;
  name: string;
  points: number;
  /** Detalle legible: "3 in 30d" para actividad, valor actual para propiedad. */
  detail: string;
}

const field = z
  .string()
  .trim()
  .max(80)
  .refine((v) => (SCORE_PROPERTY_FIELDS as readonly string[]).includes(v) || /^custom\.[\w-]{1,60}$/.test(v), {
    message: 'invalid_field',
  });

export const propertyRuleSchema = z.object({
  field,
  op: z.enum(SCORE_OPS),
  value: z.string().trim().max(500).default(''),
});

export const activityRuleSchema = z.object({
  activity: z.enum(SCORE_ACTIVITIES),
  days: z.number().int().min(1).max(365),
  min: z.number().int().min(1).max(1000).default(1),
});

export const scoreRuleCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('property'),
    name: z.string().trim().max(200).default(''),
    config: propertyRuleSchema,
    points: z.number().int().min(-1000).max(1000),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('activity'),
    name: z.string().trim().max(200).default(''),
    config: activityRuleSchema,
    points: z.number().int().min(-1000).max(1000),
    enabled: z.boolean().optional(),
  }),
]);
export type ScoreRuleInput = z.infer<typeof scoreRuleCreateSchema>;

/** Columna de crm_contacts para un campo de regla de propiedad. */
export const SCORE_FIELD_COLUMNS: Record<string, string> = {
  lifecycleStage: 'lifecycle_stage',
  leadStatus: 'lead_status',
  source: 'source',
  jobTitle: 'job_title',
  email: 'email',
  phone: 'phone',
  city: 'city',
  country: 'country',
  website: 'website',
};

/** Valor de un campo en una fila de contacto (custom incluido). */
export function contactFieldValue(contact: Record<string, unknown>, fieldName: string): string {
  if (fieldName.startsWith('custom.')) {
    let custom: Record<string, unknown> = {};
    try {
      const parsed: unknown = typeof contact.custom === 'string' ? JSON.parse(contact.custom) : contact.custom;
      if (parsed && typeof parsed === 'object') custom = parsed as Record<string, unknown>;
    } catch {
      custom = {};
    }
    const v = custom[fieldName.slice(7)];
    return v === undefined || v === null ? '' : String(v);
  }
  const col = SCORE_FIELD_COLUMNS[fieldName];
  const v = col ? contact[col] : undefined;
  return v === undefined || v === null ? '' : String(v);
}

export function matchesProperty(actual: string, cfg: PropertyRuleConfig): boolean {
  const a = actual.trim().toLowerCase();
  const v = cfg.value.trim().toLowerCase();
  switch (cfg.op) {
    case 'equals':
      return a === v;
    case 'not_equals':
      return a !== v;
    case 'contains':
      return v !== '' && a.includes(v);
    case 'gt':
    case 'lt': {
      const x = Number(actual);
      const y = Number(cfg.value);
      if (actual.trim() === '' || Number.isNaN(x) || Number.isNaN(y)) return false;
      return cfg.op === 'gt' ? x > y : x < y;
    }
    case 'is_set':
      return a !== '';
    case 'is_not_set':
      return a === '';
  }
}

/** Clave de conteo de una regla de actividad (actividad + ventana). */
export function activityKey(cfg: ActivityRuleConfig): string {
  return `${cfg.activity}:${cfg.days}`;
}

/**
 * Score de un contacto: suma de puntos de las reglas habilitadas que se
 * cumplen. `counts` trae los conteos por activityKey().
 */
export function evaluateScore(
  rules: ScoreRule[],
  contact: Record<string, unknown>,
  counts: Record<string, number>,
): { score: number; breakdown: ScoreBreakdownItem[] } {
  const breakdown: ScoreBreakdownItem[] = [];
  for (const rule of [...rules].sort((a, b) => a.position - b.position)) {
    if (!rule.enabled || !rule.points) continue;
    if (rule.kind === 'property') {
      const cfg = rule.config as PropertyRuleConfig;
      const actual = contactFieldValue(contact, cfg.field);
      if (matchesProperty(actual, cfg)) {
        breakdown.push({ ruleId: rule.id, name: rule.name, points: rule.points, detail: actual });
      }
    } else {
      const cfg = rule.config as ActivityRuleConfig;
      const n = counts[activityKey(cfg)] ?? 0;
      if (n >= Math.max(1, cfg.min)) {
        breakdown.push({ ruleId: rule.id, name: rule.name, points: rule.points, detail: `${n} / ${cfg.days}d` });
      }
    }
  }
  return { score: breakdown.reduce((s, b) => s + b.points, 0), breakdown };
}

/**
 * ¿El cambio de score cruza el umbral? direction: 'up' (de < a >=), 'down'
 * (de >= a <) o 'any'. Sin umbral: cualquier cambio cuenta.
 */
export function crossesThreshold(
  oldScore: number,
  newScore: number,
  threshold: number | null | undefined,
  direction: 'up' | 'down' | 'any' = 'up',
): boolean {
  if (oldScore === newScore) return false;
  if (threshold === null || threshold === undefined || Number.isNaN(threshold)) return true;
  const up = oldScore < threshold && newScore >= threshold;
  const down = oldScore >= threshold && newScore < threshold;
  if (direction === 'up') return up;
  if (direction === 'down') return down;
  return up || down;
}
