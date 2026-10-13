import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAgentByHandle } from '@/lib/agents';
import { agentError, streamAgentReply } from '@/lib/agents-http';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  conversationId: z.string().min(1).max(100).nullish(),
  /** Token aleatorio del navegador: solo quien lo tiene continúa la conversación. */
  visitorKey: z.string().min(16).max(100),
  message: z.string().trim().min(1).max(2000),
});

function perMinute(): number {
  const n = Number(process.env.AGENT_PUBLIC_LIMIT_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12;
}

/** Página pública /a/<handle>: mensaje del visitante → respuesta en streaming (NDJSON). */
export async function POST(req: NextRequest, props: { params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;
  const limited = await limitByIp(req, 'agent-public', perMinute(), 60, handle.toLowerCase());
  if (limited) return limited;
  const agent = await getAgentByHandle(handle);
  if (!agent || agent.enabled !== 1) return agentError(404, 'not_found');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  return streamAgentReply({
    agent,
    channel: 'public',
    text: parsed.data.message,
    conversationId: parsed.data.conversationId ?? null,
    visitorKey: parsed.data.visitorKey,
    abortSignal: req.signal,
  });
}
