/**
 * CRM — schemas zod para los payloads de las rutas API.
 * Las rutas validan con <schema>.safeParse(body) y mapean issues a crm.errors.*.
 */
import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  CONTACT_COMPANY_LABELS,
  LIFECYCLE_STAGES,
  LEAD_STATUSES,
  PRIORITIES,
  RECURRING_INTERVALS,
  SOURCES,
  TAG_COLORS,
  TAG_ENTITIES,
} from './crm-constants';

// ---------- Primitivas compartidas ----------

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(200);
const shortText = z.string().trim().max(500);
const longText = z.string().trim().max(5000);

/** Email vacío permitido; si tiene contenido debe ser válido. */
const email = z
  .string()
  .trim()
  .max(320)
  .refine((s) => s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), { message: 'invalid_email' });

const probability = z.number().int().min(0).max(100);
const amount = z.number().min(0);
const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, { message: 'invalid_currency' })
  .transform((v) => v.toUpperCase());
const percent = z.number().min(0).max(100);
/** Solo fecha 'YYYY-MM-DD' (vencimiento de quotes). */
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });
/**
 * Fecha 'YYYY-MM-DD' o fecha-hora. Acepta ISO 8601 con zona (Z o ±hh:mm, como
 * lo manda cualquier cliente de la API) y lo guarda en UTC 'YYYY-MM-DD HH:MM:SS',
 * el formato de la DB, para que ordenar y comparar fechas siga funcionando.
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/, { message: 'invalid_date' })
  .transform((v, ctx) => {
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(v) || v.length <= 10) return v.replace('T', ' ');
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_date' });
      return z.NEVER;
    }
    return d.toISOString().slice(0, 19).replace('T', ' ');
  });

const lifecycleStage = z.enum(LIFECYCLE_STAGES);
const leadStatus = z.enum(LEAD_STATUSES);
const source = z.enum(SOURCES);
const priority = z.enum(PRIORITIES);
const activityType = z.enum(ACTIVITY_TYPES);
const custom = z.record(z.unknown());

// ---------- Contacts ----------

export const contactCreateSchema = z.object({
  firstName: shortText.optional(),
  lastName: shortText.optional(),
  email: email.optional(),
  phone: shortText.optional(),
  jobTitle: shortText.optional(),
  website: shortText.optional(),
  city: shortText.optional(),
  country: shortText.optional(),
  lifecycleStage: lifecycleStage.optional(),
  leadStatus: leadStatus.optional(),
  source: source.optional(),
  companyId: id.nullish(),
  ownerId: id.nullish(),
  custom: custom.optional(),
});

export const contactUpdateSchema = contactCreateSchema.partial();

export const contactBulkUpdateSchema = z.object({
  ids: z.array(id).min(1).max(500),
  lifecycleStage: lifecycleStage.optional(),
});

export const contactBulkDeleteSchema = z.object({
  ids: z.array(id).min(1).max(500),
});

export const contactMergeSchema = z.object({
  keepId: id,
  dropId: id,
});

// ---------- Companies ----------

export const companyCreateSchema = z.object({
  name: shortText.optional(),
  domain: shortText.optional(),
  industry: shortText.optional(),
  employees: z.number().int().min(0).nullish(),
  phone: shortText.optional(),
  website: shortText.optional(),
  city: shortText.optional(),
  country: shortText.optional(),
  lifecycleStage: lifecycleStage.optional(),
  ownerId: id.nullish(),
  /** Empresa madre (jerarquía). null = raíz. */
  parentCompanyId: id.nullish(),
  custom: custom.optional(),
});

export const companyUpdateSchema = companyCreateSchema.partial();

// ---------- Pipelines & stages ----------

export const pipelineCreateSchema = z.object({ name });
export const pipelineRenameSchema = z.object({ name });

export const stageCreateSchema = z.object({
  pipelineId: id,
  name,
  probability: probability.optional(),
});

