import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listAgentActions } from '@/lib/agents-approvals';
import { agentError, canEditAgents, forbidden, unauthorized } from '@/lib/agents-http';
import type { AgentPendingActionDto } from '@/lib/agents-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: ReadonlyArray<AgentPendingActionDto['status']> = ['pending', 'approved', 'rejected', 'failed'];

/** Acciones del agente que pidieron aprobación (?conversationId=, ?status=). */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Las acciones traen datos del visitante (CRM, emails) y efectos de herramientas que configuran los admins.
  if (!canEditAgents(user)) return forbidden();
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  if (status && !STATUSES.includes(status as AgentPendingActionDto['status'])) return agentError(400, 'invalid_input');
  const actions = await listAgentActions(user.id, id, {
    conversationId: sp.get('conversationId') || undefined,
    status: (status as AgentPendingActionDto['status'] | null) ?? undefined,
  });
  return NextResponse.json({ actions });
}
