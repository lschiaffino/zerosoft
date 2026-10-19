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

/** Código de error estable para cualquier falla de una corrida. */
export function runErrorCode(err: unknown): { code: string; status: number } {
  if (err instanceof AgentError) return { code: err.code, status: err.status };
  if (err instanceof AiError) {
    return { code: err.code, status: err.code === 'ai_disabled' ? 503 : err.code === 'quota_exceeded' ? 402 : 429 };
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
