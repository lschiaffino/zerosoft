/**
 * Flow — datos (flows, corridas, webhooks entrantes, schedules) y encolado de
 * corridas desde los disparadores. La ejecución vive en lib/flow-engine.ts y
 * el procesamiento de la cola en lib/flow-worker.ts. Server-only.
 *
 * user_id = workspace (dueño); created_by = persona real que lo creó. Si otra
 * persona cambia un nodo Gmail, pasa a ser created_by: el nodo envía desde la
 * casilla de quien escribió el mensaje, nunca desde la de otro.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { nextCronRun, tzOffsetMinutes } from './cron';
import { getDb, type FlowFlowRow, type FlowRunRow, type FlowSettingsRow, type FlowStepRow, type FlowVersionRow } from './db';
import { flowChain } from './events';
import {
  DEFAULT_RETENTION_DAYS,
  diffGraphs,
  EMPTY_GRAPH,
  isHookTrigger,
  isTriggerType,
  RETENTION_DAYS,
  triggerNode,
  validateGraph,
  type FlowEventType,
  type FlowGraph,
  type GraphDiff,
  type GraphErrorCode,
} from './flow-schema';
import { compare, getPath, type ConditionOp } from './flow-template';
import { rateLimit } from './rate-limit';

/** Profundidad máxima de flows encadenados por eventos (A → B → C). */
export const MAX_FLOW_CHAIN_DEPTH = 3;

