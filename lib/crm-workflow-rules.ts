/**
 * Reglas puras de los workflows del CRM (bloque W1): ajustes de inscripción
 * (reinscripción y filtros), "propiedad cambiada", esperas, topes contra
 * loops, rotación de owner, el cuerpo firmado de los webhooks y lo que ve un
 * miembro de la config. Sin DB: lo usan lib/crm-workflows.ts, lib/crm.ts y
 * el editor, y se testea solo.
 */

export const BRANCH_OPS = ['equals', 'not_equals', 'contains', 'gt', 'lt', 'is_set', 'is_not_set'] as const;
export type BranchOp = (typeof BRANCH_OPS)[number];

export const CONDITION_ENTITIES = ['contact', 'company', 'deal'] as const;
export type ConditionEntity = (typeof CONDITION_ENTITIES)[number];

/** Una condición sobre una propiedad del registro (filtro de inscripción o si/si no). */
export interface EnrollCondition {
  entity: ConditionEntity;
  field: string;
  op: BranchOp;
  value?: string;
}

export interface WorkflowSettings {
  /** Un registro puede volver a entrar cuando se cumple de nuevo el disparador. */
  reenroll: boolean;
  /** Todas se tienen que cumplir para inscribir (AND). */
  filters: EnrollCondition[];
}

// ---------- Topes contra loops ----------

/** Acciones que corre una inscripción como máximo (las esperas cuentan). */
export const MAX_RUN_STEPS = 25;
/** Inscripciones de un mismo registro en un workflow en 24 horas, con reinscripción. */
export const MAX_ENROLLMENTS_PER_DAY = 10;
/** Una corrida 'running' más vieja que esto se considera colgada y no bloquea. */
export const STUCK_RUN_MINUTES = 60;
/** Espera más larga: 30 días. */
export const MAX_DELAY_MINUTES = 60 * 24 * 30;
export const MAX_FILTERS = 10;

export const DELAY_UNITS = ['minutes', 'hours', 'days'] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number];

const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 60 * 24 };

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function parseCondition(v: unknown): EnrollCondition | null {
  if (!isObject(v)) return null;
  const entity = (CONDITION_ENTITIES as readonly string[]).includes(str(v.entity)) ? (str(v.entity) as ConditionEntity) : 'contact';
  const field = str(v.field).trim().slice(0, 100);
  if (!field) return null;
  const op = (BRANCH_OPS as readonly string[]).includes(str(v.op)) ? (str(v.op) as BranchOp) : 'equals';
  const value = str(v.value).slice(0, 500);
  return op === 'is_set' || op === 'is_not_set' ? { entity, field, op } : { entity, field, op, value };
}

/**
 * Ajustes guardados en crm_workflows.settings. Sin `reenroll` (workflows de
 * antes de W1) queda en true: corrían en cada evento y siguen igual.
 */
export function parseWorkflowSettings(raw: unknown): WorkflowSettings {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw || '{}');
    } catch {
      v = {};
    }
  }
  const o = isObject(v) ? v : {};
  const filters = Array.isArray(o.filters)
    ? o.filters.map(parseCondition).filter((c): c is EnrollCondition => !!c).slice(0, MAX_FILTERS)
    : [];
  return { reenroll: typeof o.reenroll === 'boolean' ? o.reenroll : true, filters };
}

/** Minutos de una acción de espera, o null si la config no sirve. */
export function delayMinutes(cfg: Record<string, unknown>): number | null {
  const amount = Number(cfg.amount);
  const unit = (DELAY_UNITS as readonly string[]).includes(str(cfg.unit)) ? (str(cfg.unit) as DelayUnit) : 'days';
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const minutes = Math.ceil(amount * UNIT_MINUTES[unit]);
  return Math.min(Math.max(minutes, 1), MAX_DELAY_MINUTES);
}

/** Fecha de la DB (UTC, 'YYYY-MM-DD HH:MM:SS'). */
export function dbTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

// ---------- "Propiedad cambiada" ----------

