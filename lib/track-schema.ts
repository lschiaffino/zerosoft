/**
 * Track — schemas zod para proyectos, status, cycles, issues y comments.
 */
import { z } from 'zod';

const id = z.string().trim().min(1).max(64);
const name = z.string().trim().min(1).max(200);
const shortText = z.string().trim().max(500);
const longText = z.string().trim().max(5000);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'invalid_slug' });
/**
 * Color de label, proyecto o status: solo hex (#rgb o #rrggbb). Se renderiza
 * en style={{ background }}, así que nada de `url(...)` ni otros valores CSS.
 */
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, { message: 'invalid_color' });
const color = hexColor.optional();
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, { message: 'invalid_date' });

const statusCategory = z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']);
const issuePriority = z.enum(['urgent', 'high', 'medium', 'low']);
const relationType = z.enum(['blocks', 'related', 'duplicates']);

// ---------- Projects ----------

export const projectCreateSchema = z.object({
  name,
  slug: slug.optional(),
  description: longText.optional(),
  icon: shortText.optional(),
  color: color,
});

export const projectUpdateSchema = z.object({
  name: name.optional(),
  slug: slug.optional(),
  description: longText.optional(),
  icon: shortText.optional(),
  color: color,
  status: z.enum(['active', 'archived']).optional(),
  triageEnabled: z.boolean().optional(),
});

// ---------- Statuses ----------

export const statusCreateSchema = z.object({
  name,
  color: color,
  position: z.number().int().min(0).optional(),
  category: statusCategory.optional(),
});

export const statusUpdateSchema = statusCreateSchema.partial();

export const statusesReorderSchema = z.object({
  statusIds: z.array(id).min(1).max(100),
});

// ---------- Cycles ----------

export const cycleCreateSchema = z
  .object({
    name,
    startAt: isoDate,
    endAt: isoDate,
  })
  .refine((c) => c.endAt.slice(0, 10) >= c.startAt.slice(0, 10), { message: 'invalid_range', path: ['endAt'] });

/** Completar cycle: los issues sin terminar pasan al siguiente (o al indicado / a ninguno). */
export const cycleCompleteSchema = z.object({
  targetCycleId: id.nullish(),
});

/** Borrar status: los issues que lo usan se reasignan a otro del mismo proyecto. */
export const statusDeleteSchema = z.object({
  reassignTo: id,
});

export const cycleUpdateSchema = z.object({
  name: name.optional(),
  startAt: isoDate.optional(),
  endAt: isoDate.optional(),
});

// ---------- Issues ----------

export const issueLabelSchema = z.object({
  id: id,
  name: z.string().trim().min(1).max(50),
  color: hexColor,
});

/** Label en un payload de issue: id de un label del workspace o nombre (se crea si no existe). */
export const issueLabelInputSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1).max(50).optional(),
    color: hexColor.optional(),
  })
  .refine((l) => Boolean(l.id || l.name), { message: 'invalid_label' });

export const issueCreateSchema = z.object({
  title: shortText.optional(),
  description: z.unknown().optional(),
  statusId: id.nullish(),
  priority: issuePriority.optional(),
  assigneeId: id.nullish(),
  cycleId: id.nullish(),
  estimate: z.number().int().min(0).nullish(),
  parentId: id.nullish(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  labels: z.array(issueLabelInputSchema).max(10).optional(),
});

export const issueUpdateSchema = issueCreateSchema.partial().extend({
  title: shortText.optional(),
});

// ---------- Labels del workspace ----------

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: hexColor.optional(),
});

export const labelUpdateSchema = labelCreateSchema.partial();

// ---------- Bulk edit ----------

export const bulkIssuesSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    issueIds: z.array(id).min(1).max(200),
    patch: z
      .object({
        statusId: id.optional(),
        priority: issuePriority.optional(),
        assigneeId: id.nullable().optional(),
        cycleId: id.nullable().optional(),
        addLabelIds: z.array(id).max(10).optional(),
        removeLabelIds: z.array(id).max(10).optional(),
      })
      .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'empty_patch' }),
  }),
  z.object({
    action: z.literal('delete'),
    issueIds: z.array(id).min(1).max(200),
  }),
]);

