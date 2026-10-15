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
import { getDb, type FlowFlowRow, type FlowRunRow, type FlowStepRow } from './db';
import { sendEmail } from './email';
import { flowChain } from './events';
import { enqueueRun, kickFlowWorker, MAX_FLOW_CHAIN_DEPTH, nowIso, parseJson } from './flow';
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
import { evalConditions, renderDeep, renderString, renderValue, stringify, type Condition } from './flow-template';
import { safeFetch, UnsafeUrlError } from './safe-fetch';

export const MAX_STEPS = 200;
export const MAX_LOOP_ITEMS = 100;
const MAX_RETRIES = 5;
/** Tope por valor al guardar en la base (pasos y contexto persistido). */
const STORE_LIMIT = 64_000;
/** Tope por salida de nodo en memoria (lo que leen los nodos siguientes). */
const MEMORY_LIMIT = 5_000_000;
const HTTP_BODY_LIMIT = 1_000_000;

interface RunContext {
  graph: FlowGraph;
  trigger: unknown;
  nodes: Record<string, { output: unknown }>;
}

type FlowInfo = Pick<FlowFlowRow, 'id' | 'name' | 'user_id' | 'created_by' | 'error_flow_id'>;

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
}

interface LoopScope {
  item: unknown;
  index: number;
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
    run: { id: state.run.id },
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
  let res: Response;
  try {
    res = await safeFetch(url, { method, headers, body: body || undefined }, timeoutMs);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new StepError(err.message);
    throw new StepError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
  }
  const text = (await res.text().catch(() => '')).slice(0, HTTP_BODY_LIMIT);
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
  const msg = await createChatMessage(conv.id, 'bot', { body: body.slice(0, 10_000) });
  return { message: { id: msg.id, body: msg.body }, conversation: { id: conv.id } };
}

async function docsPageNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const title = renderString(cfg.title ?? '', tctx).trim().slice(0, 300);
  const content = renderString(cfg.content ?? '', tctx);
  const { createDocPage } = await import('./docs');
  const blocks = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((p) => ({ id: crypto.randomUUID(), type: 'paragraph' as const, content: p }));
  const page = await createDocPage(ws, { title, content: blocks.length ? blocks : undefined });
  return { page: { id: page.id, title: page.title } };
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
  await getDb()
    .prepare('UPDATE flow_runs SET locked_until = ? WHERE id = ?')
    .run(new Date(Date.now() + 10 * 60_000).toISOString(), state.run.id);
  const res = await startRobotRun(ws, robotId, inputs, { trigger: 'flow' });
  if (!res.ok) {
    // Ocupado o con rate limit: reintentable con los reintentos del nodo.
    throw new StepError(`robot_${res.error}`, res.error === 'busy' || res.error === 'rate_limited');
  }
  const output = {
    runId: res.run.id,
    status: res.run.status,
    error: res.run.error,
    output: res.run.output,
    durationMs: res.run.durationMs,
    screenshots: res.run.screenshots.filter((s) => s.url && !s.url.startsWith('data:')).map((s) => ({ name: s.name, url: s.url })),
  };
  if (res.run.status === 'failed' && cfg.failOnError !== false) throw new StepError('robot_failed', false, output);
  return output;
}

// ---------- Agente, código, merge, sub-flow ----------