export interface FlowDto {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: FlowGraph;
  version: number;
  triggerType: string | null;
  triggerEvent: string | null;
  nextRunAt: string | null;
  errorFlowId: string | null;
  /** Email al dueño cuando una corrida falla. */
  failureAlerts: boolean;
  /** Replay automático de las corridas que fallan. */
  autoReplay: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowListItem extends FlowDto {
  lastRun: { id: string; status: FlowRunRow['status']; createdAt: string } | null;
}

export interface FlowRunDto {
  id: string;
  flowId: string;
  triggerType: string;
  status: FlowRunRow['status'];
  input: unknown;
  error: string | null;
  stepCount: number;
  rerunOf: string | null;
  parentRunId: string | null;
  /** Replay automático agendado (corrida fallida). */
  replayAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FlowStepDto {
  id: string;
  nodeId: string;
  nodeType: string;
  status: FlowStepRow['status'];
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseGraph(raw: string): FlowGraph {
  const g = parseJson<FlowGraph>(raw, EMPTY_GRAPH);
  return { nodes: Array.isArray(g.nodes) ? g.nodes : [], edges: Array.isArray(g.edges) ? g.edges : [] };
}

export function toFlowDto(row: FlowFlowRow): FlowDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    graph: parseGraph(row.graph),
    version: row.version,
    triggerType: row.trigger_type,
    triggerEvent: row.trigger_event,
    nextRunAt: row.next_run_at,
    errorFlowId: row.error_flow_id ?? null,
    failureAlerts: row.failure_alerts !== 0,
    autoReplay: row.auto_replay === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRunDto(row: FlowRunRow): FlowRunDto {
  return {
    id: row.id,
    flowId: row.flow_id,
    triggerType: row.trigger_type,
    status: row.status,
    input: parseJson(row.input, {}),
    error: row.error,
    stepCount: row.step_count,
    rerunOf: row.rerun_of ?? null,
    parentRunId: row.parent_run_id ?? null,
    replayAt: row.replay_at ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toStepDto(row: FlowStepRow): FlowStepDto {
  return {
    id: row.id,
    nodeId: row.node_id,
    nodeType: row.node_type,
    status: row.status,
    input: parseJson(row.input, null),
    output: parseJson(row.output, null),
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// ---------- Schedules ----------

/** Igualdad estructural de valores JSON (sin depender del orden de las claves). */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(norm(a) ?? null) === JSON.stringify(norm(b) ?? null);
}

/**
 * Próxima ejecución de un trigger.schedule (o del schedule de un robot)
 * después de `from`. `minMinutes`: intervalo mínimo entre corridas.
 * Cron inválido → dentro de un año (nunca se usa: la validación lo rechaza).
 */
export function computeNextRun(config: Record<string, unknown>, from: Date = new Date(), minMinutes = 5): Date {
  if (config.mode === 'interval') {
    const every = Math.max(1, Math.floor(Number(config.every) || 1));
    const unitMs = config.unit === 'minutes' ? 60_000 : 3_600_000;
    return new Date(from.getTime() + Math.max(every * unitMs, minMinutes * 60_000));
  }
  if (config.mode === 'cron') {
    const tz = typeof config.timezone === 'string' && config.timezone ? config.timezone : 'UTC';
    return nextCronRun(String(config.cron ?? ''), tz, from) ?? new Date(from.getTime() + 365 * 86_400_000);
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(config.time ?? '09:00').trim());
  const hh = m ? Math.min(23, Number(m[1])) : 9;
  const mm = m ? Math.min(59, Number(m[2])) : 0;
  const tz = typeof config.timezone === 'string' && config.timezone ? config.timezone : 'UTC';
  const offset = tzOffsetMinutes(tz, from);
  const local = new Date(from.getTime() + offset * 60_000);
  let candidate =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - offset * 60_000;
  if (candidate <= from.getTime()) candidate += 86_400_000;
  // Corrección por cambio de horario entre hoy y el candidato.
  const drift = tzOffsetMinutes(tz, new Date(candidate)) - offset;
  if (drift) candidate -= drift * 60_000;
  return new Date(candidate);
}

// ---------- Flows ----------

function triggerFields(graph: FlowGraph, enabled: boolean, from = new Date()) {
  const trigger = triggerNode(graph);
  const type = trigger?.type ?? null;
  const event = type === 'trigger.event' ? String(trigger?.config.event ?? '') || null : null;
  const next =
    type === 'trigger.schedule' && enabled ? computeNextRun(trigger?.config ?? {}, from).toISOString() : null;
  return { type, event, next };
}

/** Un token por nodo trigger.webhook / trigger.stripe; se conservan los de nodos que siguen. */
async function syncWebhooks(workspaceId: string, flowId: string, graph: FlowGraph): Promise<void> {
  const db = getDb();
  const nodeIds = graph.nodes.filter((n) => isHookTrigger(n.type)).map((n) => n.id);
  const existing = (await db
    .prepare('SELECT node_id FROM flow_webhooks WHERE flow_id = ?')
    .all(flowId)) as Array<{ node_id: string }>;
  for (const e of existing) {
    if (!nodeIds.includes(e.node_id)) {
      await db.prepare('DELETE FROM flow_webhooks WHERE flow_id = ? AND node_id = ?').run(flowId, e.node_id);
    }
  }
  for (const nodeId of nodeIds) {
    if (existing.some((e) => e.node_id === nodeId)) continue;
    await db
      .prepare(
        'INSERT OR IGNORE INTO flow_webhooks (id, flow_id, user_id, node_id, token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), flowId, workspaceId, nodeId, `fh_${randomBytes(24).toString('base64url')}`, nowIso());
  }
}

export async function listFlowWebhooks(
  workspaceId: string,
  flowId: string,
): Promise<Array<{ nodeId: string; token: string }>> {
  const rows = (await getDb()
    .prepare('SELECT node_id, token FROM flow_webhooks WHERE flow_id = ? AND user_id = ?')
    .all(flowId, workspaceId)) as Array<{ node_id: string; token: string }>;
  return rows.map((r) => ({ nodeId: r.node_id, token: r.token }));
}

export async function listFlows(workspaceId: string): Promise<FlowListItem[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM flow_flows WHERE user_id = ? ORDER BY updated_at DESC')
    .all(workspaceId)) as FlowFlowRow[];
  // Última corrida de cada flow en una sola query (sin una por fila).
  const lasts = (await getDb()
    .prepare(
      `SELECT f.id AS flow_id, r.id, r.status, r.created_at FROM flow_flows f
       JOIN flow_runs r ON r.id = (SELECT id FROM flow_runs WHERE flow_id = f.id ORDER BY created_at DESC LIMIT 1)
       WHERE f.user_id = ?`,
    )
    .all(workspaceId)) as Array<{ flow_id: string; id: string; status: FlowRunRow['status']; created_at: string }>;
  const lastBy = new Map(lasts.map((l) => [l.flow_id, l]));
  return rows.map((row) => {
    const last = lastBy.get(row.id);
    return {
      ...toFlowDto(row),
      lastRun: last ? { id: last.id, status: last.status, createdAt: last.created_at } : null,
    };
  });
}

export async function getFlowRow(workspaceId: string, id: string): Promise<FlowFlowRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM flow_flows WHERE id = ? AND user_id = ?')
    .get(id, workspaceId)) as FlowFlowRow | undefined) ?? null;
}

export async function getFlow(workspaceId: string, id: string): Promise<FlowDto | null> {
  const row = await getFlowRow(workspaceId, id);
  return row ? toFlowDto(row) : null;
}

export type FlowWriteResult =
  | { ok: true; flow: FlowDto }
  | { ok: false; error: GraphErrorCode | 'not_found' | 'conflict' | 'invalid_error_flow'; nodeId?: string };

// ---------- Versiones ----------

/** Versiones guardadas por flow (las más viejas se borran). */
export const MAX_FLOW_VERSIONS = 50;

export interface FlowVersionDto {
  id: string;
  version: number;
  name: string;
  nodeCount: number;
  createdBy: string | null;
  createdAt: string;
  /** Cambios respecto de la versión anterior. */
  diff: GraphDiff;
  /** Tipo de cada nodo nombrado en el diff (también los quitados), para mostrar su título. */
  nodeTypes: Record<string, string>;
}

async function snapshotVersion(
  workspaceId: string,
  flowId: string,
  version: number,
  name: string,
  graph: FlowGraph,
  actorId: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      'INSERT INTO flow_versions (id, flow_id, user_id, version, name, graph, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(crypto.randomUUID(), flowId, workspaceId, version, name, JSON.stringify(graph), actorId, nowIso());
  await db
    .prepare(
      `DELETE FROM flow_versions WHERE flow_id = ? AND id NOT IN (
         SELECT id FROM flow_versions WHERE flow_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
    )
    .run(flowId, flowId, MAX_FLOW_VERSIONS);
}

export async function listFlowVersions(workspaceId: string, flowId: string): Promise<FlowVersionDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM flow_versions WHERE flow_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(flowId, workspaceId)) as FlowVersionRow[];
  return rows.map((row, i) => {
    const graph = parseGraph(row.graph);
    const prev = rows[i + 1] ? parseGraph(rows[i + 1].graph) : null;
    return {
      id: row.id,
      version: row.version,
      name: row.name,
      nodeCount: graph.nodes.length,
      createdBy: row.created_by,
      createdAt: row.created_at,
      diff: diffGraphs(prev, graph),
      nodeTypes: Object.fromEntries([...(prev?.nodes ?? []), ...graph.nodes].map((n) => [n.id, n.type])),
    };
  });
}

export async function getFlowVersion(
  workspaceId: string,
  flowId: string,
  versionId: string,
): Promise<{ id: string; version: number; graph: FlowGraph } | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM flow_versions WHERE id = ? AND flow_id = ? AND user_id = ?')
    .get(versionId, flowId, workspaceId)) as FlowVersionRow | undefined;
  return row ? { id: row.id, version: row.version, graph: parseGraph(row.graph) } : null;
}

/** Restaura el grafo de una versión (queda como una versión nueva). */
export async function restoreFlowVersion(
  workspaceId: string,
  flowId: string,
  versionId: string,
  actorId: string | null,
): Promise<FlowWriteResult> {
  const v = await getFlowVersion(workspaceId, flowId, versionId);
  if (!v) return { ok: false, error: 'not_found' };
  return updateFlow(workspaceId, flowId, { graph: v.graph }, actorId);
}

export async function createFlow(
  workspaceId: string,
  actorId: string,
  input: { name: string; description?: string; graph?: unknown },
): Promise<FlowWriteResult> {
  const graphInput = input.graph ?? {
    nodes: [{ id: 'trigger', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } }],
    edges: [],
  };
  const v = validateGraph(graphInput);
  if (!v.ok) return v;
  const id = crypto.randomUUID();
  const ts = nowIso();
  const tf = triggerFields(v.graph, false);
  await getDb()
    .prepare(
      `INSERT INTO flow_flows (id, user_id, name, description, enabled, graph, version, trigger_type, trigger_event,
         next_run_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(id, workspaceId, input.name.trim(), input.description ?? '', JSON.stringify(v.graph), tf.type, tf.event, actorId, ts, ts);
  await syncWebhooks(workspaceId, id, v.graph);
  await snapshotVersion(workspaceId, id, 1, input.name.trim(), v.graph, actorId);
  return { ok: true, flow: (await getFlow(workspaceId, id))! };
}

/** Nodos Gmail del grafo (id + config) para detectar si alguien los cambió. */
function gmailNodesKey(graph: FlowGraph): string {
  return JSON.stringify(graph.nodes.filter((n) => n.type === 'app.gmail').map((n) => [n.id, n.config ?? {}]));
}

export async function updateFlow(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    description?: string;
    graph?: unknown;
    enabled?: boolean;
    version?: number;
    errorFlowId?: string | null;
    failureAlerts?: boolean;
    autoReplay?: boolean;
  },
  actorId: string | null = null,
): Promise<FlowWriteResult> {
  const row = await getFlowRow(workspaceId, id);
  if (!row) return { ok: false, error: 'not_found' };
  if (patch.version !== undefined && patch.version !== row.version) return { ok: false, error: 'conflict' };
  let graph = parseGraph(row.graph);
  if (patch.graph !== undefined) {
    const v = validateGraph(patch.graph);
    if (!v.ok) return v;
    graph = v.graph;
  }
  let errorFlowId = row.error_flow_id ?? null;
  if (patch.errorFlowId !== undefined) {
    errorFlowId = patch.errorFlowId || null;
    if (errorFlowId && (errorFlowId === id || !(await getFlowRow(workspaceId, errorFlowId)))) {
      return { ok: false, error: 'invalid_error_flow' };
    }
  }
  const graphChanged = patch.graph !== undefined && JSON.stringify(graph) !== row.graph;
  // Quien edita un nodo Gmail de otro pasa a ser el remitente (su casilla).
  const createdBy =
    graphChanged && actorId && actorId !== row.created_by && gmailNodesKey(graph) !== gmailNodesKey(parseGraph(row.graph))
      ? actorId
      : row.created_by;
  const enabled = patch.enabled ?? row.enabled === 1;
  const tf = triggerFields(graph, enabled);
  // Al editar un schedule ya programado, se conserva la próxima corrida si la
  // config del trigger no cambió (el editor manda el grafo entero en cada
  // guardado: recalcular desde ahora postergaría los intervalos).
  const oldTrigger = triggerNode(parseGraph(row.graph));
  const newTrigger = triggerNode(graph);
  const keepNext =
    tf.type === 'trigger.schedule' &&
    enabled &&
    row.enabled === 1 &&
    row.next_run_at &&
    oldTrigger?.type === newTrigger?.type &&
    sameJson(oldTrigger?.config ?? {}, newTrigger?.config ?? {});
  const res = await getDb()
    .prepare(
      `UPDATE flow_flows SET name = ?, description = ?, enabled = ?, graph = ?, version = version + 1,
         trigger_type = ?, trigger_event = ?, next_run_at = ?, error_flow_id = ?, failure_alerts = ?, auto_replay = ?,
         created_by = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND version = ?`,
    )
    .run(
      patch.name?.trim() || row.name,
      patch.description ?? row.description,
      enabled ? 1 : 0,
      JSON.stringify(graph),
      tf.type,
      tf.event,
      keepNext ? row.next_run_at : tf.next,
      errorFlowId,
      patch.failureAlerts === undefined ? (row.failure_alerts === 0 ? 0 : 1) : patch.failureAlerts ? 1 : 0,
      patch.autoReplay === undefined ? (row.auto_replay === 1 ? 1 : 0) : patch.autoReplay ? 1 : 0,
      createdBy,
      nowIso(),
      id,
      workspaceId,
      row.version,
    );
  if (res.changes === 0) return { ok: false, error: 'conflict' };
  if (patch.graph !== undefined) await syncWebhooks(workspaceId, id, graph);
  if (graphChanged) {
    await snapshotVersion(workspaceId, id, row.version + 1, patch.name?.trim() || row.name, graph, actorId);
  }
  return { ok: true, flow: (await getFlow(workspaceId, id))! };
}

export async function deleteFlow(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM flow_flows WHERE id = ? AND user_id = ?').run(id, workspaceId);
  if (res.changes > 0) {
    await getDb().prepare('UPDATE flow_flows SET error_flow_id = NULL WHERE user_id = ? AND error_flow_id = ?').run(workspaceId, id);
  }
  return res.changes > 0;
}

// ---------- Corridas ----------

export async function listRuns(workspaceId: string, flowId: string, limit = 30): Promise<FlowRunDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM flow_runs WHERE flow_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(flowId, workspaceId, Math.min(Math.max(limit, 1), 100))) as FlowRunRow[];
  return rows.map(toRunDto);
}

export async function getRunWithSteps(
  workspaceId: string,
  runId: string,
): Promise<(FlowRunDto & { steps: FlowStepDto[] }) | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM flow_runs WHERE id = ? AND user_id = ?')
    .get(runId, workspaceId)) as FlowRunRow | undefined;
  if (!row) return null;
  const steps = (await getDb()
    .prepare('SELECT * FROM flow_steps WHERE run_id = ? ORDER BY started_at ASC, rowid ASC')
    .all(runId)) as FlowStepRow[];
  return { ...toRunDto(row), steps: steps.map(toStepDto) };
}