// ---------- Triage ----------

export const triageActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), statusId: id.optional() }),
  z.object({ action: z.literal('decline'), reason: shortText.optional() }),
  // El original se indica por id o por identifier (ZER-12), que se busca en
  // todo el workspace. Si no llega ninguno, resolveTriage responde invalid_duplicate.
  z.object({
    action: z.literal('duplicate'),
    duplicateOfId: id.optional(),
    duplicateOfIdentifier: z.string().trim().min(1).max(80).optional(),
  }),
]);

// ---------- GitHub ----------

const repoName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, { message: 'invalid_repo' });

export const githubConfigSchema = z.object({
  repos: z.array(repoName).min(1).max(50),
  onPrOpen: z.enum(['in_progress', 'none']).default('in_progress'),
  onPrMerge: z.enum(['done', 'none']).default('done'),
  /** Secreto nuevo (opcional al editar; obligatorio al conectar si no se genera). */
  secret: z.string().trim().min(16).max(200).optional(),
  regenerateSecret: z.boolean().optional(),
});

// ---------- Comments ----------

export const commentCreateSchema = z.object({
  body: longText,
});

// ---------- Relations ----------

export const relationCreateSchema = z.object({
  // UUID o identifier (SLUG-N); los slugs llegan a 64 caracteres.
  relatedIssueId: z.string().trim().min(1).max(80),
  type: relationType.optional(),
});

// ---------- Views ----------

export const viewTypeSchema = z.enum(['list', 'board', 'calendar', 'gantt']);

export const issueViewCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  viewType: viewTypeSchema,
  filters: z.record(z.unknown()).default({}),
  sort: z.enum(['newest', 'oldest', 'priority', 'identifier']).default('newest'),
  columns: z.array(z.string()).max(20).optional(),
});

export const issueViewUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  viewType: viewTypeSchema.optional(),
  filters: z.record(z.unknown()).optional(),
  sort: z.enum(['newest', 'oldest', 'priority', 'identifier']).optional(),
  columns: z.array(z.string()).max(20).optional(),
});

// ---------- Tipos inferidos ----------

export type ProjectCreatePayload = z.infer<typeof projectCreateSchema>;
export type ProjectUpdatePayload = z.infer<typeof projectUpdateSchema>;
export type StatusCreatePayload = z.infer<typeof statusCreateSchema>;
export type StatusUpdatePayload = z.infer<typeof statusUpdateSchema>;
export type StatusesReorderPayload = z.infer<typeof statusesReorderSchema>;
export type CycleCreatePayload = z.infer<typeof cycleCreateSchema>;
export type CycleUpdatePayload = z.infer<typeof cycleUpdateSchema>;
export type CycleCompletePayload = z.infer<typeof cycleCompleteSchema>;
export type IssueCreatePayload = z.infer<typeof issueCreateSchema>;
export type IssueUpdatePayload = z.infer<typeof issueUpdateSchema>;
export type CommentCreatePayload = z.infer<typeof commentCreateSchema>;
export type RelationCreatePayload = z.infer<typeof relationCreateSchema>;
export type IssueViewCreatePayload = z.infer<typeof issueViewCreateSchema>;
export type IssueViewUpdatePayload = z.infer<typeof issueViewUpdateSchema>;
export type IssueLabel = z.infer<typeof issueLabelSchema>;
export type IssueLabelInput = z.infer<typeof issueLabelInputSchema>;
export type BulkIssuesPayload = z.infer<typeof bulkIssuesSchema>;
export type TriageActionPayload = z.infer<typeof triageActionSchema>;
export type GithubConfigPayload = z.infer<typeof githubConfigSchema>;
