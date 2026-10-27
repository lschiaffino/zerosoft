import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getAgentRow, sendAgentMessage } from '@/lib/agents';
import { runErrorCode } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).max(100).nullish(),
  /**
   * Usuario de tu sistema que habla con el agente. Lo afirma quien tiene la
   * API key (tu servidor): el agente lee su CRM, sus reservas y sus issues y
   * lo recuerda entre conversaciones si el agente lo tiene activo.
   */
  user: z
    .object({
      id: z.string().trim().min(1).max(200).optional(),
      email: z.string().trim().email().max(200).optional(),
      name: z.string().trim().max(120).optional(),
    })
    .optional(),
});

/**
 * Envía un mensaje al agente y devuelve su respuesta (con las herramientas
 * que usó). Para seguir la conversación, mandá el conversationId devuelto.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'agents:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const agent = await getAgentRow(auth.user.id, id);
  if (!agent) return apiError(404, 'not_found', 'Agent not found.');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Body must be { "message": string, "conversationId"?: string, "user"?: { "id"?: string, "email"?: string, "name"?: string } }.');
  try {
    const res = await sendAgentMessage({
      agent,
      channel: 'api',
      text: parsed.data.message,
      conversationId: parsed.data.conversationId ?? null,
      // La key actúa como quien la creó: con su acceso trabaja el agente en Docs.
      createdBy: auth.personId,
      identity: parsed.data.user
        ? { email: parsed.data.user.email ?? null, name: parsed.data.user.name ?? null, externalId: parsed.data.user.id ?? null }
        : null,
    });
    return NextResponse.json({
      conversationId: res.conversation.id,
      message: res.reply
        ? { id: res.reply.id, role: 'assistant', content: res.reply.content, createdAt: res.reply.created_at }
        : null,
      status: res.result.status,
      handoff: res.result.handoff,
      toolCalls: res.result.toolCalls.map((c) => ({ tool: c.tool, input: c.input, output: c.output, error: c.error })),
    });
  } catch (err) {
    const { code, status } = runErrorCode(err);
    return apiError(status, code, code);
  }
}
