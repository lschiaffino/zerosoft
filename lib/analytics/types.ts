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

/** Agregación de una serie: conteos, por persona o sobre una propiedad numérica del evento. */
export const SERIES_MATHS = ['total', 'unique', 'wau', 'mau', 'sessions', 'per_user', 'per_user_min', 'per_user_max', 'per_user_median', 'per_user_p75', 'per_user_p90', 'per_user_p95', 'per_user_p99', 'unique_group', 'sum', 'avg', 'min', 'max', 'median', 'p75', 'p90', 'p95', 'p99'] as const;
export type SeriesMath = (typeof SERIES_MATHS)[number];
/** Las que leen una propiedad numérica. */
export const PROPERTY_MATHS: readonly SeriesMath[] = ['sum', 'avg', 'min', 'max', 'median', 'p75', 'p90', 'p95', 'p99'];

/** Una serie apunta a un evento o a una acción guardada ('@action:<id>'). */
export const ACTION_PREFIX = '@action:';

export const seriesSchema = z.object({
  event: eventNameSchema,
  math: z.enum(SERIES_MATHS).default('total'),
  /** Propiedad numérica para sum, avg, min, max, median y percentiles. */
  mathProperty: propertyKeySchema.optional(),
  /** Tipo de grupo para unique_group ('company', 'team'…). */
  groupType: propertyKeySchema.optional(),
  filters: filtersSchema,
  label: z.string().trim().max(100).optional(),
  /** Otros eventos que también cuentan en la serie (OR). */
  orEvents: z.array(eventNameSchema).max(4).optional(),
  /** Solo la primera vez de cada persona: de ese evento, o la primera que cumple los filtros. */
  first: z.enum(['ever', 'matching']).nullable().optional(),
});
export type SeriesDef = z.infer<typeof seriesSchema>;

export const TREND_DISPLAYS = ['line', 'area', 'bar', 'stacked', 'cumulative', 'bar_total', 'pie', 'donut', 'proportion', 'number', 'table'] as const;
export type TrendDisplay = (typeof TREND_DISPLAYS)[number];

export const TREND_UNITS = ['none', 'short', 'duration', 'duration_ms', 'percentage', 'currency'] as const;
export const trendOptionsSchema = z.object({
  /** Promedio móvil en días (solo por día). */
  smoothing: z.union([z.literal(0), z.literal(7), z.literal(28)]).optional(),
  hideWeekends: z.boolean().optional(),
  goalLines: z.array(z.object({ value: z.number().finite(), label: z.string().trim().max(60).optional() })).max(5).optional(),
  yMin: z.number().finite().nullable().optional(),
  yMax: z.number().finite().nullable().optional(),
  xLabel: z.string().trim().max(60).optional(),
  yLabel: z.string().trim().max(60).optional(),
  unit: z.enum(TREND_UNITS).optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  prefix: z.string().max(12).optional(),
  suffix: z.string().max(12).optional(),
  showValues: z.boolean().optional(),
  hideLegend: z.boolean().optional(),
});
export type TrendOptions = z.infer<typeof trendOptionsSchema>;

/** Apertura de una tendencia: por propiedad de evento, persona o grupo, con cubetas si es numérica. */
export const trendBreakdownSchema = z.object({
  key: propertyKeySchema,
  type: z.enum(['event', 'person', 'group']).default('event'),
  groupType: propertyKeySchema.optional(),
  bins: z.number().int().min(2).max(50).nullable().optional(),
});
export type TrendBreakdown = z.infer<typeof trendBreakdownSchema>;

export const trendsQuerySchema = z.object({
  kind: z.literal('trends'),
  series: z.array(seriesSchema).min(1).max(5),
  interval: z.enum(INTERVALS).default('day'),
  dateRange: dateRangeSchema.default({ from: '-7d' }),
  breakdown: trendBreakdownSchema.nullable().optional(),
  /** Hasta dos aperturas más: el valor junta las tres. */
  breakdownsMore: z.array(trendBreakdownSchema).max(2).optional(),
  /** Una serie por cohorte, en lugar de una por valor de una propiedad. */
  breakdownCohorts: z.array(z.string().max(64)).max(5).nullable().optional(),
  /** Cuántos valores traer (de a 25 con "Cargar más"). */
  breakdownLimit: z.number().int().min(1).max(500).optional(),
  compare: z.boolean().default(false),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  display: z.enum(TREND_DISPLAYS).default('line'),
  /** Fórmula sobre las series por letra: 'A / B * 100'. */
  formula: z.string().trim().max(200).nullable().optional(),
  excludeInternal: z.boolean().optional(),
  options: trendOptionsSchema.nullable().optional(),
});
export type TrendsQuery = z.infer<typeof trendsQuerySchema>;

