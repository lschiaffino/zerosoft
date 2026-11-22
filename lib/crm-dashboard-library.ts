/**
 * CRM Dashboards — biblioteca de reportes listos (como los "ready-made
 * reports" de HubSpot), filtros del dashboard y rangos de fechas. Módulo
 * puro, sin DB: lo usan el cliente (biblioteca, filtros, tiles) y el
 * servidor (lib/crm-dashboard-reports.ts calcula cada reporte).
 *
 * Fechas en UTC con formato YYYY-MM-DD. Las semanas arrancan el lunes.
 */
import { z } from 'zod';

// ============================================================
// FILTROS DEL DASHBOARD
// ============================================================

export const DATE_PRESETS = [
  'today',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_7',
  'last_30',
  'last_90',
  'last_365',
  'custom',
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(64);

export const dashboardFiltersSchema = z.object({
  range: z.enum(DATE_PRESETS).default('last_30'),
  /** Solo con range 'custom'. */
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Una persona (owner de los registros). */
  ownerId: id.nullish(),
  /** Un equipo de ventas (crm_sales_teams): sus integrantes. */
  teamId: id.nullish(),
  /** Pipeline de los reportes de deals. */
  pipelineId: id.nullish(),
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const DEFAULT_FILTERS: DashboardFilters = { range: 'last_30' };

/** Filtros guardados (JSON) → objeto válido; cualquier cosa rota cae al default. */
export function parseDashboardFilters(raw: unknown): DashboardFilters {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      v = {};
    }
  }
  const parsed = dashboardFiltersSchema.safeParse(v ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_FILTERS };
}

export type Bucket = 'day' | 'week' | 'month' | 'quarter';

export interface ResolvedRange {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  bucket: Bucket;
}

const DAY_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function bucketFor(days: number): Bucket {
  if (days <= 14) return 'day';
  if (days <= 92) return 'week';
  if (days <= 731) return 'month';
  return 'quarter';
}

/** Rango del filtro y el período anterior con el que se compara (mismo largo, o el período calendario anterior). */
export function resolveRange(filters: Pick<DashboardFilters, 'range' | 'from' | 'to'>, now: Date = new Date()): ResolvedRange {
  const today = utcDay(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const q = Math.floor(m / 3);
  const dow = (today.getUTCDay() + 6) % 7; // 0 = lunes
  let from: Date;
  let to: Date;
  let prevFrom: Date | null = null;
  let prevTo: Date | null = null;
  const lastN = (n: number) => {
    to = today;
    from = addDays(today, -(n - 1));
  };
  switch (filters.range) {
    case 'today':
      from = today;
      to = today;
      break;
    case 'this_week':
      from = addDays(today, -dow);
      to = addDays(from, 6);
      break;
    case 'last_week':
      from = addDays(today, -dow - 7);
      to = addDays(from, 6);
      break;
    case 'this_month':
      from = new Date(Date.UTC(y, m, 1));
      to = new Date(Date.UTC(y, m + 1, 0));
      prevFrom = new Date(Date.UTC(y, m - 1, 1));
      prevTo = new Date(Date.UTC(y, m, 0));
      break;
    case 'last_month':
      from = new Date(Date.UTC(y, m - 1, 1));
      to = new Date(Date.UTC(y, m, 0));
      prevFrom = new Date(Date.UTC(y, m - 2, 1));
      prevTo = new Date(Date.UTC(y, m - 1, 0));
      break;
    case 'this_quarter':
      from = new Date(Date.UTC(y, q * 3, 1));
      to = new Date(Date.UTC(y, q * 3 + 3, 0));
      prevFrom = new Date(Date.UTC(y, q * 3 - 3, 1));
      prevTo = new Date(Date.UTC(y, q * 3, 0));
      break;
    case 'last_quarter':
      from = new Date(Date.UTC(y, q * 3 - 3, 1));
      to = new Date(Date.UTC(y, q * 3, 0));
      prevFrom = new Date(Date.UTC(y, q * 3 - 6, 1));
      prevTo = new Date(Date.UTC(y, q * 3 - 3, 0));
      break;
    case 'this_year':
      from = new Date(Date.UTC(y, 0, 1));
      to = new Date(Date.UTC(y, 11, 31));
      prevFrom = new Date(Date.UTC(y - 1, 0, 1));
      prevTo = new Date(Date.UTC(y - 1, 11, 31));
      break;
    case 'last_year':
      from = new Date(Date.UTC(y - 1, 0, 1));
      to = new Date(Date.UTC(y - 1, 11, 31));
      prevFrom = new Date(Date.UTC(y - 2, 0, 1));
      prevTo = new Date(Date.UTC(y - 2, 11, 31));
      break;
    case 'last_7':
      lastN(7);
      break;
    case 'last_90':
      lastN(90);
      break;
    case 'last_365':
      lastN(365);
      break;
    case 'custom': {
      const a = filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? new Date(`${filters.from}T00:00:00Z`) : null;
      const b = filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? new Date(`${filters.to}T00:00:00Z`) : null;
      if (a && b && !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        from = a <= b ? a : b;
        to = a <= b ? b : a;
      } else lastN(30);
      break;
    }
    default:
      lastN(30);
  }
  const f = iso(from!);
  const t = iso(to!);
  const days = daysBetween(f, t);
  const pf = prevFrom ? iso(prevFrom) : iso(addDays(from!, -days));
  const pt = prevTo ? iso(prevTo) : iso(addDays(from!, -1));
  return { from: f, to: t, prevFrom: pf, prevTo: pt, days, bucket: bucketFor(days) };
}

/** Clave de período igual a la de SQLite (strftime): día, semana %W, mes o trimestre. */
export function bucketKey(date: string, bucket: Bucket): string {
  if (bucket === 'day') return date;
  if (bucket === 'month') return date.slice(0, 7);
  const d = new Date(`${date}T00:00:00Z`);
  if (bucket === 'quarter') return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  const yr = d.getUTCFullYear();
  const jan1 = Date.UTC(yr, 0, 1);
  const days = Math.floor((d.getTime() - jan1) / DAY_MS);
  const w = Math.floor((days + 7 - ((d.getUTCDay() + 6) % 7)) / 7);
  return `${yr}-W${String(w).padStart(2, '0')}`;
}

/** Todas las claves del rango, en orden (para que el gráfico no salte períodos vacíos). */
export function bucketKeys(range: Pick<ResolvedRange, 'from' | 'to' | 'bucket'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  let guard = 0;
  while (cur <= end && guard++ < 4000) {
    const k = bucketKey(iso(cur), range.bucket);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
    cur = addDays(cur, 1);
  }
  return out;
}

/** Desde/hasta (YYYY-MM-DD) de una clave de período, recortado al rango. Para el drill-down. */
export function bucketBounds(key: string, range: Pick<ResolvedRange, 'from' | 'to'>): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  let m: RegExpExecArray | null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    from = key;
    to = key;
  } else if ((m = /^(\d{4})-(\d{2})$/.exec(key))) {
    from = iso(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
    to = iso(new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)));
  } else if ((m = /^(\d{4})-Q([1-4])$/.exec(key))) {
    const qq = Number(m[2]) - 1;
    from = iso(new Date(Date.UTC(Number(m[1]), qq * 3, 1)));
    to = iso(new Date(Date.UTC(Number(m[1]), qq * 3 + 3, 0)));
  } else if ((m = /^(\d{4})-W(\d{2})$/.exec(key))) {
    const yr = Number(m[1]);
    const wk = Number(m[2]);
    const jan1 = Date.UTC(yr, 0, 1);
    const jan1Dow = new Date(jan1).getUTCDay();
    const firstMonday = jan1 + ((8 - jan1Dow) % 7) * DAY_MS;
    const start = wk === 0 ? jan1 : firstMonday + (wk - 1) * 7 * DAY_MS;
    const end = wk === 0 ? firstMonday - DAY_MS : start + 6 * DAY_MS;
    from = iso(new Date(start));
    to = iso(new Date(end));
  }
  if (!from || !to) return null;
  if (from < range.from) from = range.from;
  if (to > range.to) to = range.to;
  return from <= to ? { from, to } : null;
}

