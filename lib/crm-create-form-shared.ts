/**
 * CRM — formulario de alta configurable (HubSpot "Manage create form").
 * Puro, sin server: lo usan los formularios, Ajustes y lib/crm-create-form.ts.
 *
 * Por objeto (contactos, empresas, deals) owner y admins eligen qué
 * propiedades muestra el alta, en qué orden y cuáles son obligatorias. Las
 * propiedades base de cada objeto (nombre, email, pipeline…) van siempre
 * arriba; el resto es una lista ordenada de claves:
 * - propiedades propias del objeto (`phone`, `dealType`…, las de BUILTIN_FIELDS);
 * - propiedades personalizadas, como `custom.<name>`.
 *
 * Lo obligatorio se aplica al crear desde la app (las rutas de sesión). La API
 * v1, el import, los formularios públicos y la sync no lo piden, como HubSpot.
 */
import { DEAL_TYPES, LEAD_STATUSES, LIFECYCLE_STAGES, PRIORITIES, SOURCES } from './crm-constants';

export const CREATE_FORM_ENTITIES = ['contacts', 'companies', 'deals'] as const;
export type CreateFormEntity = (typeof CREATE_FORM_ENTITIES)[number];

export function isCreateFormEntity(v: unknown): v is CreateFormEntity {
  return typeof v === 'string' && (CREATE_FORM_ENTITIES as readonly string[]).includes(v);
}

/** Cómo se carga una propiedad propia en el formulario. */
export type BuiltinInput =
  | 'text'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'textarea'
  | 'currency'
  | 'select'
  | 'company'
  | 'contact'
  | 'owner';

export interface BuiltinField {
  key: string;
  input: BuiltinInput;
  /** select: valores (se traducen con `enums.<enumKey>.<valor>`). */
  options?: readonly string[];
  enumKey?: string;
  /** Valor elegido al abrir ('' = vacío). */
  defaultValue?: string;
}

/** Propiedades base: siempre a la vista y arriba, en este orden. */
export const CORE_FIELDS: Record<CreateFormEntity, readonly string[]> = {
  contacts: ['firstName', 'lastName', 'email'],
  companies: ['name', 'domain'],
  deals: ['name', 'pipelineId', 'stageId'],
};

/** Base que siempre es obligatoria (no se puede apagar). */
export const ALWAYS_REQUIRED: Record<CreateFormEntity, readonly string[]> = {
  contacts: [],
  companies: ['name'],
  deals: ['name', 'pipelineId', 'stageId'],
};

/** Propiedades propias que se pueden sumar al formulario, en el orden del catálogo. */
export const BUILTIN_FIELDS: Record<CreateFormEntity, readonly BuiltinField[]> = {
  contacts: [
    { key: 'phone', input: 'tel' },
    { key: 'jobTitle', input: 'text' },
    { key: 'companyId', input: 'company' },
    { key: 'ownerId', input: 'owner' },
    { key: 'lifecycleStage', input: 'select', options: LIFECYCLE_STAGES, enumKey: 'lifecycle', defaultValue: 'lead' },
    { key: 'leadStatus', input: 'select', options: LEAD_STATUSES, enumKey: 'leadStatus', defaultValue: 'new' },
    { key: 'source', input: 'select', options: SOURCES, enumKey: 'source' },
    { key: 'website', input: 'url' },
    { key: 'city', input: 'text' },
    { key: 'country', input: 'text' },
  ],
  companies: [
    { key: 'industry', input: 'text' },
    { key: 'employees', input: 'number' },
    { key: 'phone', input: 'tel' },
    { key: 'website', input: 'url' },
    { key: 'ownerId', input: 'owner' },
    { key: 'lifecycleStage', input: 'select', options: LIFECYCLE_STAGES, enumKey: 'lifecycle', defaultValue: 'lead' },
    { key: 'city', input: 'text' },
    { key: 'country', input: 'text' },
  ],
  deals: [
    { key: 'amount', input: 'number' },
    { key: 'currency', input: 'currency' },
    { key: 'closeDate', input: 'date' },
    { key: 'ownerId', input: 'owner' },
    { key: 'dealType', input: 'select', options: DEAL_TYPES, enumKey: 'dealType' },
    { key: 'priority', input: 'select', options: PRIORITIES, enumKey: 'priority', defaultValue: 'medium' },
    { key: 'source', input: 'select', options: SOURCES, enumKey: 'source' },
    { key: 'contactId', input: 'contact' },
    { key: 'nextStep', input: 'text' },
    { key: 'wonReason', input: 'text' },
    { key: 'description', input: 'textarea' },
  ],
};

/** Lo que muestra el alta si nadie la configuró (lo que ya mostraba el alta rápida). */
export const DEFAULT_CREATE_FORM: Record<CreateFormEntity, readonly CreateFormField[]> = {
  contacts: [
    { key: 'phone', required: false },
    { key: 'companyId', required: false },
    { key: 'lifecycleStage', required: false },
  ],
  companies: [{ key: 'industry', required: false }],
  deals: [
    { key: 'amount', required: false },
    { key: 'closeDate', required: false },
  ],
};

export const MAX_CREATE_FORM_FIELDS = 40;
export const CUSTOM_KEY_PREFIX = 'custom.';

export interface CreateFormField {
  key: string;
  required: boolean;
}