export const FUNNEL_PATH_MODES = ['before', 'between', 'after', 'after_dropoff', 'before_dropoff'] as const;
export type FunnelPathMode = (typeof FUNNEL_PATH_MODES)[number];
export const FUNNEL_ORDERS = ['ordered', 'strict', 'unordered'] as const;
export const FUNNEL_ATTRIBUTIONS = ['first', 'last', 'all', 'step'] as const;
export const FUNNEL_DISPLAYS = ['steps', 'time', 'trends'] as const;
export type FunnelDisplay = (typeof FUNNEL_DISPLAYS)[number];
export const FUNNEL_WINDOW_UNITS = ['second', 'minute', 'hour', 'day', 'week', 'month'] as const;
export type FunnelWindowUnit = (typeof FUNNEL_WINDOW_UNITS)[number];
const WINDOW_UNIT_MS: Record<FunnelWindowUnit, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

export const funnelQuerySchema = z.object({
  kind: z.literal('funnel'),
  steps: z
    .array(
      z.object({
        event: eventNameSchema,
        /** Otros eventos que también cumplen el paso (OR). */
        orEvents: z.array(eventNameSchema).max(4).optional(),
        filters: filtersSchema,
        label: z.string().trim().max(100).optional(),
        /** Solo la primera vez: de ese tipo de evento, o la primera que cumple los filtros del paso. */
        first: z.enum(['ever', 'matching']).nullable().optional(),
      }),
    )
    .min(2)
    .max(10),
  windowDays: z.number().int().min(1).max(90).default(14),
  /** Ventana en otra unidad; si está, manda sobre windowDays. */
  window: z.object({ value: z.number().int().min(1).max(10_000), unit: z.enum(FUNNEL_WINDOW_UNITS) }).nullable().optional(),
  order: z.enum(FUNNEL_ORDERS).optional(),
  exclusions: z
    .array(z.object({ event: eventNameSchema, filters: filtersSchema, fromStep: z.number().int().min(0).max(9), toStep: z.number().int().min(1).max(9) }))
    .max(5)
    .optional(),
  breakdown: z.object({ key: propertyKeySchema, type: z.enum(['event', 'person']).default('event') }).nullable().optional(),
  attribution: z.enum(FUNNEL_ATTRIBUTIONS).optional(),
  attributionStep: z.number().int().min(0).max(9).optional(),
  display: z.enum(FUNNEL_DISPLAYS).optional(),
  interval: z.enum(INTERVALS).optional(),
  dateRange: dateRangeSchema.default({ from: '-30d' }),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  /** Contar grupos (empresa, equipo) en lugar de personas. */
  groupType: propertyKeySchema.nullable().optional(),
  /** Contar sesiones en lugar de personas. */
  bySession: z.boolean().optional(),
  excludeInternal: z.boolean().optional(),
});
export type FunnelQuery = z.infer<typeof funnelQuerySchema>;

/** Ventana de conversión en ms, con tope de un año. */
export function funnelWindowMs(q: { windowDays?: number; window?: { value: number; unit: FunnelWindowUnit } | null }): number {
  const ms = q.window ? q.window.value * WINDOW_UNIT_MS[q.window.unit] : (q.windowDays ?? 14) * WINDOW_UNIT_MS.day;
  return Math.min(ms, 365 * WINDOW_UNIT_MS.day);
}

export const RETENTION_TYPES = ['recurring', 'first_time', 'first_ever'] as const;

