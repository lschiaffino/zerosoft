import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { addTeammateReply, getConversationDetail } from '@/lib/agents';
import { agentError, notFound, realUserId, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Una conversación con sus mensajes, feedback y llamadas a herramientas. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const detail = await getConversationDetail(user.id, id, cid);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

const replySchema = z.object({ message: z.string().trim().min(1).max(4000) });

/**
 * Respuesta de una persona del equipo (página pública / API). El visitante la
 * recibe en /a/<handle>; la conversación queda derivada (el agente no contesta más).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = replySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const res = await addTeammateReply(user.id, id, cid, parsed.data.message, realUserId(user));
  if (!res.ok) return res.error === 'not_found' ? notFound() : agentError(400, res.error);
  return NextResponse.json({ message: res.message });
}
