/**
 * CRM email de ventas — schemas zod de las rutas (templates, secuencias,
 * inscripciones, settings y borrador con IA).
 */
import { z } from 'zod';

const id = z.string().min(1).max(64);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'invalid_time' });

export const templateCreateSchema = z.object({
  kind: z.enum(['template', 'snippet']).optional(),
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(500).optional(),
  body: z.string().max(20000).optional(),
});

export const templateUpdateSchema = templateCreateSchema.omit({ kind: true }).partial();

export const templatePreviewSchema = z.object({
  subject: z.string().max(500).optional(),
  body: z.string().max(20000).optional(),
  contactId: id.optional(),
  dealId: id.optional(),
});

export const sequenceStepSchema = z.object({
  id: id.optional(),
  type: z.enum(['email', 'task', 'wait']),
  waitDays: z.number().int().min(0).max(365).optional(),
  templateId: id.nullish(),
  subject: z.string().trim().max(500).optional(),
  body: z.string().max(20000).optional(),
  newThread: z.boolean().optional(),
});

export const sequenceCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().max(64).optional(),
  windowStart: hhmm.optional(),
  windowEnd: hhmm.optional(),
  businessDays: z.boolean().optional(),
  steps: z.array(sequenceStepSchema).max(30).optional(),
});

export const sequenceUpdateSchema = sequenceCreateSchema.partial();

export const enrollSchema = z.object({
  contactIds: z.array(id).min(1).max(500),
  senderId: id.optional(),
});

export const unenrollSchema = z.object({
  contactId: id,
});

export const enrollmentActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'exit']),
});

export const emailSettingsSchema = z.object({
  trackingEnabled: z.boolean(),
});

export const aiDraftSchema = z.object({
  contactId: id,
  instructions: z.string().trim().max(2000).optional(),
  subject: z.string().trim().max(500).optional(),
});