export const retentionQuerySchema = z.object({
  kind: z.literal('retention'),
  startEvent: eventNameSchema.default('$pageview'),
  returnEvent: eventNameSchema.default('$pageview'),
  period: z.enum(['hour', 'day', 'week', 'month']).default('week'),
  periods: z.number().int().min(2).max(24).default(8),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  excludeInternal: z.boolean().optional(),
  /** Quién entra en una cohorte. Sin valor: la primera vez dentro del rango. */
  type: z.enum(RETENTION_TYPES).optional(),
  /** Quien vuelve después también cuenta en los períodos anteriores. */
  cumulative: z.boolean().optional(),
  reference: z.enum(['period0', 'previous']).optional(),
  mean: z.enum(['weighted', 'simple']).optional(),
  labelStart: z.union([z.literal(0), z.literal(1)]).optional(),
  chart: z.enum(['line', 'bar']).optional(),
  show: z.enum(['both', 'table', 'graph']).optional(),
  breakdown: z.object({ key: propertyKeySchema, type: z.enum(['event', 'person']).default('event') }).nullable().optional(),
  groupType: propertyKeySchema.nullable().optional(),
  /** Pedir quiénes están en una celda: va con su apertura, cohorte y período. */
  drill: z.object({ cohort: z.number().int().min(0).max(23), k: z.number().int().min(0).max(23), value: z.string().max(500).nullable().optional() }).nullable().optional(),
});
export type RetentionQuery = z.infer<typeof retentionQuerySchema>;

export const pathsQuerySchema = z.object({
  kind: z.literal('paths'),
  dateRange: dateRangeSchema.default({ from: '-7d' }),
  startPath: z.string().trim().max(500).nullable().optional(),
  endPath: z.string().trim().max(500).nullable().optional(),
  steps: z.number().int().min(2).max(6).default(4),
  /** Solo páginas vistas, o también los eventos propios. */
  source: z.enum(['pageviews', 'all']).optional(),
  /** Junta las URLs que solo cambian en un id numérico o largo (/orders/123 → /orders/:id). */
  collapseIds: z.boolean().optional(),
  /** Solo la gente de un paso de un embudo, y lo que hizo en relación a ese paso. */
  funnel: z.object({ query: funnelQuerySchema, step: z.number().int().min(0).max(9), mode: z.enum(FUNNEL_PATH_MODES) }).nullable().optional(),
});
export type PathsQuery = z.infer<typeof pathsQuerySchema>;

export const sqlQuerySchema = z.object({
  kind: z.literal('sql'),
  sql: z.string().max(10_000),
});
export type SqlQuery = z.infer<typeof sqlQuerySchema>;

export const stickinessQuerySchema = z.object({
  kind: z.literal('stickiness'),
  series: z.array(z.object({ event: eventNameSchema, filters: filtersSchema, label: z.string().trim().max(100).optional() })).min(1).max(5),
  interval: z.enum(['day', 'week', 'month']).default('day'),
  dateRange: dateRangeSchema.default({ from: '-30d' }),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  excludeInternal: z.boolean().optional(),
});
export type StickinessQuery = z.infer<typeof stickinessQuerySchema>;

export const lifecycleQuerySchema = z.object({
  kind: z.literal('lifecycle'),
  event: eventNameSchema.default('$pageview'),
  eventFilters: filtersSchema,
  interval: z.enum(['day', 'week', 'month']).default('day'),
  dateRange: dateRangeSchema.default({ from: '-30d' }),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  excludeInternal: z.boolean().optional(),
});
export type LifecycleQuery = z.infer<typeof lifecycleQuerySchema>;

export const insightQuerySchema = z.discriminatedUnion('kind', [
  trendsQuerySchema,
  funnelQuerySchema,
  retentionQuerySchema,
  pathsQuerySchema,
  sqlQuerySchema,
  stickinessQuerySchema,
  lifecycleQuerySchema,
]);
export type InsightQuery = z.infer<typeof insightQuerySchema>;
export type InsightKind = InsightQuery['kind'];
export const INSIGHT_KINDS: InsightKind[] = ['trends', 'funnel', 'retention', 'paths', 'stickiness', 'lifecycle', 'sql'];

export const webQuerySchema = z.object({
  kind: z.literal('web'),
  dateRange: dateRangeSchema.default({ from: '-7d' }),
  compare: z.boolean().default(true),
  filters: z
    .array(z.object({ key: z.enum(['path', 'host', 'device', 'country', 'channel', 'referrer', 'utm', 'browser', 'os']), value: z.string().min(1).max(500) }))
    .max(9)
    .optional(),
});
export type WebQuery = z.infer<typeof webQuerySchema>;

