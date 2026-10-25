/**
 * Track — triage, SLAs, pedidos de clientes y agentes: tipos y lógica pura
 * (sin base). La usan el servidor (lib/track-triage.ts, lib/track-sla.ts…) y
 * los componentes.
 */

export type TrackPriority = 'urgent' | 'high' | 'medium' | 'low';
export const TRACK_PRIORITIES: readonly TrackPriority[] = ['urgent', 'high', 'medium', 'low'];

// ---------- Ajustes de triage ----------

export type TriageOwnerAction = 'off' | 'notify' | 'assign';
export type TriageOwnerRotation = 'daily' | 'weekly';
/** Qué hace Track con cada tipo de sugerencia de IA (como Linear: mostrar, ocultar o aplicar sola). */
export type AiSuggestionMode = 'show' | 'auto' | 'off';
export const AI_SUGGESTION_KINDS = ['assignee', 'labels', 'priority', 'duplicate'] as const;
export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

export type SlaHours = Partial<Record<TrackPriority, number | null>>;

/** Defaults de Linear: urgente 24 h, alta 1 semana, el resto sin SLA. */
export const DEFAULT_SLA_HOURS: Record<TrackPriority, number | null> = {
  urgent: 24,
  high: 168,
  medium: null,
  low: null,
};

/** Opciones del selector de duración (horas), de 12 h a 4 semanas como Linear. */
export const SLA_HOUR_OPTIONS = [12, 24, 48, 72, 120, 168, 336, 672] as const;

export interface TriageSettings {
  projectId: string;
  ownerIds: string[];
  ownerRotation: TriageOwnerRotation;
  ownerAction: TriageOwnerAction;
  /** Día (YYYY-MM-DD, UTC) en que arranca la rotación: ese día le toca al primero. */
  ownerAnchor: string;
  slaEnabled: boolean;
  slaHours: Record<TrackPriority, number | null>;
  aiModes: Record<AiSuggestionKind, AiSuggestionMode>;
}

export const DEFAULT_AI_MODES: Record<AiSuggestionKind, AiSuggestionMode> = {
  assignee: 'show',
  labels: 'show',
  priority: 'show',
  duplicate: 'show',
};

export function normalizeSlaHours(raw: unknown): Record<TrackPriority, number | null> {
  const out = { ...DEFAULT_SLA_HOURS };
  if (!raw || typeof raw !== 'object') return out;
  for (const p of TRACK_PRIORITIES) {
    if (!(p in (raw as object))) continue;
    const v = (raw as Record<string, unknown>)[p];
    if (v === null) out[p] = null;
    else if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 24 * 365) out[p] = Math.round(v);
  }
  return out;
}

export function normalizeAiModes(raw: unknown): Record<AiSuggestionKind, AiSuggestionMode> {
  const out = { ...DEFAULT_AI_MODES };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of AI_SUGGESTION_KINDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === 'show' || v === 'auto' || v === 'off') out[k] = v;
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * Responsable de triage de turno: rota por la lista en orden, un turno por
 * día o por semana desde `anchor`. Sin lista, nadie.
 */
export function currentTriageOwner(
  settings: Pick<TriageSettings, 'ownerIds' | 'ownerRotation' | 'ownerAnchor'>,
  now = new Date(),
): string | null {
  const ids = settings.ownerIds;
  if (ids.length === 0) return null;
  const anchor = Date.parse(`${settings.ownerAnchor}T00:00:00Z`);
  const start = Number.isFinite(anchor) ? anchor : now.getTime();
  const days = Math.floor((now.getTime() - start) / DAY_MS);
  const turn = settings.ownerRotation === 'daily' ? days : Math.floor(days / 7);
  const i = ((turn % ids.length) + ids.length) % ids.length;
  return ids[i];
}

/** Cuándo empieza el turno siguiente (para mostrar "hasta el lunes"). */
export function nextTriageHandoff(
  settings: Pick<TriageSettings, 'ownerIds' | 'ownerRotation' | 'ownerAnchor'>,
  now = new Date(),
): Date | null {
  if (settings.ownerIds.length < 2) return null;
  const anchor = Date.parse(`${settings.ownerAnchor}T00:00:00Z`);
  const start = Number.isFinite(anchor) ? anchor : now.getTime();
  const len = settings.ownerRotation === 'daily' ? DAY_MS : 7 * DAY_MS;
  const elapsed = now.getTime() - start;
  const turns = Math.floor(elapsed / len) + 1;
  return new Date(start + turns * len);
}

// ---------- Reglas de triage ----------