/**
 * Cancela una corrida en cola o en espera: borra sus jobs (Esperar, reintentos)
 * y la marca fallida con 'cancelled'. Una corrida que ya está ejecutándose o
 * terminó no se toca.
 */
export async function cancelRun(
  workspaceId: string,
  runId: string,
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'run_not_cancellable' }> {
  const db = getDb();
  const res = await db
    .prepare(
      `UPDATE flow_runs SET status = 'failed', error = 'cancelled', finished_at = ?, locked_until = NULL
       WHERE id = ? AND user_id = ? AND status IN ('queued', 'waiting')`,
    )
    .run(nowIso(), runId, workspaceId);
  if (res.changes === 0) {
    const row = await db.prepare('SELECT 1 FROM flow_runs WHERE id = ? AND user_id = ?').get(runId, workspaceId);
    return { ok: false, error: row ? 'run_not_cancellable' : 'not_found' };
  }
  await db.prepare('DELETE FROM flow_jobs WHERE run_id = ?').run(runId);
  return { ok: true };
}

/** Última salida de cada nodo del flow (para el selector de variables). */
export async function lastOutputs(workspaceId: string, flowId: string): Promise<Record<string, unknown>> {
  const run = (await getDb()
    .prepare(
      "SELECT id FROM flow_runs WHERE flow_id = ? AND user_id = ? AND status IN ('success', 'failed', 'waiting') ORDER BY created_at DESC LIMIT 1",
    )
    .get(flowId, workspaceId)) as { id: string } | undefined;
  if (!run) return {};
  // Una fila por nodo (la última): con Loops una corrida tiene cientos de pasos.
  const steps = (await getDb()
    .prepare(
      `SELECT node_id, output FROM (
         SELECT node_id, output, ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY started_at DESC, rowid DESC) AS rn
         FROM flow_steps WHERE run_id = ? AND status = 'success'
       ) WHERE rn = 1`,
    )
    .all(run.id)) as Array<{ node_id: string; output: string | null }>;
  const out: Record<string, unknown> = {};
  for (const s of steps) out[s.node_id] = parseJson(s.output, null);
  return out;
}