// ---------- Resultados ----------

export interface TrendSeriesResult {
  label: string;
  /** Valor de la apertura (breakdown) o null. */
  breakdownValue: string | null;
  /** El total es el valor del último punto (activos en una ventana). */
  latest?: boolean;
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
  /** Opciones de presentación del insight: acompañan al resultado a tableros y links públicos. */
  options?: TrendOptions | null;
  /** La última cubeta todavía está juntando datos. */
  lastIncomplete?: boolean;
  /** Se sacaron sábados y domingos. */
  weekendsHidden?: boolean;
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
  /** Personas que llegaron a cada paso (hasta 100 por paso). Se quita en links públicos. */
  reachedPersons?: string[][];
  truncated: boolean;
  /** Qué se cuenta. */
  unit?: 'person' | 'session' | 'group';
  order?: 'ordered' | 'strict' | 'unordered';
  display?: FunnelDisplay;
  /** Tiempos entre pasos seguidos y, si hay más de dos, del primero al último. */
  times?: Array<{ fromStep: number; toStep: number; count: number; avgMs: number | null; medianMs: number | null; bins: Array<{ fromMs: number; toMs: number; count: number }> }>;
  /** Apertura: pasos por valor. */
  breakdown?: Array<{ value: string | null; counts: number[] }>;
  /** Conversión por fecha de entrada. */
  historical?: Array<{ bucket: string; counts: number[]; incomplete: boolean }>;
}

