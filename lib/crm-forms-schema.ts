/**
 * CRM Forms — tipos, schemas zod y lógica pura (sin DB): la usan el builder
 * (cliente), la página pública /f/<key> y lib/crm-forms.ts (servidor).
 */
import { z } from 'zod';
import { LEAD_STATUSES, LIFECYCLE_STAGES, SOURCES } from './crm-constants';

export const FORM_FIELD_TYPES = ['text', 'email', 'phone', 'select', 'checkbox', 'textarea', 'hidden'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_STATUSES = ['active', 'paused', 'archived'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

/** Propiedades estándar del contacto a las que se puede mapear un campo. */
export const CONTACT_FORM_PROPS = [
  'email',
  'firstName',
  'lastName',
  'fullName',
  'phone',
  'jobTitle',
  'website',
  'city',
  'country',
] as const;
/** Propiedades de la empresa (se crea o se busca por nombre/dominio). */
export const COMPANY_FORM_PROPS = ['name', 'domain', 'industry', 'website', 'phone', 'city', 'country'] as const;

/** Parámetros de URL que un campo oculto puede capturar. */
export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

export interface FormField {
  /** Clave estable (name del input). */
  id: string;
  type: FormFieldType;
  label: string;
  /**
   * Destino: '' (solo queda en el envío), una propiedad del contacto
   * ('email', 'firstName', …), 'custom.<name>' (custom field del contacto),
   * 'company.<prop>' o 'company.custom.<name>'.
   */
  property: string;
  required: boolean;
  placeholder?: string;
  /** Opciones (select). */
  options?: string[];
  /** Valor fijo (hidden) o valor por defecto. */
  defaultValue?: string;
  /** Hidden: lee este parámetro de la URL de la página (utm_source, …). */
  urlParam?: string;
}

export interface FormSettings {
  title: string;
  description: string;
  submitText: string;
  /** Texto del checkbox de consentimiento ('' = sin checkbox). */
  consentText: string;
  consentRequired: boolean;
  successMode: 'message' | 'redirect';
  successMessage: string;
  redirectUrl: string;
  /** Avisar al owner del contacto (notificación in-app). */
  notifyOwner: boolean;
  /** Emails extra a los que avisar de cada envío. */
  notifyEmails: string[];
  lifecycleStage: string;
  leadStatus: string;
  source: string;
  /** Owner fijo de los contactos nuevos ('' = round-robin o dueño del workspace). */
  ownerId: string;
  listId: string;
  tagIds: string[];
  sequenceId: string;
  /** Dedupe por email: actualiza el contacto existente en vez de duplicarlo. */
  updateExisting: boolean;
  /** Segundos mínimos entre que carga el form y se envía (0 = sin chequeo). */
  minSubmitSeconds: number;
}

export const DEFAULT_FORM_SETTINGS: FormSettings = {
  title: '',
  description: '',
  submitText: 'Submit',
  consentText: '',
  consentRequired: false,
  successMode: 'message',
  successMessage: 'Thanks! We will be in touch soon.',
  redirectUrl: '',
  notifyOwner: true,
  notifyEmails: [],
  lifecycleStage: 'lead',
  leadStatus: 'new',
  source: 'form',
  ownerId: '',
  listId: '',
  tagIds: [],
  sequenceId: '',
  updateExisting: true,
  minSubmitSeconds: 2,
};

export function defaultFormFields(): FormField[] {
  return [
    { id: 'email', type: 'email', label: 'Email', property: 'email', required: true, placeholder: 'you@company.com' },
    { id: 'first_name', type: 'text', label: 'First name', property: 'firstName', required: false },
    { id: 'last_name', type: 'text', label: 'Last name', property: 'lastName', required: false },
  ];
}

// ---------- Schemas ----------

const fieldId = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,40}$/i, { message: 'invalid_field_id' });

export const formFieldSchema = z.object({
  id: fieldId,
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().trim().max(200),
  property: z
    .string()
    .trim()
    .max(80)
    .regex(/^$|^[a-zA-Z]+$|^custom\.[\w-]{1,60}$|^company\.[a-zA-Z]+$|^company\.custom\.[\w-]{1,60}$/, {
      message: 'invalid_property',
    }),
  required: z.boolean(),
  placeholder: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  defaultValue: z.string().max(500).optional(),
  urlParam: z.string().trim().max(60).regex(/^[\w-]*$/).optional(),
});

const emailish = z.string().trim().max(320).email();

export const formSettingsSchema = z.object({
  title: z.string().trim().max(200),
  description: z.string().trim().max(2000),
  submitText: z.string().trim().max(60),
  consentText: z.string().trim().max(1000),
  consentRequired: z.boolean(),
  successMode: z.enum(['message', 'redirect']),
  successMessage: z.string().trim().max(1000),
  redirectUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), { message: 'invalid_url' }),
  notifyOwner: z.boolean(),
  notifyEmails: z.array(emailish).max(10),
  lifecycleStage: z.enum(['', ...LIFECYCLE_STAGES]),
  leadStatus: z.enum(['', ...LEAD_STATUSES]),
  source: z.enum(['', ...SOURCES]),
  ownerId: z.string().max(64),
  listId: z.string().max(64),
  tagIds: z.array(z.string().min(1).max(64)).max(20),
  sequenceId: z.string().max(64),
  updateExisting: z.boolean(),
  minSubmitSeconds: z.number().int().min(0).max(60),
});

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, { message: 'invalid_slug' });

