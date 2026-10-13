import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createAgent, listAgents } from '@/lib/agents';
import { agentCreateSchema } from '@/lib/agents-config';
import { agentError, canEditAgents, forbidden, realUserId, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Agentes del workspace (cualquier miembro puede verlos). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ agents: await listAgents(user.id), canEdit: canEditAgents(user) });
}

/** Crea un agente (vacío o desde una plantilla). Solo admins. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const parsed = agentCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const agent = await createAgent(user.id, realUserId(user), parsed.data);
  return NextResponse.json(agent, { status: 201 });
}
