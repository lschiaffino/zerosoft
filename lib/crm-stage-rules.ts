/**
 * CRM — propiedades obligatorias por etapa (puro: lo usan server y client).
 *
 * Cada etapa guarda en crm_stages.required_fields la lista de propiedades que
 * un deal tiene que tener cargadas para entrar. Se chequea en moveDeal, por
 * donde pasan todos los cambios de etapa (arrastre en el tablero, select de
 * etapa, API, edición en masa, workflows y nodos de Flow). El import y la
 * aceptación de un presupuesto no lo exigen: son datos que llegan de afuera.
 *
 * Claves: las estándar de STAGE_RULE_FIELDS y `custom:<name>` para custom fields.
 */

export const STAGE_RULE_FIELDS = [
  'amount',
  'closeDate',
  'ownerId',
  'priority',
  'source',
  'description',
  'company',
  'contacts',
] as const;
export type StageRuleField = (typeof STAGE_RULE_FIELDS)[number];

/** Campos que se pueden completar en el diálogo del movimiento (las asociaciones no). */
export const FILLABLE_RULE_FIELDS: ReadonlySet<string> = new Set(['amount', 'closeDate', 'ownerId', 'priority', 'source', 'description']);

const CUSTOM_KEY = /^custom:[A-Za-z0-9_\-]{1,100}$/;
export const MAX_REQUIRED_FIELDS = 30;

export function isStageRuleKey(v: unknown): v is string {
  return typeof v === 'string' && ((STAGE_RULE_FIELDS as readonly string[]).includes(v) || CUSTOM_KEY.test(v));
}

/** Lista válida y sin repetidos (descarta lo desconocido). */
export function normalizeRequiredFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isStageRuleKey))].slice(0, MAX_REQUIRED_FIELDS);
}

/** JSON de la columna → lista (tolera datos rotos). */
export function parseRequiredFields(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    return normalizeRequiredFields(JSON.parse(json));
  } catch {
    return [];
  }
}

export interface RuleDeal {
  amount: number | null;
  close_date: string | null;
  owner_id: string | null;
  priority: string | null;
  source: string | null;
  description: string | null;
  custom: Record<string, unknown>;
}

function emptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
}

/**
 * Propiedades de `required` que el deal no tiene. El monto cuenta como vacío
 * si es 0; un booleano `false` cuenta como respondido.
 */
export function missingRequiredFields(
  required: readonly string[],
  deal: RuleDeal,
  assoc: { companies: number; contacts: number },
): string[] {
  const out: string[] = [];
  for (const key of required) {
    let missing: boolean;
    switch (key) {
      case 'amount':
        missing = !(Number(deal.amount) > 0);
        break;
      case 'closeDate':
        missing = emptyValue(deal.close_date);
        break;
      case 'ownerId':
        missing = emptyValue(deal.owner_id);
        break;
      case 'priority':
        missing = emptyValue(deal.priority);
        break;
      case 'source':
        missing = emptyValue(deal.source);
        break;
      case 'description':
        missing = emptyValue(deal.description);
        break;
      case 'company':
        missing = assoc.companies === 0;
        break;
      case 'contacts':
        missing = assoc.contacts === 0;
        break;
      default:
        missing = key.startsWith('custom:') ? emptyValue(deal.custom[key.slice(7)]) : false;
    }
    if (missing) out.push(key);
  }
  return out;
}
