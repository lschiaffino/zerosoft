import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { decideAgentAction } from '@/lib/agents-approvals';
import { agentError, notFound, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ decision: z.enum(['approve', 'reject']) });

/** Aprueba (ejecuta) o rechaza una acción pendiente del agente. Cualquier persona del workspace. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const actor = user.actingUser?.email ?? user.email;
  const res = await decideAgentAction(user.id, id, aid, parsed.data.decision, actor);
  if (!res.ok) return res.error === 'already_decided' ? agentError(409, 'already_decided') : notFound();
  return NextResponse.json({ action: res.action });
}