export const stageUpdateSchema = z.object({
  name: name.optional(),
  probability: probability.optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export const stagesReorderSchema = z.object({
  pipelineId: id,
  stageIds: z.array(id).min(1).max(100),
});

// ---------- Deals ----------

export const dealCreateSchema = z.object({
  pipelineId: id,
  stageId: id,
  name: shortText.optional(),
  amount: amount.optional(),
  currency: currency.optional(),
  closeDate: isoDate.nullish(),
  priority: priority.optional(),
  source: source.optional(),
  description: longText.optional(),
  contactIds: z.array(id).max(50).optional(),
  /** Empresa primaria del deal. */
  companyId: id.nullish(),
  /** Otras empresas asociadas. */
  companyIds: z.array(id).max(20).optional(),
  ownerId: id.nullish(),
  custom: custom.optional(),
});

export const dealUpdateSchema = dealCreateSchema
  .partial()
  .omit({ pipelineId: true, stageId: true })
  .extend({
    lostReason: shortText.optional(),
    addContactIds: z.array(id).max(50).optional(),
    removeContactIds: z.array(id).max(50).optional(),
    /** true = amount manual aunque haya line items; false = recalcular desde line items. */
    amountOverride: z.boolean().optional(),
  });

export const dealMoveSchema = z.object({
  stageId: id,
  beforeId: id.nullish(),
  lostReason: shortText.optional(),
});

// ---------- Activities ----------

export const activityCreateSchema = z.object({
  type: activityType,
  subject: shortText.optional(),
  body: longText.optional(),
  dueAt: isoDate.nullish(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  outcome: shortText.optional(),
  durationMin: z.number().int().min(0).nullish(),
  contactId: id.nullish(),
  companyId: id.nullish(),
  dealId: id.nullish(),
  projectId: id.nullish(),
  ownerId: id.nullish(),
});

export const activityUpdateSchema = activityCreateSchema.partial().extend({
  done: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const taskProjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(20).optional(),
  archived: z.boolean().optional(),
});

export const taskProjectUpdateSchema = taskProjectCreateSchema.partial();

// ---------- Lists ----------

export const listFilterSchema = z.object({
  q: shortText.optional(),
  lifecycle: lifecycleStage.optional(),
  leadStatus: leadStatus.optional(),
  source: source.optional(),
});

export const listCreateSchema = z.object({
  name,
  entity: z.enum(['contacts']).optional(),
  kind: z.enum(['static', 'dynamic']).optional(),
  filter: listFilterSchema.optional(),
});

export const listUpdateSchema = listCreateSchema.partial();

export const listMembersSchema = z.object({
  contactIds: z.array(id).min(1).max(1000),
});

// ---------- Saved views ----------

export const savedViewCreateSchema = z.object({
  entity: z.enum(['contacts', 'companies', 'deals', 'tasks']),
  name,
  query: z.record(z.unknown()).optional(),
});

// ---------- Saved reports ----------

export const REPORT_TYPES = [
  'overview',
  'funnel',
  'forecast',
  'source',
  'owner',
  'activity',
  'conversion',
] as const;

export const savedReportCreateSchema = z.object({
  name,
  reportType: z.enum(REPORT_TYPES),
  filters: z.record(z.unknown()).optional(),
});

// ---------- Custom fields ----------

export const customFieldCreateSchema = z.object({
  entity: z.enum(['contacts', 'companies', 'deals']),
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, { message: 'invalid_name' }),
  label: name,
  type: z.enum(['text', 'number', 'date', 'select', 'boolean']),
  options: z.array(shortText).max(100).optional(),
  position: z.number().int().min(0).optional(),
});

export const customFieldUpdateSchema = customFieldCreateSchema.partial();

// ---------- Asociaciones ----------

const assocObject = z.enum(['contact', 'company', 'deal']);

export const associationSchema = z.object({
  fromType: assocObject,
  fromId: id,
  toType: assocObject,
  toId: id,
  /** Empresa primaria (contact ↔ company, deal ↔ company). */
  primary: z.boolean().optional(),
  /** Label de contact ↔ company ('' o null = sin label). */
  label: z.union([z.enum(CONTACT_COMPANY_LABELS), z.literal('')]).nullish(),
});

export const associationRemoveSchema = associationSchema.omit({ primary: true, label: true });

// ---------- Tags ----------

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.enum(TAG_COLORS).optional(),
});

export const tagUpdateSchema = tagCreateSchema.partial();

export const tagApplySchema = z.object({
  entity: z.enum(TAG_ENTITIES),
  ids: z.array(id).min(1).max(1000),
  action: z.enum(['add', 'remove']),
});

export const recordTagsSchema = z.object({
  entity: z.enum(TAG_ENTITIES),
  recordId: id,
  tagIds: z.array(id).max(50),
});

// ---------- Moneda ----------

export const crmSettingsSchema = z.object({
  baseCurrency: currency.optional(),
  quoteAcceptMovesDeal: z.boolean().optional(),
});

export const exchangeRateSchema = z.object({
  currency,
  rate: z.number().positive().max(1e9),
});

// ---------- Productos, line items, quotes ----------

const money = z.number().min(0).max(1e12);

export const productCreateSchema = z.object({
  name,
  sku: z.string().trim().max(100).optional(),
  description: longText.optional(),
  price: money.optional(),
  currency: currency.optional(),
  recurring: z.enum(RECURRING_INTERVALS).optional(),
  taxPct: percent.optional(),
  active: z.boolean().optional(),
});

export const productUpdateSchema = productCreateSchema.partial();

