/**
 * CRM — constructor de reportes propios (como el custom report builder de
 * HubSpot). Módulo puro, sin DB: lo usan el constructor (cliente) y el
 * servidor que compila la config a SQL (lib/crm-custom-reports.ts).
 *
 * Un reporte es una fuente principal (contactos, empresas, deals,
 * actividades o tareas) más objetos asociados, cuyos campos se usan como
 * columnas, filtros, dimensiones (hasta dos, las de fecha agrupadas por
 * día/semana/mes/trimestre) y una métrica (conteo, suma, promedio, mínimo o
 * máximo), con una visualización (tabla, barras, líneas, torta o KPI).
 *
 * Claves de campo: `<objeto>.<campo>`, p. ej. `deal.amount`,
 * `company.industry` o `contact.custom:plan` (campos propios).
 */
import { z } from 'zod';

export const REPORT_SOURCES = ['contacts', 'companies', 'deals', 'activities', 'tasks'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const REPORT_OBJECTS = ['contact', 'company', 'deal', 'activity'] as const;
export type ReportObject = (typeof REPORT_OBJECTS)[number];

export const REPORT_VIZ = ['table', 'bar', 'line', 'pie', 'kpi'] as const;
export type ReportViz = (typeof REPORT_VIZ)[number];

export const REPORT_AGGS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type ReportAgg = (typeof REPORT_AGGS)[number];

export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export type ReportFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';

/** De dónde salen las etiquetas de un campo select. */
export type ReportEnum =
  | 'lifecycle'
  | 'leadStatus'
  | 'source'
  | 'priority'
  | 'activityType'
  | 'owner'
  | 'stage'
  | 'pipeline'
  | 'forecastCategory'
  | 'options';

/** Objeto principal de cada fuente. */
export const SOURCE_OBJECT: Record<ReportSource, ReportObject> = {
  contacts: 'contact',
  companies: 'company',
  deals: 'deal',
  activities: 'activity',
  tasks: 'activity',
};

/** Objetos que se pueden asociar a cada fuente. */
export const SOURCE_ASSOCIATIONS: Record<ReportSource, ReportObject[]> = {
  contacts: ['company', 'deal'],
  companies: ['contact', 'deal'],
  deals: ['company', 'contact'],
  activities: ['contact', 'company', 'deal'],
  tasks: ['contact', 'company', 'deal'],
};

/** Campo nativo: la etiqueta es una clave de crm.reportBuilder.fields.<obj>.<name>. */
export interface BuiltinField {
  name: string;
  type: ReportFieldType;
  enum?: ReportEnum;
  /** Monto en la moneda base del workspace. */
  money?: boolean;
  /** Solo para estas fuentes (p. ej. el tipo de actividad no aplica a tareas). */
  only?: ReportSource[];
}

export const BUILTIN_FIELDS: Record<ReportObject, BuiltinField[]> = {
  contact: [
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'phone', type: 'text' },
    { name: 'jobTitle', type: 'text' },
    { name: 'city', type: 'text' },
    { name: 'country', type: 'text' },
    { name: 'lifecycle', type: 'select', enum: 'lifecycle' },
    { name: 'leadStatus', type: 'select', enum: 'leadStatus' },
    { name: 'source', type: 'select', enum: 'source' },
    { name: 'owner', type: 'select', enum: 'owner' },
    { name: 'score', type: 'number' },
    { name: 'created', type: 'date' },
  ],
  company: [
    { name: 'name', type: 'text' },
    { name: 'domain', type: 'text' },
    { name: 'industry', type: 'text' },
    { name: 'employees', type: 'number' },
    { name: 'city', type: 'text' },
    { name: 'country', type: 'text' },
    { name: 'lifecycle', type: 'select', enum: 'lifecycle' },
    { name: 'owner', type: 'select', enum: 'owner' },
    { name: 'created', type: 'date' },
  ],
  deal: [
    { name: 'name', type: 'text' },
    { name: 'amount', type: 'number', money: true },
    { name: 'pipeline', type: 'select', enum: 'pipeline' },
    { name: 'stage', type: 'select', enum: 'stage' },
    { name: 'priority', type: 'select', enum: 'priority' },
    { name: 'source', type: 'select', enum: 'source' },
    { name: 'owner', type: 'select', enum: 'owner' },
    { name: 'forecastCategory', type: 'select', enum: 'forecastCategory' },
    { name: 'closeDate', type: 'date' },
    { name: 'closedAt', type: 'date' },
    { name: 'created', type: 'date' },
  ],
  activity: [
    { name: 'type', type: 'select', enum: 'activityType', only: ['activities'] },
    { name: 'subject', type: 'text' },
    { name: 'done', type: 'boolean' },
    { name: 'owner', type: 'select', enum: 'owner' },
    { name: 'outcome', type: 'text', only: ['activities'] },
    { name: 'durationMin', type: 'number', only: ['activities'] },
    { name: 'dueAt', type: 'date' },
    { name: 'doneAt', type: 'date' },
    { name: 'created', type: 'date' },
  ],
};

/** Entidad de crm_custom_fields de cada objeto (las actividades no tienen campos propios). */
export const CUSTOM_FIELD_ENTITY: Partial<Record<ReportObject, 'contacts' | 'companies' | 'deals'>> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
};

export const FILTER_OPS: Record<ReportFieldType, string[]> = {
  text: ['contains', 'equals', 'starts', 'known', 'unknown'],
  number: ['eq', 'neq', 'gt', 'lt', 'known', 'unknown'],
  date: ['before', 'after', 'between', 'last', 'known', 'unknown'],
  select: ['is', 'isnot', 'known', 'unknown'],
  boolean: ['is'],
};

