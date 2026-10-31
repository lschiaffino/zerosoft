/**
 * Flow — motor de ejecución. Recorre el grafo desde el trigger siguiendo las
 * aristas (por handle), guarda cada paso en flow_steps y la salida de cada
 * nodo en el contexto de la corrida ({{nodes.<id>.output.x}}).
 *
 * - Delay y reintentos: se persiste un flow_jobs y la corrida queda 'waiting';
 *   el worker (lib/flow-worker.ts) la retoma desde ese nodo.
 * - Loop: ejecuta el cuerpo (handle 'item') una vez por elemento, en serie.
 * - Tope de pasos por corrida (MAX_STEPS) y cadena de eventos (flowChain).
 * - Errores por nodo (config.onError): stop | continue | branch (salida 'error').
 *   Si la corrida falla y el flow tiene flow de error, se encola ese flow.
 * - Credenciales: los valores usados se redactan en pasos, errores y contexto.
 * - Re-ejecución desde un paso (rerunFromStep): reusa las salidas anteriores.
 * Server-only.
 */
import { aiEnabled, aiGenerateText, AiError } from './ai';
import { isValidTimezone, tzOffsetMinutes } from './cron';
import { getDb, type FlowFlowRow, type FlowRunRow, type FlowStepRow } from './db';
import { sendEmail } from './email';
import { flowChain } from './events';
import {
  enqueueRun,
  getFlowSettings,
  INPUT_TOO_LARGE_KEY,
  kickFlowWorker,
  MAX_FLOW_CHAIN_DEPTH,
  nowIso,
  parseJson,
  WEBHOOK_REPLY_LIMIT,
  type WebhookReply,
} from './flow';
import { aiExtractNode } from './flow-ai';
import { crmTaskNode, crmUpdateNode, docsPageFlowNode, docsRowFlowNode, trackUpdateNode } from './flow-app-nodes';
import { CODE_MAX_TIMEOUT_SEC, runFlowCode } from './flow-code';
import { resolveCredential, secretValues, type ResolvedCredential } from './flow-credentials';
import { redact, type CredentialType } from './flow-credentials-schema';
import { StepError } from './flow-errors';
import {
  authHeaders,
  discordNode,
  gmailNode,
  googleSheetsNode,
  notionNode,
  slackApprovalMessage,
  slackNode,
  stripeNode,
  telegramNode,
  type IntegrationContext,
} from './flow-integrations';
import {
  edgeHandle,
  isTriggerType,
  nodeOutputs,
  onErrorMode,
  reachableFrom,
  supportsErrorHandling,
  triggerNode,
  type FlowGraph,
  type FlowNode,
} from './flow-schema';
import { evalConditions, getPath, renderDeep, renderString, renderValue, stringify, type Condition } from './flow-template';
import { variablesFor } from './flow-variables';
import {
  APPROVAL_TIMEOUT,
  approvalStrings,
  approvalUrl,
  buildApprovalEmail,
  MAX_APPROVERS,
  RESUME_BODY_LIMIT,
  RESUME_TIMEOUT,
  resumeUrl,
} from './flow-waits';
import { rateLimit } from './rate-limit';
import { readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';

export const MAX_STEPS = 200;
export const MAX_LOOP_ITEMS = 100;
/**
 * Techo absoluto de pasos por corrida. Cada Loop suma a MAX_STEPS lo que va a
 * necesitar (ítems × nodos del cuerpo) antes de empezar, así no se corta a
 * mitad de camino con efectos parciales; si no entra en este techo, falla
 * antes de correr ningún ítem.
 */
export const MAX_STEPS_TOTAL = 1_000;
const MAX_RETRIES = 5;
/**
 * Dentro de un Loop no se agenda un job (la iteración no se puede retomar a
 * mitad): se reintenta en línea, con un backoff corto y un presupuesto acotado.
 */
const LOOP_MAX_RETRIES = 3;
const LOOP_RETRY_BASE_MS = 500;
const LOOP_RETRY_BUDGET_MS = 30_000;
/** Tope por valor al guardar en la base (pasos y contexto persistido). */
const STORE_LIMIT = 64_000;
/** Tope por salida de nodo en memoria (lo que leen los nodos siguientes). */
const MEMORY_LIMIT = 5_000_000;
/**
 * Tope por salida al persistir el contexto de la corrida (lo que se retoma
 * después de un Esperar o un reintento y lo que reusa "Re-ejecutar desde aquí").
 */
const CONTEXT_LIMIT = 1_000_000;
/** Tope total de las salidas persistidas: pasado este tamaño, el resto se guarda con STORE_LIMIT. */
const CONTEXT_TOTAL_LIMIT = 8_000_000;
const HTTP_BODY_LIMIT = 1_000_000;

interface RunContext {
  graph: FlowGraph;
  trigger: unknown;
  nodes: Record<string, { output: unknown }>;
  /** Merge ya ejecutados (se persiste: un resume no los vuelve a correr). */
  merged?: string[];
  /** Nodos con un Esperar o un reintento agendado (todavía no terminaron). */
  pending?: string[];
  /** Tope de pasos de la corrida (MAX_STEPS más lo que reservaron los Loops). */
  stepLimit?: number;
  /**
   * Persona con cuyo acceso corre, cuando no es quien creó el flow: "Probar
   * flow" sobre un borrador corre como quien lo prueba (igual que "Probar
   * paso"), nunca con el acceso del dueño sobre un grafo que no publicó.
   */
  actor?: string;
}

type FlowInfo = Pick<
  FlowFlowRow,
  'id' | 'name' | 'user_id' | 'created_by' | 'error_flow_id' | 'enabled' | 'failure_alerts' | 'auto_replay'
>;

interface RunState {
  run: FlowRunRow;
  flow: FlowInfo;
  ctx: RunContext;
  steps: number;
  error: string | null;
  /** Nodo que hizo fallar la corrida (para el flow de error). */
  failedNode: string | null;
  /** Valores de credenciales usadas en la corrida: se redactan antes de guardar. */
  secrets: string[];
  /** Merge ya ejecutados en esta corrida (no corren dos veces). */
  merged: Set<string>;
  /** Nodos en espera (Esperar o reintento agendado): un Merge no los da por terminados. */
  pending: Set<string>;
  /** Milisegundos ya esperados en reintentos en línea dentro de Loops (presupuesto). */
  loopRetryMs: number;
  /** Variables de la persona con cuyo acceso corre ({{vars.x}}). */
  vars: Record<string, string>;
}

interface LoopScope {
  item: unknown;
  index: number;
  /** Loop que abrió esta iteración y los nodos de su cuerpo. */
  loopId: string;
  body: Set<string>;
  /** Nodos del cuerpo que ya corrieron en esta iteración (para los Merge). */
  ran: Set<string>;
  /** Merge del cuerpo ya ejecutados en esta iteración. */
  merged: Set<string>;
}

type NodeResult =
  | { kind: 'ok'; output: unknown; handles: string[] }
  | { kind: 'stop'; output: unknown }
  | { kind: 'wait'; output: unknown }
  | { kind: 'error'; error: string; retryable?: boolean };

/** Valor serializable y acotado (por defecto, para guardar en la base). */
function forStore(value: unknown, limit = STORE_LIMIT): unknown {
  let json: string;
  try {
    json = JSON.stringify(value ?? null);
  } catch {
    return null;
  }
  if (json.length <= limit) return value ?? null;
  return { truncated: true, preview: json.slice(0, 2000) };
}

function templateCtx(state: RunState, loop?: LoopScope): Record<string, unknown> {
  return {
    trigger: state.ctx.trigger,
    nodes: state.ctx.nodes,
    flow: { id: state.flow.id, name: state.flow.name },
    // resumeUrl: retoma un Esperar en modo "hasta una llamada" de esta corrida.
    run: { id: state.run.id, resumeUrl: resumeUrl(state.run.id) },
    vars: state.vars,
    ...(loop ? { loop } : {}),
  };
}

/** Redacta los secretos de la corrida y acota el tamaño para guardar en la base. */
function store(state: RunState, value: unknown): unknown {
  return forStore(state.secrets.length ? redact(value, state.secrets) : value);
}

/**
 * Salida de un nodo para el contexto en memoria: redactada y con un tope mucho
 * mayor que el de la base, para que los nodos siguientes (Loop, Código…) lean
 * los datos completos. Se trunca a STORE_LIMIT recién al persistir.
 */
function keep(state: RunState, value: unknown): unknown {
  return forStore(state.secrets.length ? redact(value, state.secrets) : value, MEMORY_LIMIT);
}

/** Marcador de una salida que no entró al persistirla (forStore). */
function isTruncated(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return o.truncated === true && typeof o.preview === 'string' && Object.keys(o).length === 2;
}

function configText(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) configText(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) configText(x, out);
  return out;
}

/**
 * El nodo lee la salida de otro que quedó truncada al persistirse (después de
 * una espera o al re-ejecutar): mejor fallar explícito que seguir con datos vacíos.
 */
function readsTruncated(state: RunState, node: FlowNode): boolean {
  const ids = Object.entries(state.ctx.nodes)
    .filter(([, v]) => isTruncated(v?.output))
    .map(([id]) => id);
  if (!ids.length) return false;
  const text = configText(node.config ?? {}).join('\n');
  return ids.some((id) => {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`nodes\\s*(\\.\\s*${esc}(?![\\w-])|\\[\\s*['"\`]${esc}['"\`]\\s*\\])`).test(text);
  });
}

function clean(state: RunState, text: string): string {
  return state.secrets.length ? redact(text, state.secrets) : text;
}

function str(v: unknown): string {
  return stringify(v).trim();
}

// ---------- Credenciales ----------

async function takeCredential(state: RunState, ref: unknown, types: readonly CredentialType[]): Promise<ResolvedCredential> {
  const id = String(ref ?? '').trim();
  if (!id) throw new StepError('missing_credential');
  const cred = await resolveCredential(state.flow.user_id, id);
  if (!cred) throw new StepError('credential_not_found');
  if (!types.includes(cred.type)) throw new StepError('credential_wrong_type');
  state.secrets.push(...secretValues(cred.type, cred.data));
  return cred;
}

