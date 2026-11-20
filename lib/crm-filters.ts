/**
 * CRM: compilador de filtros avanzados a SQL parametrizado (server-only).
 *
 * Un solo camino del modelo (lib/crm-filter-model.ts) al WHERE, para los
 * listados, sus conteos, el export, la API y las listas dinámicas.
 *
 * Reglas de seguridad:
 * - Todo valor va como parámetro (`?`). Nada del usuario entra en el texto SQL.
 * - La expresión de una propiedad sale de un mapa interno (`fields`). Las
 *   propias (`custom:<name>`) pasan por un patrón de nombre y, con
 *   `strictCustom`, tienen que ser una de las propiedades del workspace.
 * - Devuelve UNA condición entre paréntesis: quien la usa la une con AND al
 *   workspace y a la visibilidad del que mira. Un grupo O nunca ensancha lo
 *   que esa persona puede ver.
 */
import { tagCondition, type TagEntity } from './crm-tags';
import { tzOffsetMinutes } from './user-tz';
import {
  DATE_PERIOD_OPS,
  MAX_FILTER_GROUPS,
  MAX_GROUP_RULES,
  OWNER_ME,
  OWNER_UNASSIGNED,
  cleanFilterModel,
  isIsoDay,
  parseDays,
  ruleValues,
  type DatePeriodOp,
  type FilterCond,
  type FilterFieldType,
  type FilterModel,
  type FilterRule,
} from './crm-filter-model';

export type { FilterCond, FilterFieldType, FilterModel, FilterRule };

export interface AdvancedFieldDef {
  /** Expresión SQL ya aliaseada; sale solo de nuestros mapas internos (nunca del usuario). */
  expr: string;
  type: FilterFieldType;
  /**
   * Cómo guarda la fecha una propiedad `date`: `utc` = 'YYYY-MM-DD HH:MM:SS' en
   * UTC (se compara tal cual, así puede usar un índice); `day` = un día de
   * calendario 'YYYY-MM-DD' sin hora; sin valor = un instante en cualquier
   * formato que SQLite entienda (se normaliza con datetime()).
   */
  date?: 'utc' | 'day';
  /** Propiedad de owner: admite los valores "me" y "unassigned". */
  owner?: boolean;
}

/** Quién mira y en qué zona horaria (para "yo" y para las fechas relativas). */
export interface FilterEnv {
  viewerId?: string;
  timeZone?: string;
  now?: Date;
}

export interface FilterContext extends FilterEnv {
  alias: string;
  fields: Record<string, AdvancedFieldDef>;
  /** Tipos de las propiedades propias del workspace (name → tipo). */
  customTypes?: Record<string, FilterFieldType>;
  /** Una propiedad propia que no está en `customTypes` se rechaza (si no, se compara como texto). */
  strictCustom?: boolean;
}

export interface SqlCondition {
  sql: string;
  args: Array<string | number>;
}

/** Nombres de custom fields admitidos en el JSON path (evita inyección en el path). */
export const CUSTOM_NAME = /^[A-Za-z0-9_\-]{1,100}$/;

const ALIAS_ENTITY: Record<string, TagEntity> = { c: 'contact', co: 'company', d: 'deal' };

const NUMBER_SQL: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