/** Una propiedad personalizada tal como la ve el formulario. */
export interface CreateFormCustomDef {
  name: string;
  label: string;
  type: string;
  options: string[];
  description?: string;
}

/** Propiedad del formulario ya resuelta para quien lo abre. */
export interface ResolvedCreateField {
  key: string;
  required: boolean;
  /** Solo en las personalizadas. */
  custom?: CreateFormCustomDef;
}

export function builtinField(entity: CreateFormEntity, key: string): BuiltinField | undefined {
  return BUILTIN_FIELDS[entity].find((f) => f.key === key);
}

export function customKey(name: string): string {
  return CUSTOM_KEY_PREFIX + name;
}

export function customName(key: string): string | null {
  return key.startsWith(CUSTOM_KEY_PREFIX) && key.length > CUSTOM_KEY_PREFIX.length ? key.slice(CUSTOM_KEY_PREFIX.length) : null;
}

/** Tipos de propiedad personalizada que no se pueden pedir obligatorios (una casilla sin marcar es un valor). */
const NOT_REQUIRABLE_CUSTOM: ReadonlySet<string> = new Set(['boolean']);

/** ¿Se puede marcar obligatoria? La base que ya lo es siempre, no; un sí/no, tampoco. */
export function isRequirable(entity: CreateFormEntity, key: string, customType?: string): boolean {
  if (ALWAYS_REQUIRED[entity].includes(key)) return false;
  if (customName(key)) return customType !== undefined && !NOT_REQUIRABLE_CUSTOM.has(customType);
  return CORE_FIELDS[entity].includes(key) || !!builtinField(entity, key);
}

/**
 * Limpia una configuración: solo claves conocidas (base, propias del objeto o
 * personalizadas que existen), sin repetir, como mucho MAX. La base va
 * primero y en su orden; queda guardada solo si es obligatoria.
 * `customTypes`: nombre → tipo de las personalizadas del objeto.
 */
export function sanitizeCreateForm(
  entity: CreateFormEntity,
  fields: ReadonlyArray<{ key: unknown; required?: unknown }>,
  customTypes: ReadonlyMap<string, string>,
): CreateFormField[] {
  const seen = new Set<string>();
  const core: CreateFormField[] = [];
  const rest: CreateFormField[] = [];
  for (const f of fields) {
    if (typeof f?.key !== 'string' || seen.has(f.key)) continue;
    const key = f.key;
    const name = customName(key);
    const isCore = CORE_FIELDS[entity].includes(key);
    if (!isCore && !builtinField(entity, key) && !(name && customTypes.has(name))) continue;
    seen.add(key);
    const required = f.required === true && isRequirable(entity, key, name ? customTypes.get(name) : undefined);
    if (isCore) {
      if (required) core.push({ key, required });
    } else if (rest.length < MAX_CREATE_FORM_FIELDS) {
      rest.push({ key, required });
    }
  }
  core.sort((a, b) => CORE_FIELDS[entity].indexOf(a.key) - CORE_FIELDS[entity].indexOf(b.key));
  return [...core, ...rest];
}

/** ¿Obligatoria? La base siempre obligatoria cuenta. */
export function isRequired(entity: CreateFormEntity, form: readonly CreateFormField[], key: string): boolean {
  return ALWAYS_REQUIRED[entity].includes(key) || form.some((f) => f.key === key && f.required);
}

/** Propiedades configurables del formulario (sin la base), en orden. */
export function configuredFields(entity: CreateFormEntity, form: readonly CreateFormField[]): CreateFormField[] {
  return form.filter((f) => !CORE_FIELDS[entity].includes(f.key));
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return !Number.isFinite(v);
  return false;
}

/** Valor de una clave en el body del POST de alta. */
function bodyValue(body: Record<string, unknown>, key: string): unknown {
  const name = customName(key);
  if (name) {
    const custom = body.custom;
    return custom && typeof custom === 'object' && !Array.isArray(custom) ? (custom as Record<string, unknown>)[name] : undefined;
  }
  if (key === 'contactId') return body.contactIds;
  return body[key];
}

/**
 * Claves obligatorias que el body deja vacías. `form` ya resuelto para quien
 * crea (sin lo que tiene oculto o de solo lectura). Puro: lo usan la ruta y
 * el formulario antes de enviar.
 */
export function missingRequired(
  entity: CreateFormEntity,
  form: ReadonlyArray<Pick<ResolvedCreateField, 'key' | 'required'>>,
  body: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const f of form) {
    if (!f.required || ALWAYS_REQUIRED[entity].includes(f.key)) continue;
    if (isEmpty(bodyValue(body, f.key))) out.push(f.key);
  }
  return out;
}

/** Clave de traducción (namespace crm) de la etiqueta de una propiedad propia o base. */
export function builtinLabelKey(entity: CreateFormEntity, key: string): string {
  if (entity === 'deals') {
    if (key === 'pipelineId') return 'deals.pipelineLabel';
    if (key === 'stageId') return 'deals.form.stage';
    if (key === 'contactId') return 'record.form.contact';
    if (key === 'ownerId') return 'deals.form.owner';
    return `deals.form.${key}`;
  }
  const ns = entity === 'contacts' ? 'contacts.form' : 'companies.form';
  if (key === 'lifecycleStage') return `${ns}.lifecycle`;
  if (key === 'companyId') return `${ns}.company`;
  if (key === 'ownerId') return `${ns}.owner`;
  return `${ns}.${key}`;
}
