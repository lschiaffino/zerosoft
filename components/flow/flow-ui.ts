import type { FieldDef, FlowNodeType } from '@/lib/flow-schema';
import type { ProductKey } from '@/lib/products';

export const CATEGORY_ORDER = ['trigger', 'logic', 'data', 'action', 'app', 'integration', 'ai'] as const;

/**
 * La app de zerosoft que toca un nodo (CRM, Cal, Track...), para nombrarla
 * en el nodo y marcarla en la paleta. El resto, null.
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
  ['note.', 'notes'],
  ['board.', 'board'],
  ['agent.', 'agents'],
  ['task.', 'crm'],
];

const NODE_LINES: Partial<Record<FlowNodeType, ProductKey>> = {
  'app.crm_contact': 'crm',
  'app.crm_sequence': 'crm',
  'app.crm_deals': 'crm',
  'app.track_issue': 'track',
  'app.track_update': 'track',
  'app.crm_update': 'crm',
  'app.crm_task': 'crm',
  'app.link': 'link',
  'app.chat_message': 'chat',
  'app.docs_page': 'docs',
  'app.robot_run': 'robots',
  'ai.agent': 'agents',
};

export function nodeApp(type: FlowNodeType, config: Record<string, unknown> = {}): ProductKey | null {
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

/**
 * Código de error de un paso ("missing_credentialid (retry 1/2)", "http_502")
 * a la clave de flow.stepErrors que dice el problema y cómo resolverlo. null
 * si el código no es conocido: entonces solo se muestra el código.
 * `inEditor`: se arregla en la configuración del nodo.
 */
export function stepErrorInfo(raw: string): { code: string; key: string; values?: Record<string, string>; inEditor: boolean } | null {
  const code = raw.trim().match(/^[a-z0-9_]+/i)?.[0]?.toLowerCase() ?? '';
  if (!code) return null;
  const http = code.match(/^http_(\d{3})$/);
  if (http) return { code, key: 'http', values: { status: http[1] }, inEditor: true };
  if (code === 'missing_credential' || code === 'missing_credentialid') return { code, key: 'missing_credential', inEditor: true };
  if (code === 'credential_not_found' || code === 'credential_wrong_type') return { code, key: code, inEditor: true };
  if (code === 'invalid_credential' || /^(google_invalid_credential|telegram_invalid_token|discord_invalid_webhook|slack_invalid_auth|slack_not_authed)$/.test(code)) {
    return { code, key: 'invalid_credential', inEditor: true };
  }
  if (code === 'missing_url') return { code, key: 'missing_url', inEditor: true };
  if (code === 'invalid_email' || code === 'missing_recipient') return { code, key: 'invalid_email', inEditor: true };
  if (code === 'invalid_json') return { code, key: 'invalid_json', inEditor: true };
  if (code === 'rate_limited' || code === 'slack_ratelimited') return { code, key: 'rate_limited', inEditor: false };
  if (code === 'invalid_date' || code === 'wait_too_long') return { code, key: 'invalid_date', inEditor: true };
  if (code === 'table_not_found') return { code, key: 'table_not_found', inEditor: true };
  if (code === 'table_invalid_value' || code === 'table_unknown_column') return { code, key: 'table_value', inEditor: true };
  if (code === 'table_full' || code === 'table_row_too_large') return { code, key: 'table_full', inEditor: false };
  if (code.startsWith('missing_')) return { code, key: 'missing_field', inEditor: true };
  return null;
}

/** Entrada de un robot tal como la necesita el selector del nodo Robot. */
export interface RobotRefInput {
  name: string;
  label: string;
  required: boolean;
  default: string;
}

/**
 * Filas del campo inputs al elegir un robot: una por cada entrada del robot
 * (en su orden), conservando los valores que ya estaban. Las filas que no son
 * entradas del robot se conservan solo si tienen un valor (no se pierde nada
 * escrito a mano).
 */
export function robotInputRows(
  defs: readonly RobotRefInput[],
  current: ReadonlyArray<{ key?: string; value?: string }>,
): Array<{ key: string; value: string }> {
  const byKey = new Map(current.map((r) => [String(r.key ?? '').trim(), String(r.value ?? '')]));
  const names = new Set(defs.map((d) => d.name));
  const rows = defs.map((d) => ({ key: d.name, value: byKey.get(d.name) ?? '' }));
  for (const r of current) {
    const key = String(r.key ?? '').trim();
    if (key && !names.has(key) && String(r.value ?? '').trim()) rows.push({ key, value: String(r.value ?? '') });
  }
  return rows;
}
