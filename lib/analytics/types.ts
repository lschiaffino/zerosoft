/**
 * Analytics (PostHog): tipos y esquemas compartidos entre el servidor, la UI
 * y los tests. Sin acceso a la base: se puede importar desde componentes
 * cliente.
 */
import { z } from 'zod';

// ---------- Filtros de propiedades ----------

export const PROPERTY_OPS = ['eq', 'neq', 'contains', 'not_contains', 'is_set', 'is_not_set', 'gt', 'lt'] as const;
export type PropertyOp = (typeof PROPERTY_OPS)[number];

/** Clave de propiedad: sin comillas dobles ni barras (va dentro de un path JSON como `$."clave"`). */
export const propertyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^"\\\u0000-\u001f]+$/, 'invalid_property_key');

export const propertyFilterSchema = z.object({
  key: propertyKeySchema,
  op: z.enum(PROPERTY_OPS).default('eq'),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
  type: z.enum(['event', 'person']).default('event'),
});
export type PropertyFilter = z.infer<typeof propertyFilterSchema>;

const filtersSchema = z.array(propertyFilterSchema).max(20).default([]);

/** Nombre de evento ('*' = cualquier evento). */
export const eventNameSchema = z.string().trim().min(1).max(200);

// ---------- Rango de fechas ----------

/** '-24h', '-7d', '-30d'… o una fecha 'YYYY-MM-DD'. */
export const RELATIVE_RANGES = ['-24h', '-7d', '-14d', '-30d', '-90d', '-180d', '-365d'] as const;
export const dateRangeSchema = z.object({
  from: z.string().trim().regex(/^(-\d{1,4}[hdwm]|\d{4}-\d{2}-\d{2})$/).default('-7d'),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type DateRange = z.infer<typeof dateRangeSchema>;

export const INTERVALS = ['hour', 'day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];

// ---------- Consultas ----------

export const seriesSchema = z.object({
  event: eventNameSchema,
  math: z.enum(['total', 'unique']).default('total'),
  filters: filtersSchema,
  label: z.string().trim().max(100).optional(),
});
export type SeriesDef = z.infer<typeof seriesSchema>;

export const trendsQuerySchema = z.object({
  kind: z.literal('trends'),
  series: z.array(seriesSchema).min(1).max(5),
  interval: z.enum(INTERVALS).default('day'),
  dateRange: dateRangeSchema.default({ from: '-7d' }),
  breakdown: z.object({ key: propertyKeySchema, type: z.enum(['event', 'person']).default('event') }).nullable().optional(),
  compare: z.boolean().default(false),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  display: z.enum(['line', 'bar', 'number', 'table']).default('line'),
});
export type TrendsQuery = z.infer<typeof trendsQuerySchema>;

export const funnelQuerySchema = z.object({
  kind: z.literal('funnel'),
  steps: z.array(z.object({ event: eventNameSchema, filters: filtersSchema, label: z.string().trim().max(100).optional() })).min(2).max(10),
  windowDays: z.number().int().min(1).max(90).default(14),
  dateRange: dateRangeSchema.default({ from: '-30d' }),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
});
export type FunnelQuery = z.infer<typeof funnelQuerySchema>;

export const retentionQuerySchema = z.object({
  kind: z.literal('retention'),
  startEvent: eventNameSchema.default('$pageview'),
  returnEvent: eventNameSchema.default('$pageview'),
  period: z.enum(['day', 'week']).default('week'),
  periods: z.number().int().min(2).max(16).default(8),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
});
export type RetentionQuery = z.infer<typeof retentionQuerySchema>;

export const pathsQuerySchema = z.object({
  kind: z.literal('paths'),
  dateRange: dateRangeSchema.default({ from: '-7d' }),
  startPath: z.string().trim().max(500).nullable().optional(),
  steps: z.number().int().min(2).max(6).default(4),
});
export type PathsQuery = z.infer<typeof pathsQuerySchema>;

export const sqlQuerySchema = z.object({
  kind: z.literal('sql'),
  sql: z.string().max(10_000),
});
export type SqlQuery = z.infer<typeof sqlQuerySchema>;

export const insightQuerySchema = z.discriminatedUnion('kind', [trendsQuerySchema, funnelQuerySchema, retentionQuerySchema, pathsQuerySchema, sqlQuerySchema]);
export type InsightQuery = z.infer<typeof insightQuerySchema>;
export type InsightKind = InsightQuery['kind'];
export const INSIGHT_KINDS: InsightKind[] = ['trends', 'funnel', 'retention', 'paths', 'sql'];

export const webQuerySchema = z.object({
  kind: z.literal('web'),
  dateRange: dateRangeSchema.default({ from: '-7d' }),
  compare: z.boolean().default(true),
});
export type WebQuery = z.infer<typeof webQuerySchema>;

// ---------- Resultados ----------

export interface TrendSeriesResult {
  label: string;
  /** Valor de la apertura (breakdown) o null. */
  breakdownValue: string | null;
  data: number[];
  total: number;
  /** Mismo largo que data: el período anterior (si se pidió comparar). */
  compare?: number[];
  compareTotal?: number;
}

export interface TrendsResult {
  kind: 'trends';
  buckets: string[];
  series: TrendSeriesResult[];
  /** Se usaron los rollups diarios para parte del rango. */
  usedRollup: boolean;
}

export interface FunnelStepResult {
  label: string;
  event: string;
  count: number;
  /** Conversión desde el primer paso (0..1). */
  conversion: number;
  /** Conversión desde el paso anterior (0..1). */
  stepConversion: number;
  dropped: number;
  /** Mediana de tiempo desde el paso anterior (ms) o null. */
  medianMs: number | null;
}

export interface FunnelResult {
  kind: 'funnel';
  steps: FunnelStepResult[];
  /** Personas que llegaron a cada paso y no al siguiente (hasta 100 por paso). */
  droppedPersons: string[][];
  truncated: boolean;
}

export interface RetentionResult {
  kind: 'retention';
  period: 'day' | 'week';
  cohorts: Array<{ start: string; size: number; values: number[] }>;
  truncated: boolean;
}

export interface PathsResult {
  kind: 'paths';
  /** Transiciones por paso: from → to con cantidad de sesiones. */
  links: Array<{ step: number; from: string; to: string; count: number }>;
  topPaths: Array<{ path: string[]; count: number }>;
  sessions: number;
  truncated: boolean;
}

export interface SqlResult {
  kind: 'sql';
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
}

export type InsightResult = TrendsResult | FunnelResult | RetentionResult | PathsResult | SqlResult;

export interface WebStat {
  value: number;
  previous: number | null;
}

export interface WebResult {
  kind: 'web';
  buckets: string[];
  visitors: number[];
  pageviews: number[];
  stats: {
    visitors: WebStat;
    pageviews: WebStat;
    sessions: WebStat;
    bounceRate: WebStat;
    avgDurationSec: WebStat;
  };
  pages: Array<{ key: string; visitors: number; views: number }>;
  entries: Array<{ key: string; visitors: number; views: number }>;
  referrers: Array<{ key: string; visitors: number; views: number }>;
  utmSources: Array<{ key: string; visitors: number; views: number }>;
  countries: Array<{ key: string; visitors: number; views: number }>;
  devices: Array<{ key: string; visitors: number; views: number }>;
  browsers: Array<{ key: string; visitors: number; views: number }>;
  os: Array<{ key: string; visitors: number; views: number }>;
}

// ---------- Flags y cohortes ----------

export const flagVariantSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  rollout: z.number().int().min(0).max(100),
});
export type FlagVariant = z.infer<typeof flagVariantSchema>;

export const flagKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'invalid_flag_key');

