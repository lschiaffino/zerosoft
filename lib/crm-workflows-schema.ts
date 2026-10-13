/**
 * CRM Workflows — schemas zod para payloads de API.
 */
import { z } from 'zod';
import { TRIGGER_TYPES, ACTION_TYPES } from './crm-workflows';

const id = z.string().min(1).max(64);
const shortText = z.string().trim().max(500);
const longText = z.string().trim().max(20000);

const triggerType = z.enum(TRIGGER_TYPES);
const actionType = z.enum(ACTION_TYPES);

const configRecord = z.record(z.unknown());

const triggerSchema = z.object({
  id: id.optional(),
  type: triggerType,
  config: configRecord.optional(),
  position: z.number().int().min(0).optional(),
});

const actionSchema = z.object({
  id: id.optional(),
  type: actionType,
  config: configRecord.optional(),
  position: z.number().int().min(0).optional(),
});

export const workflowCreateSchema = z
  .object({
    name: shortText,
    enabled: z.boolean().optional(),
    triggers: z.array(triggerSchema).min(1).max(10),
    // Sin acciones solo como borrador (creación rápida: nombre + trigger → editor).
    actions: z.array(actionSchema).max(20),
  })
  .refine((w) => w.actions.length > 0 || w.enabled === false, {
    message: 'actions_required',
    path: ['actions'],
  });

export const workflowUpdateSchema = z.object({
  name: shortText.optional(),
  enabled: z.boolean().optional(),
  triggers: z.array(triggerSchema).min(1).max(10).optional(),
  actions: z.array(actionSchema).min(1).max(20).optional(),
});

export const workflowToggleSchema = z.object({
  enabled: z.boolean(),
});

export const sendCrmEmailSchema = z.object({
  recordType: z.enum(['contact', 'company', 'deal']),
  recordId: id,
  to: z.string().trim().min(1).max(320),
  subject: shortText,
  body: longText,
  /** Tracking de aperturas/clicks para este email (default: setting del workspace). */
  tracking: z.boolean().optional(),
  /** Responder dentro de un thread existente (thread id del timeline). */
  threadId: z.string().max(200).optional(),
});

// ---------- Tipos inferidos ----------

export type WorkflowCreatePayload = z.infer<typeof workflowCreateSchema>;
export type WorkflowUpdatePayload = z.infer<typeof workflowUpdateSchema>;
export type WorkflowTogglePayload = z.infer<typeof workflowToggleSchema>;
export type SendCrmEmailPayload = z.infer<typeof sendCrmEmailSchema>;