function integrationCtx(state: RunState, node: FlowNode, loop?: LoopScope): IntegrationContext {
  return {
    workspaceId: state.flow.user_id,
    actorId: state.flow.created_by,
    runId: state.run.id,
    nodeId: node.id,
    loopIndex: loop?.index,
    credential: (id, types) => takeCredential(state, id, types),
    addSecret: (v) => {
      if (v && v.length >= 4) state.secrets.push(v);
    },
  };
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// ---------- Nodos ----------

async function httpNode(state: RunState, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const method = String(cfg.method ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new StepError('invalid_method');
  const url = renderString(cfg.url ?? '', tctx).trim();
  if (!url) throw new StepError('missing_url');
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(cfg.headers) ? (cfg.headers as Array<{ key?: string; value?: string }>) : []) {
    const k = String(h?.key ?? '').trim();
    if (k && /^[A-Za-z0-9-]+$/.test(k)) headers[k.toLowerCase()] = renderString(h?.value ?? '', tctx);
  }
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const body = hasBody ? renderString(cfg.body ?? '', tctx) : undefined;
  if (hasBody && body && !headers['content-type']) {
    headers['content-type'] = /^\s*[[{]/.test(body) ? 'application/json' : 'text/plain';
  }
  headers['user-agent'] ??= 'Zerosoft-Flow/1';
  if (String(cfg.credentialId ?? '').trim()) {
    Object.assign(headers, authHeaders(await takeCredential(state, cfg.credentialId, ['api_key', 'basic', 'oauth_token'])));
  }
  const timeoutMs = Math.min(Math.max(Number(cfg.timeoutMs) || 8000, 1000), 30_000);
  const request = async (target: string) => {
    let res: Response;
    try {
      // Sigue redirecciones (p. ej. Apps Script responde 302) salvo que el nodo lo apague.
      const maxRedirects = cfg.followRedirects === false ? 0 : 5;
      res = await safeFetch(target, { method, headers, body: body || undefined }, timeoutMs, { maxRedirects });
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw new StepError(err.message);
      throw new StepError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
    }
    const text = await readTextCapped(res, HTTP_BODY_LIMIT).catch(() => '');
    let parsed: unknown = text;
    if (cfg.parseJson !== false && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (Object.keys(outHeaders).length < 30) outHeaders[k] = v;
    });
    const output = { status: res.status, ok: res.ok, headers: outHeaders, body: parsed };
    if (!res.ok) throw new StepError(`http_${res.status}`, res.status >= 500 || res.status === 429, output);
    return output;
  };
  const paginate = String(cfg.paginate ?? 'off');
  if (paginate !== 'next_url' && paginate !== 'page') return request(url);
  return paginateHttp(request, url, paginate, cfg);
}

/** Tope de ítems juntados entre todas las páginas. */
const HTTP_MAX_ITEMS = 5_000;

/** Siguiente página de un header Link (RFC 8288): <url>; rel="next". */
export function nextFromLinkHeader(link: string | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;[^,]*rel\s*=\s*"?next"?/i.exec(part);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Paginación del request HTTP: 'next_url' sigue una URL de la respuesta (un
 * campo del cuerpo o el header Link) y 'page' suma 1 al parámetro de página.
 * Junta los ítems (itemsPath, o el cuerpo si es una lista) hasta maxPages o
 * hasta una página vacía. Cada página pasa por safeFetch (la URL siguiente
 * puede venir de afuera: la guardia SSRF se aplica a cada una).
 */
async function paginateHttp(
  request: (url: string) => Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: unknown }>,
  firstUrl: string,
  mode: 'next_url' | 'page',
  cfg: Record<string, unknown>,
) {
  const maxPages = Math.min(Math.max(Math.floor(Number(cfg.maxPages)) || 5, 1), 20);
  const itemsPath = String(cfg.itemsPath ?? '').trim();
  const pageParam = String(cfg.pageParam ?? 'page').trim() || 'page';
  const nextPath = String(cfg.nextUrlPath ?? '').trim();
  const items: unknown[] = [];
  let pages = 0;
  let last: Awaited<ReturnType<typeof request>> | null = null;
  let target: string | null = firstUrl;
  let startPage = 1;
  if (mode === 'page') {
    try {
      const n = Number(new URL(firstUrl).searchParams.get(pageParam));
      if (Number.isFinite(n) && n > 0) startPage = Math.floor(n);
    } catch {
      throw new StepError('invalid_url');
    }
  }
  while (target && pages < maxPages) {
    last = await request(target);
    pages += 1;
    const list = itemsPath ? getPath(last.body, itemsPath) : last.body;
    if (!Array.isArray(list) || list.length === 0) break;
    items.push(...list.slice(0, HTTP_MAX_ITEMS - items.length));
    if (items.length >= HTTP_MAX_ITEMS) break;
    if (mode === 'page') {
      const u = new URL(firstUrl);
      u.searchParams.set(pageParam, String(startPage + pages));
      target = u.toString();
    } else {
      const raw = !nextPath || nextPath === 'header.link' ? nextFromLinkHeader(last.headers.link) : getPath(last.body, nextPath);
      const next = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      try {
        const u: URL | null = next ? new URL(next, target) : null;
        // Solo el mismo origen: el request lleva la credencial del nodo y la URL
        // siguiente la elige la respuesta (otro host se quedaría con el token).
        target = u && u.origin === new URL(firstUrl).origin ? u.toString() : null;
      } catch {
        target = null;
      }
    }
  }
  return { status: last?.status ?? 0, ok: last?.ok ?? false, headers: last?.headers ?? {}, body: last?.body ?? null, items, pages };
}

async function crmContactNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const email = renderString(cfg.email ?? '', tctx).trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new StepError('invalid_email');
  const firstName = renderString(cfg.firstName ?? '', tctx).trim();
  const lastName = renderString(cfg.lastName ?? '', tctx).trim();
  if (!email && !firstName && !lastName) throw new StepError('missing_contact');
  if (email) {
    const existing = (await getDb()
      .prepare('SELECT id, first_name, last_name, email FROM crm_contacts WHERE user_id = ? AND lower(email) = ? LIMIT 1')
      .get(ws, email)) as { id: string; first_name: string; last_name: string; email: string } | undefined;
    if (existing) return { created: false, contact: existing };
  }
  const { createContact } = await import('./crm');
  const c = await createContact(ws, {
    email,
    firstName,
    lastName,
    phone: renderString(cfg.phone ?? '', tctx).trim(),
    source: renderString(cfg.source ?? 'flow', tctx).trim() || 'flow',
  });
  return { created: true, contact: { id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email } };
}

async function crmSequenceNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const sequenceId = renderString(cfg.sequenceId ?? '', tctx).trim();
  if (!sequenceId) throw new StepError('missing_sequence');
  const email = renderString(cfg.email ?? '', tctx).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new StepError('invalid_email');
  const contact = (await getDb()
    .prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = ? LIMIT 1')
    .get(ws, email)) as { id: string } | undefined;
  if (!contact) throw new StepError('missing_contact');
  const { enrollContacts, defaultSenderFor } = await import('./crm-sequences');
  const senderId = await defaultSenderFor(ws, sequenceId, contact.id);
  const res = await enrollContacts(ws, { sequenceId, contactIds: [contact.id], senderId, enrolledBy: null });
  if (!res.ok) throw new StepError(res.error);
  return { enrolled: res.enrolled.length > 0, contactId: contact.id, skipped: res.skipped[0]?.reason ?? null };
}

async function crmDealsNode(ws: string, cfg: Record<string, unknown>) {
  const hours = Math.min(Math.max(Math.floor(Number(cfg.sinceHours) || 24), 1), 24 * 90);
  const deals = (await getDb()
    .prepare(
      `SELECT id, name, amount, currency, stage_id, created_at FROM crm_deals
       WHERE user_id = ? AND created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 100`,
    )
    .all(ws, `-${hours} hours`)) as Array<Record<string, unknown>>;
  const total = deals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  return { count: deals.length, total, deals };
}

async function trackIssueNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const projectId = renderString(cfg.projectId ?? '', tctx).trim();
  if (!projectId) throw new StepError('missing_project');
  const { getProject, createIssue } = await import('./track-data');
  const project = await getProject(projectId);
  if (!project || project.owner_id !== ws) throw new StepError('project_not_found');
  const title = renderString(cfg.title ?? '', tctx).trim().slice(0, 300);
  if (!title) throw new StepError('missing_title');
  const description = renderString(cfg.description ?? '', tctx);
  const priority = ['low', 'medium', 'high', 'urgent'].includes(String(cfg.priority))
    ? (String(cfg.priority) as 'low' | 'medium' | 'high' | 'urgent')
    : 'medium';
  const issue = await createIssue(project.id, ws, {
    title,
    description: description ? [{ type: 'text', text: description }] : undefined,
    priority,
  }, { source: 'flow' });
  return { issue: { id: issue.id, identifier: issue.identifier, title: issue.title }, project: { id: project.id, name: project.name } };
}

async function linkNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const url = renderString(cfg.url ?? '', tctx).trim();
  if (!url) throw new StepError('missing_url');
  const { createLink, getUserLink, toLinkDto } = await import('./links');
  const res = await createLink(ws, {
    url,
    slug: renderString(cfg.slug ?? '', tctx).trim() || undefined,
    title: renderString(cfg.title ?? '', tctx).trim() || undefined,
    via: 'system',
  });
  if (!res.ok) throw new StepError(res.code);
  const full = await getUserLink(ws, res.link.id);
  return { link: full ? toLinkDto(full) : { id: res.link.id, slug: res.link.slug, url: res.link.url } };
}

async function chatMessageNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const conversationId = renderString(cfg.conversationId ?? '', tctx).trim();
  const body = renderString(cfg.body ?? '', tctx).trim();
  if (!conversationId) throw new StepError('missing_conversation');
  if (!body) throw new StepError('missing_body');
  const { getChatConversation, getChatWidget, createChatMessage } = await import('./chat-data');
  const conv = await getChatConversation(conversationId);
  const widget = conv ? await getChatWidget(conv.widget_id) : undefined;
  if (!conv || !widget || widget.user_id !== ws) throw new StepError('conversation_not_found');
  if (Number(widget.restricted ?? 0) === 1) throw new StepError('restricted_inbox');
  const msg = await createChatMessage(conv.id, 'bot', { body: body.slice(0, 10_000) });
  return { message: { id: msg.id, body: msg.body }, conversation: { id: conv.id } };
}

async function groupsMessageNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const chatId = renderString(cfg.chatId ?? '', tctx).trim();
  const body = renderString(cfg.body ?? '', tctx).trim();
  if (!chatId) throw new StepError('missing_chat');
  if (!body) throw new StepError('missing_body');
  const { GroupsError, sendMessage } = await import('./groups');
  try {
    const msg = await sendMessage(ws, null, chatId, { body: body.slice(0, 4096), authorKind: 'flow' });
    if (msg.status === 'failed') throw new StepError(msg.error || 'send_failed', true);
    return { message: { id: msg.id, body: msg.body, status: msg.status }, chat: { id: chatId } };
  } catch (err) {
    if (err instanceof GroupsError) throw new StepError(err.code === 'not_found' ? 'chat_not_found' : err.code);
    throw err;
  }
}

