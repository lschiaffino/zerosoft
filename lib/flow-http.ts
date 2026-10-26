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
import { allowRun, enqueueRun, getFlowRow, getRunWithSteps, lastOutputs, parseJson, toFlowDto } from './flow';
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

/** Corrida manual: se ejecuta en el momento (con lock) y devuelve los pasos. */
export async function runFlowNow(workspaceId: string, flowId: string, input: Record<string, unknown> | undefined) {
  const row = await getFlowRow(workspaceId, flowId);
  if (!row) return { ok: false as const, error: 'not_found' };
  const graph = parseJson<FlowGraph>(row.graph, { nodes: [], edges: [] });
  const runId = await enqueueRun(row, 'manual', testInput(graph, input), { status: 'running', lockMs: 5 * 60_000 });
  if (!runId) return { ok: false as const, error: 'rate_limited' };
  await executeRun(runId);
  return { ok: true as const, run: await getRunWithSteps(workspaceId, runId) };
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
  /** Quien prueba: los datos fijados solo se usan si es quien creó el flow. */
  personId?: string,
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
    const { pins } = toFlowDto(row, personId);
    const trigger = triggerNode(graph);
    sample = {
      trigger: (trigger && pins[trigger.id]) ?? testInput(graph, undefined),
      nodes: { ...(await lastOutputs(workspaceId, flowId)), ...pins },
    };
  }
  return { ok: true, result: await testFlowStep(row, node, sample) };
}