const DAY_MS = 86_400_000;

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function marks(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Lee la lista plana de reglas de antes (JSON). Devuelve [] ante cualquier corrupción. */
export function parseFilterRules(raw: string | undefined): FilterRule[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: FilterRule[] = [];
    for (const item of value.slice(0, MAX_GROUP_RULES)) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      if (typeof r.f !== 'string' || typeof r.o !== 'string' || !r.f || !r.o) continue;
      out.push({
        f: r.f.slice(0, 120),
        o: r.o.slice(0, 20),
        v: typeof r.v === 'string' ? r.v.slice(0, 500) : undefined,
        v2: typeof r.v2 === 'string' ? r.v2.slice(0, 500) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------- Fechas ----------

function sqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
}

/** El día de hoy ('YYYY-MM-DD') en `tz`. */
export function todayIn(tz: string, now: Date): string {
  return dayOf(now.getTime() + tzOffsetMinutes(tz, now) * 60_000);
}

/** El instante UTC (formato de la DB) en que empieza `day` en `tz`. */
export function dayStartUtc(day: string, tz: string): string {
  const wall = Date.parse(`${day}T00:00:00Z`);
  // Dos pasadas: el offset del primer intento puede caer del otro lado de un cambio de hora.
  let utc = wall - tzOffsetMinutes(tz, new Date(wall)) * 60_000;
  utc = wall - tzOffsetMinutes(tz, new Date(utc)) * 60_000;
  return sqlUtc(utc);
}

/** [desde, hasta) en días de calendario de un período relativo. La semana empieza el lunes. */
export function periodDays(op: DatePeriodOp, today: string): { from: string; to: string } {
  const t = new Date(`${today}T00:00:00Z`);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const month = (delta: number) => dayOf(Date.UTC(y, m + delta, 1));
  const quarter = (delta: number) => dayOf(Date.UTC(y, Math.floor(m / 3) * 3 + delta * 3, 1));
  const year = (delta: number) => dayOf(Date.UTC(y + delta, 0, 1));
  const monday = addDays(today, -((t.getUTCDay() + 6) % 7));
  switch (op) {
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'yesterday':
      return { from: addDays(today, -1), to: today };
    case 'this_week':
      return { from: monday, to: addDays(monday, 7) };
    case 'last_week':
      return { from: addDays(monday, -7), to: monday };
    case 'next_week':
      return { from: addDays(monday, 7), to: addDays(monday, 14) };
    case 'this_month':
      return { from: month(0), to: month(1) };
    case 'last_month':
      return { from: month(-1), to: month(0) };
    case 'next_month':
      return { from: month(1), to: month(2) };
    case 'this_quarter':
      return { from: quarter(0), to: quarter(1) };
    case 'last_quarter':
      return { from: quarter(-1), to: quarter(0) };
    case 'this_year':
      return { from: year(0), to: year(1) };
    case 'last_year':
      return { from: year(-1), to: year(0) };
  }
}

/** `x` entre dos extremos ([lo, hi) salvo que se pida otra cosa). Sin extremo inferior, deja afuera lo vacío. */
function rangeSql(x: string, lo: string | undefined, hi: string | undefined, loOp = '>=', hiOp = '<'): SqlCondition | null {
  if (lo !== undefined && hi !== undefined) return { sql: `(${x} ${loOp} ? AND ${x} ${hiOp} ?)`, args: [lo, hi] };
  if (lo !== undefined) return { sql: `${x} ${loOp} ?`, args: [lo] };
  if (hi !== undefined) return { sql: `(${x} > '' AND ${x} ${hiOp} ?)`, args: [hi] };
  return null;
}

function dateCondition(def: AdvancedFieldDef, rule: FilterCond, env: FilterEnv): SqlCondition | null {
  const tz = env.timeZone || 'UTC';
  const now = env.now ?? new Date();
  const today = todayIn(tz, now);
  const isDay = def.date === 'day';
  const x = isDay ? `substr(${def.expr}, 1, 10)` : def.date === 'utc' ? def.expr : `datetime(${def.expr})`;
  /** Un rango de días de calendario [from, to): en una columna con hora, de medianoche a medianoche de quien mira. */
  const days = (from: string | undefined, to: string | undefined): SqlCondition | null =>
    isDay
      ? rangeSql(x, from, to)
      : rangeSql(x, from === undefined ? undefined : dayStartUtc(from, tz), to === undefined ? undefined : dayStartUtc(to, tz));

  const v = ruleValues(rule)[0] ?? '';
  const op = rule.o;
  if ((DATE_PERIOD_OPS as readonly string[]).includes(op)) {
    const p = periodDays(op as DatePeriodOp, today);
    return days(p.from, p.to);
  }
  switch (op) {
    case 'on':
      return isIsoDay(v) ? days(v, addDays(v, 1)) : null;
    case 'before':
      return isIsoDay(v) ? days(undefined, v) : null;
    case 'after':
      return isIsoDay(v) ? days(addDays(v, 1), undefined) : null;
    case 'between': {
      const v2 = (rule.v2 ?? '').trim();
      if (!isIsoDay(v) || !isIsoDay(v2)) return null;
      const [a, b] = v <= v2 ? [v, v2] : [v2, v];
      return days(a, addDays(b, 1));
    }
    // Hoy y los N días anteriores (o siguientes), por días de calendario.
    case 'last_days': {
      const n = parseDays(v);
      return n === null ? null : days(addDays(today, -n), addDays(today, 1));
    }
    case 'next_days': {
      const n = parseDays(v);
      return n === null ? null : days(today, addDays(today, n + 1));
    }
    // Hace menos / más de N días, contados desde este instante.
    case 'less_days_ago': {
      const n = parseDays(v);
      if (n === null) return null;
      return isDay
        ? rangeSql(x, addDays(today, -n), today, '>', '<=')
        : rangeSql(x, sqlUtc(now.getTime() - n * DAY_MS), sqlUtc(now.getTime()), '>', '<=');
    }
    case 'more_days_ago': {
      const n = parseDays(v);
      if (n === null) return null;
      return isDay ? rangeSql(x, undefined, addDays(today, -n)) : rangeSql(x, undefined, sqlUtc(now.getTime() - n * DAY_MS));
    }
    default:
      return null;
  }
}

// ---------- Reglas ----------

const known = (expr: string): string => `(${expr} IS NOT NULL AND ${expr} != '')`;
const unknown = (expr: string): string => `(${expr} IS NULL OR ${expr} = '')`;

/** Expresión SQL de un custom field, según su tipo declarado. */
function customExpr(alias: string, name: string, type: FilterFieldType): string {
  const base = `json_extract(${alias}.custom, '$.${name}')`;
  return type === 'number' ? `CAST(${base} AS REAL)` : base;
}

function scoreCondition(rule: FilterCond, values: string[]): SqlCondition | null {
  const tier = rule.f.startsWith('scoreTier:');
  const scoreId = rule.f.slice(tier ? 10 : 6);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(scoreId)) return null;
  // El score principal vive en c.score; los demás en crm_contact_scores.
  const expr = `COALESCE((SELECT xs.score FROM crm_contact_scores xs WHERE xs.contact_id = c.id AND xs.score_id = ?),
      CASE WHEN EXISTS (SELECT 1 FROM crm_scores ps WHERE ps.id = ? AND ps.is_primary = 1) THEN c.score ELSE 0 END)`;
  if (tier) {
    if (rule.o !== 'is' && rule.o !== 'isnot') return null;
    const parts: string[] = [];
    const args: Array<string | number> = [];
    for (const value of values) {
      const m = /^(-?\d{1,7})\|(-?\d{1,7})?$/.exec(value);
      if (!m) return null;
      if (m[2] === undefined) {
        parts.push(`${expr} >= ?`);
        args.push(scoreId, scoreId, Number(m[1]));
      } else {
        parts.push(`(${expr} >= ? AND ${expr} < ?)`);
        args.push(scoreId, scoreId, Number(m[1]), scoreId, scoreId, Number(m[2]));
      }
    }
    if (!parts.length) return null;
    const any = parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
    return { sql: rule.o === 'is' ? any : `NOT ${any}`, args };
  }
  const v = values[0] ?? '';
  if (rule.o === 'between') {
    const a = Number(v);
    const b = Number((rule.v2 ?? '').trim());
    if (!v || !(rule.v2 ?? '').trim() || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { sql: `(${expr} >= ? AND ${expr} <= ?)`, args: [scoreId, scoreId, Math.min(a, b), scoreId, scoreId, Math.max(a, b)] };
  }
  const sqlOp = NUMBER_SQL[rule.o];
  const n = Number(v);
  if (!sqlOp || !v || !Number.isFinite(n)) return null;
  return { sql: `${expr} ${sqlOp} ?`, args: [scoreId, scoreId, n] };
}

/**
 * Traduce una regla a una condición WHERE parametrizada. Devuelve null si la
 * propiedad no existe, el operador no es de su tipo o falta el valor.
 */
export function compileRule(ctx: FilterContext, rule: FilterCond): SqlCondition | null {
  const { alias } = ctx;
  if (typeof rule?.f !== 'string' || typeof rule.o !== 'string') return null;
  const values = ruleValues(rule);
  const op = rule.o;

  // Tag: relación many-to-many, no una columna.
  if (rule.f === 'tag') {
    const entity = ALIAS_ENTITY[alias];
    if (!entity) return null;
    if (op === 'known' || op === 'unknown') {
      const any = `EXISTS (SELECT 1 FROM crm_record_tags rt WHERE rt.entity = '${entity}' AND rt.record_id = ${alias}.id)`;
      return { sql: op === 'known' ? any : `NOT ${any}`, args: [] };
    }
    if ((op !== 'is' && op !== 'isnot') || !values.length) return null;
    const one = tagCondition(alias, entity);
    const any = values.length === 1 ? one : `(${values.map(() => one).join(' OR ')})`;
    return { sql: op === 'is' ? any : `NOT ${any}`, args: values };
  }
  // Miembro de una lista estática (solo contactos).
  if (rule.f === 'list') {
    if ((op !== 'is' && op !== 'isnot') || !values.length || alias !== 'c') return null;
    const cond = `EXISTS (SELECT 1 FROM crm_list_members xlm JOIN crm_lists xl ON xl.id = xlm.list_id
      WHERE xlm.contact_id = c.id AND xlm.list_id IN (${marks(values.length)}) AND xl.kind = 'static')`;
    return { sql: op === 'is' ? cond : `NOT ${cond}`, args: values };
  }
  // Lead scores (lib/crm-scoring.ts): `score:<id>` por puntos y `scoreTier:<id>` por tramo ("min|max").
  if (alias === 'c' && (rule.f.startsWith('score:') || rule.f.startsWith('scoreTier:'))) {
    return scoreCondition(rule, values);
  }

  let def: AdvancedFieldDef | undefined = Object.prototype.hasOwnProperty.call(ctx.fields, rule.f) ? ctx.fields[rule.f] : undefined;
  let customName = '';
  if (!def && rule.f.startsWith('custom:')) {
    customName = rule.f.slice(7);
    if (!CUSTOM_NAME.test(customName)) return null;
    const declared =
      ctx.customTypes && Object.prototype.hasOwnProperty.call(ctx.customTypes, customName) ? ctx.customTypes[customName] : undefined;
    if (!declared && ctx.strictCustom) return null;
    const type = declared ?? 'text';
    def = { expr: customExpr(alias, customName, type), type, ...(type === 'date' ? { date: 'day' as const } : {}) };
  }
  if (!def) return null;

  const { expr, type } = def;
  const v = values[0] ?? '';

  if (type === 'multiselect') {
    // Lista JSON dentro de `custom`.
    if (!customName) return null;
    const path = `'$.${customName}'`;
    if (op === 'known') return { sql: `COALESCE(json_array_length(${alias}.custom, ${path}), 0) > 0`, args: [] };
    if (op === 'unknown') return { sql: `COALESCE(json_array_length(${alias}.custom, ${path}), 0) = 0`, args: [] };
    if (!values.length) return null;
    const has = (n: number) => `EXISTS (SELECT 1 FROM json_each(${alias}.custom, ${path}) WHERE value IN (${marks(n)}))`;
    if (op === 'is') return { sql: has(values.length), args: values };
    if (op === 'isnot') return { sql: `NOT ${has(values.length)}`, args: values };
    if (op === 'all') return { sql: `(${values.map(() => has(1)).join(' AND ')})`, args: values };
    return null;
  }

  if (type === 'boolean') {
    // Un sí/no propio se guarda como JSON true/false: json_extract da 1/0. Sin valor = NULL.
    if (op === 'true') return { sql: `${expr} = 1`, args: [] };
    if (op === 'false') return { sql: `${expr} = 0`, args: [] };
    if (op === 'unknown') return { sql: `${expr} IS NULL`, args: [] };
    if (op === 'known') return { sql: `${expr} IS NOT NULL`, args: [] };
    if ((op !== 'is' && op !== 'isnot') || !v) return null;
    const arg = Number(v === '1' || v === 'true');
    return op === 'is' ? { sql: `${expr} = ?`, args: [arg] } : { sql: `(${expr} IS NULL OR ${expr} != ?)`, args: [arg] };
  }

  if (type === 'number') {
    if (op === 'known') return { sql: `${expr} IS NOT NULL`, args: [] };
    if (op === 'unknown') return { sql: `${expr} IS NULL`, args: [] };
    const n = Number(v);
    if (!v || !Number.isFinite(n)) return null;
    if (op === 'between') {
      const raw2 = (rule.v2 ?? '').trim();
      const n2 = Number(raw2);
      if (!raw2 || !Number.isFinite(n2)) return null;
      return { sql: `(${expr} >= ? AND ${expr} <= ?)`, args: [Math.min(n, n2), Math.max(n, n2)] };
    }
    const sqlOp = NUMBER_SQL[op];
    return sqlOp ? { sql: `${expr} ${sqlOp} ?`, args: [n] } : null;
  }

  if (op === 'known') return { sql: known(expr), args: [] };
  if (op === 'unknown') return { sql: unknown(expr), args: [] };

  if (type === 'date') return dateCondition(def, rule, ctx);

  if (!values.length) return null;

  if (type === 'text') {
    const like = (pattern: (s: string) => string): SqlCondition => ({
      sql: values.length === 1 ? `${expr} LIKE ? ESCAPE '\\'` : `(${values.map(() => `${expr} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
      args: values.map((s) => pattern(escapeLike(s))),
    });
    switch (op) {
      case 'equals':
        return { sql: `${expr} COLLATE NOCASE IN (${marks(values.length)})`, args: values };
      case 'not_equals':
        return { sql: `(${expr} IS NULL OR ${expr} COLLATE NOCASE NOT IN (${marks(values.length)}))`, args: values };
      case 'contains':
        return like((s) => `%${s}%`);
      case 'not_contains': {
        const c = like((s) => `%${s}%`);
        return { sql: `(${expr} IS NULL OR NOT ${values.length === 1 ? `(${c.sql})` : c.sql})`, args: c.args };
      }
      case 'starts':
        return like((s) => `${s}%`);
      case 'ends':
        return like((s) => `%${s}`);
      default:
        return null;
    }
  }

  // select (y owner, etapa, pipeline: son selects con ids)
  if (op !== 'is' && op !== 'isnot') return null;
  let ids = values;
  let unassigned = false;
  if (def.owner) {
    unassigned = ids.includes(OWNER_UNASSIGNED);
    if (ids.includes(OWNER_ME) && !ctx.viewerId) return null;
    ids = ids.filter((id) => id !== OWNER_UNASSIGNED).map((id) => (id === OWNER_ME ? (ctx.viewerId as string) : id));
    ids = ids.filter((id, i) => ids.indexOf(id) === i);
  }
  const empty = unknown(expr);
  if (op === 'is') {
    if (!ids.length) return unassigned ? { sql: empty, args: [] } : null;
    const inList = `${expr} IN (${marks(ids.length)})`;
    return { sql: unassigned ? `(${inList} OR ${expr} IS NULL OR ${expr} = '')` : inList, args: ids };
  }
  // "ninguno de" incluye los registros sin valor, salvo que "sin asignar" sea uno de los excluidos.
  if (!ids.length) return unassigned ? { sql: known(expr), args: [] } : null;
  const notIn = `${expr} NOT IN (${marks(ids.length)})`;
  return {
    sql: unassigned ? `(${expr} IS NOT NULL AND ${expr} != '' AND ${notIn})` : `(${expr} IS NULL OR ${notIn})`,
    args: ids,
  };
}

/** Un filtro que no se puede aplicar tal como llegó (API: responde 400). */
export class FilterError extends Error {
  constructor(public readonly rule: FilterCond | null, message = 'invalid_filter') {
    super(message);
    this.name = 'FilterError';
  }
}

/**
 * Compila el modelo a una sola condición: reglas de un grupo con AND, grupos
 * con OR, todo entre paréntesis. null = sin filtro.
 *
 * Por defecto una regla que no compila se ignora (links viejos, una propiedad
 * que se borró); con `strict` tira FilterError.
 */
export function compileFilterModel(ctx: FilterContext, model: FilterModel, opts: { strict?: boolean } = {}): SqlCondition | null {
  const groups: string[] = [];
  const args: Array<string | number> = [];
  for (const group of model.groups.slice(0, MAX_FILTER_GROUPS)) {
    const conds: string[] = [];
    const groupArgs: Array<string | number> = [];
    for (const rule of group.rules.slice(0, MAX_GROUP_RULES)) {
      const cond = compileRule(ctx, rule);
      if (!cond) {
        if (opts.strict) throw new FilterError(rule);
        continue;
      }
      conds.push(`(${cond.sql})`);
      groupArgs.push(...cond.args);
    }
    if (!conds.length) continue;
    groups.push(conds.length === 1 ? conds[0] : `(${conds.join(' AND ')})`);
    args.push(...groupArgs);
  }
  if (!groups.length) return null;
  return { sql: groups.length === 1 ? groups[0] : `(${groups.join(' OR ')})`, args };
}

/**
 * Lee un filtro que llega por API: JSON bien formado, dentro de los límites y
 * con todas sus reglas válidas para `ctx`. Si no, FilterError.
 */
export function parseStrictFilter(ctx: FilterContext, raw: string): FilterModel {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FilterError(null);
  }
  const groupsIn: unknown = Array.isArray(value) ? [value] : (value as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groupsIn) || groupsIn.length > MAX_FILTER_GROUPS) throw new FilterError(null);
  let rulesIn = 0;
  for (const g of groupsIn) {
    const rules: unknown = Array.isArray(g) ? g : (g as { rules?: unknown } | null)?.rules;
    if (!Array.isArray(rules) || rules.length > MAX_GROUP_RULES) throw new FilterError(null);
    rulesIn += rules.length;
  }
  const model = cleanFilterModel(value);
  // Una regla sin forma de regla se habría descartado en silencio: acá es un error.
  if (model.groups.reduce((n, g) => n + g.rules.length, 0) !== rulesIn) throw new FilterError(null);
  compileFilterModel(ctx, model, { strict: true });
  return model;
}

// ---------- Compatibilidad: la lista plana de reglas ----------

/** Una regla suelta (listas dinámicas, objetos propios). null si es inválida o está incompleta. */
export function buildRuleCondition(
  alias: string,
  fields: Record<string, AdvancedFieldDef>,
  rule: FilterCond,
  customTypes?: Record<string, FilterFieldType>,
  env: FilterEnv = {},
): SqlCondition | null {
  return compileRule({ alias, fields, customTypes, ...env }, rule);
}

/**
 * Agrega el filtro al WHERE. Acepta el modelo con grupos o la lista plana de
 * antes: todas sus reglas (AND, por defecto) o cualquiera (`match: 'any'`).
 * En los dos casos entra como una sola condición, unida con AND al resto.
 */
export function appendAdvancedFilters(
  where: string[],
  args: Array<string | number>,
  alias: string,
  fields: Record<string, AdvancedFieldDef>,
  filters: FilterCond[] | FilterModel | undefined,
  customTypes?: Record<string, FilterFieldType>,
  match: 'all' | 'any' = 'all',
  env: FilterEnv & { strictCustom?: boolean } = {},
): void {
  if (!filters) return;
  const ctx: FilterContext = { alias, fields, customTypes, ...env };
  // La lista plana "cualquiera" puede traer más reglas que el tope de grupos: se compila regla por regla.
  if (Array.isArray(filters) && match === 'any') {
    const conds: string[] = [];
    const condArgs: Array<string | number> = [];
    for (const rule of filters.slice(0, MAX_GROUP_RULES)) {
      const cond = compileRule(ctx, rule);
      if (!cond) continue;
      conds.push(`(${cond.sql})`);
      condArgs.push(...cond.args);
    }
    if (!conds.length) return;
    where.push(conds.length === 1 ? conds[0] : `(${conds.join(' OR ')})`);
    args.push(...condArgs);
    return;
  }
  const model: FilterModel = Array.isArray(filters) ? { v: 1, groups: [{ rules: filters }] } : filters;
  const cond = compileFilterModel(ctx, model);
  if (!cond) return;
  where.push(cond.sql);
  args.push(...cond.args);
}
