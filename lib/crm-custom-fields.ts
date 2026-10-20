/**
 * CRM — tipos de custom field (puro, sin DB: lo usan server y client).
 *
 * Cómo se guarda cada valor en el JSON `custom` del registro:
 * - text, url, phone: string (url siempre http/https).
 * - number, currency: number (la moneda es del campo: options[0], p. ej. "USD").
 * - date: 'YYYY-MM-DD'.
 * - select: una de las opciones; multiselect: lista de opciones (string[]).
 * - boolean: true/false.
 * - user: id de una persona del workspace.
 */
import { CRM_CUSTOM_FIELD_TYPES, type CrmCustomFieldType } from './schema/types';
import { formatMoney } from './crm-money';

export { CRM_CUSTOM_FIELD_TYPES, type CrmCustomFieldType };

export interface CustomFieldDefLike {
  name: string;
  label: string;
  type: CrmCustomFieldType;
  /** JSON string[] (como en la fila) o la lista ya parseada. */
  options: string | string[];
}

/** Tipos que eligen de una lista de opciones definida en el campo. */
export const OPTION_FIELD_TYPES: ReadonlySet<CrmCustomFieldType> = new Set(['select', 'multiselect']);

export function isCustomFieldType(v: unknown): v is CrmCustomFieldType {
  return typeof v === 'string' && (CRM_CUSTOM_FIELD_TYPES as readonly string[]).includes(v);
}

/** Opciones del campo (JSON de la fila o lista). Tolera datos rotos. */
export function fieldOptions(def: Pick<CustomFieldDefLike, 'options'>): string[] {
  let raw: unknown = def.options;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : [];
}

/** Moneda de un campo currency (la primera "opción"); USD si falta o no es un código ISO. */
export function fieldCurrency(def: Pick<CustomFieldDefLike, 'options'>): string {
  const cur = (fieldOptions(def)[0] ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : 'USD';
}

/** Tipo con el que el filtro avanzado compara el campo (lib/crm.ts buildRuleCondition). */
export type CustomFilterType = 'text' | 'number' | 'select' | 'date' | 'boolean' | 'multiselect';

export function filterTypeFor(type: CrmCustomFieldType): CustomFilterType {
  switch (type) {
    case 'number':
    case 'currency':
      return 'number';
    case 'date':
      return 'date';
    case 'select':
    case 'user':
      return 'select';
    case 'boolean':
      return 'boolean';
    case 'multiselect':
      return 'multiselect';
    default:
      return 'text';
  }
}

/** URL guardable: http(s) con host. */
export function isValidFieldUrl(v: string): boolean {
  if (v.length > 2000) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** "acme.com" → "https://acme.com"; lo que ya trae protocolo queda igual. */
export function normalizeFieldUrl(v: string): string {
  const s = v.trim();
  if (!s) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

/** Teléfono: dígitos con +, espacios, guiones, puntos o paréntesis (de 5 a 20 dígitos). */
export function isValidFieldPhone(v: string): boolean {
  if (!/^\+?[0-9 ().-]{5,40}$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 5 && digits <= 20;
}

/**
 * Valor de un custom field normalizado a su tipo. null = vaciar; undefined =
 * inválido. `users`: ids válidos para el tipo user (sin la lista, cualquier id).
 */
export function coerceCustomFieldValue(
  def: Pick<CustomFieldDefLike, 'type' | 'options'>,
  value: unknown,
  users?: ReadonlySet<string>,
): unknown {
  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  switch (def.type) {
    case 'number':
    case 'currency': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return undefined;
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    case 'select':
      return typeof value === 'string' && fieldOptions(def).includes(value) ? value : undefined;
    case 'multiselect': {
      const options = fieldOptions(def);
      // Desde un CSV o un formulario puede llegar "A, B".
      const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map((v) => v.trim()) : null;
      if (!list || list.some((v) => typeof v !== 'string' || !options.includes(v))) return undefined;
      return options.filter((o) => (list as string[]).includes(o));
    }
    case 'url': {
      if (typeof value !== 'string') return undefined;
      const url = normalizeFieldUrl(value);
      return isValidFieldUrl(url) ? url : undefined;
    }
    case 'phone': {
      if (typeof value !== 'string') return undefined;
      const v = value.trim();
      return isValidFieldPhone(v) ? v : undefined;
    }
    case 'user':
      if (typeof value !== 'string' || !value || value.length > 64) return undefined;
      return users && !users.has(value) ? undefined : value;
    default:
      return typeof value === 'string' ? value.trim().slice(0, 500) : typeof value === 'number' ? String(value) : undefined;
  }
}

/**
 * Valor para mostrar (tablas, propiedades). '' = vacío. `users`: id → nombre
 * para el tipo user.
 */
export function formatCustomFieldValue(
  def: Pick<CustomFieldDefLike, 'type' | 'options'>,
  raw: unknown,
  ctx: { locale: string; yes: string; no: string; users?: ReadonlyMap<string, string> },
): string {
  if (raw === null || raw === undefined || raw === '') return '';
  switch (def.type) {
    case 'boolean':
      return raw === true || raw === 'true' ? ctx.yes : raw === false || raw === 'false' ? ctx.no : '';
    case 'currency': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? formatMoney(n, fieldCurrency(def), ctx.locale, true) : String(raw);
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? new Intl.NumberFormat(ctx.locale).format(n) : String(raw);
    }
    case 'multiselect':
      return Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
    case 'user':
      return ctx.users?.get(String(raw)) ?? String(raw);
    default:
      return Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
  }
}

/** Link del valor: url → la URL; phone → tel:. null si no corresponde. */
export function customFieldHref(def: Pick<CustomFieldDefLike, 'type'>, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (def.type === 'url') return isValidFieldUrl(raw) ? raw : null;
  if (def.type === 'phone') return `tel:${raw.replace(/[^0-9+]/g, '')}`;
  return null;
}

/**
 * Valores crudos (de un formulario público, p. ej.) convertidos al tipo de
 * cada campo. Los que no validan se descartan; los de campos que no existen
 * quedan como vinieron.
 */
export function typedCustomValues(
  defs: Array<Pick<CustomFieldDefLike, 'name' | 'type' | 'options'>>,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const def = defs.find((d) => d.name === name);
    if (!def) {
      out[name] = value;
      continue;
    }
    const v = coerceCustomFieldValue(def, value);
    if (v !== undefined && v !== null) out[name] = v;
  }
  return out;
}