// ============================================================
// BIBLIOTECA DE REPORTES
// ============================================================

export const REPORT_CATEGORIES = ['deals', 'forecast', 'activities', 'contacts'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Cómo se dibuja un tile. */
export const TILE_VIZ = ['kpi', 'bar', 'hbar', 'stacked', 'line', 'area', 'funnel', 'donut', 'table'] as const;
export type TileViz = (typeof TILE_VIZ)[number];

export const TILE_SIZES = ['small', 'medium', 'wide'] as const;
export type TileSize = (typeof TILE_SIZES)[number];

/** Columnas del grid de 12 que ocupa cada tamaño. */
export const SIZE_COLS: Record<TileSize, number> = { small: 3, medium: 6, wide: 12 };

export function sizeFromCols(w: number): TileSize {
  if (w <= 4) return 'small';
  if (w <= 8) return 'medium';
  return 'wide';
}

/** Qué rango de fechas usa el reporte: el del dashboard, el mes en curso o ninguno (foto de hoy). */
export type RangeMode = 'filter' | 'this_month' | 'snapshot';

export interface LibraryReport {
  key: string;
  category: ReportCategory;
  viz: TileViz;
  /** Visualizaciones que tienen sentido para estos datos (la primera es la default). */
  vizOptions: TileViz[];
  size: TileSize;
  rangeMode: RangeMode;
  /** Usa el filtro de pipeline. */
  usesPipeline: boolean;
}

const R = (
  key: string,
  category: ReportCategory,
  vizOptions: TileViz[],
  size: TileSize,
  rangeMode: RangeMode = 'filter',
  usesPipeline = true,
): LibraryReport => ({ key, category, viz: vizOptions[0], vizOptions, size, rangeMode, usesPipeline });

export const LIBRARY: LibraryReport[] = [
  R('revenue_won_kpi', 'deals', ['kpi'], 'small'),
  R('deals_created_kpi', 'deals', ['kpi'], 'small'),
  R('win_rate_kpi', 'deals', ['kpi'], 'small'),
  R('avg_deal_size_kpi', 'deals', ['kpi'], 'small'),
  R('sales_velocity', 'deals', ['kpi'], 'small'),
  R('deals_created', 'deals', ['area', 'line', 'bar', 'table'], 'medium'),
  R('revenue_won_over_time', 'deals', ['area', 'line', 'bar', 'table'], 'medium'),
  R('won_lost_over_time', 'deals', ['stacked', 'table'], 'medium'),
  R('deals_won_lost_by_owner', 'deals', ['stacked', 'table'], 'medium'),
  R('pipeline_by_stage', 'deals', ['hbar', 'bar', 'table'], 'medium', 'snapshot'),
  R('conversion_funnel', 'deals', ['funnel', 'table'], 'medium'),
  R('avg_time_in_stage', 'deals', ['hbar', 'table'], 'medium'),
  R('deals_closing_this_month', 'deals', ['table'], 'medium', 'this_month'),
  R('deal_forecast', 'forecast', ['hbar', 'table'], 'medium'),
  R('activities_by_rep', 'activities', ['stacked', 'table'], 'medium', 'filter', false),
  R('activities_kpi', 'activities', ['kpi'], 'small', 'filter', false),
  R('upcoming_tasks', 'activities', ['table'], 'medium', 'snapshot', false),
  R('new_contacts_kpi', 'contacts', ['kpi'], 'small', 'filter', false),
  R('new_contacts_by_source', 'contacts', ['hbar', 'donut', 'table'], 'medium', 'filter', false),
  R('lifecycle_stage_changes', 'contacts', ['hbar', 'table'], 'medium', 'filter', false),
];

export const LIBRARY_KEYS = LIBRARY.map((r) => r.key) as [string, ...string[]];

export function libraryReport(key: string | undefined | null): LibraryReport | null {
  return LIBRARY.find((r) => r.key === key) ?? null;
}

/** El dashboard "Sales" que ve un workspace nuevo: 4 KPIs arriba y 8 reportes. */
export const SALES_TEMPLATE: Array<{ reportKey: string; size: TileSize }> = [
  { reportKey: 'revenue_won_kpi', size: 'small' },
  { reportKey: 'deals_created_kpi', size: 'small' },
  { reportKey: 'win_rate_kpi', size: 'small' },
  { reportKey: 'sales_velocity', size: 'small' },
  { reportKey: 'revenue_won_over_time', size: 'medium' },
  { reportKey: 'pipeline_by_stage', size: 'medium' },
  { reportKey: 'deal_forecast', size: 'medium' },
  { reportKey: 'conversion_funnel', size: 'medium' },
  { reportKey: 'deals_won_lost_by_owner', size: 'medium' },
  { reportKey: 'activities_by_rep', size: 'medium' },
  { reportKey: 'new_contacts_by_source', size: 'medium' },
  { reportKey: 'deals_closing_this_month', size: 'medium' },
];

/**
 * Los widgets de antes (tipos fijos) se muestran con el reporte de la
 * biblioteca que dice lo mismo. Así no hace falta reescribir filas viejas.
 */
export function legacyReportKey(type: string, config: { metric?: string }): string | null {
  switch (type) {
    case 'kpi':
      return (
        {
          newContacts: 'new_contacts_kpi',
          newDeals: 'deals_created_kpi',
          wonAmount: 'revenue_won_kpi',
          activities: 'activities_kpi',
        } as Record<string, string>
      )[config.metric ?? 'newContacts'] ?? 'new_contacts_kpi';
    case 'funnel':
      return 'conversion_funnel';
    case 'forecast':
      return 'deal_forecast';
    case 'timeseries':
      return 'deals_created';
    case 'wonlost':
      return 'won_lost_over_time';
    case 'source':
      return 'new_contacts_by_source';
    case 'owner':
      return 'deals_won_lost_by_owner';
    case 'leaderboard':
      return 'activities_by_rep';
    case 'tasks':
      return 'upcoming_tasks';
    case 'recent_activity':
      return 'activities_kpi';
    default:
      return null;
  }
}

// ============================================================
// RESULTADO DE UN TILE (lo que el servidor devuelve y el cliente dibuja)
// ============================================================

export type ValueFormat = 'number' | 'money' | 'percent' | 'days' | 'moneyPerDay';

/** Qué segmento se clickeó: claves por dimensión (categoría y serie). */
export interface DrillSegment {
  category?: string | null;
  series?: string | null;
}

export interface TileCategory {
  key: string;
  /** Etiqueta lista (nombre de etapa, persona) o null si el cliente la traduce (labelKind). */
  label: string | null;
}

export interface TileSeries {
  key: string;
  label: string | null;
  values: number[];
}

export type TileLabelKind = 'bucket' | 'source' | 'lifecycle' | 'forecastCategory' | 'activityType' | 'outcome' | 'metric' | null;

export type TileResult =
  | {
      kind: 'kpi';
      value: number;
      prev: number | null;
      format: ValueFormat;
      /** Detalle chico debajo del número (p. ej. "12 ganados de 30 cerrados"). */
      detail?: { won?: number; closed?: number; count?: number };
      drill: boolean;
    }
  | {
      kind: 'chart';
      format: ValueFormat;
      categories: TileCategory[];
      categoryKind: TileLabelKind;
      series: TileSeries[];
      seriesKind: TileLabelKind;
      /** Valor extra por categoría (p. ej. cantidad de deals junto al monto, conversión del embudo). */
      extra?: { label: 'count' | 'conversion'; values: Array<number | null> };
      total: number | null;
      drill: boolean;
    }
  | {
      kind: 'records';
      object: DrillObject;
      rows: DrillRow[];
      total: number;
      sum: number | null;
    };

export type DrillObject = 'deal' | 'contact' | 'activity';

export interface DrillRow {
  id: string;
  /** Tipo de registro para abrir la vista previa (o null si no se abre). */
  previewType: 'deal' | 'contact' | 'company' | null;
  previewId: string | null;
  href: string | null;
  name: string;
  /** Monto (deals) en la moneda base. */
  amount: number | null;
  /** Etapa (deals), fuente/ciclo de vida (contactos) o tipo (actividades). */
  status: string | null;
  statusKind: TileLabelKind | 'stage';
  owner: string | null;
  date: string | null;
}

export interface DrillResult {
  object: DrillObject;
  rows: DrillRow[];
  total: number;
  sum: number | null;
  truncated: boolean;
}

export const drillSegmentSchema = z.object({
  category: z.string().max(80).nullish(),
  series: z.string().max(80).nullish(),
});
