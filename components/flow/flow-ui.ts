import type { NodeCategory } from '@/lib/flow-schema';

/** Color por categoría de nodo (tokens --c-* de globals.css). */
export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  trigger: 'var(--c-flow)',
  logic: 'var(--c-crm)',
  data: 'var(--c-docs)',
  action: 'var(--c-link)',
  app: 'var(--c-cal)',
  ai: 'var(--c-chat)',
};

export const CATEGORY_ORDER: NodeCategory[] = ['trigger', 'logic', 'data', 'action', 'app', 'ai'];

/** next-intl usa '.' como separador: 'trigger.event' → 'trigger_event'. */
export function i18nKey(value: string): string {
  return value.replace(/\./g, '_');
}

/**
 * Rutas de un objeto para el selector de variables:
 * { a: { b: 1 }, c: [ { d: 2 } ] } → a, a.b, c, c.0.d …
 */
export function flattenPaths(value: unknown, prefix: string, depth = 0, out: string[] = []): string[] {
  if (out.length >= 120) return out;
  if (prefix) out.push(prefix);
  if (depth >= 4 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length > 0) flattenPaths(value[0], `${prefix}.0`, depth + 1, out);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]+$/.test(k)) continue;
    flattenPaths(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  }
  return out;
}

export function preview(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? `[${value.length}]` : '{…}';
}

export function getAt(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}
