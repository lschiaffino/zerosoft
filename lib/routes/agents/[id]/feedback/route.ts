import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { setMessageFeedback } from '@/lib/agents';
import { agentError, notFound, realUserId, unauthorized, visibleAgentRow } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  conversationId: z.string().min(1).max(100),
  messageId: z.string().min(1).max(100),
  rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  note: z.string().max(1000).optional(),
});

/** Pulgar arriba/abajo (+ nota) sobre una respuesta del agente. 0 = quitar. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await visibleAgentRow(user, id))) return notFound();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const ok = await setMessageFeedback(user.id, id, { ...parsed.data, createdBy: realUserId(user) });
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