/** Nombre de propiedad de la UI ('lifecycleStage', 'lifecycle_stage', 'custom.x') a columna o 'custom.<key>'. */
export function fieldColumn(field: string): string {
  const f = field.trim();
  if (f.startsWith('custom.')) return f;
  return f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).toLowerCase();
}

function normValue(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function parseObj(v: unknown): Record<string, unknown> {
  if (isObject(v)) return v;
  if (typeof v !== 'string') return {};
  try {
    const p: unknown = JSON.parse(v || '{}');
    return isObject(p) ? p : {};
  } catch {
    return {};
  }
}

/**
 * Propiedades que de verdad cambian con un UPDATE: columnas y 'custom.<key>'.
 * `sets` son los pares [columna, valor] que arma lib/crm.ts.
 */
export function changedFields(existing: Record<string, unknown>, sets: ReadonlyArray<readonly [string, unknown]>): string[] {
  const out: string[] = [];
  for (const [col, value] of sets) {
    if (col === 'custom') {
      const before = parseObj(existing.custom);
      const after = parseObj(value);
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (normValue(before[k]) !== normValue(after[k])) out.push(`custom.${k}`);
      }
      continue;
    }
    if (normValue(existing[col]) !== normValue(value)) out.push(col);
  }
  return [...new Set(out)];
}

/**
 * Disparador "registro actualizado" con una propiedad elegida: solo cuando
 * esa propiedad está entre las que cambiaron. Sin propiedad, cualquier cambio.
 */
export function propertyChangeMatches(cfg: Record<string, unknown>, payload: Record<string, unknown> | undefined): boolean {
  const field = str(cfg.field).trim();
  if (!field) return true;
  const changed = Array.isArray(payload?.changed) ? (payload!.changed as unknown[]).map(str) : [];
  return changed.includes(fieldColumn(field));
}

/** Condición "y el valor nuevo es" de un disparador de propiedad, o null si no tiene. */
export function triggerValueCondition(entity: string, cfg: Record<string, unknown>): EnrollCondition | null {
  const field = str(cfg.field).trim();
  const value = str(cfg.value).trim();
  if (!field || !value || !(CONDITION_ENTITIES as readonly string[]).includes(entity)) return null;
  return { entity: entity as ConditionEntity, field, op: 'equals', value };
}

// ---------- Rotar owner ----------

/**
 * Próxima persona del pool desde el cursor, salteando las no disponibles
 * (fuera de oficina). null si no queda nadie. `next` es el cursor nuevo.
 */
export function pickRotation(pool: readonly string[], cursor: number, away: ReadonlySet<string>): { owner: string; next: number } | null {
  const n = pool.length;
  if (!n) return null;
  const start = ((Math.trunc(cursor) % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (!away.has(pool[idx])) return { owner: pool[idx], next: (idx + 1) % n };
  }
  return null;
}

// ---------- Webhook ----------

/** Claves del payload de un evento que pueden salir en un webhook (nada de respuestas de formularios). */
const WEBHOOK_PAYLOAD_KEYS = ['oldStageId', 'newStageId', 'formId', 'scoreId', 'oldScore', 'newScore', 'changed'] as const;

/** Propiedades estándar de cada registro que salen en el webhook. */
const WEBHOOK_RECORD_KEYS: Record<ConditionEntity, readonly string[]> = {
  contact: ['id', 'first_name', 'last_name', 'email', 'company_id', 'owner_id'],
  company: ['id', 'name', 'domain', 'owner_id'],
  deal: ['id', 'name', 'amount', 'currency', 'stage_id', 'pipeline_id', 'owner_id'],
};

export type HiddenByEntity = Partial<Record<ConditionEntity, ReadonlySet<string>>>;

function webhookRecord(entity: ConditionEntity, row: Record<string, unknown> | null | undefined, hidden: ReadonlySet<string>) {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const k of WEBHOOK_RECORD_KEYS[entity]) if (row[k] !== undefined) out[k] = row[k];
  const custom = parseObj(row.custom);
  const visible: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) if (!hidden.has(k)) visible[k] = v;
  out.custom = visible;
  return out;
}

