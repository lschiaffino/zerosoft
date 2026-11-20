/**
 * CRM: modelo de los filtros avanzados (puro, sin DB: lo usan server y client).
 *
 * Un filtro es una lista de grupos. Dentro de un grupo las reglas se cruzan
 * (Y); entre grupos se suman (O), como los "Advanced filters" de HubSpot.
 *
 *   { "v": 1, "groups": [
 *       { "rules": [ { "f": "lifecycle", "o": "is", "v": ["lead", "customer"] },
 *                    { "f": "created", "o": "last_days", "v": "30" } ] },
 *       { "rules": [ { "f": "owner", "o": "is", "v": ["me"] } ] } ] }
 *
 * Cada regla: `f` = propiedad (las propias van como `custom:<name>`), `o` =
 * operador, `v` = un valor o una lista de valores, `v2` = el segundo extremo
 * de un "entre". Es la misma regla que ya guardaban las listas dinámicas y los
 * links viejos (`?filters=[{f,o,v}]`): una lista plana de reglas se lee como un
 * solo grupo. El SQL lo arma lib/crm-filters.ts.
 */

export type FilterFieldType = 'text' | 'number' | 'select' | 'date' | 'boolean' | 'multiselect';

/** Regla de una lista plana (listas dinámicas, objetos propios, links viejos): un solo valor. */
export interface FilterRule {
  f: string;
  o: string;
  v?: string;
  v2?: string;
}

/** Regla de un grupo: como FilterRule, con uno o varios valores. */
export interface FilterCond {
  f: string;
  o: string;
  v?: string | string[];
  v2?: string;
}

export interface FilterGroup {
  rules: FilterCond[];
}

export interface FilterModel {
  v: 1;
  groups: FilterGroup[];
}

export const MAX_FILTER_GROUPS = 5;
export const MAX_GROUP_RULES = 20;
export const MAX_RULE_VALUES = 50;
const MAX_FIELD_LENGTH = 120;
const MAX_OP_LENGTH = 20;
const MAX_VALUE_LENGTH = 500;

export const EMPTY_FILTER: FilterModel = { v: 1, groups: [] };

/** Valores especiales de una propiedad de owner: quien mira y los registros sin owner. */
export const OWNER_ME = 'me';
export const OWNER_UNASSIGNED = 'unassigned';

/** Períodos relativos de una fecha (sin valor): se calculan en la zona horaria de quien mira. */
export const DATE_PERIOD_OPS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'next_week',
  'this_month',
  'last_month',
  'next_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
] as const;
export type DatePeriodOp = (typeof DATE_PERIOD_OPS)[number];

/** Operadores de fecha que llevan una cantidad de días. */
export const DATE_DAYS_OPS = ['last_days', 'next_days', 'less_days_ago', 'more_days_ago'] as const;

/** Operadores que se ofrecen por tipo de propiedad. */
export const FILTER_OPS: Record<FilterFieldType, readonly string[]> = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'starts', 'ends', 'known', 'unknown'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'known', 'unknown'],
  date: ['on', 'before', 'after', 'between', ...DATE_DAYS_OPS, ...DATE_PERIOD_OPS, 'known', 'unknown'],
  select: ['is', 'isnot', 'known', 'unknown'],
  multiselect: ['is', 'isnot', 'all', 'known', 'unknown'],
  boolean: ['true', 'false', 'unknown'],
};

export const DEFAULT_FILTER_OP: Record<FilterFieldType, string> = {
  text: 'contains',
  number: 'eq',
  date: 'last_days',
  select: 'is',
  multiselect: 'is',
  boolean: 'true',
};

/**
 * Qué valor lleva un operador: ninguno, uno, dos (entre), varios (cualquiera
 * de / ninguno de) o una cantidad de días.
 */
export type OpArity = 'none' | 'one' | 'two' | 'many' | 'days';

export function opArity(type: FilterFieldType, op: string): OpArity {
  if (op === 'known' || op === 'unknown') return 'none';
  if (type === 'boolean') return op === 'is' || op === 'isnot' ? 'one' : 'none';
  if (type === 'date') {
    if ((DATE_PERIOD_OPS as readonly string[]).includes(op)) return 'none';
    if ((DATE_DAYS_OPS as readonly string[]).includes(op)) return 'days';
    return op === 'between' ? 'two' : 'one';
  }
  if (type === 'number') return op === 'between' ? 'two' : 'one';
  return 'many';
}

