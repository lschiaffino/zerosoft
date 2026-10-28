/**
 * Flow — helpers de las rutas API (app/api/flow/**). Errores { error: '<code>' };
 * los códigos se traducen en el editor con flow.errors.*.
 */
import { NextResponse } from 'next/server';
import type { SessionUser } from './session';
import { roleAtLeast } from './teams';
import type { z } from 'zod';
import {
  EVENT_SAMPLES,
  FLOW_TEMPLATES,
  isStepTestable,
  triggerNode,
  type flowStepTestSchema,
  type FlowEventType,
  type FlowGraph,
  type FlowNode,
} from './flow-schema';
import { allowRun, enqueueRun, getFlowDraft, getFlowRow, getRunWithSteps, lastOutputs, parseJson, toFlowDto, type FlowRunViewer } from './flow';
import { executeRun, testFlowStep, type StepTestResult } from './flow-engine';

export function flowError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export const unauthorized = () => flowError(401, 'unauthorized');
export const forbidden = () => flowError(403, 'forbidden');
export const notFound = () => flowError(404, 'not_found');

/**
 * Crear, editar, borrar y correr flows: admins y owners del workspace (igual
 * que isWorkspaceAdmin de lib/session; acá sin importar next-auth).
 */
export function canEditFlows(user: Pick<SessionUser, 'role'>): boolean {
  return roleAtLeast(user.role, 'admin');
}

/** Quién mira las corridas (datos solo para quien creó el flow y admins). */
export function runViewer(user: Pick<SessionUser, 'id' | 'actingUser' | 'role'>): { personId: string; admin: boolean } {
  return { personId: user.actingUser?.id ?? user.id, admin: roleAtLeast(user.role, 'admin') };
}

/**
 * ¿Puede re-ejecutar la corrida? Reusa datos capturados con el acceso de una
 * persona (captured_by) y la nueva corre con el de quien creó el flow hoy:
 * tienen que ser la misma, y ser quien lo pide.
 */
export async function runOwnedBy(workspaceId: string, runId: string, personId: string): Promise<boolean> {
  const { getDb } = await import('./db');
  const row = (await getDb()
    .prepare('SELECT r.captured_by, f.created_by FROM flow_runs r JOIN flow_flows f ON f.id = r.flow_id WHERE r.id = ? AND r.user_id = ?')
    .get(runId, workspaceId)) as { captured_by: string | null; created_by: string | null } | undefined;
  return Boolean(row?.created_by && row.created_by === personId && row.captured_by === personId);
}

/** Persona real logueada (no el dueño del workspace). */
export function realUserId(user: Pick<SessionUser, 'id' | 'actingUser'>): string {
  return user.actingUser?.id ?? user.id;
}

export function templateGraph(key: string | undefined): FlowGraph | undefined {
  if (!key) return undefined;
  const t = FLOW_TEMPLATES.find((x) => x.key === key);
  return t ? (JSON.parse(JSON.stringify(t.graph)) as FlowGraph) : undefined;
}

/** Datos de prueba para "Test run" según el tipo de trigger. */
export function testInput(graph: FlowGraph, input: Record<string, unknown> | undefined): Record<string, unknown> {
  const trigger = triggerNode(graph);
  if (input && Object.keys(input).length) {
    if (trigger?.type === 'trigger.webhook' && !('body' in input)) {
      return { method: 'POST', body: input, query: {}, headers: {} };
    }
    return input;
  }
  switch (trigger?.type) {
    case 'trigger.manual': {
      const raw = trigger.config.sample;
      const v = typeof raw === 'string' ? parseJson<unknown>(raw, {}) : raw;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    }
    case 'trigger.event': {
      const type = String(trigger.config.event ?? '') as FlowEventType;
      return { ...(EVENT_SAMPLES[type] ?? {}), event: { type, at: new Date().toISOString(), test: true } };
    }
    case 'trigger.webhook':
      return { method: 'POST', body: {}, query: {}, headers: {} };
    case 'trigger.schedule':
      return { scheduledAt: new Date().toISOString(), firedAt: new Date().toISOString() };
    default:
      return {};
  }
}