async function agentNode(ws: string, cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
  const agentId = renderString(cfg.agentId ?? '', tctx).trim();
  if (!agentId) throw new StepError('missing_agent');
  const message = renderString(cfg.message ?? '', tctx).trim();
  if (!message) throw new StepError('missing_message');
  const { getAgentRow, sendAgentMessage, AgentError } = await import('./agents');
  const agent = await getAgentRow(ws, agentId);
  if (!agent) throw new StepError('agent_not_found');
  const conversationId = renderString(cfg.conversationId ?? '', tctx).trim() || null;
  try {
    const res = await sendAgentMessage({ agent, channel: 'api', text: message.slice(0, 4000), conversationId });
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

async function codeNode(state: RunState, cfg: Record<string, unknown>) {
  const code = String(cfg.code ?? '');
  if (!code.trim()) throw new StepError('missing_code');
  if (code.length > 50_000) throw new StepError('code_too_long');
  const timeoutSec = Math.min(Math.max(Math.floor(Number(cfg.timeoutSec) || 10), 1), CODE_MAX_TIMEOUT_SEC);
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
    .prepare('SELECT id, user_id FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(flowId, state.flow.user_id)) as Pick<FlowFlowRow, 'id' | 'user_id'> | undefined;
  if (!row) throw new StepError('flow_not_found');
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
  const status = await executeRun(runId);
  const sub = (await getDb().prepare('SELECT error, context FROM flow_runs WHERE id = ?').get(runId)) as
    | { error: string | null; context: string }
    | undefined;
  const nodes = parseJson<{ nodes?: Record<string, { output: unknown }> }>(sub?.context, {}).nodes ?? {};
  const outputs: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(nodes)) outputs[id] = v?.output ?? null;
  const output = { runId, status, error: sub?.error ?? null, outputs };
  if (status === 'failed' && cfg.failOnError !== false) throw new StepError('subflow_failed', false, output);
  return output;
}

async function runNodeLogic(state: RunState, node: FlowNode, loop?: LoopScope): Promise<NodeResult> {
  const cfg = node.config ?? {};
  const tctx = templateCtx(state, loop);
  const ws = state.flow.user_id;
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
    case 'logic.delay': {
      const amount = Math.max(0, Number(cfg.amount) || 0);
      const unitMs = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[String(cfg.unit)] ?? 60_000;
      const ms = Math.min(amount * unitMs, 30 * 86_400_000);
      const runAt = new Date(Date.now() + ms).toISOString();
      await scheduleJob(state.run.id, node.id, runAt, { kind: 'continue' });
      return { kind: 'wait', output: { resumeAt: runAt } };
    }
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
    case 'app.link':
      return { kind: 'ok', output: await linkNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.chat_message':
      return { kind: 'ok', output: await chatMessageNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.docs_page':
      return { kind: 'ok', output: await docsPageNode(ws, cfg, tctx), handles: ['out'] };
    case 'app.robot_run':
      return { kind: 'ok', output: await robotNode(state, cfg, tctx), handles: ['out'] };
    case 'ai.text':
      return { kind: 'ok', output: await aiNode(ws, cfg, tctx), handles: ['out'] };
    case 'ai.agent':
      return { kind: 'ok', output: await agentNode(ws, cfg, tctx), handles: ['out'] };
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
  const key = loop ? `${node.id}@${loop.index}` : node.id;
  if (state.merged.has(key)) return false;
  const sources = [...new Set(state.ctx.graph.edges.filter((e) => e.target === node.id).map((e) => e.source))];
  if (sources.some((id) => state.ctx.nodes[id] === undefined)) return false;
  state.merged.add(key);
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
  state.steps += 1;
  if (state.steps > MAX_STEPS) {
    state.error = 'step_limit';
    return;
  }

  if (node.type === 'logic.loop') {
    await runLoop(state, node, loop);
    return;
  }

  const stepId = await startStep(state.run.id, node, renderedInput(state, node, loop));
  let result: NodeResult;
  try {
    result = await runNodeLogic(state, node, loop);
  } catch (err) {
    const e = err instanceof StepError ? err : new StepError(err instanceof Error ? err.message.slice(0, 200) : 'error');
    result = { kind: 'error', error: e.code, retryable: e.retryable };
    if (e.output !== undefined && e.output !== null) state.ctx.nodes[node.id] = { output: keep(state, e.output) };
  }

  if (result.kind === 'error') {
    const retries = Math.min(Math.max(Math.floor(Number(node.config?.retries) || 0), 0), MAX_RETRIES);
    if (result.retryable && attempt < retries && !loop) {
      const delayMs = Math.min(15_000 * 2 ** attempt, 3_600_000);
      await scheduleJob(state.run.id, node.id, new Date(Date.now() + delayMs).toISOString(), {
        kind: 'retry',
        attempt: attempt + 1,
      });
      await finishStep(state, stepId, 'failed', state.ctx.nodes[node.id]?.output ?? null, `${result.error} (retry ${attempt + 1}/${retries})`);
      return;
    }
    const details = state.ctx.nodes[node.id]?.output ?? null;
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
    await finishStep(state, stepId, 'waiting', result.output, null);
    return;
  }
  await finishStep(state, stepId, 'success', result.output, null);
  for (const h of result.handles) await runChildren(state, node.id, h, loop);
}

async function runLoop(state: RunState, node: FlowNode, outer?: LoopScope): Promise<void> {
  const cfg = node.config ?? {};
  const stepId = await startStep(state.run.id, node, renderedInput(state, node, outer));
  const raw = renderValue(cfg.items ?? '', templateCtx(state, outer));
  let items: unknown[];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string' && raw.trim().startsWith('[')) items = parseJson<unknown[]>(raw, []);
  else if (raw === undefined || raw === null || raw === '') items = [];
  else items = [raw];
  const max = Math.min(Math.max(Math.floor(Number(cfg.max) || 50), 1), MAX_LOOP_ITEMS);
  const capped = items.slice(0, max);
  for (let i = 0; i < capped.length; i++) {
    if (state.error) break;
    await runChildren(state, node.id, 'item', { item: capped[i], index: i });
  }
  const output = { count: capped.length, total: items.length, items: capped };
  state.ctx.nodes[node.id] = { output: keep(state, output) };
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
    .prepare('SELECT id, user_id FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(target, state.flow.user_id)) as Pick<FlowFlowRow, 'id' | 'user_id'> | undefined;
  if (!row) return;
  const failed = state.failedNode ? state.ctx.graph.nodes.find((n) => n.id === state.failedNode) : null;
  const input = store(state, {
    flow: { id: state.flow.id, name: state.flow.name },
    run: { id: state.run.id, error: state.error, triggerType: state.run.trigger_type, startedAt: state.run.started_at },
    failedNode: failed ? { id: failed.id, type: failed.type, output: store(state, state.ctx.nodes[failed.id]?.output ?? null) } : null,
    trigger: state.ctx.trigger,
  });
  const id = await enqueueRun(row, 'error', input, { chain: { depth, seen }, parentRunId: state.run.id });
  if (id) kickFlowWorker();
}

async function finalize(state: RunState): Promise<FlowRunRow['status']> {
  const db = getDb();
  const pending = (await db.prepare('SELECT COUNT(*) AS n FROM flow_jobs WHERE run_id = ?').get(state.run.id)) as {
    n: number;
  };
  const waiting = !state.error && Number(pending.n) > 0;
  if (state.error) await db.prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(state.run.id);
  const status = state.error ? 'failed' : waiting ? 'waiting' : 'success';
  // Al persistir, cada salida se acota a STORE_LIMIT (en memoria iban completas).
  const nodes: RunContext['nodes'] = {};
  for (const [id, v] of Object.entries(state.ctx.nodes)) nodes[id] = { output: store(state, v?.output) };
  const persisted: RunContext = { ...state.ctx, nodes };
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
  if (status === 'failed') await enqueueErrorFlow(state).catch(() => {});
  return status;
}

async function loadState(run: FlowRunRow): Promise<RunState | null> {
  const flow = (await getDb()
    .prepare('SELECT id, name, user_id, graph, created_by, error_flow_id FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(run.flow_id, run.user_id)) as (FlowInfo & Pick<FlowFlowRow, 'graph'>) | undefined;
  if (!flow) return null;
  const saved = parseJson<Partial<RunContext>>(run.context, {});
  const ctx: RunContext = {
    // La corrida usa el grafo del momento en que arrancó (un delay no se rompe si editan el flow).
    graph: saved.graph ?? parseJson<FlowGraph>(flow.graph, { nodes: [], edges: [] }),
    trigger: saved.trigger ?? parseJson(run.input, {}),
    nodes: saved.nodes ?? {},
  };
  return { run, flow, ctx, steps: run.step_count, error: null, failedNode: null, secrets: [], merged: new Set() };
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
  await inChain(run, async () => {
    const trigger = triggerNode(state.ctx.graph);
    if (!trigger) {
      state.error = 'no_trigger';
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
  payload: { kind?: string; attempt?: number },
): Promise<FlowRunRow['status']> {
  const run = (await getDb().prepare('SELECT * FROM flow_runs WHERE id = ?').get(runId)) as FlowRunRow | undefined;
  if (!run || run.status === 'failed' || run.status === 'success') return run?.status ?? 'failed';
  const state = await loadState(run);
  if (!state) return 'failed';
  await getDb().prepare("UPDATE flow_runs SET status = 'running' WHERE id = ?").run(runId);
  await inChain(run, async () => {
    if (payload.kind === 'retry') await runNode(state, nodeId, undefined, Number(payload.attempt) || 1);
    else await runChildren(state, nodeId, 'out');
  });
  return finalize(state);
}

// ---------- Re-ejecución desde un paso ----------

export type RerunError = 'not_found' | 'run_active' | 'node_not_found' | 'node_is_trigger' | 'node_in_loop' | 'rate_limited';

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
    .run(JSON.stringify({ graph, trigger: oldCtx.trigger ?? parseJson(old.input, {}), nodes }), copied, newId);

  const run = (await db.prepare('SELECT * FROM flow_runs WHERE id = ?').get(newId)) as FlowRunRow;
  const state = await loadState(run);
  if (!state) return { ok: false, error: 'not_found' };
  await inChain(run, () => runNode(state, fromNodeId));
  return { ok: true, runId: newId, status: await finalize(state) };
}
