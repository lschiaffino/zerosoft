/**
 * CRM Forms — tipos, schemas zod y lógica pura (sin DB): la usan el builder
 * (cliente), la página pública /f/<key> y lib/crm-forms.ts (servidor).
 */
import { z } from 'zod';
import { LEAD_STATUSES, LIFECYCLE_STAGES, SOURCES } from './crm-constants';

/** 'step' no es un campo: corta el formulario en pasos (su etiqueta es el título del paso). */
export const FORM_FIELD_TYPES = ['text', 'email', 'phone', 'select', 'checkbox', 'textarea', 'hidden', 'step'] as const;
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

/** Lógica condicional: el campo solo se muestra (y se exige) si otro campo cumple esto. */
export const CONDITION_OPS = ['equals', 'not_equals', 'filled', 'empty'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export interface FieldCondition {
  field: string;
  op: ConditionOp;
  value?: string;
}

/** Regla de dueño: si el campo vale esto, el contacto nuevo es de esta persona (la primera que coincide). */
export interface OwnerRule {
  field: string;
  value: string;
  ownerId: string;
}

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
  /** Mostrar solo si se cumple la condición. */
  showIf?: FieldCondition;
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
  /** CAPTCHA (Cloudflare Turnstile; hace falta TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY). */
  captcha: boolean;
  /** Crear un deal con cada envío, en este pipeline y etapa. */
  createDeal: boolean;
  dealPipelineId: string;
  dealStageId: string;
  /** Nombre del deal; {name}, {email}, {company} y {form} se reemplazan. */
  dealName: string;
  /** Reglas de dueño (antes que el dueño fijo y el round-robin). */
  ownerRules: OwnerRule[];
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
  captcha: false,
  createDeal: false,
  dealPipelineId: '',
  dealStageId: '',
  dealName: '{name} · {form}',
  ownerRules: [],
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
  showIf: z
    .object({
      field: z.string().trim().regex(/^[a-z0-9_]{1,40}$/i),
      op: z.enum(CONDITION_OPS),
      value: z.string().max(500).optional(),
    })
    .optional(),
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
  captcha: z.boolean(),
  createDeal: z.boolean(),
  dealPipelineId: z.string().max(64),
  dealStageId: z.string().max(64),
  dealName: z.string().trim().max(200),
  ownerRules: z
    .array(
      z.object({
        field: z.string().trim().regex(/^[a-z0-9_]{1,40}$/i),
        value: z.string().trim().max(500),
        ownerId: z.string().min(1).max(64),
      }),
    )
    .max(30),
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
  /** Token del CAPTCHA (cf-turnstile-response). */
  captchaToken: z.string().max(4000).optional(),
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

/** Valor del campo como texto para comparar ('yes'/'' para checkboxes). */
function asText(v: string | boolean | undefined): string {
  if (v === true) return 'yes';
  if (v === false || v === undefined) return '';
  return String(v).trim();
}

/**
 * ¿Se muestra el campo con estos valores? Sin condición, siempre. Si el campo
 * del que depende está oculto, este también (las cadenas se resuelven solas).
 */
export function isFieldVisible(
  field: FormField,
  values: Record<string, string | boolean | undefined>,
  fields: FormField[],
  depth = 0,
): boolean {
  const c = field.showIf;
  if (!c || depth > 10) return true;
  const parent = fields.find((f) => f.id === c.field);
  if (!parent) return true;
  if (!isFieldVisible(parent, values, fields, depth + 1)) return false;
  const v = asText(values[c.field]);
  const target = (c.value ?? '').trim();
  switch (c.op) {
    case 'filled':
      return v !== '';
    case 'empty':
      return v === '';
    case 'not_equals':
      return v.toLowerCase() !== target.toLowerCase();
    default:
      return v.toLowerCase() === target.toLowerCase();
  }
}

/** Campos agrupados en pasos (los 'step' cortan; el primero puede no tener título). */
export function formSteps(fields: FormField[]): Array<{ title: string; fields: FormField[] }> {
  const steps: Array<{ title: string; fields: FormField[] }> = [{ title: '', fields: [] }];
  for (const f of fields) {
    if (f.type === 'step') {
      if (steps[steps.length - 1].fields.length || steps.length > 1 || steps[0].title) steps.push({ title: f.label, fields: [] });
      else steps[0].title = f.label;
      continue;
    }
    steps[steps.length - 1].fields.push(f);
  }
  return steps.filter((st, i) => st.fields.length || i === 0);
}

/** Dueño según las reglas (primera que coincide), o '' si ninguna. */
export function ownerFromRules(rules: OwnerRule[], values: Record<string, string | boolean>): string {
  for (const r of rules) {
    if (asText(values[r.field]).toLowerCase() === r.value.trim().toLowerCase()) return r.ownerId;
  }
  return '';
}

/** Nombre del deal creado por el envío. */
export function dealNameFor(template: string, ctx: { name: string; email: string; company: string; form: string }): string {
  const out = (template || DEFAULT_FORM_SETTINGS.dealName)
    .replace(/\{name\}/g, ctx.name)
    .replace(/\{email\}/g, ctx.email)
    .replace(/\{company\}/g, ctx.company)
    .replace(/\{form\}/g, ctx.form)
    .replace(/\s*·\s*$/, '')
    .replace(/^\s*·\s*/, '')
    .trim();
  return (out || ctx.form || 'Deal').slice(0, 200);
}

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
    if (field.type === 'step') continue;
    // Oculto por la lógica condicional: no se exige ni se guarda.
    if (!isFieldVisible(field, body.values, fields)) {
      values[field.id] = field.type === 'checkbox' ? false : '';
      continue;
    }
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
