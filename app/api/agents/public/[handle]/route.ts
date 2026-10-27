import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAgentByHandle, listVisitorMessages } from '@/lib/agents';
import { agentError, streamAgentReply } from '@/lib/agents-http';
import { limitByIp } from '@/lib/rate-limit';
import { requestCountry } from '@/lib/agents-privacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
    country: requestCountry(req),
    abortSignal: req.signal,
  });
}

/**
 * Página pública: historial de la conversación del visitante (con su
 * visitorKey) y si está derivada. El chat lo consulta cada pocos segundos
 * mientras espera la respuesta de una persona del equipo.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;
  const limited = await limitByIp(req, 'agent-public-poll', 60, 60, handle.toLowerCase());
  if (limited) return limited;
  const agent = await getAgentByHandle(handle);
  if (!agent || agent.enabled !== 1) return agentError(404, 'not_found');
  const sp = req.nextUrl.searchParams;
  const conversationId = sp.get('conversationId') ?? '';
  const visitorKey = sp.get('visitorKey') ?? '';
  if (!conversationId || visitorKey.length < 16) return agentError(400, 'invalid_input');
  const data = await listVisitorMessages(agent, conversationId, visitorKey);
  if (!data) return agentError(404, 'conversation_not_found');
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