/** Talk: publica como bot (con el nombre elegido) en un canal donde la persona que creó el flow es miembro. */
async function talkMessageNode(ws: string, creatorId: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const channel = renderString(cfg.channel ?? '', tctx).trim();
  const body = renderString(cfg.body ?? '', tctx).trim();
  const threadId = renderString(cfg.threadId ?? '', tctx).trim() || null;
  const botName = renderString(cfg.botName ?? '', tctx).trim().slice(0, 60) || 'Flow';
  if (!channel) throw new StepError('missing_channel');
  if (!body) throw new StepError('missing_body');
  const { postAsBot } = await import('./talk-bot');
  const { TalkError } = await import('./talk');
  try {
    const msg = await postAsBot(ws, { channel, body: body.slice(0, 12_000), threadId, botName, memberId: creatorId });
    return { message: { id: msg.id, channelId: msg.channelId, threadId: msg.parentId } };
  } catch (err) {
    if (err instanceof TalkError) throw new StepError(err.code === 'not_found' ? 'channel_not_found' : err.code === 'not_member' ? 'not_channel_member' : err.code);
    throw err;
  }
}

async function aiNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  if (!aiEnabled()) throw new StepError('ai_disabled');
  const prompt = renderString(cfg.prompt ?? '', tctx).trim();
  if (!prompt) throw new StepError('missing_prompt');
  const instructions = renderString(cfg.instructions ?? '', tctx).trim() || undefined;
  try {
    const res = await aiGenerateText({
      workspaceId: ws,
      feature: 'flow',
      instructions,
      prompt: prompt.slice(0, 20_000),
      maxOutputTokens: Math.min(Math.max(Number(cfg.maxTokens) || 500, 16), 4000),
    });
    return { text: res.text, inputTokens: res.inputTokens, outputTokens: res.outputTokens, model: res.model };
  } catch (err) {
    if (err instanceof AiError) throw new StepError(err.code, err.code === 'rate_limited');
    throw new StepError('ai_error', true);
  }
}

/** Cuánto espera el nodo Robot su turno si otra corrida ocupa el workspace. */
function robotWaitMs(): number {
  const n = Number(process.env.ROBOTS_FLOW_WAIT_SEC);
  return (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 90) * 1000;
}

function robotPollMs(): number {
  const n = Number(process.env.ROBOTS_FLOW_POLL_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/**
 * Corre un robot y espera el resultado (sincrónico, con el timeout del robot).
 * Las corridas de Flow ya van en segundo plano (worker), así que esperar
 * acá es lo simple. Extiende el lock de la corrida para que el worker no la
 * marque como colgada mientras el navegador trabaja.
 */
async function robotNode(state: RunState, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const ws = state.flow.user_id;
  const robotId = renderString(cfg.robotId ?? '', tctx).trim();
  if (!robotId) throw new StepError('missing_robot');
  const inputs: Record<string, unknown> = {};
  for (const f of Array.isArray(cfg.inputs) ? (cfg.inputs as Array<{ key?: string; value?: unknown }>) : []) {
    const k = String(f?.key ?? '').trim();
    if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') inputs[k] = renderValue(f?.value ?? '', tctx);
  }
  const { startRobotRun } = await import('./robots');
  // Si hay otra corrida del workspace, espera su turno en la cola (no falla como busy).
  const waitMs = robotWaitMs();
  await getDb()
    .prepare('UPDATE flow_runs SET locked_until = ? WHERE id = ?')
    .run(new Date(Date.now() + waitMs + 10 * 60_000).toISOString(), state.run.id);
  const res = await startRobotRun(ws, robotId, inputs, { trigger: 'flow', waitMs, pollMs: robotPollMs() });
  if (!res.ok) {
    // Cola llena, sin turno a tiempo o rate limit: reintentable con los reintentos del nodo.
    throw new StepError(`robot_${res.error}`, res.error === 'busy' || res.error === 'rate_limited');
  }
  const output = {
    runId: res.run.id,
    status: res.run.status,
    error: res.run.error,
    warnings: res.run.warnings,
    output: res.run.output,
    durationMs: res.run.durationMs,
    screenshots: res.run.screenshots.filter((s) => s.url && !s.url.startsWith('data:')).map((s) => ({ name: s.name, url: s.url })),
  };
  if (res.run.status === 'failed' && cfg.failOnError !== false) throw new StepError('robot_failed', false, output);
  return output;
}

// ---------- Responder al webhook ----------

const REPLY_TYPES: Record<string, string> = {
  json: 'application/json; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
};
/** Headers que no puede fijar la respuesta (los maneja el servidor o tocan la sesión). */
const REPLY_BLOCKED_HEADERS = /^(content-type|content-length|transfer-encoding|connection|keep-alive|set-cookie|content-security-policy|x-content-type-options|access-control-allow-credentials|strict-transport-security)$/i;

/**
 * Respuesta del nodo "Responder al webhook": status, tipo, headers y cuerpo.
 * El route del webhook la devuelve si el trigger espera este nodo
 * (respond = reply_node); en cualquier otro caso es solo la salida del paso.
 */
export function webhookReplyOutput(cfg: Record<string, unknown>, tctx: Record<string, unknown>): WebhookReply {
  const status = Math.floor(Number(cfg.statusCode ?? 200));
  if (!Number.isFinite(status) || status < 200 || status > 599) throw new StepError('invalid_status');
  const kind = typeof cfg.contentType === 'string' && REPLY_TYPES[cfg.contentType] ? cfg.contentType : 'json';
  const body = renderString(cfg.body ?? '', tctx);
  if (body.length > WEBHOOK_REPLY_LIMIT) throw new StepError('reply_too_large');
  if (kind === 'json' && body.trim()) {
    try {
      JSON.parse(body);
    } catch {
      throw new StepError('invalid_json');
    }
  }
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(cfg.headers) ? (cfg.headers as Array<{ key?: string; value?: string }>) : []) {
    const k = String(h?.key ?? '').trim().toLowerCase();
    if (!k || !/^[a-z0-9-]+$/.test(k) || REPLY_BLOCKED_HEADERS.test(k) || Object.keys(headers).length >= 20) continue;
    headers[k] = renderString(h?.value ?? '', tctx).replace(/[\r\n]/g, ' ').slice(0, 1000);
  }
  return { status, contentType: REPLY_TYPES[kind], headers, body };
}

// ---------- Agente, código, merge, sub-flow ----------

/** El agente trabaja en Docs con el acceso de quien creó el flow (nunca con el de quien configuró el agente). */
async function agentNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>, createdBy: string | null) {
  const agentId = renderString(cfg.agentId ?? '', tctx).trim();
  if (!agentId) throw new StepError('missing_agent');
  const message = renderString(cfg.message ?? '', tctx).trim();
  if (!message) throw new StepError('missing_message');
  const { getAgentRow, sendAgentMessage, AgentError } = await import('./agents');
  const agent = await getAgentRow(ws, agentId);
  if (!agent) throw new StepError('agent_not_found');
  const conversationId = renderString(cfg.conversationId ?? '', tctx).trim() || null;
  try {
    const res = await sendAgentMessage({ agent, channel: 'api', source: 'flow', text: message.slice(0, 4000), conversationId, createdBy });
    return {
      reply: res.result.text,
      status: res.result.status,
      handoff: res.result.handoff,
      conversationId: res.conversation.id,
      tools: res.result.toolCalls.map((c) => c.tool),
    };
  } catch (err) {
    if (err instanceof AgentError) throw new StepError(err.message, err.message === 'rate_limited');
    if (err instanceof AiError) throw new StepError(err.code, err.code === 'rate_limited');
    throw new StepError('ai_error', true);
  }
}

/** Tope de ejecuciones del nodo Código (env; 'unlimited' lo apaga). */
function codeLimit(name: string, fallback: number): number | null {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === 'unlimited') return null;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Ejecuciones del nodo Código por workspace: por hora y por día (UTC). Cada
 * una es una microVM de Vercel Sandbox; sin tope, un Loop dentro de un flow
 * con webhook crearía VMs sin límite.
 */
async function allowFlowCode(workspaceId: string): Promise<boolean> {
  const perHour = codeLimit('FLOW_CODE_RUNS_PER_HOUR', 300);
  const perDay = codeLimit('FLOW_CODE_RUNS_PER_DAY', 2000);
  if (perHour !== null && !(await rateLimit(`flow-code-hour:${workspaceId}`, perHour, 3600)).ok) return false;
  if (perDay !== null && !(await rateLimit(`flow-code-day:${workspaceId}`, perDay, 86_400)).ok) return false;
  return true;
}

async function codeNode(state: RunState, cfg: Record<string, unknown>) {
  const code = String(cfg.code ?? '');
  if (!code.trim()) throw new StepError('missing_code');
  if (code.length > 50_000) throw new StepError('code_too_long');
  const timeoutSec = Math.min(Math.max(Math.floor(Number(cfg.timeoutSec) || 10), 1), CODE_MAX_TIMEOUT_SEC);
  // Cada ejecución levanta una microVM (costo de la plataforma): tope por workspace.
  if (!(await allowFlowCode(state.flow.user_id))) throw new StepError('code_rate_limited', true);
  // Lo que ve el código: trigger y salidas previas (ya redactadas), sin truncar.
  const all = { trigger: state.ctx.trigger, nodes: state.ctx.nodes, flow: { id: state.flow.id, name: state.flow.name } };
  const input = state.secrets.length ? redact(all, state.secrets) : all;
  const res = await runFlowCode({ code, input, timeoutMs: timeoutSec * 1000 });
  if (!res.ok) throw new StepError(res.error, false, res.logs ? { logs: res.logs } : undefined);
  return { result: res.result, logs: res.logs || undefined };
}

const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max', 'collect', 'unique', 'join'] as const;

