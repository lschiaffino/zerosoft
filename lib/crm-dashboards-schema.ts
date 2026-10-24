/**
 * CRM dashboards — schemas zod y tipos compartidos (cliente + servidor).
 * Sin imports de runtime del servidor: safe para componentes client.
 * Los tipos de datasets se importan como type-only (se borran al compilar).
 */
import { z } from 'zod';
import type { ActivityListRow, WonLostMonth } from './crm';
import type { ReportConfig, ReportResult } from './crm-report-builder';
import type {
  ActivityLeaderboard,
  ForecastReportStage,
  FunnelReportStage,
  Kpis,
  OwnerMetric,
  SourcePerformance,
  TimeseriesPoint,
} from './crm-reports';

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
] as const;

export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];

/** Tipos del menú "Add widget": los reportes propios se agregan desde el reporte. */
export const DASHBOARD_MENU_TYPES = DASHBOARD_WIDGET_TYPES.filter((t) => t !== 'custom_report');

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
});

export type DashboardWidgetConfig = z.infer<typeof dashboardWidgetConfigSchema>;

// ---------- Dashboards ----------

export const dashboardCreateSchema = z.object({ name });

export const dashboardLayoutItemSchema = z.object({
  id,
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(9999),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
  position: z.number().int().min(0).max(99999),
});

/** PATCH /api/crm/dashboards/[id]: rename y/o layout bulk de widgets. */
export const dashboardPatchSchema = z
  .object({
    name: name.optional(),
    layout: z.array(dashboardLayoutItemSchema).min(1).max(200).optional(),
  })
  .refine((v) => v.name !== undefined || v.layout !== undefined, {
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
  w: z.number().int().min(1).max(12).optional(),
  h: z.number().int().min(1).max(24).optional(),
});

export const dashboardWidgetPatchSchema = z.object({
  config: dashboardWidgetConfigSchema.optional(),
  x: z.number().int().min(0).max(11).optional(),
  y: z.number().int().min(0).max(9999).optional(),
  w: z.number().int().min(1).max(12).optional(),
  h: z.number().int().min(1).max(24).optional(),
  position: z.number().int().min(0).max(99999).optional(),
});

// ---------- Data endpoint ----------

export const dashboardDataRequestSchema = z.object({
  type: z.enum(DASHBOARD_WIDGET_TYPES),
  pipelineId: id.nullish(),
  range: z.enum(RANGE_LABELS).optional(),
  reportId: id.optional(),
});

export type DashboardCreatePayload = z.infer<typeof dashboardCreateSchema>;
export type DashboardPatchPayload = z.infer<typeof dashboardPatchSchema>;
export type DashboardReorderPayload = z.infer<typeof dashboardReorderSchema>;
export type DashboardWidgetCreatePayload = z.infer<typeof dashboardWidgetCreateSchema>;
export type DashboardWidgetPatchPayload = z.infer<typeof dashboardWidgetPatchSchema>;
export type DashboardDataRequest = z.infer<typeof dashboardDataRequestSchema>;

// ---------- Datasets por widget (respuestas de /api/crm/dashboards/data) ----------

export interface WidgetDataMap {
  kpi: { kpis: Kpis };
  funnel: { funnel: FunnelReportStage[] };
  forecast: { forecast: ForecastReportStage[] };
  timeseries: { timeseries: TimeseriesPoint[] };
  wonlost: { wonLost: WonLostMonth[] };
  source: { sourcePerformance: SourcePerformance[] };
  owner: { byOwner: OwnerMetric[] };
  leaderboard: { leaderboard: ActivityLeaderboard[] };
  tasks: { tasks: ActivityListRow[] };
  recent_activity: { activities: ActivityListRow[] };
  /** null si el reporte ya no existe; error si falló al correr. */
  custom_report: { report: { id: string; name: string; config: ReportConfig; result: ReportResult } | null; error?: string };
}

export type WidgetData = WidgetDataMap[DashboardWidgetType];

/** Bundle que la página prefetch-ea para el pipeline default + rango 30d. */
export type DashboardInitialData = WidgetDataMap;

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
};

export const WIDGET_MIN_SIZE: Record<DashboardWidgetType, { w: number; h: number }> = {
  kpi: { w: 2, h: 2 },
  funnel: { w: 3, h: 3 },
  forecast: { w: 3, h: 3 },
  timeseries: { w: 4, h: 3 },
  wonlost: { w: 4, h: 3 },
  source: { w: 3, h: 3 },
  owner: { w: 4, h: 3 },
  leaderboard: { w: 3, h: 3 },
  tasks: { w: 3, h: 3 },
  recent_activity: { w: 3, h: 3 },
  custom_report: { w: 3, h: 2 },
};
