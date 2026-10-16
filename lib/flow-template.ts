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
 *   {"text": {{nodes.ai.output.text | json}}}
 *   {{nodes.deals.output.deals | map:name | lines}}
 */

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
