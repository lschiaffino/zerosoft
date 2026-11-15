/**
 * Fleet: tipos y funciones puras (sin base ni red). Las comparte el cliente.
 */
export { FLEET_NAME } from './name';

export type ConnectionKind = 'github' | 'vercel';
export const CONNECTION_KINDS: readonly ConnectionKind[] = ['github', 'vercel'];

/** Estado de una sesión de agente en el tablero. */
export type SessionStatus = 'working' | 'waiting' | 'done' | 'failed' | 'idle';
export const SESSION_STATUSES: readonly SessionStatus[] = ['working', 'waiting', 'done', 'failed', 'idle'];

/** Eventos del hook de Claude Code que acepta la ingesta. */
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'StopFailure', 'SessionEnd'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(v: unknown): v is HookEvent {
  return typeof v === 'string' && (HOOK_EVENTS as readonly string[]).includes(v);
}

/** Rol de un mensaje del chat con el agente. */
export type MessageRole = 'prompt' | 'agent' | 'notice' | 'reply';
/** Respuesta en cola: pendiente hasta que el Stop hook (o el próximo prompt) la entrega. */
export type ReplyStatus = 'pending' | 'delivered' | 'cancelled';
/** De dónde vino la respuesta. */
export type ReplySource = 'web' | 'whatsapp' | 'inbox' | 'lines';

export class FleetError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** Topes de lo que se guarda (el hook ya recorta; el servidor recorta de nuevo). */
export const LIMITS = {
  prompt: 4000,
  agent: 8000,
  notice: 600,
  reply: 4000,
  project: 120,
  branch: 200,
  sessionKey: 120,
  orca: 200,
  title: 140,
  label: 80,
} as const;

