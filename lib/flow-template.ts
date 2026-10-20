/**
 * Flow — plantillas {{...}} y condiciones. Sin dependencias de servidor: lo
 * usan el motor (lib/flow-engine.ts) y el editor (vista previa de variables).
 *
 * Variables:
 *   {{trigger.x}}                 datos del disparador
 *   {{nodes.<id>.output.x}}       salida de un nodo anterior
 *   {{loop.item}} {{loop.index}}  dentro del cuerpo de un Loop
 *   {{flow.name}} {{run.id}} {{now}}
 * Filtros encadenables con |: json, join[:sep], lines, length, upper, lower,
 * trim, map:<campo>, default:<valor>, number, first, last, urlencode.
 * Texto: replace:"de","a" y split[:sep] (lista, cada parte recortada).
 * Fechas: date[:formato[,zona]], add_time:<n>,<unidad> y timezone:<zona>.
 *   {"text": {{nodes.ai.output.text | json}}}
 *   {{nodes.deals.output.deals | map:name | lines}}
 *   {{trigger.startsAt | add_time:-1,hours | timezone:America/Argentina/Buenos_Aires | date:"DD/MM HH:mm"}}
 */
import { isValidTimezone, tzOffsetMinutes } from './cron';

export type TemplateContext = Record<string, unknown>;

const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SINGLE_RE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;

/** Lee `a.b[0].c` / `a.b.0.c` de un objeto. undefined si no existe. */
export function getPath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    if (Array.isArray(cur)) {
      if (part === 'length') {
        cur = cur.length;
        continue;
      }
      const i = Number(part);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === 'object') {
      cur = Object.prototype.hasOwnProperty.call(cur, part) ? (cur as Record<string, unknown>)[part] : undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Valor como texto: '' para null/undefined, JSON para objetos. */
export function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function splitFilters(expr: string): string[] {
  // Separa por | (sin soportar | dentro de argumentos: no hace falta).
  return expr.split('|').map((s) => s.trim());
}

/**
 * Argumentos de un filtro separados por coma; las comillas conservan comas y
 * espacios: replace:", "," / " → [', ', ' / ']. Sin argumento: [].
 */
export function filterArgs(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let quoted = false;
  const push = () => {
    out.push((quoted ? cur : cur.trim()).replace(/\\n/g, '\n'));
    cur = '';
    quoted = false;
  };
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      if (!quoted) cur = '';
      quote = ch;
      quoted = true;
    } else if (ch === ',') {
      push();
    } else if (!quoted) {
      cur += ch;
    }
  }
  push();
  return out;
}

// ---------- Fechas ----------