export interface RetentionResult {
  kind: 'retention';
  period: 'hour' | 'day' | 'week' | 'month';
  cohorts: Array<{ start: string; size: number; values: number[] }>;
  truncated: boolean;
  options?: Pick<RetentionQuery, 'reference' | 'mean' | 'labelStart' | 'chart' | 'show'>;
  /** Grupos en lugar de personas. */
  unit?: 'person' | 'group';
  breakdown?: Array<{ value: string | null; cohorts: Array<{ start: string; size: number; values: number[] }> }>;
  /** Quiénes están en la celda pedida. No se manda a links públicos. */
  drillPersons?: string[];
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

export interface StickinessResult {
  kind: 'stickiness';
  interval: 'day' | 'week' | 'month';
  /** Cantidad de intervalos del rango (el eje x va de 1 a este número). */
  intervals: number;
  series: Array<{ label: string; data: number[]; total: number }>;
  truncated: boolean;
}

export interface LifecycleResult {
  kind: 'lifecycle';
  interval: 'day' | 'week' | 'month';
  buckets: string[];
  new: number[];
  returning: number[];
  resurrecting: number[];
  /** En negativo, como en PostHog: la gente que dejó de venir ese intervalo. */
  dormant: number[];
  truncated: boolean;
}

export type InsightResult = TrendsResult | FunnelResult | RetentionResult | PathsResult | SqlResult | StickinessResult | LifecycleResult;

export interface CorrelationItem {
  name: string;
  kind: 'event' | 'property';
  converted: number;
  dropped: number;
  odds: number;
  /** Intervalo del 95 % de log-odds sin cruzar el 0. */
  significant: boolean;
}

export interface CorrelationResult {
  kind: 'correlation';
  convertedPeople: number;
  droppedPeople: number;
  positive: CorrelationItem[];
  negative: CorrelationItem[];
  truncated: boolean;
}

export const correlationQuerySchema = z.object({
  kind: z.literal('correlation'),
  funnel: funnelQuerySchema,
  source: z.enum(['events', 'properties']).default('events'),
});
export type CorrelationQuery = z.infer<typeof correlationQuerySchema>;

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
  hosts: Array<{ key: string; visitors: number; views: number }>;
  channels: Array<{ key: string; visitors: number; views: number }>;
  /** ¿El proyecto recibió alguna vez un pageview? (para no pedir el snippet si ya está instalado). */
  hasPageviews: boolean;
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

/** Grupo de release: condiciones y porcentaje; el primero que aplica decide (y puede forzar una variante). */
export const flagGroupSchema = z.object({
  conditions: z.array(propertyFilterSchema.extend({ type: z.literal('person').default('person') })).max(10).default([]),
  cohortId: z.string().max(64).nullable().optional(),
  rollout: z.number().int().min(0).max(100).default(100),
  variant: z.string().max(64).nullable().optional(),
});
export type FlagGroup = z.infer<typeof flagGroupSchema>;

/** Payload de un flag: JSON válido como texto, por valor ('true' o la clave de la variante). */
export const flagPayloadsSchema = z
  .record(z.string().max(64), z.string().max(10_000))
  .refine((r) => Object.keys(r).length <= 11, 'too_many_payloads')
  .refine((r) => Object.values(r).every((v) => {
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  }), 'invalid_payload');

export const flagInputSchema = z.object({
  key: flagKeySchema,
  name: z.string().trim().max(200).default(''),
  active: z.boolean().default(true),
  rollout: z.number().int().min(0).max(100).default(100),
  variants: z.array(flagVariantSchema).max(10).default([]),
  conditions: z.array(propertyFilterSchema.extend({ type: z.literal('person').default('person') })).max(10).default([]),
  groups: z.array(flagGroupSchema).max(10).default([]),
  payloads: flagPayloadsSchema.default({}),
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
  groups: FlagGroup[];
  payloads: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const cohortGroupSchema = z.object({
  properties: z.array(propertyFilterSchema.extend({ type: z.literal('person').default('person') })).max(10).default([]),
  behaviors: z
    .array(
      z.object({
        event: eventNameSchema,
        days: z.number().int().min(1).max(365).default(30),
        minCount: z.number().int().min(1).max(10_000).default(1),
        /** "No hizo": la persona no llegó a minCount en esos días. */
        negate: z.boolean().default(false),
      }),
    )
    .max(5)
    .default([]),
});
export type CohortGroup = z.infer<typeof cohortGroupSchema>;

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
  /** Grupos unidos con OR: dentro de cada uno, todo con AND. Con grupos, los dos campos de arriba no cuentan. */
  groups: z.array(cohortGroupSchema).max(10).optional(),
  /** Estática: lista subida o guardada desde una lista de personas. */
  type: z.enum(['dynamic', 'static']).optional(),
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
  replayEnabled: boolean;
  replaySampleRate: number;
  replayMaskText: boolean;
  heatmapsEnabled: boolean;
  captureExceptions: boolean;
  webVitals: boolean;
  retentionDays: number;
  tzOffsetMin: number;
  tzName: string | null;
  keepBots: boolean;
  cookieless: boolean;
  botsFiltered: number;
  cookielessDropped: number;
  /** Filtros que definen gente interna o de prueba (se aplican con excludeInternal). */
  testFilters: PropertyFilter[];
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

export const dashboardTileSchema = z.object({
  size: z.enum(['s', 'm', 'l']).optional(),
  ignoreFilters: z.boolean().optional(),
  dateRange: dateRangeSchema.nullable().optional(),
  interval: z.enum(INTERVALS).nullable().optional(),
  filters: filtersSchema.optional(),
  options: trendOptionsSchema.nullable().optional(),
});
export type DashboardTile = z.infer<typeof dashboardTileSchema>;

export const AUTO_REFRESH_MINUTES = [0, 1, 5, 15, 30, 60] as const;
export const dashboardSettingsSchema = z.object({
  dateRange: dateRangeSchema.nullable().optional(),
  filters: filtersSchema,
  cohortId: z.string().max(64).nullable().optional(),
  /** Gente interna: como diga cada insight, o forzado en todo el tablero. */
  internal: z.enum(['inherit', 'on', 'off']).optional(),
  autoRefreshMin: z.number().int().min(0).max(60).optional(),
  texts: z.array(z.object({ id: z.string().max(64), body: z.string().max(5000) })).max(50).default([]),
  /** Orden de las tarjetas: ids de insights y de textos. */
  order: z.array(z.string().max(64)).max(100).default([]),
  tiles: z.record(z.string().max(64), dashboardTileSchema).default({}),
});
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>;

export interface DashboardDto {
  id: string;
  name: string;
  description: string;
  insightIds: string[];
  settings: DashboardSettings;
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

export const annotationInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().trim().min(1).max(400),
});
export interface AnnotationDto {
  id: string;
  date: string;
  content: string;
  createdAt: string;
}

export const actionStepSchema = z.object({
  event: eventNameSchema,
  urlContains: z.string().trim().max(300).nullable().optional(),
  filters: filtersSchema,
});
export type ActionStep = z.infer<typeof actionStepSchema>;
export const actionInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).default(''),
  steps: z.array(actionStepSchema).min(1).max(10),
});
export interface ActionDto {
  id: string;
  name: string;
  description: string;
  steps: ActionStep[];
  createdAt: string;
  updatedAt: string;
}