/**
 * Cuerpo JSON de la acción webhook. Lleva el evento (con un payload acotado)
 * y el contacto, la empresa y el deal del evento, sin los campos propios que
 * tienen una regla "oculto" para alguien del workspace: esos datos nunca
 * salen del CRM por un webhook. Puro.
 */
export function webhookBody(input: {
  workflowId: string;
  runId: string;
  event: { type: string; entity: string; entityId: string; payload?: Record<string, unknown> };
  records: Partial<Record<ConditionEntity, Record<string, unknown> | null>>;
  hidden: HiddenByEntity;
  sentAt?: Date;
}): string {
  const payload: Record<string, unknown> = {};
  const all = new Set<string>();
  for (const e of CONDITION_ENTITIES) for (const k of input.hidden[e] ?? []) all.add(k);
  for (const k of WEBHOOK_PAYLOAD_KEYS) {
    const v = input.event.payload?.[k];
    if (v === undefined) continue;
    payload[k] = k === 'changed' && Array.isArray(v) ? v.map(str).filter((f) => !(f.startsWith('custom.') && all.has(f.slice(7)))) : v;
  }
  const empty = new Set<string>();
  return JSON.stringify({
    workflowId: input.workflowId,
    runId: input.runId,
    sentAt: (input.sentAt ?? new Date()).toISOString(),
    event: { type: input.event.type, entity: input.event.entity, entityId: input.event.entityId, payload },
    contact: webhookRecord('contact', input.records.contact, input.hidden.contact ?? empty),
    company: webhookRecord('company', input.records.company, input.hidden.company ?? empty),
    deal: webhookRecord('deal', input.records.deal, input.hidden.deal ?? empty),
  });
}

/** Cabeceras que el workflow nunca deja pisar (la firma la pone el motor). */
export function safeWebhookHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { 'content-type': 'application/json' };
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase().trim();
    if (!key || key === 'zerosoft-signature' || key === 'host' || key === 'content-length') continue;
    if (!/^[a-z0-9-]{1,64}$/.test(key)) continue;
    out[key] = str(v).slice(0, 2000);
  }
  return out;
}

// ---------- Lo que ve un miembro ----------

/** Solo el origen de una URL (sin path ni query, que pueden llevar tokens). */
export function urlOrigin(url: unknown): string {
  try {
    return new URL(str(url)).origin;
  } catch {
    return '';
  }
}

/**
 * Config de las acciones para quien no administra workflows: el webhook va
 * sin cabeceras y con solo el origen de la URL (pueden llevar tokens). Puro.
 */
export function redactActionsForMember<A extends { type: string; config: Record<string, unknown> }>(actions: A[]): A[] {
  return actions.map((a) => {
    if (a.type !== 'webhook') return a;
    return { ...a, config: { method: str(a.config.method) || 'POST', url: urlOrigin(a.config.url), when: a.config.when } };
  });
}

/**
 * ¿La config del workflow (disparadores, filtros de inscripción, acciones,
 * plantillas) nombra un campo propio que la persona tiene oculto? Busca
 * `custom.<nombre>` en cualquier parte, de cualquier entidad: ante la duda,
 * el workflow no se le muestra (como una lista que filtra por un campo
 * oculto). Puro.
 */
export function workflowUsesHiddenField(
  workflow: { triggers: Array<{ config: unknown }>; actions: Array<{ config: unknown }>; settings?: unknown },
  hidden: ReadonlySet<string>,
): boolean {
  if (!hidden.size) return false;
  const text = JSON.stringify([workflow.triggers.map((t) => t.config), workflow.actions.map((a) => a.config), workflow.settings ?? null]);
  for (const m of text.matchAll(/custom\.([A-Za-z0-9_-]+)/g)) if (hidden.has(m[1])) return true;
  return false;
}
