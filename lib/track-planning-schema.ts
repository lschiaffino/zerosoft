/**
 * Track, planificación: schemas zod de plans (los projects de Linear),
 * updates, initiatives, dashboards, insights y automatizaciones por proyecto.
 */
import { z } from 'zod';

const id = z.string().trim().min(1).max(64);
const name = z.string().trim().min(1).max(200);
const day = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
const markdown = z.string().max(20000);
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, { message: 'invalid_color' });

export const PLAN_STATUSES = ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const;
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];
export const PLAN_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type PlanHealth = (typeof PLAN_HEALTH)[number];
export const UPDATE_CADENCES = ['weekly', 'biweekly', 'off'] as const;
export type UpdateCadence = (typeof UPDATE_CADENCES)[number];
export const INITIATIVE_STATUSES = ['proposed', 'planned', 'active', 'completed', 'canceled'] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

// ---------- Plans ----------

export const planCreateSchema = z.object({
  name,
  icon: z.string().trim().max(8).optional(),
  color: hexColor.optional(),
  summary: z.string().trim().max(255).optional(),
  description: markdown.optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  priority: z.enum(PLAN_PRIORITIES).optional(),
  leadId: id.nullish(),
  memberIds: z.array(id).max(100).optional(),
  teamIds: z.array(id).max(50).optional(),
  initiativeIds: z.array(id).max(20).optional(),
  startDate: day.nullish(),
  targetDate: day.nullish(),
  updateCadence: z.enum(UPDATE_CADENCES).optional(),
  updateDay: z.number().int().min(1).max(7).optional(),
});

export const planUpdateSchema = planCreateSchema.partial();

export const planIssuesSchema = z.object({
  action: z.enum(['add', 'remove']),
  issueIds: z.array(id).min(1).max(200),
  /** Al agregar: milestone del plan (opcional). */
  milestoneId: id.nullish(),
});

export const planIssueMilestoneSchema = z.object({
  issueId: id,
  milestoneId: id.nullable(),
});

export const planMilestoneCreateSchema = z.object({
  name,
  description: z.string().trim().max(5000).optional(),
  targetDate: day.nullish(),
});

export const planMilestoneUpdateSchema = planMilestoneCreateSchema.partial().extend({
  position: z.number().int().min(0).max(1000).optional(),
});

export const planUpdateCreateSchema = z.object({
  health: z.enum(PLAN_HEALTH),
  body: markdown.default(''),
});

export const planUpdateEditSchema = z.object({
  health: z.enum(PLAN_HEALTH).optional(),
  body: markdown.optional(),
});

export const planUpdateCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const planFollowSchema = z.object({ following: z.boolean() });

// ---------- Initiatives ----------

export const initiativeCreateSchema = z.object({
  name,
  icon: z.string().trim().max(8).optional(),
  description: markdown.optional(),
  status: z.enum(INITIATIVE_STATUSES).optional(),
  leadId: id.nullish(),
  targetDate: day.nullish(),
  parentId: id.nullish(),
  planIds: z.array(id).max(200).optional(),
});

export const initiativeUpdateSchema = initiativeCreateSchema.partial();

// ---------- Insights ----------

export const INSIGHT_MEASURES = ['count', 'effort', 'cycle_time', 'lead_time', 'issue_age'] as const;
export type InsightMeasure = (typeof INSIGHT_MEASURES)[number];
export const INSIGHT_DIMENSIONS = [
  'status',
  'status_type',
  'assignee',
  'priority',
  'label',
  'team',
  'plan',
  'cycle',
  'created_week',
  'created_month',
  'completed_week',
  'completed_month',
] as const;
export type InsightDimension = (typeof INSIGHT_DIMENSIONS)[number];
export const INSIGHT_SLICES = [...INSIGHT_DIMENSIONS, 'burnup'] as const;
export type InsightSlice = (typeof INSIGHT_SLICES)[number];

export const insightFiltersSchema = z.object({
  teamIds: z.array(id).max(50).optional(),
  planIds: z.array(id).max(50).optional(),
  labelIds: z.array(id).max(50).optional(),
  assigneeIds: z.array(id).max(50).optional(),
  cycleIds: z.array(id).max(50).optional(),
  statusTypes: z.array(z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled'])).max(5).optional(),
  createdAfter: day.optional(),
  createdBefore: day.optional(),
  includeArchived: z.boolean().optional(),
});
export type InsightFilters = z.infer<typeof insightFiltersSchema>;

export const insightQuerySchema = z.object({
  measure: z.enum(INSIGHT_MEASURES).default('count'),
  slice: z.enum(INSIGHT_SLICES).default('status_type'),
  segment: z.enum([...INSIGHT_DIMENSIONS, 'none']).default('none'),
  interval: z.enum(['week', 'month']).default('week'),
  filters: insightFiltersSchema.default({}),
});
export type InsightQuery = z.infer<typeof insightQuerySchema>;

// ---------- Dashboards ----------

export const dashboardCreateSchema = z.object({
  name,
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(['personal', 'workspace']).optional(),
  filters: insightFiltersSchema.optional(),
});

export const dashboardUpdateSchema = dashboardCreateSchema.partial();

export const widgetCreateSchema = z.object({
  title: z.string().trim().max(200).optional(),
  kind: z.enum(['chart', 'table', 'metric']).default('chart'),
  width: z.union([z.literal(1), z.literal(2)]).optional(),
  query: insightQuerySchema,
});

export const widgetUpdateSchema = z.object({
  title: z.string().trim().max(200).optional(),
  kind: z.enum(['chart', 'table', 'metric']).optional(),
  width: z.union([z.literal(1), z.literal(2)]).optional(),
  query: insightQuerySchema.optional(),
  /** Mover una posición arriba o abajo. */
  move: z.enum(['up', 'down']).optional(),
});

// ---------- Auto-cierre y auto-archivo ----------

export const HOUSEKEEPING_MONTHS = [0, 1, 3, 6, 9, 12] as const;
const months = z.number().int().refine((n) => (HOUSEKEEPING_MONTHS as readonly number[]).includes(n), {
  message: 'invalid_months',
});

export const automationSchema = z.object({
  autoCloseMonths: months.optional(),
  autoCloseStatusId: id.nullish(),
  autoArchiveMonths: months.optional(),
});

export const archiveRestoreSchema = z.object({
  issueIds: z.array(id).min(1).max(200),
  /** true = archivar a mano (Linear: ⌘K › Archive); sin él, restaurar. */
  archive: z.boolean().optional(),
});

export type PlanCreatePayload = z.infer<typeof planCreateSchema>;
export type PlanUpdatePayload = z.infer<typeof planUpdateSchema>;
export type InitiativeCreatePayload = z.infer<typeof initiativeCreateSchema>;
export type InitiativeUpdatePayload = z.infer<typeof initiativeUpdateSchema>;
export type AutomationPayload = z.infer<typeof automationSchema>;
