import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getAgentRow } from '@/lib/agents';
import { agentError, notFound, realUserId, streamAgentReply, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  conversationId: z.string().min(1).max(100).nullish(),
  message: z.string().trim().min(1).max(4000),
});

/** Playground: cualquier miembro puede probar el agente (respuesta en streaming NDJSON). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const agent = await getAgentRow(user.id, id);
  if (!agent) return notFound();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  return streamAgentReply({
    agent,
    channel: 'playground',
    text: parsed.data.message,
    conversationId: parsed.data.conversationId ?? null,
    createdBy: realUserId(user),
    abortSignal: req.signal,
  });
}
