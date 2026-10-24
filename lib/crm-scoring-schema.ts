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
  /** Score al que suma (crm_scores); sin dato = el principal. */
  scoreId?: string | null;
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
  /** La actividad es vieja: los puntos se redujeron por decaimiento. */
  decayed?: boolean;
}

// ---------- Varios scores: umbrales y decaimiento ----------

/** Umbral de un score: desde `min` puntos el contacto cae en `label` (p. ej. Hot). */
export interface ScoreThreshold {
  label: string;
  min: number;
}

export interface ScoreDef {
  id: string;
  name: string;
  isPrimary: boolean;
  thresholds: ScoreThreshold[];
  /** Decaimiento: si lo último que cumple una regla de actividad tiene más de N días… */
  decayDays: number | null;
  /** …sus puntos bajan este porcentaje (0 = sin decaimiento). */
  decayPct: number;
  position: number;
}

export const MAX_SCORES = 10;

export const thresholdsSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(40), min: z.number().int().min(-100_000).max(100_000) }))
  .max(6)
  .default([]);

export const scoreDefSchema = z.object({
  name: z.string().trim().min(1).max(80),
  thresholds: thresholdsSchema.optional(),
  decayDays: z.number().int().min(1).max(730).nullable().optional(),
  decayPct: z.number().int().min(0).max(100).optional(),
});
export type ScoreDefInput = z.infer<typeof scoreDefSchema>;

/** Umbrales válidos y ordenados de menor a mayor (sin labels repetidos). */
export function normalizeThresholds(raw: unknown): ScoreThreshold[] {
  const parsed = thresholdsSchema.safeParse(raw);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  return [...parsed.data]
    .sort((a, b) => a.min - b.min)
    .filter((x) => {
      const k = x.label.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function parseThresholds(json: string | null | undefined): ScoreThreshold[] {
  try {
    return normalizeThresholds(JSON.parse(json || '[]'));
  } catch {
    return [];
  }
}

/** Tramo del score: el umbral más alto que alcanza (null = debajo de todos o sin umbrales). */
export function scoreTier(score: number, thresholds: ScoreThreshold[]): string | null {
  let tier: string | null = null;
  for (const th of [...thresholds].sort((a, b) => a.min - b.min)) {
    if (score >= th.min) tier = th.label;
  }
  return tier;
}

/** Rango de puntos de cada tramo: [min, max) con max = el min del siguiente (null = sin techo). */
export function tierRanges(thresholds: ScoreThreshold[]): Array<{ label: string; min: number; max: number | null }> {
  const sorted = [...thresholds].sort((a, b) => a.min - b.min);
  return sorted.map((th, i) => ({ label: th.label, min: th.min, max: i + 1 < sorted.length ? sorted[i + 1].min : null }));
}

/** Valor de filtro de un tramo ("min|max", max vacío = sin techo) y su parseo. */
export function tierFilterValue(r: { min: number; max: number | null }): string {
  return `${r.min}|${r.max ?? ''}`;
}

export function parseTierFilter(v: string): { min: number; max: number | null } | null {
  const m = /^(-?\d{1,7})\|(-?\d{1,7})?$/.exec(v.trim());
  if (!m) return null;
  return { min: Number(m[1]), max: m[2] === undefined ? null : Number(m[2]) };
}

/** Puntos de una regla de actividad con decaimiento (redondeo hacia cero). */
export function decayedPoints(points: number, pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  return Math.trunc((points * (100 - p)) / 100);
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
    scoreId: z.string().trim().max(100).nullish(),
    name: z.string().trim().max(200).default(''),
    config: propertyRuleSchema,
    points: z.number().int().min(-1000).max(1000),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('activity'),
    scoreId: z.string().trim().max(100).nullish(),
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
  /** Decaimiento del score: `recent` = conteos de los últimos decayDays por activityKey(). */
  decay?: { pct: number; recent: Record<string, number> },
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
        // Con decaimiento: si lo reciente no alcanza el mínimo, la regla se cumple con actividad vieja.
        const old = !!decay && decay.pct > 0 && (decay.recent[activityKey(cfg)] ?? 0) < Math.max(1, cfg.min);
        const points = old ? decayedPoints(rule.points, decay!.pct) : rule.points;
        if (points) {
          breakdown.push({ ruleId: rule.id, name: rule.name, points, detail: `${n} / ${cfg.days}d`, ...(old ? { decayed: true } : {}) });
        }
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