export const RULE_FIELDS = ['source', 'text', 'priority', 'label', 'customer'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export interface RuleCondition {
  field: RuleField;
  /** is: alguno de los valores; contains: el texto (título o descripción) contiene alguno. */
  op: 'is' | 'is_not' | 'contains';
  values: string[];
}

export interface RuleActions {
  priority?: TrackPriority;
  assigneeId?: string;
  /** Ids de labels del workspace a agregar. */
  labelIds?: string[];
  cycleId?: string;
  /** Acepta el issue en este estado (sale de triage). */
  acceptStatusId?: string;
}

export interface TriageRule {
  id: string;
  projectId: string;
  name: string;
  position: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleActions;
  createdAt: string;
  updatedAt: string;
}

/** Datos del issue que miran las reglas. */
export interface RuleSubject {
  source: string;
  title: string;
  description: string;
  priority: string;
  labelIds: string[];
  /** Nombres o dominios de los clientes que lo pidieron. */
  customers: string[];
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();
}

function conditionMatches(c: RuleCondition, s: RuleSubject): boolean {
  const values = c.values.map(norm).filter(Boolean);
  if (values.length === 0) return true;
  let hit: boolean;
  switch (c.field) {
    case 'source':
      hit = values.includes(norm(s.source || 'app'));
      break;
    case 'priority':
      hit = values.includes(norm(s.priority));
      break;
    case 'label':
      hit = s.labelIds.some((l) => values.includes(norm(l)));
      break;
    case 'customer':
      hit = s.customers.some((cu) => values.some((v) => norm(cu).includes(v)));
      break;
    case 'text':
    default: {
      const text = norm(`${s.title}\n${s.description}`);
      hit = values.some((v) => text.includes(v));
      break;
    }
  }
  return c.op === 'is_not' ? !hit : hit;
}

/** Todas las condiciones (AND); cada una acepta varios valores (OR), como Linear con Shift. */
export function ruleMatches(rule: Pick<TriageRule, 'enabled' | 'conditions'>, subject: RuleSubject): boolean {
  if (!rule.enabled) return false;
  return rule.conditions.every((c) => conditionMatches(c, subject));
}

/**
 * Corre las reglas de arriba a abajo y junta las acciones. Una propiedad que
 * ya fijó una regla de más arriba no la pisa una de más abajo (conflicto: gana
 * la primera, como el orden de Linear); los labels se suman.
 */
export function planTriageRules(
  rules: Array<Pick<TriageRule, 'id' | 'name' | 'enabled' | 'conditions' | 'actions' | 'position'>>,
  subject: RuleSubject,
): { actions: RuleActions; matched: Array<{ id: string; name: string }>; conflicts: string[] } {
  const actions: RuleActions = {};
  const matched: Array<{ id: string; name: string }> = [];
  const conflicts: string[] = [];
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  for (const r of sorted) {
    if (!ruleMatches(r, subject)) continue;
    matched.push({ id: r.id, name: r.name });
    const a = r.actions;
    for (const key of ['priority', 'assigneeId', 'cycleId', 'acceptStatusId'] as const) {
      const v = a[key];
      if (!v) continue;
      if (actions[key] && actions[key] !== v) conflicts.push(key);
      else (actions as Record<string, unknown>)[key] = v;
    }
    if (a.labelIds?.length) actions.labelIds = [...new Set([...(actions.labelIds ?? []), ...a.labelIds])];
  }
  return { actions, matched, conflicts: [...new Set(conflicts)] };
}

// ---------- SLA ----------

export type SlaState = 'on_track' | 'at_risk' | 'breached' | 'met' | 'failed';

export interface IssueSla {
  priority: string;
  startedAt: string;
  riskAt: string;
  dueAt: string;
  completedAt: string | null;
}

/** En riesgo cuando queda la cuarta parte del plazo o 24 h, lo que sea menos. */
export function slaRiskAt(startedAt: Date, hours: number): Date {
  const total = hours * 3_600_000;
  const lead = Math.min(24 * 3_600_000, total / 4);
  return new Date(startedAt.getTime() + total - lead);
}

export function slaState(sla: Pick<IssueSla, 'riskAt' | 'dueAt' | 'completedAt'>, now = new Date()): SlaState {
  if (sla.completedAt) return sla.completedAt <= sla.dueAt ? 'met' : 'failed';
  const t = now.toISOString();
  if (t >= sla.dueAt) return 'breached';
  if (t >= sla.riskAt) return 'at_risk';
  return 'on_track';
}

/** "3d", "5h", "40m": tiempo que falta (o que pasó, si venció) en una unidad. */
export function slaRemaining(dueAt: string, now = new Date()): { amount: number; unit: 'd' | 'h' | 'm'; overdue: boolean } {
  const diff = Date.parse(dueAt) - now.getTime();
  const abs = Math.abs(diff);
  const overdue = diff < 0;
  if (abs >= 2 * DAY_MS) return { amount: Math.floor(abs / DAY_MS), unit: 'd', overdue };
  if (abs >= 3_600_000) return { amount: Math.floor(abs / 3_600_000), unit: 'h', overdue };
  return { amount: Math.max(1, Math.floor(abs / 60_000)), unit: 'm', overdue };
}

// ---------- Pedidos de clientes ----------

export const REQUEST_SOURCES = ['manual', 'crm', 'chat', 'groups', 'email', 'form', 'api'] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/** Dominios de correo personal: no identifican a una empresa (como Linear). */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

export function emailDomain(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const domain = email.trim().toLowerCase().slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return PERSONAL_EMAIL_DOMAINS.has(domain) ? null : domain;
}

// ---------- Agentes ----------

export type AgentSessionState = 'pending' | 'active' | 'awaiting_input' | 'complete' | 'error' | 'stopped';
export type AgentActivityType = 'prompt' | 'thought' | 'action' | 'elicitation' | 'response' | 'error';
export const AGENT_ACTIVITY_TYPES: readonly AgentActivityType[] = ['prompt', 'thought', 'action', 'elicitation', 'response', 'error'];

/** El estado de la sesión sale de la última actividad (como Linear). */
export function stateAfterActivity(type: AgentActivityType, current: AgentSessionState): AgentSessionState {
  if (current === 'stopped') return 'stopped';
  switch (type) {
    case 'prompt':
      return 'pending';
    case 'thought':
    case 'action':
      return 'active';
    case 'elicitation':
      return 'awaiting_input';
    case 'response':
      return 'complete';
    case 'error':
      return 'error';
  }
}

export function sessionIsOpen(state: AgentSessionState): boolean {
  return state === 'pending' || state === 'active' || state === 'awaiting_input';
}