function runsPerHour(): number {
  const n = Number(process.env.FLOW_RUNS_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

/** Corridas por workspace y hora. false = límite alcanzado. */
export async function allowRun(workspaceId: string): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
  const res = await rateLimit(`flow-runs:${workspaceId}`, runsPerHour(), 3600);
  return res.ok;
}

export interface EnqueueOptions {
  chain?: { depth: number; seen: readonly string[] };
  status?: 'queued' | 'running';
  /** Lock inicial (corridas manuales que se ejecutan en el momento). */
  lockMs?: number;
  /** Corrida que la lanzó (sub-flow o flow de error). */
  parentRunId?: string | null;
  /** Corrida original (re-ejecución desde un paso). */
  rerunOf?: string | null;
}

/**
 * Tope del input guardado de una corrida: holgado por encima del body máximo
 * de un webhook (256 KB, que al serializarse puede crecer) más headers y query.
 */
export const MAX_RUN_INPUT = 2_000_000;
/** Input que no entró en MAX_RUN_INPUT: la corrida falla con input_too_large (nunca arranca vacía). */
export const INPUT_TOO_LARGE_KEY = '__flowInputTooLarge';

/** Input serializado para flow_runs.input; si no entra, un marcador explícito (nunca JSON cortado). */
function serializeRunInput(input: unknown): string {
  const json = JSON.stringify(input ?? {});
  return json.length <= MAX_RUN_INPUT ? json : JSON.stringify({ [INPUT_TOO_LARGE_KEY]: json.length });
}

/** Inserta una corrida en cola. null si el workspace superó el límite. */
export async function enqueueRun(
  flow: Pick<FlowFlowRow, 'id' | 'user_id'>,
  triggerType: string,
  input: unknown,
  opts: EnqueueOptions = {},
): Promise<string | null> {
  if (!(await allowRun(flow.user_id))) return null;
  const id = crypto.randomUUID();
  const ts = nowIso();
  const chain = opts.chain ?? { depth: 0, seen: [] };
  const status = opts.status ?? 'queued';
  await getDb()
    .prepare(
      `INSERT INTO flow_runs (id, flow_id, user_id, trigger_type, status, input, chain_depth, chain_seen, locked_until,
         parent_run_id, rerun_of, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      flow.id,
      flow.user_id,
      triggerType,
      status,
      serializeRunInput(input),
      chain.depth,
      JSON.stringify([...new Set([...chain.seen, flow.id])]),
      opts.lockMs ? new Date(Date.now() + opts.lockMs).toISOString() : null,
      opts.parentRunId ?? null,
      opts.rerunOf ?? null,
      ts,
      status === 'running' ? ts : null,
    );
  return id;
}

/**
 * Corrida automática (schedule o evento) que no se encoló por el tope de
 * corridas del workspace: queda en el historial como fallida con
 * 'rate_limited' en lugar de perderse sin rastro. Como mucho una por flow y
 * hora (el registro no puede convertirse en otra fuente de escrituras).
 */
async function recordRateLimitedRun(flow: Pick<FlowFlowRow, 'id' | 'user_id'>, triggerType: string, input: unknown): Promise<void> {
  if (process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(`flow-skipped:${flow.id}`, 1, 3600)).ok) return;
  const ts = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO flow_runs (id, flow_id, user_id, trigger_type, status, input, error, chain_depth, chain_seen,
         created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'failed', ?, 'rate_limited', 0, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), flow.id, flow.user_id, triggerType, serializeRunInput(input), JSON.stringify([flow.id]), ts, ts, ts);
}

const KICK_LIMIT = 5;
const KICK_BUDGET_MS = 20_000;

/**
 * Procesa la cola poco después de responder (after) si hay request en curso;
 * si no (scripts), en segundo plano. En tests no hace nada: se llama al worker
 * explícitamente. Con presupuesto y pocas corridas: corre dentro de la función
 * que encoló (que pudo gastar buena parte de su maxDuration); el resto queda
 * para el cron.
 */
export function kickFlowWorker(): void {
  if (process.env.FLOW_WORKER_KICK === 'false' || process.env.VITEST) return;
  const job = async () => {
    const { processFlowQueue } = await import('./flow-worker');
    await processFlowQueue({ limit: KICK_LIMIT, budgetMs: KICK_BUDGET_MS });
  };
  try {
    after(job);
  } catch {
    void job().catch(() => {});
  }
}

function matchesFilter(config: Record<string, unknown>, data: unknown): boolean {
  const path = typeof config.filterPath === 'string' ? config.filterPath.trim() : '';
  if (!path) return true;
  const op = (typeof config.filterOp === 'string' ? config.filterOp : 'equals') as ConditionOp;
  return compare(getPath(data, path), op, config.filterValue ?? '');
}

/**
 * Encola corridas para los flows habilitados del workspace con un trigger de
 * este evento. Respeta la cadena (flowChain): no se vuelve a disparar un flow
 * que ya corrió en la cadena ni se pasa de MAX_FLOW_CHAIN_DEPTH.
 */
export async function enqueueEventRuns(
  workspaceId: string,
  type: FlowEventType,
  data: Record<string, unknown>,
): Promise<string[]> {
  const parent = flowChain.getStore();
  const depth = parent ? parent.depth + 1 : 0;
  if (depth > MAX_FLOW_CHAIN_DEPTH) return [];
  const rows = (await getDb()
    .prepare(
      "SELECT * FROM flow_flows WHERE user_id = ? AND enabled = 1 AND trigger_type = 'trigger.event' AND trigger_event = ?",
    )
    .all(workspaceId, type)) as FlowFlowRow[];
  const ids: string[] = [];
  for (const row of rows) {
    if (parent?.seen.includes(row.id)) continue;
    const trigger = triggerNode(parseGraph(row.graph));
    if (!trigger || !matchesFilter(trigger.config, data)) continue;
    const input = { ...data, event: { type, at: nowIso() } };
    const id = await enqueueRun(row, 'trigger.event', input, { chain: { depth, seen: parent?.seen ?? [] } });
    if (id) ids.push(id);
    else await recordRateLimitedRun(row, 'trigger.event', input);
  }
  if (ids.length) kickFlowWorker();
  return ids;
}

/** ¿El trigger.webhook acepta este método? (GET, POST o los dos; default POST). */
export function webhookAccepts(accept: unknown, method: string): boolean {
  const m = method.toUpperCase();
  if (accept === 'get_only') return m === 'GET';
  if (accept === 'get_post') return m === 'GET' || m === 'POST';
  return m === 'POST';
}

function sameSecret(a: string, b: string): boolean {
  // Digests de igual largo: timingSafeEqual no filtra el largo del secreto.
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Autenticación de un trigger.webhook con su credencial: api_key exige el
 * header (con el prefijo, si tiene) y basic, Authorization: Basic con usuario
 * y contraseña. `header` lee un header del request (sin distinguir mayúsculas).
 */
export function checkWebhookAuth(
  cred: { type: string; data: Record<string, string> },
  header: (name: string) => string | null,
): boolean {
  if (cred.type === 'api_key') {
    const name = String(cred.data.headerName ?? '').trim();
    const secret = String(cred.data.value ?? '');
    if (!name || !secret) return false;
    const prefix = String(cred.data.prefix ?? '').trim();
    const expected = prefix ? `${prefix} ${secret}` : secret;
    return sameSecret((header(name) ?? '').trim(), expected);
  }
  if (cred.type === 'basic') {
    const got = /^Basic\s+(.+)$/i.exec((header('authorization') ?? '').trim());
    if (!got || !cred.data.password) return false;
    let decoded = '';
    try {
      decoded = Buffer.from(got[1], 'base64').toString('utf8');
    } catch {
      return false;
    }
    return sameSecret(decoded, `${cred.data.username ?? ''}:${cred.data.password}`);
  }
  return false;
}

export type WebhookRunResult =
  | { ok: true; runId: string | null; ignored?: boolean; respond?: 'immediately' | 'reply_node' }
  | {
      ok: false;
      error: 'not_found' | 'disabled' | 'rate_limited' | 'invalid_signature' | 'method_not_allowed' | 'unauthorized';
      /** unauthorized con usuario y contraseña: el route pide credenciales (WWW-Authenticate). */
      basic?: boolean;
    };

/**
 * Webhook entrante: encola si el token existe y el flow está habilitado.
 * trigger.stripe además verifica la firma (Stripe-Signature con el secreto
 * de la credencial) y filtra por tipo de evento; el evento queda como trigger.
 * trigger.webhook valida el método y, si tiene credencial, la autenticación
 * (el header con el secreto no llega al flow). Con respond = reply_node la
 * corrida queda tomada ('running') para que el route la ejecute y responda.
 */
export async function enqueueWebhookRun(
  token: string,
  data: { method: string; body: unknown; query: Record<string, string>; headers: Record<string, string> },
  raw: { body: string; signature: string | null; header?: (name: string) => string | null } = { body: '', signature: null },
): Promise<WebhookRunResult> {
  const hook = (await getDb()
    .prepare(
      `SELECT h.node_id, f.id, f.user_id, f.enabled, f.graph FROM flow_webhooks h
       JOIN flow_flows f ON f.id = h.flow_id WHERE h.token = ?`,
    )
    .get(token)) as { node_id: string; id: string; user_id: string; enabled: number; graph: string } | undefined;
  if (!hook) return { ok: false, error: 'not_found' };
  if (hook.enabled !== 1) return { ok: false, error: 'disabled' };
  const trigger = triggerNode(parseGraph(hook.graph));
  if (!trigger || trigger.id !== hook.node_id) return { ok: false, error: 'not_found' };
  if (trigger.type === 'trigger.stripe') {
    if (data.method.toUpperCase() !== 'POST') return { ok: false, error: 'method_not_allowed' };
    const { resolveCredential } = await import('./flow-credentials');
    const { verifyStripeSignature, stripeEventAllowed } = await import('./flow-integrations');
    const cred = await resolveCredential(hook.user_id, String(trigger.config.credentialId ?? ''));
    const secret = cred?.type === 'stripe' ? cred.data.webhookSecret : '';
    if (!secret || !verifyStripeSignature(raw.body, raw.signature, secret)) return { ok: false, error: 'invalid_signature' };
    const event = (data.body && typeof data.body === 'object' ? data.body : {}) as { id?: unknown; type?: string };
    if (!stripeEventAllowed(trigger.config.events, String(event.type ?? ''))) return { ok: true, runId: null, ignored: true };
    // Stripe puede entregar el mismo evento más de una vez (y reintenta hasta 3 días):
    // si este flow ya tiene una corrida con ese event.id, no se vuelve a correr.
    if (typeof event.id === 'string' && event.id) {
      const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
      const dup = await getDb()
        .prepare(
          `SELECT 1 FROM flow_runs WHERE flow_id = ? AND trigger_type = 'trigger.stripe' AND created_at > ?
             AND json_valid(input) AND json_extract(input, '$.id') = ? LIMIT 1`,
        )
        .get(hook.id, since, event.id);
      if (dup) return { ok: true, runId: null, ignored: true };
    }
    const runId = await enqueueRun({ id: hook.id, user_id: hook.user_id }, 'trigger.stripe', event);
    if (!runId) return { ok: false, error: 'rate_limited' };
    kickFlowWorker();
    return { ok: true, runId };
  }
  if (!webhookAccepts(trigger.config.accept, data.method)) return { ok: false, error: 'method_not_allowed' };
  const headers = { ...data.headers };
  const credId = String(trigger.config.authCredentialId ?? '').trim();
  if (credId) {
    const { resolveCredential } = await import('./flow-credentials');
    const cred = await resolveCredential(hook.user_id, credId);
    // Credencial borrada o de otro tipo: la URL queda cerrada (nunca abierta sin querer).
    const ok = !!cred && (cred.type === 'api_key' || cred.type === 'basic') && checkWebhookAuth(cred, raw.header ?? (() => null));
    if (!ok) return { ok: false, error: 'unauthorized', basic: cred?.type === 'basic' };
    if (cred.type === 'api_key') delete headers[String(cred.data.headerName ?? '').trim().toLowerCase()];
  }
  const respond = trigger.config.respond === 'reply_node' ? 'reply_node' : 'immediately';
  const runId = await enqueueRun(
    { id: hook.id, user_id: hook.user_id },
    'trigger.webhook',
    { ...data, headers },
    respond === 'reply_node' ? { status: 'running', lockMs: 5 * 60_000 } : {},
  );
  if (!runId) return { ok: false, error: 'rate_limited' };
  if (respond === 'immediately') kickFlowWorker();
  return { ok: true, runId, respond };
}

/** Tope del cuerpo de la respuesta del nodo "Responder al webhook". */
export const WEBHOOK_REPLY_LIMIT = 30_000;

export interface WebhookReply {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
}

/** Respuesta que armó el nodo "Responder al webhook" en la corrida (el último que corrió). null si no corrió. */
export async function webhookReply(runId: string): Promise<WebhookReply | null> {
  const step = (await getDb()
    .prepare(
      `SELECT output FROM flow_steps WHERE run_id = ? AND node_type = 'action.webhook_reply' AND status = 'success'
       ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(runId)) as { output: string | null } | undefined;
  const out = parseJson<Partial<WebhookReply> | null>(step?.output, null);
  if (!out || typeof out.status !== 'number' || typeof out.body !== 'string') return null;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(out.headers ?? {})) if (typeof v === 'string') headers[k] = v;
  return { status: out.status, contentType: String(out.contentType ?? 'application/json'), headers, body: out.body };
}

