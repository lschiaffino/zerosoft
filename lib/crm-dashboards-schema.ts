/**
 * CRM dashboards — schemas zod y tipos compartidos (cliente + servidor).
 * Sin imports de runtime del servidor: safe para componentes client.
 * Los tipos de datasets se importan como type-only (se borran al compilar).
 */
import { z } from 'zod';
import { DATE_PRESETS, LIBRARY_KEYS, TILE_SIZES, TILE_VIZ, dashboardFiltersSchema, drillSegmentSchema, type DrillResult, type TileResult } from './crm-dashboard-library';
import type { ReportConfig, ReportResult } from './crm-report-builder';

export const DASHBOARD_WIDGET_TYPES = [
  'kpi',
  'funnel',
  'forecast',
  'timeseries',
  'wonlost',
  'source',
  'owner',
  'leaderboard',
  'tasks',
  'recent_activity',
  'custom_report',
  /** Reporte de la biblioteca (config.reportKey, lib/crm-dashboard-library.ts). */
  'library',
] as const;

export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];


export const KPI_METRICS = ['newContacts', 'newDeals', 'wonAmount', 'activities'] as const;
export type KpiMetric = (typeof KPI_METRICS)[number];

const RANGE_LABELS = ['7d', '30d', '90d', 'quarter', '12m'] as const;

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(200);

/** Config por widget (JSON en crm_dashboard_widgets.config). */
export const dashboardWidgetConfigSchema = z.object({
  metric: z.enum(KPI_METRICS).optional(),
  pipelineId: id.nullish(),
  range: z.enum(RANGE_LABELS).optional(),
  /** Widget custom_report: el reporte propio que muestra (lib/crm-custom-reports.ts). */
  reportId: id.optional(),
  /** Widget library: clave del reporte de la biblioteca. */
  reportKey: z.enum(LIBRARY_KEYS).optional(),
  /** Título propio del tile (si no, el del reporte). */
  title: z.string().trim().max(120).optional(),
  /** Visualización elegida (una de las que admite el reporte). */
  viz: z.enum(TILE_VIZ).optional(),
});

export type DashboardWidgetConfig = z.infer<typeof dashboardWidgetConfigSchema>;

// ---------- Dashboards ----------

export const DASHBOARD_VISIBILITIES = ['private', 'team', 'everyone'] as const;
export type DashboardVisibility = (typeof DASHBOARD_VISIBILITIES)[number];
export const DASHBOARD_ACCESS = ['view', 'edit'] as const;
export type DashboardAccess = (typeof DASHBOARD_ACCESS)[number];

/** POST /api/crm/dashboards: nuevo (vacío o con la plantilla de ventas) o copia de otro. */
export const dashboardCreateSchema = z.object({
  name,
  template: z.enum(['blank', 'sales']).optional(),
  cloneFrom: id.optional(),
  /** Para compartir con un equipo se elige el equipo después (PATCH). */
  visibility: z.enum(['private', 'everyone']).optional(),
});

export const dashboardLayoutItemSchema = z.object({
  id,
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(9999),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
  position: z.number().int().min(0).max(99999),
});

/** Orden y tamaño de los tiles (tras arrastrar o cambiar el tamaño). */
export const dashboardOrderItemSchema = z.object({
  id,
  position: z.number().int().min(0).max(99999),
  size: z.enum(TILE_SIZES).optional(),
});

/** PATCH /api/crm/dashboards/[id]: nombre, layout, acceso, filtros guardados o default. */
export const dashboardPatchSchema = z
  .object({
    name: name.optional(),
    layout: z.array(dashboardLayoutItemSchema).min(1).max(200).optional(),
    order: z.array(dashboardOrderItemSchema).min(1).max(200).optional(),
    visibility: z.enum(DASHBOARD_VISIBILITIES).optional(),
    teamId: id.nullish(),
    access: z.enum(DASHBOARD_ACCESS).optional(),
    filters: dashboardFiltersSchema.optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'invalid_input',
  });

/** PATCH /api/crm/dashboards: reordenar dashboards (tabs). */
export const dashboardReorderSchema = z.object({
  ids: z.array(id).min(1).max(100),
});

// ---------- Widgets ----------

export const dashboardWidgetCreateSchema = z.object({
  type: z.enum(DASHBOARD_WIDGET_TYPES),
  config: dashboardWidgetConfigSchema.optional(),
  size: z.enum(TILE_SIZES).optional(),
  /** Copia de un tile del mismo dashboard (Duplicar). */
  duplicateOf: id.optional(),
  w: z.number().int().min(1).max(12).optional(),
  h: z.number().int().min(1).max(24).optional(),
});

export const dashboardWidgetPatchSchema = z.object({
  config: dashboardWidgetConfigSchema.optional(),
  size: z.enum(TILE_SIZES).optional(),
  x: z.number().int().min(0).max(11).optional(),
  y: z.number().int().min(0).max(9999).optional(),
  w: z.number().int().min(1).max(12).optional(),
  h: z.number().int().min(1).max(24).optional(),
  position: z.number().int().min(0).max(99999).optional(),
});


/** POST /api/crm/dashboards/data: todos los tiles de un dashboard con sus filtros. */
export const dashboardTilesRequestSchema = z.object({
  dashboardId: id,
  filters: dashboardFiltersSchema.optional(),
  /** Solo estos tiles (p. ej. el que se acaba de agregar). */
  widgetIds: z.array(id).max(200).optional(),
});

/** POST /api/crm/dashboards/drill: registros detrás de un número o segmento. */
export const dashboardDrillRequestSchema = z.object({
  dashboardId: id,
  widgetId: id,
  filters: dashboardFiltersSchema.optional(),
  segment: drillSegmentSchema.default({}),
});

export { DATE_PRESETS };

/** Lo que muestra un tile: un reporte de la biblioteca, un reporte propio o un error. */
export type TileData =
  | TileResult
  | {
      kind: 'custom';
      report: { id: string; name: string; config: ReportConfig; result: ReportResult };
    }
  | { kind: 'error'; code: string };

export type { DrillResult };

export type DashboardCreatePayload = z.infer<typeof dashboardCreateSchema>;
export type DashboardPatchPayload = z.infer<typeof dashboardPatchSchema>;
export type DashboardReorderPayload = z.infer<typeof dashboardReorderSchema>;
export type DashboardWidgetCreatePayload = z.infer<typeof dashboardWidgetCreateSchema>;
export type DashboardWidgetPatchPayload = z.infer<typeof dashboardWidgetPatchSchema>;

// ---------- Tamaños de grid (12 columnas) ----------

export const WIDGET_DEFAULT_SIZE: Record<DashboardWidgetType, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 },
  funnel: { w: 6, h: 5 },
  forecast: { w: 6, h: 5 },
  timeseries: { w: 6, h: 5 },
  wonlost: { w: 6, h: 5 },
  source: { w: 6, h: 5 },
  owner: { w: 6, h: 5 },
  leaderboard: { w: 4, h: 5 },
  tasks: { w: 4, h: 5 },
  recent_activity: { w: 4, h: 5 },
  custom_report: { w: 6, h: 5 },
  library: { w: 6, h: 5 },
};