export const ALERT_CONDITIONS = ['above', 'below', 'increase_pct', 'decrease_pct'] as const;
export const alertInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  insightId: z.string().max(64),
  seriesIndex: z.number().int().min(0).max(20).default(0),
  condition: z.enum(ALERT_CONDITIONS),
  threshold: z.number().finite().min(-1e12).max(1e12),
  frequency: z.enum(['hourly', 'daily']).default('daily'),
  enabled: z.boolean().default(true),
  subscribers: z.array(z.string().max(64)).max(25).default([]),
});
export type AlertInput = z.infer<typeof alertInputSchema>;
export interface AlertDto extends AlertInput {
  id: string;
  insightName: string;
  state: 'ok' | 'firing' | 'error';
  lastValue: number | null;
  lastCheckedAt: number | null;
  lastFiredAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export const experimentMetricSchema = z.object({
  event: eventNameSchema,
  filters: filtersSchema,
  /** conversion: % de gente que lo hizo después de ver el flag. mean: cantidad (o suma de propiedad) por persona. */
  type: z.enum(['conversion', 'mean']).default('conversion'),
  mathProperty: propertyKeySchema.nullable().optional(),
});
export type ExperimentMetric = z.infer<typeof experimentMetricSchema>;

export const experimentInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  hypothesis: z.string().max(2000).default(''),
  flagId: z.string().max(64),
  metrics: z.array(experimentMetricSchema).min(1).max(3),
});
export interface ExperimentDto {
  id: string;
  name: string;
  hypothesis: string;
  flagId: string;
  flagKey: string;
  metrics: ExperimentMetric[];
  status: 'draft' | 'running' | 'stopped';
  startedAt: number | null;
  endedAt: number | null;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ExperimentVariantResult {
  key: string;
  exposed: number;
  /** conversion: gente que lo hizo. mean: suma total. */
  value: number;
  /** Tasa o media por persona. */
  rate: number;
  low: number;
  high: number;
  /** Probabilidad de ser la mejor variante (0..1). */
  chanceBest: number;
  /** Cambio contra control (null en control). */
  uplift: number | null;
}
export interface ExperimentMetricResult {
  metric: ExperimentMetric;
  variants: ExperimentVariantResult[];
  /** Ganadora con más de 95 % de chance, o null. */
  winner: string | null;
}
export interface ExperimentResults {
  exposedTotal: number;
  /** Gente que vio más de una variante: queda afuera del cálculo. */
  multipleVariants: number;
  /** El reparto real se aleja del configurado (p < 0.001). */
  sampleMismatch: boolean;
  metrics: ExperimentMetricResult[];
  truncated: boolean;
}

/** Propiedades cuyos valores no dicen quién es alguien: las únicas aperturas que van a un link abierto. */
export const SAFE_SHARE_BREAKDOWNS = ['$browser', '$browser_version', '$os', '$device_type', '$geoip_country_code', '$pathname', '$host', '$referring_domain', '$lib', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/**
 * ¿Se puede publicar el resultado de esta consulta en un link abierto? SQL no
 * (puede traer cualquier dato) y tampoco una apertura por propiedad de persona o
 * por una propiedad fuera de la lista segura, porque sus valores pueden identificar gente.
 */
export function shareableQuery(q: InsightQuery): boolean {
  if (q.kind === 'sql') return false;
  if (q.kind === 'trends' && (q.breakdownCohorts?.length || q.breakdownsMore?.some((b) => b.type !== 'event' || !SAFE_SHARE_BREAKDOWNS.includes(b.key)))) return false;
  if ((q.kind === 'trends' || q.kind === 'funnel' || q.kind === 'retention') && q.breakdown && (q.breakdown.type !== 'event' || !SAFE_SHARE_BREAKDOWNS.includes(q.breakdown.key))) return false;
  return true;
}

export interface EventDefinitionDto {
  event: string;
  description: string;
  verified: boolean;
  hidden: boolean;
  count30d: number;
  lastSeen: number | null;
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