export const formCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slug.nullish(),
  status: z.enum(FORM_STATUSES).optional(),
  fields: z.array(formFieldSchema).min(1).max(50).optional(),
  settings: formSettingsSchema.partial().optional(),
});

export const formUpdateSchema = formCreateSchema.partial();

export type FormCreateInput = z.infer<typeof formCreateSchema>;
export type FormUpdateInput = z.infer<typeof formUpdateSchema>;

/** Body del POST público (/api/crm/forms/submit/<key>). */
export const formSubmitSchema = z.object({
  values: z.record(z.union([z.string().max(5000), z.boolean()])),
  consent: z.boolean().optional(),
  /** Honeypot: los humanos no lo ven; un bot lo completa. */
  website_url: z.string().max(500).optional(),
  /** ms desde que se mostró el form. */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  utm: z.record(z.string().max(500)).optional(),
  pageUrl: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
});
export type FormSubmitBody = z.infer<typeof formSubmitSchema>;

// ---------- Lógica pura ----------

/** Settings guardados (JSON) + defaults: siempre devuelve un objeto completo. */
export function normalizeSettings(raw: unknown): FormSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const parsed = formSettingsSchema.partial().safeParse(obj);
  return { ...DEFAULT_FORM_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export function normalizeFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const p = formFieldSchema.safeParse(f);
    if (!p.success || seen.has(p.data.id)) continue;
    seen.add(p.data.id);
    out.push(p.data);
  }
  return out;
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export type FieldError = 'required' | 'invalid_email' | 'invalid_option' | 'invalid_phone';

/**
 * Valida y limpia los valores enviados contra la definición del form.
 * Devuelve los valores normalizados (solo campos del form) y los errores por campo.
 */
export function validateSubmission(
  fields: FormField[],
  settings: FormSettings,
  body: Pick<FormSubmitBody, 'values' | 'consent'>,
  urlParams: Record<string, string> = {},
): { values: Record<string, string | boolean>; errors: Record<string, FieldError> } {
  const values: Record<string, string | boolean> = {};
  const errors: Record<string, FieldError> = {};
  for (const field of fields) {
    const raw = body.values[field.id];
    if (field.type === 'checkbox') {
      const checked = raw === true || raw === 'true' || raw === 'on' || raw === '1';
      if (field.required && !checked) errors[field.id] = 'required';
      values[field.id] = checked;
      continue;
    }
    let value = typeof raw === 'string' ? raw.trim() : '';
    if (field.type === 'hidden') {
      // Hidden: el parámetro de URL gana; si no, lo que mandó la página o el valor fijo.
      const fromUrl = field.urlParam ? (urlParams[field.urlParam] ?? '').trim() : '';
      value = (fromUrl || value || field.defaultValue || '').slice(0, 500);
      values[field.id] = value;
      continue;
    }
    if (!value && field.defaultValue) value = field.defaultValue;
    if (!value) {
      if (field.required) errors[field.id] = 'required';
      values[field.id] = '';
      continue;
    }
    if (field.type === 'email' && !EMAIL_RE.test(value)) errors[field.id] = 'invalid_email';
    if (field.type === 'phone' && !/^[+\d][\d\s().-]{4,30}$/.test(value)) errors[field.id] = 'invalid_phone';
    if (field.type === 'select' && field.options?.length && !field.options.includes(value)) {
      errors[field.id] = 'invalid_option';
    }
    values[field.id] = field.type === 'email' ? value.toLowerCase() : value;
  }
  if (settings.consentText && settings.consentRequired && !body.consent) errors.__consent = 'required';
  return { values, errors };
}

export interface MappedSubmission {
  contact: Record<string, string>;
  contactCustom: Record<string, string | boolean>;
  company: Record<string, string>;
  companyCustom: Record<string, string | boolean>;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Valores validados → propiedades de contacto/empresa según el mapeo de cada campo. */
export function mapSubmission(fields: FormField[], values: Record<string, string | boolean>): MappedSubmission {
  const out: MappedSubmission = { contact: {}, contactCustom: {}, company: {}, companyCustom: {} };
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined || value === '' || !field.property) continue;
    const prop = field.property;
    if (prop.startsWith('company.custom.')) {
      out.companyCustom[prop.slice('company.custom.'.length)] = value;
    } else if (prop.startsWith('company.')) {
      const key = prop.slice('company.'.length);
      if ((COMPANY_FORM_PROPS as readonly string[]).includes(key)) out.company[key] = String(value);
    } else if (prop.startsWith('custom.')) {
      out.contactCustom[prop.slice('custom.'.length)] = value;
    } else if (prop === 'fullName') {
      const { firstName, lastName } = splitName(String(value));
      if (firstName && !out.contact.firstName) out.contact.firstName = firstName;
      if (lastName && !out.contact.lastName) out.contact.lastName = lastName;
    } else if ((CONTACT_FORM_PROPS as readonly string[]).includes(prop)) {
      out.contact[prop] = String(value);
    }
  }
  return out;
}

/** Parámetros de UTM/URL de una URL (para capturar en campos ocultos). */
export function urlParamsOf(url: string | undefined): Record<string, string> {
  if (!url) return {};
  try {
    const u = new URL(url);
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      if (k.length <= 60) out[k] = v.slice(0, 500);
    });
    return out;
  } catch {
    return {};
  }
}
