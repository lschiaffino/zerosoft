import type { FieldDef, FlowNodeType } from '@/lib/flow-schema';
import type { ProductKey } from '@/lib/products';

export const CATEGORY_ORDER = ['trigger', 'logic', 'data', 'action', 'app', 'integration', 'ai'] as const;

/**
 * La red de subte en el canvas: el flow es la línea de Flow y cada nodo una
 * estación. Un nodo que entra o sale por otra app de zerosoft es una
 * combinación con la línea de esa app (devuelve su clave). El resto, null.
 */
const EVENT_LINES: Array<[string, ProductKey]> = [
  ['booking.', 'cal'],
  ['link.', 'link'],
  ['contact.', 'crm'],
  ['deal.', 'crm'],
  ['quote.', 'crm'],
  ['email.', 'crm'],
  ['form.', 'crm'],
  ['issue.', 'track'],
  ['conversation.', 'chat'],
  ['message.', 'chat'],
  ['page.', 'docs'],
  ['robot.', 'robots'],
];

const NODE_LINES: Partial<Record<FlowNodeType, ProductKey>> = {
  'app.crm_contact': 'crm',
  'app.crm_sequence': 'crm',
  'app.crm_deals': 'crm',
  'app.track_issue': 'track',
  'app.link': 'link',
  'app.chat_message': 'chat',
  'app.docs_page': 'docs',
  'app.robot_run': 'robots',
  'ai.agent': 'agents',
};

export function interchangeLine(type: FlowNodeType, config: Record<string, unknown> = {}): ProductKey | null {
  if (type === 'trigger.event') {
    const ev = String(config.event ?? '');
    return EVENT_LINES.find(([prefix]) => ev.startsWith(prefix))?.[1] ?? null;
  }
  return NODE_LINES[type] ?? null;
}

/**
 * Campos visibles de un nodo, separados en el camino básico y "Avanzado"
 * (FieldDef.advanced). Respeta showIf y oculta el operador y valor del filtro
 * de eventos mientras no haya campo a filtrar.
 */
export function splitFields(
  type: FlowNodeType,
  fields: readonly FieldDef[],
  config: Record<string, unknown>,
): { basic: FieldDef[]; advanced: FieldDef[] } {
  const visible = fields.filter((f) => {
    if (f.showIf) {
      const dep = fields.find((x) => x.key === f.showIf!.key);
      const current = String(config[f.showIf.key] ?? dep?.default ?? '');
      if (!f.showIf.values.includes(current)) return false;
    }
    if (type === 'trigger.event' && (f.key === 'filterOp' || f.key === 'filterValue') && !String(config.filterPath ?? '').trim()) {
      return false;
    }
    return true;
  });
  return { basic: visible.filter((f) => !f.advanced), advanced: visible.filter((f) => f.advanced) };
}

/** Cuántos campos avanzados se apartan de su valor por defecto (para avisar que hay algo ajustado). */
export function changedCount(fields: readonly FieldDef[], config: Record<string, unknown>): number {
  return fields.filter((f) => {
    const v = config[f.key];
    if (v === undefined || v === '') return false;
    return JSON.stringify(v) !== JSON.stringify(f.default ?? '');
  }).length;
}

/**
 * Nombre técnico de una credencial nueva, derivado del tipo: "slack",
 * "slack-2"… Sigue CREDENTIAL_NAME_RE y no choca (sin distinguir mayúsculas)
 * con los nombres que ya existen.
 */
export function suggestCredentialName(type: string, existing: readonly string[]): string {
  const base = type.replace(/[^A-Za-z0-9_-]/g, '-').replace(/_/g, '-').slice(0, 50) || 'credential';
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base}-${i}`;
    if (!taken.has(name)) return name;
  }
}

/** Badge (ui.css) por estado de corrida o de paso. */
export const RUN_BADGE: Record<string, string> = {
  success: 'badge-ok',
  failed: 'badge-bad',
  waiting: 'badge-warn',
  queued: 'badge-warn',
  running: 'badge-info',
  skipped: 'badge-outline',
};

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
