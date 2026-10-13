/**
 * Flow — motor de ejecución. Recorre el grafo desde el trigger siguiendo las
 * aristas (por handle), guarda cada paso en flow_steps y la salida de cada
 * nodo en el contexto de la corrida ({{nodes.<id>.output.x}}).
 *
 * - Delay y reintentos: se persiste un flow_jobs y la corrida queda 'waiting';
 *   el worker (lib/flow-worker.ts) la retoma desde ese nodo.
 * - Loop: ejecuta el cuerpo (handle 'item') una vez por elemento, en serie.
 * - Tope de pasos por corrida (MAX_STEPS) y cadena de eventos (flowChain).
 * Server-only.
 */
import { aiEnabled, aiGenerateText, AiError } from './ai';
import { getDb, type FlowFlowRow, type FlowRunRow } from './db';
import { sendEmail } from './email';
import { flowChain } from './events';
import { nowIso, parseJson } from './flow';
import { edgeHandle, nodeOutputs, triggerNode, type FlowGraph, type FlowNode } from './flow-schema';
import { evalConditions, renderDeep, renderString, renderValue, stringify, type Condition } from './flow-template';
import { safeFetch, UnsafeUrlError } from './safe-fetch';

export const MAX_STEPS = 200;
export const MAX_LOOP_ITEMS = 100;
const MAX_RETRIES = 5;
const STORE_LIMIT = 64_000;
const HTTP_BODY_LIMIT = 1_000_000;

interface RunContext {
  graph: FlowGraph;
  trigger: unknown;
  nodes: Record<string, { output: unknown }>;
}

interface RunState {
  run: FlowRunRow;
  flow: Pick<FlowFlowRow, 'id' | 'name' | 'user_id'>;
  ctx: RunContext;
  steps: number;
  error: string | null;
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

class StepError extends Error {
  constructor(
    public code: string,
    public retryable = false,
  ) {
    super(code);
  }
}

/** Valor serializable y acotado para guardar en la base. */
function forStore(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value ?? null);
  } catch {
    return null;
  }
  if (json.length <= STORE_LIMIT) return value ?? null;
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

function str(v: unknown): string {
  return stringify(v).trim();
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// ---------- Nodos ----------

async function httpNode(cfg: Record<string, unknown>, tctx: Record<string, unknown>) {
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
  if (!res.ok) {
    const err = new StepError(`http_${res.status}`, res.status >= 500 || res.status === 429);
    (err as StepError & { output?: unknown }).output = output;
    throw err;
  }
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
  });
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
  if (res.run.status === 'failed' && cfg.failOnError !== false) {
    const err = new StepError('robot_failed');
    (err as StepError & { output?: unknown }).output = output;
    throw err;
  }
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
      return { kind: 'ok', output: await httpNode(cfg, tctx), handles: ['out'] };
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
    default:
      throw new StepError('unsupported_node');
  }
}

/** Config renderizada (para mostrar el input de cada paso). */
function renderedInput(state: RunState, node: FlowNode, loop?: LoopScope): unknown {
  if (node.type.startsWith('trigger.')) return null;
  try {
    return forStore(renderDeep(node.config ?? {}, templateCtx(state, loop)));
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
  stepId: string,
  status: 'success' | 'failed' | 'skipped' | 'waiting',
  output: unknown,
  error: string | null,
) {
  await getDb()
    .prepare('UPDATE flow_steps SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?')
    .run(status, JSON.stringify(forStore(output)), error, nowIso(), stepId);
}

// ---------- Recorrido ----------

async function runChildren(state: RunState, nodeId: string, handle: string, loop?: LoopScope): Promise<void> {
  const edges = state.ctx.graph.edges.filter((e) => e.source === nodeId && edgeHandle(e) === handle);
  for (const e of edges) {
    if (state.error) return;
    await runNode(state, e.target, loop);
  }
}

async function runNode(state: RunState, nodeId: string, loop?: LoopScope, attempt = 0): Promise<void> {
  if (state.error) return;
  const node = state.ctx.graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    state.error = 'node_missing';
    return;
  }
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
    const output = (e as StepError & { output?: unknown }).output ?? null;
    result = { kind: 'error', error: e.code, retryable: e.retryable };
    if (output) state.ctx.nodes[node.id] = { output: forStore(output) };
  }

  if (result.kind === 'error') {
    const retries = Math.min(Math.max(Math.floor(Number(node.config?.retries) || 0), 0), MAX_RETRIES);
    if (result.retryable && attempt < retries && !loop) {
      const delayMs = Math.min(15_000 * 2 ** attempt, 3_600_000);
      await scheduleJob(state.run.id, node.id, new Date(Date.now() + delayMs).toISOString(), {
        kind: 'retry',
        attempt: attempt + 1,
      });
      await finishStep(stepId, 'failed', state.ctx.nodes[node.id]?.output ?? null, `${result.error} (retry ${attempt + 1}/${retries})`);
      return;
    }
    await finishStep(stepId, 'failed', state.ctx.nodes[node.id]?.output ?? null, result.error);
    state.error = `${node.id}: ${result.error}`;
    return;
  }

  state.ctx.nodes[node.id] = { output: forStore(result.output) };
  if (result.kind === 'stop') {
    await finishStep(stepId, 'skipped', result.output, null);
    return;
  }
  if (result.kind === 'wait') {
    await finishStep(stepId, 'waiting', result.output, null);
    return;
  }
  await finishStep(stepId, 'success', result.output, null);
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
  state.ctx.nodes[node.id] = { output: forStore(output) };
  if (state.error) {
    await finishStep(stepId, 'failed', output, 'loop_body_failed');
    return;
  }
  await finishStep(stepId, 'success', output, null);
  await runChildren(state, node.id, 'done', outer);
}

// ---------- Corridas ----------

async function finalize(state: RunState): Promise<FlowRunRow['status']> {
  const db = getDb();
  const pending = (await db.prepare('SELECT COUNT(*) AS n FROM flow_jobs WHERE run_id = ?').get(state.run.id)) as {
    n: number;
  };
  const waiting = !state.error && Number(pending.n) > 0;
  if (state.error) await db.prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(state.run.id);
  const status = state.error ? 'failed' : waiting ? 'waiting' : 'success';
  await db
    .prepare(
      `UPDATE flow_runs SET status = ?, error = ?, context = ?, step_count = ?, locked_until = NULL,
         finished_at = ? WHERE id = ?`,
    )
    .run(
      status,
      state.error,
      JSON.stringify(state.ctx),
      state.steps,
      waiting ? null : nowIso(),
      state.run.id,
    );
  return status;
}

async function loadState(run: FlowRunRow): Promise<RunState | null> {
  const flow = (await getDb()
    .prepare('SELECT id, name, user_id, graph FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(run.flow_id, run.user_id)) as (Pick<FlowFlowRow, 'id' | 'name' | 'user_id' | 'graph'>) | undefined;
  if (!flow) return null;
  const saved = parseJson<Partial<RunContext>>(run.context, {});
  const ctx: RunContext = {
    // La corrida usa el grafo del momento en que arrancó (un delay no se rompe si editan el flow).
    graph: saved.graph ?? parseJson<FlowGraph>(flow.graph, { nodes: [], edges: [] }),
    trigger: saved.trigger ?? parseJson(run.input, {}),
    nodes: saved.nodes ?? {},
  };
  return { run, flow, ctx, steps: run.step_count, error: null };
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
    state.ctx.nodes[trigger.id] = { output: forStore(state.ctx.trigger) };
    await finishStep(stepId, 'success', state.ctx.trigger, null);
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
