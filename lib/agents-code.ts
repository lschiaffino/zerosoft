/**
 * Agents — funciones de código propio (run_code y el paso "Acción" de un
 * procedimiento). El código es el cuerpo de una función async que recibe
 * `input` (los parámetros declarados) y devuelve un valor JSON. Corre en el
 * mismo runner que el nodo Código de Flow (lib/flow-code.ts): una microVM
 * efímera de Vercel Sandbox, sin red, con tope de tiempo, memoria y salida.
 * Nunca en el proceso del servidor. Server-only.
 */
import type { AgentCodeFunction } from './agents-config';
import { flowCodeAvailable, runFlowCode } from './flow-code';

export function agentCodeAvailable(): boolean {
  return flowCodeAvailable();
}

/** Valida y convierte los parámetros al tipo declarado. Devuelve el error o el input limpio. */
export function coerceCodeInput(fn: AgentCodeFunction, raw: unknown): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const input: Record<string, unknown> = {};
  for (const p of fn.params) {
    const v = src[p.name];
    if (v === undefined || v === null || v === '') {
      input[p.name] = null;
      continue;
    }
    if (p.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) return { ok: false, error: `invalid_param:${p.name}` };
      input[p.name] = n;
    } else if (p.type === 'boolean') {
      input[p.name] = v === true || v === 'true' || v === 1 || v === '1';
    } else {
      input[p.name] = String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 10_000);
    }
  }
  return { ok: true, input };
}

export async function runAgentCode(fn: AgentCodeFunction, raw: unknown): Promise<Record<string, unknown>> {
  const coerced = coerceCodeInput(fn, raw);
  if (!coerced.ok) return { error: coerced.error };
  if (!agentCodeAvailable()) return { error: 'code_unavailable' };
  const res = await runFlowCode({ code: fn.code, input: coerced.input, timeoutMs: fn.timeoutSec * 1000 });
  if (!res.ok) return { error: res.error.slice(0, 300), ...(res.logs ? { logs: res.logs.slice(0, 1000) } : {}) };
  return { result: res.result as unknown, ...(res.logs ? { logs: res.logs.slice(0, 1000) } : {}) };
}
