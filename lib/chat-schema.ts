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

// Atributo de conversación (lib/chat-attributes.ts). Un select necesita opciones.
const conversationAttributeDef = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'number', 'select', 'boolean']),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  })
  .refine((d) => d.type !== 'select' || d.options.length > 0, { message: 'missing_options' });

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
  helpEnabled: z.boolean().optional(),
  locale: z.enum(['auto', 'en', 'es', 'pt']).optional(),
  // Minutos sin leer antes de mandar la respuesta por email (0 = nunca, tope 1 día).
  offlineEmailMinutes: z.number().int().min(0).max(1440).optional(),
  conversationAttributes: z
    .array(conversationAttributeDef)
    .max(20)
    .refine((list) => new Set(list.map((d) => d.id)).size === list.length, { message: 'duplicate_id' })
    .optional(),
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
  teamId: id.nullable().optional(),
  // Atributos de conversación: id → valor (null o '' borra). Los valida
  // applyAttributePatch contra las definiciones del widget.
  attributes: z
    .record(z.string().max(64), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
    .refine((o) => Object.keys(o).length <= 20, { message: 'too_many_attributes' })
    .optional(),
});

// ---------- Merge ----------

export const conversationMergeSchema = z.object({
  /** Conversación que se suma a esta (sus mensajes pasan acá y se borra). */
  sourceId: id,
});

// ---------- Mensajes ----------

/** Tope de largo de un mensaje (visitante y agente). */
export const CHAT_MESSAGE_MAX = 5000;

/** Tope de un adjunto (igual a MAX_UPLOAD_SIZE de lib/uploads, que es solo servidor). */
export const CHAT_UPLOAD_MAX = 10 * 1024 * 1024;

/** Clave de traducción (namespace chat) para el código de error de un envío del agente. */
export function sendErrorKey(code: string | undefined): string {
  if (code === 'file_too_large') return 'errors.fileTooLarge';
  if (code === 'file_type_not_allowed') return 'errors.fileTypeNotAllowed';
  if (code === 'invalid_input') return 'errors.invalid_input';
  if (code === 'invalid_assignee') return 'errors.invalid_assignee';
  if (code === 'missing_attributes') return 'errors.missingAttributes';
  if (code === 'invalid_attribute' || code === 'unknown_attribute') return 'errors.invalidAttribute';
  return 'errors.generic';
}

/**
 * Límites del POST público del visitante (sin auth: el widgetId es público).
 * Solo acota tamaños; widgetId/visitorId y el resto se validan en la ruta.
 */
export const visitorMessageLimitsSchema = z
  .object({
    body: z.string().max(CHAT_MESSAGE_MAX).optional(),
    subject: z.string().max(200).optional(),
    fields: z
      .record(z.string().max(64), z.string().max(1000))
      .refine((o) => Object.keys(o).length <= 20, { message: 'too_many_fields' })
      .optional(),
    // Página desde la que escribe (lib/chat-visitor-context.ts limpia cada campo).
    context: z
      .object({
        url: z.string().max(2000).optional(),
        title: z.string().max(500).optional(),
        referrer: z.string().max(2000).optional(),
        language: z.string().max(64).optional(),
      })
      .optional(),
    // Formulario de un agente de Agents enviado desde el widget (lib/agents-ui-blocks.ts lo valida).
    agentForm: z
      .object({
        id: z.string().max(40),
        values: z.record(z.string().max(64), z.string().max(2000)).refine((o) => Object.keys(o).length <= 20),
      })
      .optional(),
  })
  .passthrough();

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