/** Merge: une valores en un objeto. Aggregate: resume una lista (suma, promedio…). */
export function mergeAggregate(cfg: Record<string, unknown>, tctx: Record<string, unknown>): unknown {
  if (cfg.mode === 'aggregate') {
    const raw = renderValue(cfg.items ?? '', tctx);
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' && raw.trim().startsWith('[')
        ? parseJson<unknown[]>(raw, [])
        : [];
    const items = list.slice(0, 10_000);
    const field = String(cfg.field ?? '').trim();
    const values = field ? items.map((v) => renderValue(`{{x.${field}}}`, { x: v })) : items;
    const nums = values.map((v) => (v === '' || v === null ? NaN : Number(v))).filter((n) => Number.isFinite(n));
    const op = (AGG_OPS as readonly string[]).includes(String(cfg.operation)) ? String(cfg.operation) : 'collect';
    let value: unknown;
    switch (op) {
      case 'count':
        value = values.filter((v) => v !== undefined && v !== null && v !== '').length;
        break;
      case 'sum':
        value = nums.reduce((a, b) => a + b, 0);
        break;
      case 'avg':
        value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        break;
      case 'min':
        value = nums.length ? Math.min(...nums) : null;
        break;
      case 'max':
        value = nums.length ? Math.max(...nums) : null;
        break;
      case 'unique':
        value = [...new Map(values.map((v) => [stringify(v), v])).values()];
        break;
      case 'join':
        value = values.map(stringify).join(', ');
        break;
      default:
        value = values;
    }
    return { operation: op, field: field || null, count: items.length, value };
  }
  const out: Record<string, unknown> = {};
  for (const f of Array.isArray(cfg.fields) ? (cfg.fields as Array<{ key?: string; value?: unknown }>) : []) {
    const k = String(f?.key ?? '').trim();
    if (!k || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const v = renderValue(f?.value ?? '', tctx);
    // Clave '...': copia las propiedades del objeto (une salidas de varios nodos).
    if (k === '...' && v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

async function subflowNode(state: RunState, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const flowId = renderString(cfg.flowId ?? '', tctx).trim();
  if (!flowId) throw new StepError('missing_flow');
  const parent = flowChain.getStore();
  const seen = [...new Set([...(parent?.seen ?? []), state.flow.id])];
  if (seen.includes(flowId)) throw new StepError('subflow_recursion');
  const depth = (parent?.depth ?? state.run.chain_depth) + 1;
  if (depth > MAX_FLOW_CHAIN_DEPTH) throw new StepError('subflow_depth');
  const row = (await getDb()
    .prepare('SELECT id, user_id, created_by FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(flowId, state.flow.user_id)) as Pick<FlowFlowRow, 'id' | 'user_id' | 'created_by'> | undefined;
  if (!row) throw new StepError('flow_not_found');
  // El subflow corre con el acceso de quien lo creó y devuelve sus salidas: solo flows de la misma persona.
  if (!row.created_by || row.created_by !== state.flow.created_by) throw new StepError('subflow_other_owner');
  const input: Record<string, unknown> = {};
  for (const f of Array.isArray(cfg.inputs) ? (cfg.inputs as Array<{ key?: string; value?: unknown }>) : []) {
    const k = String(f?.key ?? '').trim();
    if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') input[k] = renderValue(f?.value ?? '', tctx);
  }
  const runId = await enqueueRun(row, 'subflow', input, {
    status: 'running',
    lockMs: 5 * 60_000,
    chain: { depth, seen },
    parentRunId: state.run.id,
  });
  if (!runId) throw new StepError('rate_limited', true);
  let status = await executeRun(runId);
  if (status === 'waiting') {
    // El paso espera al otro flow en la misma ejecución: no puede quedar en espera
    // (Esperar o reintentos). Se cancela para que no siga solo más tarde.
    await getDb().prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(runId);
    await getDb()
      .prepare("UPDATE flow_runs SET status = 'failed', error = 'subflow_waiting', finished_at = ?, locked_until = NULL WHERE id = ?")
      .run(nowIso(), runId);
    status = 'failed';
  }
  const sub = (await getDb().prepare('SELECT error, context FROM flow_runs WHERE id = ?').get(runId)) as
    | { error: string | null; context: string }
    | undefined;
  const nodes = parseJson<{ nodes?: Record<string, { output: unknown }> }>(sub?.context, {}).nodes ?? {};
  const outputs: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(nodes)) outputs[id] = v?.output ?? null;
  const output = { runId, status, error: sub?.error ?? null, outputs };
  if (status === 'failed' && cfg.failOnError !== false) {
    throw new StepError(output.error === 'subflow_waiting' ? 'subflow_waiting' : 'subflow_failed', false, output);
  }
  return output;
}

// ---------- Esperar, Aprobación y Tabla de datos ----------

const UNIT_MS: Record<string, number> = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
/** Tope de un Esperar por tiempo o hasta una llamada. */
const MAX_DELAY_MS = 30 * 86_400_000;
/** Tope de un Esperar hasta una fecha. */
export const MAX_WAIT_UNTIL_MS = 365 * 86_400_000;

/**
 * Fecha de "Esperar hasta": ISO con zona (2026-03-01T09:00:00Z, …-03:00),
 * fecha u hora local sin zona (2026-03-01, 2026-03-01 09:00) en `timezone`,
 * o un epoch (segundos o milisegundos). null si no se entiende.
 */
export function parseWaitUntil(raw: string, timezone = 'UTC'): Date | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{9,13}$/.test(v)) {
    const n = Number(v);
    return new Date(v.length <= 10 ? n * 1000 : n);
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (local) {
    const tz = timezone && isValidTimezone(timezone) ? timezone : 'UTC';
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = local;
    const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
    if (!Number.isFinite(utc)) return null;
    // Offset de la zona en ese momento (se corrige una vez por cambio de horario).
    let at = utc - tzOffsetMinutes(tz, new Date(utc)) * 60_000;
    at = utc - tzOffsetMinutes(tz, new Date(at)) * 60_000;
    return new Date(at);
  }
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function timeoutMs(cfg: Record<string, unknown>, fallbackAmount: number, fallbackUnit: string): number {
  const amount = Number(cfg.timeoutAmount);
  const unit = UNIT_MS[String(cfg.timeoutUnit ?? fallbackUnit)] ?? UNIT_MS[fallbackUnit];
  const ms = (Number.isFinite(amount) && amount > 0 ? amount : fallbackAmount) * unit;
  return Math.min(Math.max(ms, 60_000), MAX_DELAY_MS);
}

/**
 * Esperar: un tiempo fijo (duration), hasta una fecha (until; si ya pasó,
 * sigue sin esperar) o hasta una llamada a {{run.resumeUrl}} (resume, con
 * tiempo límite). Las tres dejan un flow_jobs y la corrida en 'waiting'.
 */
async function delayNode(state: RunState, node: FlowNode, cfg: Record<string, unknown>, tctx: Record<string, unknown>): Promise<NodeResult> {
  const mode = cfg.mode === 'until' || cfg.mode === 'resume' ? cfg.mode : 'duration';
  if (mode === 'until') {
    const raw = renderString(cfg.until ?? '', tctx);
    const at = parseWaitUntil(raw, String(cfg.timezone ?? 'UTC').trim() || 'UTC');
    if (!at) throw new StepError('invalid_date');
    const ms = at.getTime() - Date.now();
    if (ms > MAX_WAIT_UNTIL_MS) throw new StepError('wait_too_long');
    if (ms <= 0) return { kind: 'ok', output: { mode, resumeAt: at.toISOString(), waited: false }, handles: ['out'] };
    await scheduleJob(state.run.id, node.id, at.toISOString(), { kind: 'continue' });
    return { kind: 'wait', output: { mode, resumeAt: at.toISOString() } };
  }
  if (mode === 'resume') {
    const expiresAt = new Date(Date.now() + timeoutMs(cfg, 7, 'days')).toISOString();
    await scheduleJob(state.run.id, node.id, expiresAt, { kind: RESUME_TIMEOUT });
    return { kind: 'wait', output: { mode, resumeUrl: resumeUrl(state.run.id), expiresAt } };
  }
  const amount = Math.max(0, Number(cfg.amount) || 0);
  const ms = Math.min(amount * (UNIT_MS[String(cfg.unit)] ?? 60_000), MAX_DELAY_MS);
  const runAt = new Date(Date.now() + ms).toISOString();
  await scheduleJob(state.run.id, node.id, runAt, { kind: 'continue' });
  return { kind: 'wait', output: { resumeAt: runAt } };
}

/** Emails del campo "Para" de una aprobación (coma, punto y coma o espacios). */
export function approvalRecipients(raw: string): string[] {
  const list = raw
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(list)];
}

/**
 * Aprobación: manda el pedido por email (links firmados a la página de
 * aprobación) y, si tiene credencial de Slack, también a Slack con dos
 * botones. Deja el tiempo límite agendado y la corrida espera la decisión
 * (salidas approved / rejected, ver finishExternalWait).
 */
async function approvalNode(
  state: RunState,
  node: FlowNode,
  cfg: Record<string, unknown>,
  tctx: Record<string, unknown>,
  loop?: LoopScope,
): Promise<Record<string, unknown>> {
  const ws = state.flow.user_id;
  const to = approvalRecipients(renderString(cfg.to ?? '', tctx));
  const slackCred = String(cfg.slackCredentialId ?? '').trim();
  if (to.some((e) => !EMAIL_RE.test(e)) || to.length > MAX_APPROVERS) throw new StepError('invalid_email');
  if (to.length === 0 && !slackCred) throw new StepError('missing_recipient');
  const subject = renderString(cfg.subject ?? '', tctx).trim().slice(0, 300);
  const message = renderString(cfg.message ?? '', tctx).slice(0, 10_000);
  const expiresAt = new Date(Date.now() + timeoutMs(cfg, 3, 'days')).toISOString();
  const { locale } = await getFlowSettings(ws);
  const approveUrl = approvalUrl(locale, state.run.id, node.id, 'approve');
  const rejectUrl = approvalUrl(locale, state.run.id, node.id, 'reject');
  const sent: string[] = [];
  if (to.length) {
    const mail = buildApprovalEmail({ locale, flowName: state.flow.name, subject, message, approveUrl, rejectUrl, expiresAt });
    for (const addr of to) {
      if (!(await allowFlowEmail(ws))) throw new StepError('email_quota');
      const res = await sendEmail({ to: addr, subject: mail.subject, text: mail.text, html: mail.html });
      if (res.ok) sent.push(addr);
    }
    if (sent.length === 0) throw new StepError('send_failed', true);
  }
  let slack: unknown = null;
  if (slackCred) {
    const s = approvalStrings(locale);
    slack = await slackApprovalMessage(integrationCtx(state, node, loop), {
      credentialId: slackCred,
      channel: renderString(cfg.slackChannel ?? '', tctx).trim(),
      text: [subject || state.flow.name, message.trim()].filter(Boolean).join('\n\n'),
      approveUrl,
      rejectUrl,
      approveLabel: s.approve,
      rejectLabel: s.reject,
    });
  }
  await scheduleJob(state.run.id, node.id, expiresAt, { kind: APPROVAL_TIMEOUT });
  return { status: 'pending', to: sent, slack, subject, message, expiresAt };
}

/** Tabla de datos: buscar, insertar, insertar o actualizar (upsert) y borrar filas. */
async function tableNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const tableId = renderString(cfg.tableId ?? '', tctx).trim();
  if (!tableId) throw new StepError('missing_table');
  const op = String(cfg.operation ?? 'find');
  const column = String(cfg.column ?? '').trim();
  const value = renderValue(cfg.value ?? '', tctx);
  const values: Record<string, unknown> = {};
  for (const f of Array.isArray(cfg.values) ? (cfg.values as Array<{ key?: string; value?: unknown }>) : []) {
    const k = String(f?.key ?? '').trim();
    if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') values[k] = renderValue(f?.value ?? '', tctx);
  }
  const t = await import('./flow-tables');
  try {
    switch (op) {
      case 'insert':
        return { row: await t.insertTableRow(ws, tableId, values) };
      case 'upsert': {
        if (!column) throw new StepError('missing_column');
        return await t.upsertTableRow(ws, tableId, { column, value }, values);
      }
      case 'delete': {
        if (!column) throw new StepError('missing_column');
        return { deleted: await t.deleteTableRowsWhere(ws, tableId, { column, value }) };
      }
      default: {
        const rows = await t.findTableRows(ws, tableId, column ? { column, value } : {}, Number(cfg.limit) || 1);
        return { found: rows.length > 0, count: rows.length, row: rows[0] ?? null, rows };
      }
    }
  } catch (err) {
    if (err instanceof t.TableError) {
      throw new StepError(err.code === 'not_found' ? 'table_not_found' : err.code.startsWith('table_') ? err.code : `table_${err.code}`, false, err.column ? { column: err.column } : undefined);
    }
    throw err;
  }
}

async function runNodeLogic(state: RunState, node: FlowNode, loop?: LoopScope): Promise<NodeResult> {
  const cfg = node.config ?? {};
  const tctx = templateCtx(state, loop);
  const ws = state.flow.user_id;
  if (readsTruncated(state, node)) throw new StepError('context_truncated');
  switch (node.type) {
    case 'logic.if': {
      const pass = evalConditions(cfg.conditions as Condition[], cfg.combine as 'all' | 'any', tctx);
      return { kind: 'ok', output: { result: pass }, handles: [pass ? 'true' : 'false'] };
    }
    case 'logic.filter': {
      const pass = evalConditions(cfg.conditions as Condition[], cfg.combine as 'all' | 'any', tctx);
      return pass ? { kind: 'ok', output: { passed: true }, handles: ['out'] } : { kind: 'stop', output: { passed: false } };
    }
    case 'logic.switch': {
      const value = str(renderValue(cfg.value ?? '', tctx));
      const cases = Array.isArray(cfg.cases) ? (cfg.cases as unknown[]).map((c) => str(renderValue(c, tctx))) : [];
      const i = cases.findIndex((c) => c === value);
      return { kind: 'ok', output: { value, matched: i >= 0 ? cases[i] : null }, handles: [i >= 0 ? `case-${i}` : 'default'] };
    }
    case 'logic.delay':
      return delayNode(state, node, cfg, tctx);
    case 'logic.approval':
      return { kind: 'wait', output: await approvalNode(state, node, cfg, tctx, loop) };
    case 'data.table':
      return { kind: 'ok', output: await tableNode(ws, cfg, tctx), handles: ['out'] };
    case 'data.set': {
      const out: Record<string, unknown> = {};
      for (const f of Array.isArray(cfg.fields) ? (cfg.fields as Array<{ key?: string; value?: unknown }>) : []) {
        const k = String(f?.key ?? '').trim();
        if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = renderValue(f?.value ?? '', tctx);
      }
      return { kind: 'ok', output: out, handles: ['out'] };
    }
    case 'data.json_parse': {
      const raw = renderValue(cfg.text ?? '', tctx);
      if (raw && typeof raw === 'object') return { kind: 'ok', output: raw, handles: ['out'] };
      try {
        return { kind: 'ok', output: JSON.parse(String(raw ?? '')), handles: ['out'] };
      } catch {
        throw new StepError('invalid_json');
      }
    }
    case 'action.http':
      return { kind: 'ok', output: await httpNode(state, cfg, tctx), handles: ['out'] };
    case 'action.email': {
      const to = renderString(cfg.to ?? '', tctx).trim();
      if (!EMAIL_RE.test(to)) throw new StepError('missing_recipient');
      const subject = renderString(cfg.subject ?? '', tctx).slice(0, 300) || state.flow.name;
      const text = renderString(cfg.body ?? '', tctx);
      if (!(await allowFlowEmail(ws))) throw new StepError('email_quota');
      const res = await sendEmail({ to, subject, text });
      if (!res.ok) throw new StepError(res.error ?? 'send_failed', true);
      return { kind: 'ok', output: { sent: true, to, subject, provider: res.provider ?? null }, handles: ['out'] };
    }
    case 'app.crm_contact':
      return { kind: 'ok', output: await crmContactNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.crm_sequence':
      return { kind: 'ok', output: await crmSequenceNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.crm_deals':
      return { kind: 'ok', output: await crmDealsNode(ws, cfg), handles: ['out'] };
    case 'app.track_issue':
      return { kind: 'ok', output: await trackIssueNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.track_update':
      return { kind: 'ok', output: await trackUpdateNode(ws, state.flow.created_by ?? ws, cfg, tctx), handles: ['out'] };
    case 'app.crm_update':
      return { kind: 'ok', output: await crmUpdateNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.crm_task':
      return { kind: 'ok', output: await crmTaskNode(ws, cfg, tctx), handles: ['out'] };
    case 'action.webhook_reply':
      return { kind: 'ok', output: webhookReplyOutput(cfg, tctx), handles: ['out'] };
    case 'app.link':
      return { kind: 'ok', output: await linkNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.chat_message':
      return { kind: 'ok', output: await chatMessageNode(ws, cfg, tctx), handles: ['out'] };
    // Docs escribe con los permisos de quien creó el flow; sin esa persona no corre (nunca como el dueño).
    case 'app.docs_page':
      if (!state.flow.created_by) throw new StepError('no_flow_owner');
      return { kind: 'ok', output: await docsPageFlowNode(ws, state.flow.created_by, cfg, tctx), handles: ['out'] };
    case 'app.docs_row':
      if (!state.flow.created_by) throw new StepError('no_flow_owner');
      return { kind: 'ok', output: await docsRowFlowNode(ws, state.flow.created_by, cfg, tctx), handles: ['out'] };
    case 'app.groups_message':
      return { kind: 'ok', output: await groupsMessageNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.talk_message':
      return { kind: 'ok', output: await talkMessageNode(ws, state.flow.created_by ?? ws, cfg, tctx), handles: ['out'] };
    case 'app.robot_run':
      return { kind: 'ok', output: await robotNode(state, cfg, tctx), handles: ['out'] };
    case 'ai.text':
      return { kind: 'ok', output: await aiNode(ws, cfg, tctx), handles: ['out'] };
    case 'ai.extract':
      return {
        kind: 'ok',
        output: await aiExtractNode(ws, {
          mode: String(cfg.mode ?? 'extract'),
          text: renderString(cfg.text ?? '', tctx),
          fields: cfg.fields,
          categories: cfg.categories,
          instructions: renderString(cfg.instructions ?? '', tctx).trim(),
        }),
        handles: ['out'],
      };
    // Las notas del canvas no se conectan: nunca llegan acá (por si acaso, no hacen nada).
    case 'note.sticky':
      return { kind: 'stop', output: null };
    case 'ai.agent':
      return { kind: 'ok', output: await agentNode(ws, cfg, tctx, state.flow.created_by ?? null), handles: ['out'] };
    case 'data.code':
      return { kind: 'ok', output: await codeNode(state, cfg), handles: ['out'] };
    case 'data.merge':
      return { kind: 'ok', output: mergeAggregate(cfg, tctx), handles: ['out'] };
    case 'logic.run_flow':
      return { kind: 'ok', output: await subflowNode(state, cfg, tctx), handles: ['out'] };
    case 'app.slack':
      return { kind: 'ok', output: await slackNode(integrationCtx(state, node, loop), rendered(cfg, tctx)), handles: ['out'] };
    case 'app.google_sheets':
      return { kind: 'ok', output: await googleSheetsNode(integrationCtx(state, node, loop), rendered(cfg, tctx)), handles: ['out'] };
    case 'app.gmail':
      return {
        kind: 'ok',
        output: await gmailNode(integrationCtx(state, node, loop), rendered(cfg, tctx), state.flow.name),
        handles: ['out'],
      };
    case 'app.stripe':
      return { kind: 'ok', output: await stripeNode(integrationCtx(state, node, loop), rendered(cfg, tctx)), handles: ['out'] };
    case 'app.notion':
      return { kind: 'ok', output: await notionNode(integrationCtx(state, node, loop), rendered(cfg, tctx)), handles: ['out'] };
    case 'app.discord':
      return { kind: 'ok', output: await discordNode(integrationCtx(state, node, loop), rendered(cfg, tctx)), handles: ['out'] };
    case 'app.telegram':
      return { kind: 'ok', output: await telegramNode(integrationCtx(state, node, loop), rendered(cfg, tctx)), handles: ['out'] };
    default:
      throw new StepError('unsupported_node');
  }
}

function flowEmailsPerDay(): number {
  const n = Number(process.env.FLOW_EMAILS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/**
 * Cuota diaria de emails del nodo Email por workspace: salen desde el remitente
 * de la plataforma, así que un flow (o un Loop) no puede mandar volumen ilimitado.
 */
async function allowFlowEmail(workspaceId: string): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
  const res = await rateLimit(`flow-email:${workspaceId}`, flowEmailsPerDay(), 86_400);
  return res.ok;
}

/** Config con las plantillas resueltas (nodos de integraciones). */
function rendered(cfg: Record<string, unknown>, tctx: Record<string, unknown>): Record<string, unknown> {
  return renderDeep(cfg, tctx) as Record<string, unknown>;
}

/** Config renderizada (para mostrar el input de cada paso). El código se muestra tal cual. */
function renderedInput(state: RunState, node: FlowNode, loop?: LoopScope): unknown {
  if (isTriggerType(node.type)) return null;
  if (node.type === 'data.code') return store(state, { code: node.config?.code ?? '', timeoutSec: node.config?.timeoutSec ?? 10 });
  try {
    return store(state, renderDeep(node.config ?? {}, templateCtx(state, loop)));
  } catch {
    return null;
  }
}

// ---------- Persistencia ----------

async function scheduleJob(runId: string, nodeId: string, runAt: string, payload: Record<string, unknown>) {
  await getDb()
    .prepare('INSERT INTO flow_jobs (id, run_id, node_id, run_at, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), runId, nodeId, runAt, JSON.stringify(payload), nowIso());
}

async function startStep(runId: string, node: FlowNode, input: unknown): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      "INSERT INTO flow_steps (id, run_id, node_id, node_type, status, input, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
    )
    .run(id, runId, node.id, node.type, JSON.stringify(input ?? null), nowIso());
  return id;
}

async function finishStep(
  state: RunState,
  stepId: string,
  status: 'success' | 'failed' | 'skipped' | 'waiting',
  output: unknown,
  error: string | null,
) {
  const db = getDb();
  // El input se guardó al empezar: si el nodo resolvió credenciales, se redacta otra vez.
  if (state.secrets.length) {
    const row = (await db.prepare('SELECT input FROM flow_steps WHERE id = ?').get(stepId)) as { input: string | null } | undefined;
    if (row?.input) await db.prepare('UPDATE flow_steps SET input = ? WHERE id = ?').run(clean(state, row.input), stepId);
  }
  await db
    .prepare('UPDATE flow_steps SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?')
    .run(status, JSON.stringify(store(state, output)), error === null ? null : clean(state, error), nowIso(), stepId);
}

// ---------- Recorrido ----------

async function runChildren(state: RunState, nodeId: string, handle: string, loop?: LoopScope): Promise<void> {
  const edges = state.ctx.graph.edges.filter((e) => e.source === nodeId && edgeHandle(e) === handle);
  for (const e of edges) {
    if (state.error) return;
    await runNode(state, e.target, loop);
  }
}

/**
 * Merge espera a todas sus entradas: corre una sola vez, cuando ya corrieron
 * todos los nodos conectados a él (los que llegan antes no lo ejecutan).
 */
function mergeReady(state: RunState, node: FlowNode, loop?: LoopScope): boolean {
  const merged = loop ? loop.merged : state.merged;
  if (merged.has(node.id)) return false;
  const sources = [...new Set(state.ctx.graph.edges.filter((e) => e.target === node.id).map((e) => e.source))];
  // Dentro de un Loop, las fuentes del cuerpo (y el propio Loop) tienen que haber
  // corrido en esta iteración: la salida de la iteración anterior no cuenta.
  const done = (id: string) =>
    loop && (id === loop.loopId || loop.body.has(id))
      ? loop.ran.has(id)
      : state.ctx.nodes[id] !== undefined && !state.pending.has(id);
  if (!sources.every(done)) return false;
  merged.add(node.id);
  return true;
}

/** Salida con la que sigue un nodo con onError = continue. */
function continueHandle(node: FlowNode): string | null {
  const outs = nodeOutputs(node).filter((h) => h !== 'error');
  if (outs.includes('out')) return 'out';
  if (node.type === 'logic.if') return 'false';
  if (node.type === 'logic.switch') return 'default';
  return outs[0] ?? null;
}

async function runNode(state: RunState, nodeId: string, loop?: LoopScope, attempt = 0): Promise<void> {
  if (state.error) return;
  const node = state.ctx.graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    state.error = 'node_missing';
    return;
  }
  if (node.type === 'data.merge' && attempt === 0 && !mergeReady(state, node, loop)) return;
  if (attempt > 0) state.pending.delete(node.id);
  state.steps += 1;
  if (state.steps > (state.ctx.stepLimit ?? MAX_STEPS)) {
    state.error = 'step_limit';
    return;
  }

  if (node.type === 'logic.loop') {
    await runLoop(state, node, loop);
    return;
  }

  const stepId = await startStep(state.run.id, node, renderedInput(state, node, loop));
  let result: NodeResult;
  let errorOutput: unknown = null;
  try {
    result = await runNodeLogic(state, node, loop);
  } catch (err) {
    const e = err instanceof StepError ? err : new StepError(err instanceof Error ? err.message.slice(0, 200) : 'error');
    result = { kind: 'error', error: e.code, retryable: e.retryable };
    if (e.output !== undefined && e.output !== null) errorOutput = keep(state, e.output);
  }
  loop?.ran.add(node.id);

  if (result.kind === 'error') {
    const retries = Math.min(Math.max(Math.floor(Number(node.config?.retries) || 0), 0), MAX_RETRIES);
    if (result.retryable && loop && attempt < Math.min(retries, LOOP_MAX_RETRIES)) {
      const delayMs = LOOP_RETRY_BASE_MS * 2 ** attempt;
      if (state.loopRetryMs + delayMs <= LOOP_RETRY_BUDGET_MS) {
        state.loopRetryMs += delayMs;
        await finishStep(state, stepId, 'failed', errorOutput, `${result.error} (retry ${attempt + 1}/${retries})`);
        delete state.ctx.nodes[node.id];
        loop.ran.delete(node.id);
        // El reintento suma un paso que el Loop no reservó.
        state.ctx.stepLimit = Math.min((state.ctx.stepLimit ?? MAX_STEPS) + 1, MAX_STEPS_TOTAL);
        await new Promise((r) => setTimeout(r, delayMs));
        await runNode(state, node.id, loop, attempt + 1);
        return;
      }
    }
    if (result.retryable && attempt < retries && !loop) {
      const delayMs = Math.min(15_000 * 2 ** attempt, 3_600_000);
      await scheduleJob(state.run.id, node.id, new Date(Date.now() + delayMs).toISOString(), {
        kind: 'retry',
        attempt: attempt + 1,
      });
      // La salida del intento fallido queda solo en el paso: en el contexto el
      // nodo sigue pendiente, así un Merge no corre con datos de error.
      delete state.ctx.nodes[node.id];
      state.pending.add(node.id);
      await finishStep(state, stepId, 'failed', errorOutput, `${result.error} (retry ${attempt + 1}/${retries})`);
      return;
    }
    if (errorOutput !== null) state.ctx.nodes[node.id] = { output: errorOutput };
    const details = errorOutput;
    await finishStep(state, stepId, 'failed', details, result.error);
    const mode = supportsErrorHandling(node.type) ? onErrorMode(node.config) : 'stop';
    if (mode === 'stop') {
      state.error = `${node.id}: ${clean(state, result.error)}`;
      state.failedNode = node.id;
      return;
    }
    // continue / branch: la salida del nodo describe el error.
    const extra = details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : details !== null ? { details } : {};
    state.ctx.nodes[node.id] = { output: keep(state, { ...extra, error: result.error, failed: true }) };
    const handle = mode === 'branch' ? 'error' : continueHandle(node);
    if (handle) await runChildren(state, node.id, handle, loop);
    return;
  }

  state.ctx.nodes[node.id] = { output: keep(state, result.output) };
  if (result.kind === 'stop') {
    await finishStep(state, stepId, 'skipped', result.output, null);
    return;
  }
  if (result.kind === 'wait') {
    state.pending.add(node.id);
    await finishStep(state, stepId, 'waiting', result.output, null);
    return;
  }
  await finishStep(state, stepId, 'success', result.output, null);
  for (const h of result.handles) await runChildren(state, node.id, h, loop);
}

async function runLoop(state: RunState, node: FlowNode, outer?: LoopScope): Promise<void> {
  const cfg = node.config ?? {};
  const stepId = await startStep(state.run.id, node, renderedInput(state, node, outer));
  if (readsTruncated(state, node)) {
    await finishStep(state, stepId, 'failed', null, 'context_truncated');
    state.error = `${node.id}: context_truncated`;
    state.failedNode = node.id;
    return;
  }
  const raw = renderValue(cfg.items ?? '', templateCtx(state, outer));
  let items: unknown[];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string' && raw.trim().startsWith('[')) items = parseJson<unknown[]>(raw, []);
  else if (raw === undefined || raw === null || raw === '') items = [];
  else items = [raw];
  const max = Math.min(Math.max(Math.floor(Number(cfg.max) || 50), 1), MAX_LOOP_ITEMS);
  const capped = items.slice(0, max);
  const body = reachableFrom(state.ctx.graph, node.id, 'item');
  // Reserva los pasos del cuerpo antes de empezar: si no entran, no corre ningún ítem.
  const limit = (state.ctx.stepLimit ?? MAX_STEPS) + capped.length * body.size;
  if (limit > MAX_STEPS_TOTAL) {
    await finishStep(state, stepId, 'failed', null, 'step_limit');
    state.error = 'step_limit';
    state.failedNode = node.id;
    return;
  }
  state.ctx.stepLimit = limit;
  for (let i = 0; i < capped.length; i++) {
    if (state.error) break;
    await runChildren(state, node.id, 'item', {
      item: capped[i],
      index: i,
      loopId: node.id,
      body,
      ran: new Set([node.id]),
      merged: new Set(),
    });
  }
  const output = { count: capped.length, total: items.length, items: capped };
  state.ctx.nodes[node.id] = { output: keep(state, output) };
  outer?.ran.add(node.id);
  if (state.error) {
    await finishStep(state, stepId, 'failed', output, 'loop_body_failed');
    return;
  }
  await finishStep(state, stepId, 'success', output, null);
  await runChildren(state, node.id, 'done', outer);
}

// ---------- Corridas ----------

/** Corrida fallida + flow de error configurado: se encola ese flow con los detalles. */
async function enqueueErrorFlow(state: RunState): Promise<void> {
  const target = state.flow.error_flow_id;
  if (!target || target === state.flow.id || state.run.trigger_type === 'error') return;
  const seen = [...new Set([...parseJson<string[]>(state.run.chain_seen, []), state.flow.id])];
  const depth = state.run.chain_depth + 1;
  if (depth > MAX_FLOW_CHAIN_DEPTH || seen.includes(target)) return;
  const row = (await getDb()
    .prepare('SELECT id, user_id, created_by FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(target, state.flow.user_id)) as Pick<FlowFlowRow, 'id' | 'user_id' | 'created_by'> | undefined;
  // Los detalles traen datos de esta corrida: solo a un flow de la misma persona.
  if (!row || !row.created_by || row.created_by !== state.flow.created_by) return;
  const failed = state.failedNode ? state.ctx.graph.nodes.find((n) => n.id === state.failedNode) : null;
  // flow, run y failedNode van completos (son chicos; la salida del nodo ya
  // viene acotada): solo el trigger se acota aparte. Truncar el objeto entero
  // dejaba {{trigger.run.error}} vacío cuando el trigger era grande.
  const details = {
    flow: { id: state.flow.id, name: state.flow.name },
    run: { id: state.run.id, error: state.error, triggerType: state.run.trigger_type, startedAt: state.run.started_at },
    failedNode: failed ? { id: failed.id, type: failed.type, output: store(state, state.ctx.nodes[failed.id]?.output ?? null) } : null,
    trigger: forStore(state.ctx.trigger, CONTEXT_LIMIT),
  };
  const input = state.secrets.length ? redact(details, state.secrets) : details;
  const id = await enqueueRun(row, 'error', input, { chain: { depth, seen }, parentRunId: state.run.id });
  if (id) kickFlowWorker();
}

/** Corrida fallida: agenda el replay automático (si el flow lo tiene) y avisa al dueño por email. */
async function afterFailure(state: RunState): Promise<void> {
  const { notifyRunFailure, scheduleAutoReplay } = await import('./flow-alerts');
  const error = state.error === null ? null : clean(state, state.error);
  const replayAt = await scheduleAutoReplay(state.flow, state.run, error);
  await notifyRunFailure({ flow: state.flow, run: state.run, error, failedNode: state.failedNode, replayAt });
}

async function finalize(state: RunState): Promise<FlowRunRow['status']> {
  const db = getDb();
  const pending = (await db.prepare('SELECT COUNT(*) AS n FROM flow_jobs WHERE run_id = ?').get(state.run.id)) as {
    n: number;
  };
  const waiting = !state.error && Number(pending.n) > 0;
  if (state.error) await db.prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(state.run.id);
  const status = state.error ? 'failed' : waiting ? 'waiting' : 'success';
  // Al persistir, cada salida se acota a CONTEXT_LIMIT (y, pasado el tope total,
  // a STORE_LIMIT): es lo que leen los nodos al retomar después de una espera.
  const nodes: RunContext['nodes'] = {};
  let budget = CONTEXT_TOTAL_LIMIT;
  for (const [id, v] of Object.entries(state.ctx.nodes)) {
    const value = state.secrets.length ? redact(v?.output, state.secrets) : v?.output;
    const output = forStore(value, budget >= CONTEXT_LIMIT ? CONTEXT_LIMIT : STORE_LIMIT);
    budget -= JSON.stringify(output ?? null).length;
    nodes[id] = { output };
  }
  const persisted: RunContext = { ...state.ctx, nodes, merged: [...state.merged], pending: [...state.pending] };
  const ctx = state.secrets.length ? redact(persisted, state.secrets) : persisted;
  await db
    .prepare(
      `UPDATE flow_runs SET status = ?, error = ?, context = ?, step_count = ?, locked_until = NULL,
         finished_at = ? WHERE id = ?`,
    )
    .run(
      status,
      state.error === null ? null : clean(state, state.error),
      JSON.stringify(ctx),
      state.steps,
      waiting ? null : nowIso(),
      state.run.id,
    );
  if (status === 'failed') {
    await enqueueErrorFlow(state).catch(() => {});
    await afterFailure(state).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[flow] failure alert', err);
    });
  }
  return status;
}

async function loadState(run: FlowRunRow): Promise<RunState | null> {
  const flow = (await getDb()
    .prepare(
      `SELECT id, name, user_id, graph, created_by, error_flow_id, enabled, failure_alerts, auto_replay
       FROM flow_flows WHERE id = ? AND user_id = ?`,
    )
    .get(run.flow_id, run.user_id)) as (FlowInfo & Pick<FlowFlowRow, 'graph'>) | undefined;
  if (!flow) return null;
  const saved = parseJson<Partial<RunContext>>(run.context, {});
  const ctx: RunContext = {
    // La corrida usa el grafo del momento en que arrancó (un delay no se rompe si editan el flow).
    graph: saved.graph ?? parseJson<FlowGraph>(flow.graph, { nodes: [], edges: [] }),
    trigger: saved.trigger ?? parseJson(run.input, {}),
    nodes: saved.nodes ?? {},
    stepLimit: saved.stepLimit,
    ...(saved.actor ? { actor: saved.actor } : {}),
  };
  // Prueba de un borrador: corre con el acceso de quien la lanzó (y solo si es quien la capturó).
  const actingFlow = saved.actor ? { ...flow, created_by: saved.actor === run.captured_by ? saved.actor : null } : flow;
  return {
    run,
    flow: actingFlow,
    ctx,
    vars: await variablesFor(flow.user_id, actingFlow.created_by ?? null),
    steps: run.step_count,
    error: null,
    failedNode: null,
    secrets: [],
    merged: new Set(saved.merged ?? []),
    pending: new Set(saved.pending ?? []),
    loopRetryMs: 0,
  };
}

/** Disparadores automáticos: si el flow se apagó, sus corridas pendientes no siguen. */
const AUTOMATIC_TRIGGERS = new Set(['trigger.event', 'trigger.webhook', 'trigger.stripe', 'trigger.schedule', 'trigger.poll', 'trigger.form']);

/**
 * Corrida automática de un flow apagado: se cancela (falla con flow_disabled y
 * se borran sus jobs) en lugar de ejecutarse o retomarse. Las pruebas manuales,
 * sub-flows y flows de error sí corren con el flow apagado.
 */
async function cancelIfDisabled(state: RunState): Promise<boolean> {
  if (state.flow.enabled === 1 || !AUTOMATIC_TRIGGERS.has(state.run.trigger_type)) return false;
  const db = getDb();
  await db.prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(state.run.id);
  await db
    .prepare("UPDATE flow_runs SET status = 'failed', error = 'flow_disabled', finished_at = ?, locked_until = NULL WHERE id = ?")
    .run(nowIso(), state.run.id);
  return true;
}

function inChain<T>(run: FlowRunRow, fn: () => Promise<T>): Promise<T> {
  const seen = parseJson<string[]>(run.chain_seen, []);
  return flowChain.run({ depth: run.chain_depth, seen: [...new Set([...seen, run.flow_id])] }, fn);
}

/**
 * Ejecuta una corrida ya reclamada (status 'running', lock del llamador)
 * desde el trigger. Devuelve el estado final.
 */
export async function executeRun(runId: string): Promise<FlowRunRow['status']> {
  const run = (await getDb().prepare('SELECT * FROM flow_runs WHERE id = ?').get(runId)) as FlowRunRow | undefined;
  if (!run) return 'failed';
  const state = await loadState(run);
  if (!state) {
    await getDb()
      .prepare("UPDATE flow_runs SET status = 'failed', error = 'flow_missing', finished_at = ?, locked_until = NULL WHERE id = ?")
      .run(nowIso(), runId);
    return 'failed';
  }
  if (await cancelIfDisabled(state)) return 'failed';
  // Sin la persona con cuyo acceso corre, no se ejecuta ningún nodo (nunca como el dueño del workspace).
  // Y si el flow pasó a otra persona después de encolarse, no corre con lo que se capturó para la anterior.
  const ownerError = !state.flow.created_by ? 'no_flow_owner' : run.captured_by && run.captured_by !== state.flow.created_by ? 'owner_changed' : null;
  if (ownerError) {
    await getDb()
      .prepare("UPDATE flow_runs SET status = 'failed', error = ?, finished_at = ?, locked_until = NULL WHERE id = ?")
      .run(ownerError, nowIso(), runId);
    return 'failed';
  }
  await inChain(run, async () => {
    const trigger = triggerNode(state.ctx.graph);
    if (!trigger) {
      state.error = 'no_trigger';
      return;
    }
    const input = state.ctx.trigger;
    if (input && typeof input === 'object' && INPUT_TOO_LARGE_KEY in input) {
      state.error = 'input_too_large';
      return;
    }
    state.steps += 1;
    const stepId = await startStep(run.id, trigger, null);
    state.ctx.nodes[trigger.id] = { output: forStore(state.ctx.trigger, MEMORY_LIMIT) };
    await finishStep(state, stepId, 'success', state.ctx.trigger, null);
    for (const h of nodeOutputs(trigger)) await runChildren(state, trigger.id, h);
  });
  return finalize(state);
}

/**
 * Retoma una corrida en espera desde un job ya reclamado: 'continue' sigue
 * después del nodo (delay), 'retry' vuelve a ejecutar el nodo.
 */
export async function resumeRun(
  runId: string,
  nodeId: string,
  payload: { kind?: string; attempt?: number; decision?: string; comment?: string; data?: unknown },
): Promise<FlowRunRow['status']> {
  const run = (await getDb().prepare('SELECT * FROM flow_runs WHERE id = ?').get(runId)) as FlowRunRow | undefined;
  if (!run || run.status === 'failed' || run.status === 'success') return run?.status ?? 'failed';
  const state = await loadState(run);
  if (!state) return 'failed';
  if (await cancelIfDisabled(state)) return 'failed';
  // Si el flow pasó a otra persona mientras esperaba, no sigue con lo capturado para la anterior.
  if (!state.flow.created_by || (run.captured_by ?? null) !== state.flow.created_by) {
    const res = await getDb()
      .prepare("UPDATE flow_runs SET status = 'failed', error = 'owner_changed', finished_at = ?, locked_until = NULL WHERE id = ? AND status = 'waiting'")
      .run(nowIso(), runId);
    if (res.changes === 1) await getDb().prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(runId);
    return 'failed';
  }
  // Solo si sigue en espera: una cancelación entre la lectura y acá gana.
  const claimed = await getDb()
    .prepare("UPDATE flow_runs SET status = 'running' WHERE id = ? AND status = 'waiting'")
    .run(runId);
  if (claimed.changes !== 1) {
    const now = (await getDb().prepare('SELECT status FROM flow_runs WHERE id = ?').get(runId)) as
      | Pick<FlowRunRow, 'status'>
      | undefined;
    return now?.status ?? 'failed';
  }
  await inChain(run, async () => {
    if (payload.kind === 'retry') await runNode(state, nodeId, undefined, Number(payload.attempt) || 1);
    else if (payload.kind && payload.kind !== 'continue') await finishExternalWait(state, nodeId, payload);
    else {
      state.pending.delete(nodeId);
      await runChildren(state, nodeId, 'out');
    }
  });
  return finalize(state);
}

/** Lo que trajo una llamada de resume, acotado (queda como salida del nodo). */
function resumeData(data: unknown): Record<string, unknown> {
  const d = (data && typeof data === 'object' ? data : {}) as { method?: unknown; body?: unknown; query?: unknown };
  const body = forStore(d.body ?? null, RESUME_BODY_LIMIT);
  return { method: String(d.method ?? 'POST'), body, query: d.query && typeof d.query === 'object' ? d.query : {} };
}

/**
 * Fin de una espera externa: una llamada a la URL de resume, una decisión de
 * aprobación o su tiempo límite. El paso en espera pasa a terminado con la
 * salida final y la corrida sigue por la salida que corresponde (o falla si
 * el nodo dice que vencer es un error).
 */
async function finishExternalWait(
  state: RunState,
  nodeId: string,
  payload: { kind?: string; decision?: string; comment?: string; data?: unknown },
): Promise<void> {
  const node = state.ctx.graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    state.error = 'node_missing';
    return;
  }
  const cfg = node.config ?? {};
  const prev = state.ctx.nodes[nodeId]?.output;
  const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const at = nowIso();
  let output: Record<string, unknown>;
  let handle: string | null = null;
  let error: string | null = null;
  if (payload.kind === 'resume') {
    output = { mode: 'resume', resumed: true, timedOut: false, resumedAt: at, ...resumeData(payload.data) };
    handle = 'out';
  } else if (payload.kind === RESUME_TIMEOUT) {
    output = { mode: 'resume', resumed: false, timedOut: true, resumedAt: at };
    if (cfg.onTimeout === 'fail') error = 'resume_timeout';
    else handle = 'out';
  } else if (payload.kind === 'approval') {
    const approved = payload.decision === 'approve';
    output = {
      ...base,
      status: 'decided',
      decision: approved ? 'approved' : 'rejected',
      approved,
      comment: payload.comment ?? '',
      decidedAt: at,
      timedOut: false,
    };
    handle = approved ? 'approved' : 'rejected';
  } else if (payload.kind === APPROVAL_TIMEOUT) {
    const onTimeout = cfg.onTimeout === 'approve' || cfg.onTimeout === 'fail' ? cfg.onTimeout : 'reject';
    if (onTimeout === 'fail') {
      output = { ...base, status: 'expired', decision: null, approved: false, comment: '', decidedAt: null, timedOut: true };
      error = 'approval_timeout';
    } else {
      const approved = onTimeout === 'approve';
      output = {
        ...base,
        status: 'decided',
        decision: approved ? 'approved' : 'rejected',
        approved,
        comment: '',
        decidedAt: at,
        timedOut: true,
      };
      handle = approved ? 'approved' : 'rejected';
    }
  } else {
    state.error = 'invalid_resume';
    return;
  }
  state.pending.delete(nodeId);
  state.ctx.nodes[nodeId] = { output: keep(state, output) };
  const step = (await getDb()
    .prepare("SELECT id FROM flow_steps WHERE run_id = ? AND node_id = ? AND status = 'waiting' ORDER BY started_at DESC, rowid DESC LIMIT 1")
    .get(state.run.id, nodeId)) as { id: string } | undefined;
  if (step) await finishStep(state, step.id, error ? 'failed' : 'success', output, error);
  if (error) {
    state.error = `${nodeId}: ${error}`;
    state.failedNode = nodeId;
    return;
  }
  if (handle) await runChildren(state, nodeId, handle);
}

// ---------- Probar un paso ----------

export interface StepTestResult {
  status: 'success' | 'skipped' | 'failed';
  output: unknown;
  error: string | null;
  /** Salidas por las que seguiría el flow. */
  handles: string[];
  durationMs: number;
}

/**
 * Corre un solo nodo con datos de prueba ({ trigger, nodes: { id: salida } }),
 * sin crear una corrida ni seguir a los nodos siguientes. Las acciones son
 * reales (un email se manda, un contacto se crea). Esperas, Loops y sub-flows
 * no se prueban solos (isStepTestable).
 */
export async function testFlowStep(
  flow: FlowInfo,
  node: FlowNode,
  sample: { trigger?: unknown; nodes?: Record<string, unknown> },
): Promise<StepTestResult> {
  const ts = nowIso();
  const run: FlowRunRow = {
    id: `test_${crypto.randomUUID()}`,
    flow_id: flow.id,
    user_id: flow.user_id,
    trigger_type: 'manual',
    status: 'running',
    input: '{}',
    context: '{}',
    error: null,
    chain_depth: 0,
    chain_seen: JSON.stringify([flow.id]),
    step_count: 0,
    locked_until: null,
    rerun_of: null,
    parent_run_id: null,
    created_at: ts,
    started_at: ts,
    finished_at: null,
  };
  const nodes: RunContext['nodes'] = {};
  for (const [id, output] of Object.entries(sample.nodes ?? {})) nodes[id] = { output };
  const state: RunState = {
    run,
    flow,
    ctx: { graph: { nodes: [node], edges: [] }, trigger: sample.trigger ?? {}, nodes },
    steps: 0,
    error: null,
    failedNode: null,
    secrets: [],
    merged: new Set(),
    pending: new Set(),
    loopRetryMs: 0,
    vars: await variablesFor(flow.user_id, flow.created_by ?? null),
  };
  const started = Date.now();
  const done = (r: Omit<StepTestResult, 'durationMs'>): StepTestResult => ({
    ...r,
    output: store(state, r.output),
    error: r.error === null ? null : clean(state, r.error),
    durationMs: Date.now() - started,
  });
  try {
    const result = await inChain(run, () => runNodeLogic(state, node));
    if (result.kind === 'ok') return done({ status: 'success', output: result.output, error: null, handles: result.handles });
    if (result.kind === 'stop') return done({ status: 'skipped', output: result.output, error: null, handles: [] });
    if (result.kind === 'error') return done({ status: 'failed', output: null, error: result.error, handles: [] });
    return done({ status: 'success', output: result.output, error: null, handles: [] });
  } catch (err) {
    const e = err instanceof StepError ? err : new StepError(err instanceof Error ? err.message.slice(0, 200) : 'error');
    return done({ status: 'failed', output: e.output ?? null, error: e.code, handles: [] });
  }
}

// ---------- Re-ejecución desde un paso ----------

export type RerunError = 'not_found' | 'run_active' | 'node_not_found' | 'node_is_trigger' | 'node_in_loop' | 'rate_limited' | 'owner_changed';

/**
 * Nueva corrida que reusa las salidas de la corrida `runId` para todo lo que
 * está antes de `fromNodeId` y ejecuta ese nodo y lo que sigue con el grafo
 * actual del flow (sirve para corregir un nodo y volver a probar sin repetir
 * los pasos anteriores). No aplica a nodos dentro del cuerpo de un Loop.
 */
export async function rerunFromStep(
  workspaceId: string,
  runId: string,
  fromNodeId: string,
): Promise<{ ok: true; runId: string; status: FlowRunRow['status'] } | { ok: false; error: RerunError }> {
  const db = getDb();
  const old = (await db.prepare('SELECT * FROM flow_runs WHERE id = ? AND user_id = ?').get(runId, workspaceId)) as
    | FlowRunRow
    | undefined;
  if (!old) return { ok: false, error: 'not_found' };
  if (old.status !== 'failed' && old.status !== 'success') return { ok: false, error: 'run_active' };
  const flow = (await db.prepare('SELECT * FROM flow_flows WHERE id = ? AND user_id = ?').get(old.flow_id, workspaceId)) as
    | FlowFlowRow
    | undefined;
  if (!flow) return { ok: false, error: 'not_found' };
  // Reusa lo capturado con el acceso de captured_by y corre como quien creó el flow hoy: tienen que coincidir.
  if (!flow.created_by || old.captured_by !== flow.created_by) return { ok: false, error: 'owner_changed' };
  const graph = parseJson<FlowGraph>(flow.graph, { nodes: [], edges: [] });
  const node = graph.nodes.find((n) => n.id === fromNodeId);
  if (!node) return { ok: false, error: 'node_not_found' };
  if (isTriggerType(node.type)) return { ok: false, error: 'node_is_trigger' };
  for (const loop of graph.nodes.filter((n) => n.type === 'logic.loop')) {
    if (reachableFrom(graph, loop.id, 'item').has(fromNodeId)) return { ok: false, error: 'node_in_loop' };
  }
  const redo = reachableFrom(graph, fromNodeId);
  redo.add(fromNodeId);
  const reused = (id: string) => !redo.has(id) && graph.nodes.some((n) => n.id === id);
  const oldCtx = parseJson<Partial<RunContext>>(old.context, {});
  const nodes: RunContext['nodes'] = {};
  for (const [id, v] of Object.entries(oldCtx.nodes ?? {})) if (reused(id)) nodes[id] = v;

  const newId = await enqueueRun(flow, old.trigger_type, parseJson(old.input, {}), {
    status: 'running',
    lockMs: 5 * 60_000,
    chain: { depth: old.chain_depth, seen: parseJson<string[]>(old.chain_seen, []) },
    rerunOf: old.id,
  });
  if (!newId) return { ok: false, error: 'rate_limited' };

  // Pasos reusados: se copian para ver la corrida completa.
  const steps = (await db
    .prepare("SELECT * FROM flow_steps WHERE run_id = ? AND status = 'success' ORDER BY started_at ASC, rowid ASC")
    .all(old.id)) as FlowStepRow[];
  let copied = 0;
  for (const s of steps) {
    if (!reused(s.node_id)) continue;
    copied += 1;
    await db
      .prepare(
        `INSERT INTO flow_steps (id, run_id, node_id, node_type, status, input, output, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, 'success', ?, ?, NULL, ?, ?)`,
      )
      .run(crypto.randomUUID(), newId, s.node_id, s.node_type, s.input ?? null, s.output ?? null, s.started_at, s.finished_at ?? null);
  }
  await db
    .prepare('UPDATE flow_runs SET context = ?, step_count = ? WHERE id = ?')
    .run(
      JSON.stringify({ graph, trigger: oldCtx.trigger ?? parseJson(old.input, {}), nodes, stepLimit: MAX_STEPS + copied }),
      copied,
      newId,
    );

  const run = (await db.prepare('SELECT * FROM flow_runs WHERE id = ?').get(newId)) as FlowRunRow;
  const state = await loadState(run);
  if (!state) return { ok: false, error: 'not_found' };
  await inChain(run, () => runNode(state, fromNodeId));
  return { ok: true, runId: newId, status: await finalize(state) };
}
