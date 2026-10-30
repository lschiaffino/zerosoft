/**
 * Evaluación de feature flags (pura). Igual que PostHog: el porcentaje de
 * rollout usa un hash estable de `<key>.<distinct_id>` (la misma persona cae
 * siempre del mismo lado) y las variantes otro hash con sal "variant".
 */
import { createHash } from 'crypto';
import type { FlagVariant, PropertyFilter } from './types';

const LONG_SCALE = 0xfffffffffffffff;

/** Número estable en [0, 1) para un flag, un distinct_id y una sal. */
export function flagHash(key: string, distinctId: string, salt = ''): number {
  const hex = createHash('sha1').update(`${key}.${distinctId}${salt}`).digest('hex').slice(0, 15);
  return parseInt(hex, 16) / LONG_SCALE;
}

function asText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

/** ¿Las propiedades cumplen el filtro? Misma semántica que el SQL de las consultas. */
export function matchProperty(filter: Pick<PropertyFilter, 'key' | 'op' | 'value'>, props: Record<string, unknown>): boolean {
  const raw = props[filter.key];
  const text = asText(raw);
  const want = filter.value === undefined || filter.value === null ? '' : String(filter.value);
  switch (filter.op) {
    case 'is_set':
      return text !== null;
    case 'is_not_set':
      return text === null;
    case 'eq':
      return text !== null && text.toLowerCase() === want.toLowerCase();
    case 'neq':
      return text === null || text.toLowerCase() !== want.toLowerCase();
    case 'contains':
      return text !== null && text.toLowerCase().includes(want.toLowerCase());
    case 'not_contains':
      return text === null || !text.toLowerCase().includes(want.toLowerCase());
    case 'gt':
    case 'lt': {
      const a = Number(raw);
      const b = Number(filter.value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || text === null) return false;
      return filter.op === 'gt' ? a > b : a < b;
    }
    default:
      return false;
  }
}

export interface EvaluableFlag {
  key: string;
  active: boolean;
  rollout: number;
  variants: FlagVariant[];
  conditions: Array<Pick<PropertyFilter, 'key' | 'op' | 'value'>>;
}

/** Variante para el hash (rangos acumulados según el % de cada una). null si no suman. */
export function pickVariant(variants: FlagVariant[], hash: number): string | null {
  let acc = 0;
  for (const v of variants) {
    acc += v.rollout / 100;
    if (hash < acc) return v.key;
  }
  return null;
}

/**
 * Valor del flag para una persona: false si está apagado, no cumple las
 * condiciones o queda fuera del rollout; si es multivariante, la clave de la
 * variante; si no, true.
 */
export function evaluateFlag(flag: EvaluableFlag, distinctId: string, props: Record<string, unknown>): boolean | string {
  if (!flag.active) return false;
  if (!flag.conditions.every((c) => matchProperty(c, props))) return false;
  if (flag.rollout < 100 && flagHash(flag.key, distinctId) >= flag.rollout / 100) return false;
  if (flag.variants.length) return pickVariant(flag.variants, flagHash(flag.key, distinctId, 'variant')) ?? false;
  return true;
}

/** Las variantes de un flag multivariante suman 100 %. */
export function variantsValid(variants: FlagVariant[]): boolean {
  if (!variants.length) return true;
  const keys = new Set(variants.map((v) => v.key));
  return keys.size === variants.length && variants.reduce((a, v) => a + v.rollout, 0) === 100;
}