/** Offset explícito al final de una fecha ISO ('Z', '+02:00', '-0300'), en minutos. */
function explicitOffset(text: string): number | null {
  const m = /[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(text.trim());
  if (!m) return null;
  if (m[1].toUpperCase() === 'Z') return 0;
  const sign = m[1][0] === '-' ? -1 : 1;
  const digits = m[1].slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/**
 * Fecha de una variable: ISO, 'YYYY-MM-DD HH:MM:SS' (SQLite, en UTC),
 * 'YYYY-MM-DD' o epoch (segundos o milisegundos). null si no se entiende.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value < 1e11 ? value * 1000 : value) : null;
  const text = stringify(value).trim();
  if (!text) return null;
  if (/^\d{9,13}$/.test(text)) return toDate(Number(text));
  let iso = text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso = `${iso.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

const pad = (n: number, len = 2) => String(Math.abs(Math.trunc(n))).padStart(len, '0');

function offsetText(minutes: number, colon = true): string {
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}${colon ? ':' : ''}${pad(Math.abs(minutes) % 60)}`;
}

/** ISO con la hora de pared del offset: 2026-01-01T12:00:00.000-03:00 (UTC: ...Z). */
function isoWithOffset(date: Date, offset: number): string {
  if (offset === 0) return date.toISOString();
  const local = new Date(date.getTime() + offset * 60_000);
  return `${local.toISOString().slice(0, -1)}${offsetText(offset)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DATE_TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMM|MM|M|DD|D|ddd|HH|H|hh|h|mm|ss|SSS|A|ZZ|Z|X|x/g;
const DATE_PRESETS: Record<string, string> = { date: 'YYYY-MM-DD', time: 'HH:mm', datetime: 'YYYY-MM-DD HH:mm' };

/**
 * Formatea con tokens (YYYY MM DD HH mm ss, MMM, ddd, hh A, Z…; [texto]
 * literal) en la zona dada; sin zona, en el offset que trae el texto (así
 * `timezone:X | date:...` muestra la hora de esa zona) o en UTC. Formatos
 * con nombre: iso, date, time, datetime, unix, unix_ms. null si no es fecha.
 */
export function formatDate(value: unknown, format = '', timezone = ''): string | null {
  const date = toDate(value);
  if (!date) return null;
  const tz = timezone.trim();
  const offset =
    tz && isValidTimezone(tz) ? tzOffsetMinutes(tz, date) : typeof value === 'string' ? (explicitOffset(value) ?? 0) : 0;
  const fmt = format.trim() || 'datetime';
  if (fmt === 'iso') return isoWithOffset(date, offset);
  if (fmt === 'unix') return String(Math.floor(date.getTime() / 1000));
  if (fmt === 'unix_ms') return String(date.getTime());
  const l = new Date(date.getTime() + offset * 60_000);
  const hours = l.getUTCHours();
  const parts: Record<string, () => string> = {
    YYYY: () => String(l.getUTCFullYear()),
    YY: () => pad(l.getUTCFullYear() % 100),
    MMM: () => MONTHS[l.getUTCMonth()],
    MM: () => pad(l.getUTCMonth() + 1),
    M: () => String(l.getUTCMonth() + 1),
    DD: () => pad(l.getUTCDate()),
    D: () => String(l.getUTCDate()),
    ddd: () => WEEKDAYS[l.getUTCDay()],
    HH: () => pad(hours),
    H: () => String(hours),
    hh: () => pad(hours % 12 || 12),
    h: () => String(hours % 12 || 12),
    mm: () => pad(l.getUTCMinutes()),
    ss: () => pad(l.getUTCSeconds()),
    SSS: () => pad(l.getUTCMilliseconds(), 3),
    A: () => (hours < 12 ? 'AM' : 'PM'),
    ZZ: () => offsetText(offset, false),
    Z: () => offsetText(offset),
    X: () => String(Math.floor(date.getTime() / 1000)),
    x: () => String(date.getTime()),
  };
  return (DATE_PRESETS[fmt] ?? fmt).replace(DATE_TOKEN_RE, (tok, literal: string | undefined) =>
    literal !== undefined ? literal : (parts[tok]?.() ?? tok),
  );
}

const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
const UNIT_ALIASES: Record<string, string> = {
  s: 'second',
  sec: 'second',
  second: 'second',
  seconds: 'second',
  m: 'minute',
  min: 'minute',
  mins: 'minute',
  minute: 'minute',
  minutes: 'minute',
  h: 'hour',
  hour: 'hour',
  hours: 'hour',
  d: 'day',
  day: 'day',
  days: 'day',
  w: 'week',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  y: 'year',
  year: 'year',
  years: 'year',
};

/**
 * Suma (o resta, con n negativo) tiempo a una fecha; sin unidad, días. Meses
 * y años respetan el calendario (31/01 + 1 mes = último día de febrero).
 * Conserva el offset del texto de entrada; si no trae, ISO en UTC.
 */
export function addTime(value: unknown, amount: unknown, unitRaw: unknown): string | null {
  const date = toDate(value);
  const n = Number(String(amount ?? '').trim() || NaN);
  const rawUnit = String(unitRaw ?? '').trim().toLowerCase();
  const unit = rawUnit ? UNIT_ALIASES[rawUnit] : 'day';
  if (!date || !Number.isFinite(n) || !unit) return null;
  let out: Date;
  if (unit === 'month' || unit === 'year') {
    const months = Math.trunc(n) * (unit === 'year' ? 12 : 1);
    out = new Date(date.getTime());
    const day = out.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + months);
    const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, last));
  } else {
    out = new Date(date.getTime() + n * UNIT_MS[unit]);
  }
  if (!Number.isFinite(out.getTime())) return null;
  return isoWithOffset(out, typeof value === 'string' ? (explicitOffset(value) ?? 0) : 0);
}

/** El mismo instante con la hora de pared de la zona: 2026-01-01T12:00:00.000-03:00. */
export function inTimezone(value: unknown, timezone: unknown): string | null {
  const date = toDate(value);
  const tz = String(timezone ?? '').trim();
  if (!date || !tz || !isValidTimezone(tz)) return null;
  return isoWithOffset(date, tzOffsetMinutes(tz, date));
}

function applyFilter(value: unknown, filter: string): unknown {
  const idx = filter.indexOf(':');
  const name = (idx < 0 ? filter : filter.slice(0, idx)).trim().toLowerCase();
  const rawArg = idx < 0 ? undefined : filter.slice(idx + 1);
  // Argumento entre comillas para conservar espacios: join:", ".
  const unquoted =
    rawArg !== undefined && /^\s*(["']).*\1\s*$/.test(rawArg) ? rawArg.trim().slice(1, -1) : rawArg;
  const arg = unquoted === undefined ? undefined : unquoted.replace(/\\n/g, '\n');
  switch (name) {
    case 'json':
      return JSON.stringify(value === undefined ? null : value);
    case 'join':
      return Array.isArray(value) ? value.map(stringify).join(arg ?? ', ') : stringify(value);
    case 'lines':
      return Array.isArray(value) ? value.map(stringify).join('\n') : stringify(value);
    case 'length':
      if (Array.isArray(value) || typeof value === 'string') return value.length;
      if (value && typeof value === 'object') return Object.keys(value).length;
      return 0;
    case 'upper':
      return stringify(value).toUpperCase();
    case 'lower':
      return stringify(value).toLowerCase();
    case 'trim':
      return stringify(value).trim();
    case 'map':
      return Array.isArray(value) ? value.map((v) => getPath(v, (arg ?? '').trim())) : value;
    case 'default':
      return value === undefined || value === null || value === '' ? (arg ?? '') : value;
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'first':
      return Array.isArray(value) ? value[0] : value;
    case 'last':
      return Array.isArray(value) ? value[value.length - 1] : value;
    case 'urlencode':
      // Para meter datos externos en el path o la query de una URL sin que cambien su forma.
      return encodeURIComponent(stringify(value));
    case 'replace': {
      const [from = '', to = ''] = filterArgs(rawArg);
      const text = stringify(value);
      return from ? text.split(from).join(to) : text;
    }
    case 'split': {
      if (Array.isArray(value)) return value;
      const [sep] = filterArgs(rawArg);
      const text = stringify(value);
      if (!text) return [];
      return text.split(sep || ',').map((p) => p.trim());
    }
    // Fechas: si el valor no es una fecha, sigue igual (se ve en el paso).
    case 'date': {
      const [format, tz] = filterArgs(rawArg);
      return formatDate(value, format, tz) ?? value;
    }
    case 'add_time': {
      const [amount, unit] = filterArgs(rawArg);
      return addTime(value, amount, unit) ?? value;
    }
    case 'timezone': {
      const [tz] = filterArgs(rawArg);
      return inTimezone(value, tz) ?? value;
    }
    default:
      return value;
  }
}

/** Evalúa `path | filtro | filtro:arg`. `now` es la fecha ISO actual. */
export function evalExpression(expr: string, ctx: TemplateContext): unknown {
  const [path, ...filters] = splitFilters(expr);
  let value: unknown = path === 'now' ? new Date().toISOString() : getPath(ctx, path);
  for (const f of filters) if (f) value = applyFilter(value, f);
  return value;
}

/** Siempre devuelve texto (para asuntos, cuerpos, URLs). */
export function renderString(template: unknown, ctx: TemplateContext): string {
  if (typeof template !== 'string') return stringify(template);
  return template.replace(TEMPLATE_RE, (_m, expr: string) => stringify(evalExpression(expr, ctx)));
}

/**
 * Si el texto es una sola variable ({{trigger.items}}) devuelve el valor tal
 * cual (arrays, objetos, números); si no, renderiza como texto.
 */
export function renderValue(template: unknown, ctx: TemplateContext): unknown {
  if (typeof template !== 'string') return template;
  const single = SINGLE_RE.exec(template);
  if (single) return evalExpression(single[1], ctx);
  return renderString(template, ctx);
}

/** Renderiza recursivamente strings dentro de objetos/arrays (texto). */
export function renderDeep(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return renderValue(value, ctx);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderDeep(v, ctx);
    return out;
  }
  return value;
}

/** Variables usadas en un texto (para validar o resaltar). */
export function templateVariables(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_RE)) out.push(splitFilters(m[1])[0]);
  return out;
}

// ---------- Condiciones ----------

export const CONDITION_OPS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'not_exists',
  'is_true',
  'is_false',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface Condition {
  left: string;
  op: ConditionOp;
  right?: string;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function compare(left: unknown, op: ConditionOp, right: unknown): boolean {
  switch (op) {
    case 'exists':
      return left !== undefined && left !== null && left !== '';
    case 'not_exists':
      return left === undefined || left === null || left === '';
    case 'is_true':
      return left === true || left === 'true' || left === 1 || left === '1';
    case 'is_false':
      return !(left === true || left === 'true' || left === 1 || left === '1');
    case 'equals':
    case 'not_equals': {
      const ln = asNumber(left);
      const rn = asNumber(right);
      const eq = ln !== null && rn !== null ? ln === rn : stringify(left) === stringify(right);
      return op === 'equals' ? eq : !eq;
    }
    case 'contains':
    case 'not_contains': {
      const has = Array.isArray(left)
        ? left.some((v) => stringify(v) === stringify(right))
        : stringify(left).toLowerCase().includes(stringify(right).toLowerCase());
      return op === 'contains' ? has : !has;
    }
    case 'starts_with':
      return stringify(left).toLowerCase().startsWith(stringify(right).toLowerCase());
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const ln = asNumber(left);
      const rn = asNumber(right);
      if (ln === null || rn === null) return false;
      if (op === 'gt') return ln > rn;
      if (op === 'gte') return ln >= rn;
      if (op === 'lt') return ln < rn;
      return ln <= rn;
    }
    default:
      return false;
  }
}

export function evalCondition(cond: Condition, ctx: TemplateContext): boolean {
  const left = renderValue(cond.left ?? '', ctx);
  const right = renderValue(cond.right ?? '', ctx);
  return compare(left, cond.op, right);
}

/** Todas (all) o alguna (any). Sin condiciones = verdadero. */
export function evalConditions(
  conditions: Condition[] | undefined,
  combine: 'all' | 'any' | undefined,
  ctx: TemplateContext,
): boolean {
  const list = Array.isArray(conditions) ? conditions : [];
  if (list.length === 0) return true;
  return combine === 'any' ? list.some((c) => evalCondition(c, ctx)) : list.every((c) => evalCondition(c, ctx));
}