/**
 * Schedules vencidos: avanza next_run_at con compare-and-set (dos crons a la
 * vez no encolan dos veces) y encola una corrida por flow.
 */
export async function enqueueDueSchedules(now: Date = new Date(), limit = 100): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM flow_flows WHERE enabled = 1 AND trigger_type = 'trigger.schedule'
         AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?`,
    )
    .all(now.toISOString(), limit)) as FlowFlowRow[];
  const ids: string[] = [];
  for (const row of rows) {
    const trigger = triggerNode(parseGraph(row.graph));
    if (!trigger || !isTriggerType(trigger.type)) continue;
    const next = computeNextRun(trigger.config, now).toISOString();
    const res = await getDb()
      .prepare('UPDATE flow_flows SET next_run_at = ? WHERE id = ? AND next_run_at = ?')
      .run(next, row.id, row.next_run_at);
    if (res.changes !== 1) continue;
    const input = { scheduledAt: row.next_run_at, firedAt: now.toISOString() };
    const id = await enqueueRun(row, 'trigger.schedule', input);
    if (id) ids.push(id);
    else await recordRateLimitedRun(row, 'trigger.schedule', input);
  }
  return ids;
}

// ---------- Ajustes del workspace y retención ----------

export interface FlowSettingsDto {
  retentionDays: number;
  locale: string;
}

export async function getFlowSettings(workspaceId: string): Promise<FlowSettingsDto> {
  const row = (await getDb().prepare('SELECT * FROM flow_settings WHERE user_id = ?').get(workspaceId)) as
    | FlowSettingsRow
    | undefined;
  return { retentionDays: row?.retention_days ?? DEFAULT_RETENTION_DAYS, locale: row?.locale ?? 'en' };
}

export async function updateFlowSettings(
  workspaceId: string,
  patch: { retentionDays?: number; locale?: string },
): Promise<FlowSettingsDto> {
  const current = await getFlowSettings(workspaceId);
  const days = patch.retentionDays;
  const next = {
    retentionDays: days !== undefined && (RETENTION_DAYS as readonly number[]).includes(days) ? days : current.retentionDays,
    locale: patch.locale && FLOW_LOCALES.includes(patch.locale) ? patch.locale : current.locale,
  };
  await getDb()
    .prepare(
      `INSERT INTO flow_settings (user_id, retention_days, locale, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET retention_days = excluded.retention_days, locale = excluded.locale,
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId, next.retentionDays, next.locale, nowIso());
  return next;
}

