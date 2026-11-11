/**
 * Lines + HubSpot: tipos y funciones puras que comparten el servidor y la
 * interfaz (definición de una propiedad, filtros de la bandeja, formato de un
 * valor). Sin base de datos ni red: se puede importar desde un componente.
 */

/** Cómo se edita y se filtra una propiedad (sale del type y el fieldType de HubSpot). */
export type HubspotPropKind = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'multi' | 'bool' | 'owner';

export interface HubspotOption {
  label: string;
  value: string;
}

export interface HubspotPropDef {
  name: string;
  label: string;
  /** type y fieldType tal como los da HubSpot. */
  type: string;
  fieldType: string;
  kind: HubspotPropKind;
  group: string;
  description: string;
  options: HubspotOption[];
  /** No se edita: HubSpot la marca de solo lectura o la calcula. */
  readOnly: boolean;
  calculated: boolean;
  /** Oculta en HubSpot: se importa y se guarda, pero no se muestra. */
  hidden: boolean;
  /** Creada por la cuenta (no viene con HubSpot). */
  custom: boolean;
}

export interface HubspotOwner {
  id: string;
  name: string;
}

export interface HubspotPropGroup {
  name: string;
  label: string;
}

export interface HubspotSchemaDto {
  connected: boolean;
  /** Última vez que se importaron las propiedades. */
  syncedAt: string | null;
  groups: HubspotPropGroup[];
  props: HubspotPropDef[];
  owners: HubspotOwner[];
  /** Las que el workspace eligió mostrar arriba y en los detalles del chat. */
  pinned: string[];
  /** El token puede escribir empresas (editar desde Lines). */
  canWrite: boolean;
}

export const HUBSPOT_PROP_NAME = /^[A-Za-z0-9_.-]{1,120}$/;
export const HUBSPOT_DEFAULT_PINNED = ['domain', 'hubspot_owner_id', 'lifecyclestage'];
export const HUBSPOT_MAX_PINNED = 12;

export function hubspotPropKind(type: string, fieldType: string, ownerRef = false): HubspotPropKind {
  if (ownerRef) return 'owner';
  if (type === 'bool' || fieldType === 'booleancheckbox') return 'bool';
  if (type === 'enumeration') return fieldType === 'checkbox' ? 'multi' : 'select';
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime';
  return fieldType === 'textarea' || fieldType === 'html' ? 'textarea' : 'text';
}

// ---------------------------------------------------------------------
// Filtros de la bandeja
// ---------------------------------------------------------------------

export const HUBSPOT_FILTER_OPS = ['is', 'is_not', 'contains', 'gt', 'lt', 'any_of', 'none_of', 'empty', 'not_empty'] as const;
export type HubspotFilterOp = (typeof HUBSPOT_FILTER_OPS)[number];

export interface HubspotPropFilter {
  /** Nombre interno de la propiedad de la empresa en HubSpot. */
  name: string;
  op: HubspotFilterOp;
  /** is, is_not, contains, gt, lt. Fechas como YYYY-MM-DD. */
  value?: string;
  /** any_of, none_of. */
  values?: string[];
}

export const HUBSPOT_MAX_FILTERS = 5;

/** Operadores que tienen sentido para cada tipo de propiedad. */
export function hubspotOpsFor(kind: HubspotPropKind): HubspotFilterOp[] {
  if (kind === 'number') return ['is', 'is_not', 'gt', 'lt', 'empty', 'not_empty'];
  if (kind === 'date' || kind === 'datetime') return ['is', 'gt', 'lt', 'empty', 'not_empty'];
  if (kind === 'select' || kind === 'multi' || kind === 'owner' || kind === 'bool') return ['any_of', 'none_of', 'empty', 'not_empty'];
  return ['is', 'is_not', 'contains', 'empty', 'not_empty'];
}

export function hubspotOpNeedsValue(op: HubspotFilterOp): 'none' | 'one' | 'many' {
  if (op === 'empty' || op === 'not_empty') return 'none';
  return op === 'any_of' || op === 'none_of' ? 'many' : 'one';
}

/** Filtros válidos y completos (lo que llega por la URL o de una lista guardada). */
export function cleanHubspotFilters(raw: unknown): HubspotPropFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: HubspotPropFilter[] = [];
  for (const item of raw.slice(0, 20)) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = String(r.name ?? '');
    const op = HUBSPOT_FILTER_OPS.find((o) => o === r.op);
    if (!HUBSPOT_PROP_NAME.test(name) || !op) continue;
    const needs = hubspotOpNeedsValue(op);
    if (needs === 'none') out.push({ name, op });
    else if (needs === 'one') {
      const value = r.value == null ? '' : String(r.value).trim().slice(0, 200);
      if (value) out.push({ name, op, value });
    } else {
      const values = Array.isArray(r.values) ? [...new Set(r.values.filter((v): v is string => typeof v === 'string' && v !== '').map((v) => v.slice(0, 200)))].slice(0, 20) : [];
      if (values.length) out.push({ name, op, values });
    }
    if (out.length >= HUBSPOT_MAX_FILTERS) break;
  }
  return out;
}