// ---------- Config ----------

const fieldKey = z.string().min(3).max(140).regex(/^(contact|company|deal|activity)\.[A-Za-z0-9_:\-]+$/);

export const reportFilterSchema = z.object({
  f: fieldKey,
  o: z.string().min(1).max(20),
  v: z.string().max(500).optional(),
  v2: z.string().max(500).optional(),
});

export const reportDimensionSchema = z.object({
  field: fieldKey,
  /** Solo para campos de fecha. */
  bucket: z.enum(DATE_BUCKETS).optional(),
});

export const reportConfigSchema = z.object({
  source: z.enum(REPORT_SOURCES),
  /** Objetos asociados elegidos (sus campos quedan disponibles). */
  objects: z.array(z.enum(REPORT_OBJECTS)).max(3).default([]),
  /** Columnas de la tabla de registros (sin dimensiones). */
  columns: z.array(fieldKey).max(15).default([]),
  filters: z.array(reportFilterSchema).max(20).default([]),
  dimensions: z.array(reportDimensionSchema).max(2).default([]),
  metric: z
    .object({
      agg: z.enum(REPORT_AGGS),
      /** Campo numérico para sum/avg/min/max. */
      field: fieldKey.optional(),
      /** Para conteos: qué objeto se cuenta (por defecto el principal). */
      object: z.enum(REPORT_OBJECTS).optional(),
    })
    .default({ agg: 'count' }),
  viz: z.enum(REPORT_VIZ).default('table'),
  sort: z.enum(['value_desc', 'value_asc', 'label']).default('value_desc'),
});

export type ReportConfig = z.infer<typeof reportConfigSchema>;
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type ReportDimension = z.infer<typeof reportDimensionSchema>;

export const reportCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  config: reportConfigSchema,
});

export const reportPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    config: reportConfigSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.config !== undefined, { message: 'invalid_input' });

export const reportRunSchema = z.object({ config: reportConfigSchema });

export function defaultConfig(source: ReportSource = 'deals'): ReportConfig {
  const obj = SOURCE_OBJECT[source];
  const firstCols: Record<ReportObject, string[]> = {
    contact: ['contact.name', 'contact.email', 'contact.lifecycle', 'contact.owner', 'contact.created'],
    company: ['company.name', 'company.domain', 'company.industry', 'company.owner', 'company.created'],
    deal: ['deal.name', 'deal.amount', 'deal.stage', 'deal.owner', 'deal.closeDate'],
    activity: source === 'tasks'
      ? ['activity.subject', 'activity.done', 'activity.owner', 'activity.dueAt']
      : ['activity.type', 'activity.subject', 'activity.owner', 'activity.created'],
  };
  return {
    source,
    objects: [],
    columns: firstCols[obj],
    filters: [],
    dimensions: [],
    metric: { agg: 'count' },
    viz: 'table',
    sort: 'value_desc',
  };
}

export function fieldObject(key: string): ReportObject | null {
  const obj = key.split('.')[0];
  return (REPORT_OBJECTS as readonly string[]).includes(obj) ? (obj as ReportObject) : null;
}

export function fieldName(key: string): string {
  return key.slice(key.indexOf('.') + 1);
}

/** Objetos que la config usa (el principal siempre). */
export function usedObjects(config: ReportConfig): ReportObject[] {
  const base = SOURCE_OBJECT[config.source];
  const keys = [
    ...config.columns,
    ...config.filters.map((f) => f.f),
    ...config.dimensions.map((d) => d.field),
    ...(config.metric.field ? [config.metric.field] : []),
  ];
  const set = new Set<ReportObject>([base, ...config.objects]);
  for (const k of keys) {
    const o = fieldObject(k);
    if (o) set.add(o);
  }
  if (config.metric.object) set.add(config.metric.object);
  return [...set];
}

/** ¿La config usa solo objetos válidos para la fuente? */
export function configObjectsValid(config: ReportConfig): boolean {
  const base = SOURCE_OBJECT[config.source];
  const allowed = new Set<ReportObject>([base, ...SOURCE_ASSOCIATIONS[config.source]]);
  return usedObjects(config).every((o) => allowed.has(o));
}

/** Etiqueta de serie para una fila agregada: varias dimensiones se unen con " · ". */
export function joinLabels(labels: string[]): string {
  return labels.join(' · ');
}

// ---------- Resultado ----------

export interface ReportColumn {
  key: string;
  type: ReportFieldType;
  enum?: ReportEnum;
  money?: boolean;
  /** Etiqueta de un campo propio (los nativos se traducen en el cliente). */
  label?: string;
}

export interface ReportRecordsResult {
  kind: 'records';
  columns: ReportColumn[];
  rows: Array<{ id: string; href: string | null; cells: Array<string | number | null> }>;
  /** Etiquetas para valores con id (owner, etapa, pipeline): valor → nombre. */
  labels: Record<string, string>;
  total: number;
  truncated: boolean;
}

export interface ReportAggregateRow {
  keys: Array<string | null>;
  value: number;
}

export interface ReportAggregateResult {
  kind: 'aggregate';
  dimensions: ReportColumn[];
  metric: { agg: ReportAgg; field: ReportColumn | null; object: ReportObject };
  rows: ReportAggregateRow[];
  labels: Record<string, string>;
  /** Métrica sobre todo el conjunto (KPI y fila de total). */
  total: number;
  truncated: boolean;
}

export type ReportResult = ReportRecordsResult | ReportAggregateResult;

/** CSV (RFC 4180) a partir de filas ya formateadas. */
export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Evita fórmulas al abrir en planillas (=, +, -, @).
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}
