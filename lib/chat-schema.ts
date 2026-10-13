/**
 * Chat — schemas zod para payloads de rutas API.
 */
import { z } from 'zod';

// ---------- Primitivas ----------

const id = z.string().trim().min(1).max(64);
const shortText = z.string().trim().max(200);
const longText = z.string().trim().max(2000);
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'invalid_color' });
const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'invalid_time' });

export const chatStatusSchema = z.enum(['open', 'pending', 'resolved', 'snoozed']);
export const chatPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

// ---------- Widgets ----------

const chatField = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  required: z.boolean().default(false),
  type: z.enum(['text', 'email', 'number']),
});

export const officeHoursDaySchema = z.object({
  enabled: z.boolean(),
  start: time,
  end: time,
});

// days[i] con i = Date.getDay() (0 = domingo … 6 = sábado).
export const officeHoursSchema = z.object({
  timezone: z.string().trim().min(1).max(64),
  days: z.array(officeHoursDaySchema).length(7),
});

const widgetBase = {
  color: hexColor.optional(),
  position: z.enum(['bottom-right', 'bottom-left']).optional(),
  welcomeMessage: longText.optional(),
  fields: z.array(chatField).max(20).optional(),
  botEnabled: z.boolean().optional(),
  botGreeting: longText.optional(),
  botSource: z.enum(['canned', 'docs', 'ai', 'agent']).optional(),
  officeHours: officeHoursSchema.nullable().optional(),
};

export const widgetCreateSchema = z.object({
  ...widgetBase,
  name: z.string().trim().min(1, { message: 'missing_name' }).max(200),
});

export const widgetUpdateSchema = z.object({
  ...widgetBase,
  name: z.string().trim().min(1, { message: 'missing_name' }).max(200).optional(),
});

// ---------- Conversaciones ----------

export const conversationPatchSchema = z.object({
  status: chatStatusSchema.optional(),
  assignedTo: id.nullable().optional(),
  priority: chatPrioritySchema.optional(),
  subject: shortText.optional(),
  snoozedUntil: z.string().trim().max(40).nullable().optional(), // ISO datetime
});

// ---------- CSAT (público) ----------

export const csatSubmitSchema = z.object({
  widgetId: id,
  visitorId: z.string().trim().min(1).max(128),
  conversationId: id,
  score: z.number().int().min(1).max(5),
  comment: longText.optional(),
});

// ---------- SLA policies ----------

// Minutos positivos con tope de 30 días (43200).
const slaMinutes = z.number().int().min(1).max(43_200);

export const slaPolicySchema = z.object({
  priority: chatPrioritySchema,
  firstResponseMinutes: slaMinutes,
  resolutionMinutes: slaMinutes.nullable(),
});

export const slaPoliciesUpdateSchema = z.object({
  policies: z.array(slaPolicySchema).min(1).max(4),
});