/**
 * Corrida manual: se ejecuta en el momento (con lock) y devuelve los pasos.
 * Con `draft` corre el borrador sin publicar con el acceso de quien la lanza
 * (como "Probar paso"): nunca el acceso del dueño sobre un grafo que no publicó.
 */
export async function runFlowNow(
  workspaceId: string,
  flowId: string,
  input: Record<string, unknown> | undefined,
  viewer?: FlowRunViewer,
  opts: { draft?: boolean; draftRev?: number } = {},
) {
  const row = await getFlowRow(workspaceId, flowId);
  if (!row) return { ok: false as const, error: 'not_found' };
  if (opts.draft && !viewer) return { ok: false as const, error: 'forbidden' };
  // Solo el borrador propio, y el que se ve en el editor (revisión igual).
  const own = opts.draft && viewer ? await getFlowDraft(flowId, viewer.personId) : null;
  if (opts.draft && (!own || (opts.draftRev !== undefined && opts.draftRev !== own.rev))) return { ok: false as const, error: 'conflict' };
  const draft = own?.graph ?? null;
  const graph = draft ?? parseJson<FlowGraph>(row.graph, { nodes: [], edges: [] });
  const runInput = testInput(graph, input);
  // Una corrida manual lleva datos que elige quien la lanza: corre con SU acceso
  // (su borrador, o lo publicado si no es quien creó el flow), nunca con el del
  // dueño. Solo el dueño corre lo publicado con el acceso del flow.
  const actAs = viewer && (draft || viewer.personId !== row.created_by) ? viewer.personId : null;
  const runId = await enqueueRun(row, 'manual', runInput, {
    status: 'running',
    lockMs: 5 * 60_000,
    ...(actAs ? { capturedBy: actAs } : {}),
  });
  if (!runId) return { ok: false as const, error: 'rate_limited' };
  if (actAs) {
    const { getDb } = await import('./db');
    await getDb()
      .prepare('UPDATE flow_runs SET context = ? WHERE id = ?')
      .run(JSON.stringify({ graph, trigger: runInput, nodes: {}, actor: actAs }), runId);
  }
  await executeRun(runId);
  return { ok: true as const, run: await getRunWithSteps(workspaceId, runId, viewer) };
}

/**
 * "Probar paso": corre un nodo solo. El nodo puede venir del editor (config sin
 * guardar); los datos de prueba, del editor o, si no, de lo fijado en el flow
 * y la última corrida (el trigger cae en sus datos de prueba).
 */
export async function testStepNow(
  workspaceId: string,
  flowId: string,
  body: z.infer<typeof flowStepTestSchema>,
  /** Quien prueba: el paso corre con su acceso (no el de quien creó el flow) y ve sus propios datos. */
  viewer?: { personId: string; admin: boolean },
): Promise<{ ok: true; result: StepTestResult } | { ok: false; error: 'not_found' | 'node_not_found' | 'step_not_testable' | 'rate_limited' }> {
  const row = await getFlowRow(workspaceId, flowId);
  if (!row) return { ok: false, error: 'not_found' };
  const graph = parseJson<FlowGraph>(row.graph, { nodes: [], edges: [] });
  const saved = graph.nodes.find((n) => n.id === body.nodeId);
  const node: FlowNode | null = body.node
    ? { id: body.nodeId, type: body.node.type as FlowNode['type'], position: { x: 0, y: 0 }, config: body.node.config }
    : (saved ?? null);
  if (!node) return { ok: false, error: 'node_not_found' };
  if (!isStepTestable(node.type)) return { ok: false, error: 'step_not_testable' };
  if (!(await allowRun(workspaceId))) return { ok: false, error: 'rate_limited' };
  let sample = body.context;
  if (!sample) {
    // Datos fijados y salidas: solo los de quien prueba (lo capturado con su acceso).
    const { pins } = toFlowDto(row, viewer ? viewer.personId : undefined);
    const trigger = triggerNode(graph);
    sample = {
      trigger: (trigger && pins[trigger.id]) ?? testInput(graph, undefined),
      nodes: { ...(await lastOutputs(workspaceId, flowId, viewer)), ...pins },
    };
  }
  return { ok: true, result: await testFlowStep(viewer ? { ...row, created_by: viewer.personId } : row, node, sample) };
}