export const lineItemCreateSchema = z.object({
  /** De un producto del catálogo (copia nombre, precio e impuesto) o custom (sin productId). */
  productId: id.nullish(),
  name: shortText.optional(),
  sku: z.string().trim().max(100).optional(),
  description: longText.optional(),
  quantity: z.number().positive().max(1e9).optional(),
  unitPrice: money.optional(),
  discountPct: percent.optional(),
  taxPct: percent.optional(),
  recurring: z.enum(RECURRING_INTERVALS).optional(),
  position: z.number().int().min(0).optional(),
});

export const lineItemUpdateSchema = lineItemCreateSchema.omit({ productId: true }).partial();

const quoteFields = {
  title: shortText.optional(),
  expiresAt: dateOnly.nullish(),
  terms: longText.optional(),
  notes: longText.optional(),
  senderName: shortText.optional(),
  senderEmail: email.optional(),
  senderCompany: shortText.optional(),
  recipientName: shortText.optional(),
  recipientEmail: email.optional(),
  recipientCompany: shortText.optional(),
};

export const quoteCreateSchema = z.object({ dealId: id, ...quoteFields });

export const quoteUpdateSchema = z.object({
  ...quoteFields,
  /** Vuelve a tomar los line items actuales del deal (solo borradores). */
  refreshItems: z.boolean().optional(),
  /** 'sent' publica el link (draft → sent). */
  status: z.literal('sent').optional(),
});

export const quoteRespondSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    name: z.string().trim().min(1).max(200),
    agree: z.literal(true),
  }),
  z.object({
    action: z.literal('decline'),
    reason: z.string().trim().max(1000).optional(),
  }),
]);

// ---------- Import ----------

export const importContactRowSchema = z.object({
  firstName: shortText.optional(),
  lastName: shortText.optional(),
  email: email.optional(),
  phone: shortText.optional(),
  jobTitle: shortText.optional(),
  website: shortText.optional(),
  city: shortText.optional(),
  country: shortText.optional(),
  lifecycleStage: lifecycleStage.optional(),
  leadStatus: leadStatus.optional(),
  source: source.optional(),
});

export const importCompanyRowSchema = z.object({
  name: shortText.optional(),
  domain: shortText.optional(),
  industry: shortText.optional(),
  employees: z.number().int().min(0).nullish(),
  phone: shortText.optional(),
  website: shortText.optional(),
  city: shortText.optional(),
  country: shortText.optional(),
  lifecycleStage: lifecycleStage.optional(),
});

export const importContactsSchema = z.object({
  mode: z.enum(['skip', 'update']),
  rows: z.array(importContactRowSchema).min(1).max(5000),
});

export const importCompaniesSchema = z.object({
  mode: z.enum(['skip', 'update']),
  rows: z.array(importCompanyRowSchema).min(1).max(5000),
});

// ---------- Tipos inferidos ----------

export type ContactCreatePayload = z.infer<typeof contactCreateSchema>;
export type ContactUpdatePayload = z.infer<typeof contactUpdateSchema>;
export type ContactBulkUpdatePayload = z.infer<typeof contactBulkUpdateSchema>;
export type ContactMergePayload = z.infer<typeof contactMergeSchema>;
export type CompanyCreatePayload = z.infer<typeof companyCreateSchema>;
export type CompanyUpdatePayload = z.infer<typeof companyUpdateSchema>;
export type PipelineCreatePayload = z.infer<typeof pipelineCreateSchema>;
export type StageCreatePayload = z.infer<typeof stageCreateSchema>;
export type StageUpdatePayload = z.infer<typeof stageUpdateSchema>;
export type StagesReorderPayload = z.infer<typeof stagesReorderSchema>;
export type DealCreatePayload = z.infer<typeof dealCreateSchema>;
export type DealUpdatePayload = z.infer<typeof dealUpdateSchema>;
export type DealMovePayload = z.infer<typeof dealMoveSchema>;
export type ActivityCreatePayload = z.infer<typeof activityCreateSchema>;
export type ActivityUpdatePayload = z.infer<typeof activityUpdateSchema>;
export type TaskProjectCreatePayload = z.infer<typeof taskProjectCreateSchema>;
export type TaskProjectUpdatePayload = z.infer<typeof taskProjectUpdateSchema>;
export type ListCreatePayload = z.infer<typeof listCreateSchema>;
export type ListUpdatePayload = z.infer<typeof listUpdateSchema>;
export type ListMembersPayload = z.infer<typeof listMembersSchema>;
export type SavedViewCreatePayload = z.infer<typeof savedViewCreateSchema>;
export type CustomFieldCreatePayload = z.infer<typeof customFieldCreateSchema>;
export type CustomFieldUpdatePayload = z.infer<typeof customFieldUpdateSchema>;
export type ImportContactsPayload = z.infer<typeof importContactsSchema>;
export type ImportCompaniesPayload = z.infer<typeof importCompaniesSchema>;