const FLOW_LOCALES = ['en', 'es', 'pt'];

/**
 * Idioma de los avisos por email del workspace: el de quien guarda un flow
 * (no hay idioma por persona). Solo escribe si cambió.
 */
export async function rememberFlowLocale(workspaceId: string, locale: string): Promise<void> {
  if (!FLOW_LOCALES.includes(locale)) return;
  await getDb()
    .prepare(
      `INSERT INTO flow_settings (user_id, retention_days, locale, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at
       WHERE flow_settings.locale != excluded.locale`,
    )
    .run(workspaceId, DEFAULT_RETENTION_DAYS, locale, nowIso());
}

/** Corridas por lote al purgar (cada una se lleva sus pasos). */
const PRUNE_BATCH = 200;

/**
 * Borra las corridas terminadas (y sus pasos) más viejas que la retención
 * de su workspace (flow_settings.retention_days, 30 días por defecto). Por
 * lotes acotados y con presupuesto de tiempo: lo que no entra sigue en el
 * próximo tick. Nunca borra la última corrida de cada flow (el selector de
 * variables la usa) ni una con replay pendiente. La llama el tick horario.
 */
export async function pruneFlowRuns(
  opts: { now?: Date; batch?: number; maxBatches?: number; budgetMs?: number } = {},
): Promise<{ runs: number; batches: number }> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const batch = Math.min(Math.max(opts.batch ?? PRUNE_BATCH, 1), 1000);
  const maxBatches = Math.max(opts.maxBatches ?? 10, 1);
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  let runs = 0;
  let batches = 0;
  while (batches < maxBatches && Date.now() < deadline) {
    const rows = (await db
      .prepare(
        `SELECT r.id FROM flow_runs r
         LEFT JOIN flow_settings s ON s.user_id = r.user_id
         WHERE r.status IN ('success', 'failed') AND r.replay_at IS NULL
           AND r.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || COALESCE(s.retention_days, ?) || ' days')
           AND r.id != (SELECT r2.id FROM flow_runs r2 WHERE r2.flow_id = r.flow_id ORDER BY r2.created_at DESC LIMIT 1)
         ORDER BY r.created_at ASC LIMIT ?`,
      )
      .all(now, DEFAULT_RETENTION_DAYS, batch)) as Array<{ id: string }>;
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    // Los pasos primero (explícito: no depende de que el FK esté activo).
    await db.prepare(`DELETE FROM flow_steps WHERE run_id IN (${ph})`).run(...ids);
    const res = await db.prepare(`DELETE FROM flow_runs WHERE id IN (${ph})`).run(...ids);
    runs += res.changes;
    batches += 1;
    if (rows.length < batch) break;
  }
  return { runs, batches };
}