/** Los valores de una regla como lista, sin vacíos ni repetidos. */
export function ruleValues(rule: Pick<FilterCond, 'v'>): string[] {
  const raw = Array.isArray(rule.v) ? rule.v : rule.v === undefined ? [] : [rule.v];
  const out: string[] = [];
  for (const item of raw) {
    const s = typeof item === 'string' ? item.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' que existe en el calendario. */
export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Días de un operador relativo: entero de 1 a 3650. */
export function parseDays(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{1,4}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n >= 1 && n <= 3650 ? n : null;
}

/** ¿La regla tiene lo que su operador necesita? (el editor la aplica solo si está completa). */
export function isRuleComplete(type: FilterFieldType, rule: FilterCond, ops: readonly string[] = FILTER_OPS[type]): boolean {
  if (!ops.includes(rule.o)) return false;
  const values = ruleValues(rule);
  const first = values[0] ?? '';
  switch (opArity(type, rule.o)) {
    case 'none':
      return true;
    case 'days':
      return parseDays(first) !== null;
    case 'many':
      return values.length > 0;
    case 'one':
      if (type === 'date') return isIsoDay(first);
      if (type === 'number') return first !== '' && Number.isFinite(Number(first));
      return first !== '';
    case 'two': {
      const second = (rule.v2 ?? '').trim();
      if (type === 'date') return isIsoDay(first) && isIsoDay(second);
      return first !== '' && second !== '' && Number.isFinite(Number(first)) && Number.isFinite(Number(second));
    }
  }
}

function cleanCond(raw: unknown): FilterCond | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.f !== 'string' || typeof r.o !== 'string' || !r.f.trim() || !r.o.trim()) return null;
  const out: FilterCond = { f: r.f.trim().slice(0, MAX_FIELD_LENGTH), o: r.o.trim().slice(0, MAX_OP_LENGTH) };
  if (typeof r.v === 'string') out.v = r.v.slice(0, MAX_VALUE_LENGTH);
  else if (Array.isArray(r.v)) {
    out.v = r.v
      .filter((x): x is string => typeof x === 'string')
      .slice(0, MAX_RULE_VALUES)
      .map((x) => x.slice(0, MAX_VALUE_LENGTH));
  }
  if (typeof r.v2 === 'string') out.v2 = r.v2.slice(0, MAX_VALUE_LENGTH);
  return out;
}

function cleanRules(raw: unknown): FilterCond[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterCond[] = [];
  for (const item of raw.slice(0, MAX_GROUP_RULES)) {
    const cond = cleanCond(item);
    if (cond) out.push(cond);
  }
  return out;
}

/**
 * Lee un filtro ya parseado de JSON: el modelo con grupos o la lista plana de
 * antes (un solo grupo). Lo que no tiene forma de regla se descarta; los
 * grupos que quedan vacíos también.
 */
export function cleanFilterModel(value: unknown): FilterModel {
  let groups: FilterGroup[] = [];
  if (Array.isArray(value)) {
    groups = [{ rules: cleanRules(value) }];
  } else if (typeof value === 'object' && value !== null) {
    const raw = (value as Record<string, unknown>).groups;
    if (Array.isArray(raw)) {
      groups = raw.slice(0, MAX_FILTER_GROUPS).map((g) => ({
        rules: cleanRules(Array.isArray(g) ? g : typeof g === 'object' && g !== null ? (g as Record<string, unknown>).rules : null),
      }));
    }
  }
  return { v: 1, groups: groups.filter((g) => g.rules.length > 0) };
}

/** Lee el query param `filters` (JSON). Ante cualquier corrupción devuelve el filtro vacío. */
export function parseFilterModel(raw: string | null | undefined): FilterModel {
  if (!raw) return { v: 1, groups: [] };
  try {
    return cleanFilterModel(JSON.parse(raw));
  } catch {
    return { v: 1, groups: [] };
  }
}

/** El filtro como texto para la URL o para guardar; '' si no tiene reglas. */
export function serializeFilterModel(model: FilterModel): string {
  const groups = model.groups.filter((g) => g.rules.length > 0);
  if (!groups.length) return '';
  return JSON.stringify({ v: 1, groups });
}

export function countFilterRules(model: FilterModel): number {
  return model.groups.reduce((n, g) => n + g.rules.length, 0);
}

/** Lo que el editor necesita saber de una propiedad para validar sus reglas. */
export interface FilterFieldShape {
  type: FilterFieldType;
  /** Operadores que admite, si no son todos los de su tipo (tags, listas, tramos de score). */
  ops?: readonly string[];
}

/**
 * Deja solo las reglas de propiedades conocidas, con un operador de esa
 * propiedad y su valor completo. Así los chips y la tabla muestran lo mismo:
 * una regla que el server ignoraría no aparece como activa.
 */
export function sanitizeFilterModel(model: FilterModel, fields: Record<string, FilterFieldShape>): FilterModel {
  const groups: FilterGroup[] = [];
  for (const group of model.groups.slice(0, MAX_FILTER_GROUPS)) {
    const rules = group.rules.filter((rule) => {
      const def = Object.prototype.hasOwnProperty.call(fields, rule.f) ? fields[rule.f] : undefined;
      if (!def) return false;
      return isRuleComplete(def.type, rule, legacyOps(def));
    });
    if (rules.length) groups.push({ rules: rules.slice(0, MAX_GROUP_RULES) });
  }
  return { v: 1, groups };
}

/** Los operadores de la propiedad más los que usaban los links viejos para sí/no (is/isnot con 1 o 0). */
function legacyOps(def: FilterFieldShape): readonly string[] {
  const ops = def.ops ?? FILTER_OPS[def.type];
  return def.type === 'boolean' ? [...ops, 'is', 'isnot'] : ops;
}
