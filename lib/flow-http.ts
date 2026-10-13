/**
 * Flow — helpers de las rutas API (app/api/flow/**). Errores { error: '<code>' };
 * los códigos se traducen en el editor con flow.errors.*.
 */
import { NextResponse } from 'next/server';
import type { SessionUser } from './session';
import { roleAtLeast } from './teams';
import { EVENT_SAMPLES, FLOW_TEMPLATES, triggerNode, type FlowEventType, type FlowGraph } from './flow-schema';
import { enqueueRun, getFlowRow, getRunWithSteps, parseJson } from './flow';
import { executeRun } from './flow-engine';

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