export const flagInputSchema = z.object({
  key: flagKeySchema,
  name: z.string().trim().max(200).default(''),
  active: z.boolean().default(true),
  rollout: z.number().int().min(0).max(100).default(100),
  variants: z.array(flagVariantSchema).max(10).default([]),
  conditions: z.array(propertyFilterSchema.extend({ type: z.literal('person').default('person') })).max(10).default([]),
});
export type FlagInput = z.infer<typeof flagInputSchema>;

export interface FlagDto {
  id: string;
  key: string;
  name: string;
  active: boolean;
  rollout: number;
  variants: FlagVariant[];
  conditions: PropertyFilter[];
  createdAt: string;
  updatedAt: string;
}

export const cohortDefinitionSchema = z.object({
  properties: z.array(propertyFilterSchema.extend({ type: z.literal('person').default('person') })).max(10).default([]),
  behavior: z
    .object({
      event: eventNameSchema,
      days: z.number().int().min(1).max(365).default(30),
      minCount: z.number().int().min(1).max(10_000).default(1),
    })
    .nullable()
    .default(null),
});
export type CohortDefinition = z.infer<typeof cohortDefinitionSchema>;

// ---------- DTOs ----------

export interface ProjectDto {
  id: string;
  name: string;
  publicKey: string;
  secretHint: string | null;
  allowedDomains: string[];
  respectDnt: boolean;
  anonymizeIp: boolean;
  autocapture: boolean;
  retentionDays: number;
  tzOffsetMin: number;
  createdAt: string;
  updatedAt: string;
}

export interface InsightDto {
  id: string;
  kind: InsightKind;
  name: string;
  description: string;
  query: InsightQuery;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardDto {
  id: string;
  name: string;
  description: string;
  insightIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CohortDto {
  id: string;
  name: string;
  definition: CohortDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface LiveEvent {
  id: number;
  event: string;
  distinctId: string;
  ts: number;
  url: string | null;
  pathname: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  properties: Record<string, unknown>;
}

export interface PersonRow {
  id: string;
  distinctIds: string[];
  properties: Record<string, unknown>;
  isIdentified: boolean;
  createdAt: number;
  lastSeen: number;
}

/** Nombre de una persona para mostrar: email, name, o el primer distinct_id. */
export function personLabel(p: { properties: Record<string, unknown>; distinctIds: string[]; id: string }): string {
  const email = p.properties.email;
  const name = p.properties.name;
  if (typeof email === 'string' && email) return email;
  if (typeof name === 'string' && name) return name;
  return p.distinctIds[0] ?? p.id;
}
