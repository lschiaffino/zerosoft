import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { addTeammateReply, getConversationDetail, getConversationRow } from '@/lib/agents';
import { agentError, agentRouteContext, notFound, realUserId, unauthorized } from '@/lib/agents-http';
import { parseScore, setConversationReview } from '@/lib/agents-quality';
import { listMemories } from '@/lib/agents-context';
import { blockConversationVisitor } from '@/lib/agents-privacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; cid: string }> };

/** Una conversación con sus mensajes, feedback, llamadas a herramientas, puntaje y memoria del visitante. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id, cid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const detail = await getConversationDetail(user.id, id, cid, user.actingUser?.id ?? user.id);
  if (!detail) return notFound();
  const row = await getConversationRow(cid);
  const memories = row?.visitor_ref ? await listMemories(id, row.visitor_ref) : [];
  return NextResponse.json({ ...detail, score: row ? parseScore(row) : null, memories, hasVisitor: Boolean(row?.visitor_key || row?.chat_conversation_id) });
}

const replySchema = z.object({ message: z.string().trim().min(1).max(4000) });

/**
 * Respuesta de una persona del equipo (página pública / API). El visitante la
 * recibe en /a/<handle>; la conversación queda derivada (el agente no contesta más).
 */
export async function POST(req: NextRequest, props: Ctx) {
  const { id, cid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = replySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const res = await addTeammateReply(user.id, id, cid, parsed.data.message, realUserId(user));
  if (!res.ok) return res.error === 'not_found' ? notFound() : agentError(400, res.error);
  return NextResponse.json({ message: res.message });
}

const patchSchema = z.object({
  reviewed: z.boolean().optional(),
  reviewNote: z.string().max(1000).optional(),
  block: z.literal(true).optional(),
});

/** Cola de revisión (marcar revisada con nota) y bloquear al visitante. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, cid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const conv = await getConversationRow(cid);
  if (!conv || conv.user_id !== ctx.user.id || conv.agent_id !== id) return notFound();
  if (parsed.data.block) {
    const res = await blockConversationVisitor(ctx.user.id, id, conv, ctx.personId);
    if (!res.ok) return agentError(400, res.error);
  }
  if (parsed.data.reviewed !== undefined) {
    const email = ctx.user.actingUser?.email ?? ctx.user.email;
    await setConversationReview(ctx.user.id, id, cid, { reviewed: parsed.data.reviewed, note: parsed.data.reviewNote }, email);
  }
  const row = await getConversationRow(cid);
  return NextResponse.json({ score: row ? parseScore(row) : null, reviewedAt: row?.reviewed_at ?? null, reviewNote: row?.review_note ?? '' });
}