/** ?hs=<JSON> de la bandeja. */
export function parseHubspotFilterParam(raw: string | null | undefined): HubspotPropFilter[] {
  if (!raw) return [];
  try {
    return cleanHubspotFilters(JSON.parse(raw));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------

/** Milisegundos de una fecha de HubSpot: ISO, YYYY-MM-DD o epoch en milisegundos. */
export function hubspotTime(value: string): number | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (/^-?\d{9,14}$/.test(v)) return Number(v);
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isFinite(ms) ? ms : null;
}

/** El número con el que se compara un valor: fechas en milisegundos, números tal cual. */
export function hubspotNumeric(kind: HubspotPropKind | null, value: string): number | null {
  if (kind === 'date' || kind === 'datetime') return hubspotTime(value);
  if (kind === 'number') {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Valores de una selección múltiple (HubSpot los separa con punto y coma). */
export function hubspotMulti(value: string): string[] {
  return String(value ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
}

export interface HubspotFormat {
  locale: string;
  owners: HubspotOwner[];
  yes: string;
  no: string;
}

/** Un valor como lo lee una persona: etiqueta de la opción, nombre del dueño, fecha o número local. */
export function formatHubspotValue(def: Pick<HubspotPropDef, 'kind' | 'options'> | null | undefined, value: string, f: HubspotFormat): string {
  const v = String(value ?? '');
  if (!v || !def) return v;
  const label = (x: string) => def.options.find((o) => o.value === x)?.label ?? x;
  if (def.kind === 'owner') return f.owners.find((o) => o.id === v)?.name ?? v;
  if (def.kind === 'bool') return v === 'true' ? f.yes : v === 'false' ? f.no : v;
  if (def.kind === 'select') return label(v);
  if (def.kind === 'multi') return hubspotMulti(v).map(label).join(', ');
  if (def.kind === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString(f.locale, { maximumFractionDigits: 6 }) : v;
  }
  if (def.kind === 'date' || def.kind === 'datetime') {
    const ms = hubspotTime(v);
    if (ms === null) return v;
    // Una fecha de HubSpot es un día, no un instante: se muestra en UTC.
    return def.kind === 'date'
      ? new Date(ms).toLocaleDateString(f.locale, { timeZone: 'UTC', dateStyle: 'medium' })
      : new Date(ms).toLocaleString(f.locale, { dateStyle: 'medium', timeStyle: 'short' });
  }
  return v;
}

// ---------------------------------------------------------------------
// Parecido de nombres (vincular grupos de a muchos)
// ---------------------------------------------------------------------

/** Palabras que no distinguen a una empresa de otra. */
const NOISE = new Set([
  'grupo', 'group', 'team', 'equipo', 'soporte', 'support', 'ventas', 'sales', 'clientes', 'cliente', 'customer', 'customers', 'chat', 'whatsapp', 'wa',
  'sa', 'srl', 'sas', 'inc', 'llc', 'ltd', 'ltda', 'corp', 'co', 'gmbh', 'the', 'and', 'los', 'las', 'del', 'con', 'para', 'por', 'com', 'onboarding', 'x',
]);

/** Palabras que distinguen un nombre: sin tildes, sin signos y sin las genéricas. */
export function nameTokens(name: string): string[] {
  const plain = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return plain.split(' ').filter((w) => w.length > 1 && !NOISE.has(w));
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Parecido entre el nombre de un grupo y el de una empresa, de 0 a 1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  // Cuántas palabras de la empresa están en el grupo: "Acme Logistics soporte" contiene a "Acme Logistics".
  const setA = new Set(ta);
  const shared = tb.filter((w) => setA.has(w)).length;
  const contain = shared / tb.length;
  const ja = ta.join('');
  const jb = tb.join('');
  const ga = bigrams(ja);
  const gb = bigrams(jb);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(1, ja.length - 1) + Math.max(1, jb.length - 1);
  const dice = (2 * overlap) / total;
  // Una sola palabra en común de una empresa de varias palabras no alcanza.
  const containScore = shared === 0 ? 0 : tb.length === 1 ? (tb[0].length >= 4 ? 0.9 : 0.6) : contain === 1 ? 0.95 : contain * 0.7;
  return Math.min(1, Math.max(dice, containScore));
}

export const HUBSPOT_SUGGEST_MIN = 0.6;
