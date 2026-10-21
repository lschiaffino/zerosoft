/**
 * Agents — helpers de las rutas API (app/api/agents/**, /api/v1/agents/**).
 * Errores { error: '<code>' }; la UI los traduce con agents.errors.*.
 */
import { NextResponse } from 'next/server';
import type { SessionUser } from './session';
import { roleAtLeast } from './teams';
import { AiError, aiEnabled } from './ai';
import { AgentError, sendAgentMessage, type SendAgentMessageOptions } from './agents';
import type { AgentStreamEvent } from './agents-config';

export function agentError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export const unauthorized = () => agentError(401, 'unauthorized');
export const forbidden = () => agentError(403, 'forbidden');
export const notFound = () => agentError(404, 'not_found');

/** Crear y editar agentes: admins y owners (como Flow y los workflows del CRM). */
export function canEditAgents(user: Pick<SessionUser, 'role'>): boolean {
  return roleAtLeast(user.role, 'admin');
}

export function realUserId(user: Pick<SessionUser, 'id' | 'actingUser'>): string {
  return user.actingUser?.id ?? user.id;
}

/**
 * Falla del proveedor de AI (AI Gateway u otro) que la persona puede resolver:
 * credenciales inválidas, cuenta sin créditos o sin acceso al modelo, o
 * demasiados pedidos. Revisa el error y sus `cause`. Null si es otra cosa.
 */
export function aiProviderErrorCode(err: unknown): 'ai_auth' | 'ai_no_credits' | 'rate_limited' | null {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as { name?: unknown; message?: unknown; statusCode?: unknown; status?: unknown; responseBody?: unknown; cause?: unknown };
    const name = typeof e.name === 'string' ? e.name : '';
    const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`;
    const status = Number(e.statusCode ?? e.status);
    if (/free tier|credits|insufficient[_ ]funds|top-up|payment required|RestrictedModels|no_providers_available/i.test(text) || status === 402) {
      return 'ai_no_credits';
    }
    if (/GatewayAuthenticationError/.test(name) || status === 401 || /invalid api key|unauthenticated|authentication/i.test(text)) {
      return 'ai_auth';
    }
    if (/RateLimit/.test(name) || status === 429) return 'rate_limited';
    cur = e.cause;
  }
  return null;
}

/** Código de error estable para cualquier falla de una corrida. */
export function runErrorCode(err: unknown): { code: string; status: number } {
  if (err instanceof AgentError) return { code: err.code, status: err.status };
  if (err instanceof AiError) {
    return { code: err.code, status: err.code === 'ai_disabled' ? 503 : err.code === 'quota_exceeded' ? 402 : 429 };
  }
  const provider = aiProviderErrorCode(err);
  if (provider) {
    console.warn('[agents] AI provider refused', provider, err instanceof Error ? err.message : err);
    return { code: provider, status: provider === 'rate_limited' ? 429 : 502 };
  }
  console.error('[agents] run failed', err);
  return { code: 'generic', status: 500 };
}

/**
 * Respuesta en streaming (NDJSON: un AgentStreamEvent por línea) para el
 * playground y la página pública. Sin dependencias de cliente (fetch + reader).
 */
export function streamAgentReply(
  opts: Omit<SendAgentMessageOptions, 'onEvent' | 'stream'>,
): Response {
  // Sin AI no hay stream (salvo en una conversación existente, que puede estar
  // derivada a una persona: sendAgentMessage decide).
  if (!aiEnabled() && !opts.conversationId) return agentError(503, 'ai_disabled');
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // El cliente cerró la conexión.
        }
      };
      try {
        const res = await sendAgentMessage({ ...opts, stream: true, onEvent: emit });
        emit({
          type: 'done',
          messageId: res.reply?.id ?? null,
          text: res.result.text,
          status: res.result.status,
          handoff: res.result.handoff,
        });
      } catch (err) {
        emit({ type: 'error', code: runErrorCode(err).code });
      } finally {
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
