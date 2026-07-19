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
const color = z.string().trim().max(20).optional();
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

export const cycleCreateSchema = z.object({
  name,
  startAt: isoDate,
  endAt: isoDate,
});

export const cycleUpdateSchema = z.object({
  name: name.optional(),
  startAt: isoDate.optional(),
  endAt: isoDate.optional(),
});

// ---------- Issues ----------

export const issueCreateSchema = z.object({
  title: shortText.optional(),
  description: z.unknown().optional(),
  statusId: id.nullish(),
  priority: issuePriority.optional(),
  assigneeId: id.nullish(),
  cycleId: id.nullish(),
  estimate: z.number().int().min(0).nullish(),
  parentId: id.nullish(),
});

export const issueUpdateSchema = issueCreateSchema.partial().extend({
  title: shortText.optional(),
});

// ---------- Comments ----------

export const commentCreateSchema = z.object({
  body: longText,
});

// ---------- Relations ----------

export const relationCreateSchema = z.object({
  relatedIssueId: id,
  type: relationType.optional(),
});

// ---------- Tipos inferidos ----------

export type ProjectCreatePayload = z.infer<typeof projectCreateSchema>;
export type ProjectUpdatePayload = z.infer<typeof projectUpdateSchema>;
export type StatusCreatePayload = z.infer<typeof statusCreateSchema>;
export type StatusUpdatePayload = z.infer<typeof statusUpdateSchema>;
export type StatusesReorderPayload = z.infer<typeof statusesReorderSchema>;
export type CycleCreatePayload = z.infer<typeof cycleCreateSchema>;
export type CycleUpdatePayload = z.infer<typeof cycleUpdateSchema>;
export type IssueCreatePayload = z.infer<typeof issueCreateSchema>;
export type IssueUpdatePayload = z.infer<typeof issueUpdateSchema>;
export type CommentCreatePayload = z.infer<typeof commentCreateSchema>;
export type RelationCreatePayload = z.infer<typeof relationCreateSchema>;
