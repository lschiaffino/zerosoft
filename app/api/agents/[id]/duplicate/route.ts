import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { duplicateAgent } from '@/lib/agents';
import { agentError, canEditAgents, forbidden, notFound, realUserId, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Duplica un agente con su configuración (sin canales, secretos ni conversaciones). Solo admins. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name : undefined;
  if (name !== undefined && name.length > 200) return agentError(400, 'invalid_input');
  const agent = await duplicateAgent(user.id, id, realUserId(user), name);
  if (!agent) return notFound();
  return NextResponse.json(agent, { status: 201 });
}