/** Recorta a `max` caracteres (sin cortar un par sustituto) y marca el corte con "…". */
export function clip(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  const t = text.replace(/\u0000/g, '');
  if (t.length <= max) return t;
  let end = max - 1;
  const code = t.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${t.slice(0, end)}…`;
}

/** Vista previa sin Markdown: sin bloques de código, marcas de negrita, código en línea ni viñetas. */
export function plainPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/^\s*(?:[-*]|\d+\.|#{1,6})\s+/gm, '');
}

/** Una línea (para títulos y vistas previas). */
export function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s+/g, ' ').trim(), max);
}

/**
 * Último segmento de una ruta: el hook manda solo el nombre de la carpeta, pero si llega una ruta entera se queda
 * con el final (nunca se guarda la ruta completa).
 */
export function baseName(path: unknown): string {
  if (typeof path !== 'string') return '';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return clip(parts[parts.length - 1] ?? '', LIMITS.project);
}

/**
 * Patrones de secretos comunes que nunca se guardan aunque aparezcan en un prompt o una respuesta: tokens de
 * GitHub, Vercel, OpenAI/Anthropic, AWS, Slack, JWTs, claves privadas y los tokens propios (zsf_, zsa_, zsk_).
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bzs[afk]_[A-Za-z0-9_-]{16,}\b/g,
  /\bvercel_[A-Za-z0-9_-]{20,}\b/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/** El evento, ya limpio, que guarda la ingesta. Lo arma `normalizeHookPayload` a partir de lo que manda el hook. */
export interface IngestEvent {
  event: HookEvent;
  sessionKey: string;
  project: string;
  branch: string;
  orcaPane: string;
  orcaWorktree: string;
  orcaTab: string;
  /** Texto del evento: prompt, respuesta final, aviso o error (recortado y sin secretos). */
  text: string;
  /** Notification: tipo (permission_prompt, idle_prompt, …). SessionStart: source. SubagentStop: tipo del subagente. */
  detail: string;
  /** Stop: Claude ya está continuando por un Stop hook. */
  stopHookActive: boolean;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? clip(v.trim(), max) : '';
}

/**
 * Valida y limpia lo que manda el hook. Acepta tanto el formato compacto del script de zerosoft
 * ({ event, session, project, branch, text, … }) como el JSON crudo de Claude Code (hook_event_name, session_id,
 * cwd, prompt, last_assistant_message, message), por si alguien lo apunta directo: de ese se toman solo los campos
 * de la lista y la ruta queda en su último segmento. Devuelve null si falta el evento o la sesión.
 */
export function normalizeHookPayload(raw: unknown): IngestEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const event = r.event ?? r.hook_event_name;
  if (!isHookEvent(event)) return null;
  const sessionKey = str(r.session ?? r.session_id, LIMITS.sessionKey);
  if (!sessionKey || !/^[A-Za-z0-9._:-]+$/.test(sessionKey)) return null;
  const project = typeof r.project === 'string' ? baseName(r.project) : baseName(r.cwd);
  let text = '';
  let detail = '';
  switch (event) {
    case 'UserPromptSubmit':
      text = typeof r.text === 'string' ? r.text : typeof r.prompt === 'string' ? r.prompt : '';
      text = clip(text, LIMITS.prompt);
      break;
    case 'Stop':
    case 'SubagentStop':
      text = typeof r.text === 'string' ? r.text : typeof r.last_assistant_message === 'string' ? r.last_assistant_message : '';
      text = clip(text, event === 'Stop' ? LIMITS.agent : LIMITS.notice);
      detail = str(r.detail ?? r.agent_type, 80);
      break;
    case 'Notification':
      text = clip(typeof r.text === 'string' ? r.text : typeof r.message === 'string' ? r.message : '', LIMITS.notice);
      detail = str(r.detail ?? r.notification_type, 80);
      break;
    case 'StopFailure':
      text = clip(typeof r.text === 'string' ? r.text : '', LIMITS.notice);
      detail = str(r.detail ?? r.error, 80);
      break;
    case 'SessionStart':
    case 'SessionEnd':
      detail = str(r.detail ?? r.source ?? r.reason, 80);
      break;
  }
  return {
    event,
    sessionKey,
    project,
    branch: str(r.branch, LIMITS.branch),
    orcaPane: str(r.orca_pane, LIMITS.orca),
    orcaWorktree: str(r.orca_worktree, LIMITS.orca),
    orcaTab: str(r.orca_tab, LIMITS.orca),
    text: redactSecrets(text),
    detail: detail.replace(/[^A-Za-z0-9_. -]/g, ''),
    stopHookActive: r.stop_hook_active === true || r.stop_hook_active === 'true' || r.stop_hook_active === 1,
  };
}

/**
 * Estado de la sesión después de un evento. Notification de permiso o pregunta: te espera. Stop: terminó su turno
 * (queda esperando tu próximo mensaje, se muestra como "listo"). StopFailure: falló.
 */
export function statusAfter(prev: SessionStatus, ev: Pick<IngestEvent, 'event' | 'detail'>): SessionStatus {
  switch (ev.event) {
    case 'SessionStart':
      return prev === 'working' ? 'working' : 'idle';
    case 'UserPromptSubmit':
      return 'working';
    case 'Notification':
      // idle_prompt llega después de un rato sin actividad: si ya había terminado, sigue como "listo".
      if (ev.detail === 'idle_prompt') return prev === 'done' || prev === 'failed' ? prev : 'waiting';
      if (ev.detail === 'auth_success' || ev.detail === 'agent_completed') return prev;
      return 'waiting';
    case 'Stop':
      return 'done';
    case 'StopFailure':
      return 'failed';
    case 'SubagentStop':
      return prev === 'idle' ? 'working' : prev;
    case 'SessionEnd':
      return prev === 'failed' ? 'failed' : 'done';
  }
}

/** Texto que el Stop hook le pasa a Claude como motivo para seguir: los mensajes pendientes, en orden. */
export function deliveryReason(messages: Array<{ text: string; source: ReplySource | string }>): string {
  if (!messages.length) return '';
  if (messages.length === 1) return messages[0].text;
  return messages.map((m, i) => `(${i + 1}) ${m.text}`).join('\n\n');
}

/**
 * Lo que imprime el hook en stdout para cada evento (contrato de los hooks de Claude Code):
 * - Stop / SubagentStop con mensajes en cola: {"decision":"block","reason":"<mensaje>"} (Claude sigue con eso).
 * - UserPromptSubmit con mensajes en cola: hookSpecificOutput.additionalContext (se suman al prompt).
 * - El resto: {} (no cambia nada).
 */
export function hookOutput(event: HookEvent, messages: Array<{ text: string; source: string }>): Record<string, unknown> {
  const reason = deliveryReason(messages);
  if (!reason) return {};
  if (event === 'Stop' || event === 'SubagentStop') return { decision: 'block', reason };
  if (event === 'UserPromptSubmit') {
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `Message from your Fleet chat, sent while you were working:\n${reason}` } };
  }
  return {};
}

// ---------- DTOs ----------

export interface ConnectionDto {
  id: string;
  kind: ConnectionKind;
  label: string;
  account: string;
  tokenHint: string;
  status: 'ok' | 'error';
  error: string;
  lastSyncAt: string | null;
  /** GitHub: repos elegidos ("owner/name"). Vercel: proyectos elegidos (ids; vacío = todos). */
  selected: string[];
  /** Vercel: equipo (id) del token, si es de un equipo. */
  teamId: string;
  createdAt: string;
}

export type ChecksState = 'success' | 'failure' | 'pending' | '';

export interface PullDto {
  id: string;
  connectionId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  sha: string;
  draft: boolean;
  autoMerge: boolean;
  /** MERGEABLE, CONFLICTING o UNKNOWN (GitHub). */
  mergeable: string;
  /** clean, blocked, behind, dirty, unstable, … (mergeStateStatus en minúsculas). */
  mergeState: string;
  checks: ChecksState;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RunDto {
  id: string;
  repo: string;
  name: string;
  url: string;
  branch: string;
  sha: string;
  /** queued, in_progress, completed. */
  status: string;
  /** success, failure, cancelled, skipped, … ('' mientras corre). */
  conclusion: string;
  event: string;
  actor: string;
  at: string | null;
}

export interface ReleaseDto {
  id: string;
  repo: string;
  tag: string;
  name: string;
  url: string;
  author: string;
  draft: boolean;
  prerelease: boolean;
  at: string | null;
}

export type DeployState = 'building' | 'queued' | 'ready' | 'error' | 'canceled';

export interface DeployDto {
  id: string;
  connectionId: string;
  project: string;
  projectId: string;
  url: string;
  inspectorUrl: string;
  state: DeployState;
  target: 'production' | 'preview';
  /** Este deploy es el que sirve producción en su proyecto. */
  serving: boolean;
  branch: string;
  sha: string;
  commitMessage: string;
  prNumber: number | null;
  creator: string;
  at: string | null;
  readyAt: string | null;
}

export interface SessionDto {
  id: string;
  title: string;
  project: string;
  branch: string;
  orcaPane: string;
  orcaWorktree: string;
  status: SessionStatus;
  lastText: string;
  unread: number;
  pending: number;
  archived: boolean;
  startedAt: string;
  lastEventAt: string;
  /** PR abierto de la misma rama, si hay. */
  pr: Pick<PullDto, 'id' | 'repo' | 'number' | 'url' | 'checks' | 'autoMerge' | 'title'> | null;
  /** Último deploy de la misma rama, si hay. */
  deploy: Pick<DeployDto, 'id' | 'project' | 'state' | 'url' | 'target' | 'serving'> | null;
}

export interface MessageDto {
  id: string;
  role: MessageRole;
  event: string;
  text: string;
  status: ReplyStatus | '';
  source: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface FleetPrefs {
  /** Mostrar las conversaciones con los agentes en Inbox (carpeta Agents). */
  mirrorInbox: boolean;
  /** Mostrar las conversaciones con los agentes en Lines. */
  mirrorLines: boolean;
  /** Aviso por WhatsApp a tu propio chat: nunca, al terminar, al esperarte o ambos. */
  notify: 'off' | 'done' | 'waiting' | 'both';
  /** Cuenta de WhatsApp de Inbox desde la que sale el aviso (a tu propio chat). */
  notifyAccountId: string;
}

export const DEFAULT_PREFS: FleetPrefs = { mirrorInbox: false, mirrorLines: false, notify: 'off', notifyAccountId: '' };

export interface NowSummary {
  working: number;
  waiting: number;
  prsOpen: number;
  failingChecks: number;
  deploying: number;
}

/** Clave estable del agrupado del tablero: proyecto (carpeta) o, sin carpeta, la rama. */
export function groupKey(s: Pick<SessionDto, 'project' | 'branch'>): string {
  return s.project || s.branch || '';
}

/** Orden de las sesiones en una columna/lista: primero las que te esperan, después las que trabajan, el resto por actividad. */
export function sessionRank(status: SessionStatus): number {
  return { waiting: 0, failed: 1, working: 2, done: 3, idle: 4 }[status];
}
