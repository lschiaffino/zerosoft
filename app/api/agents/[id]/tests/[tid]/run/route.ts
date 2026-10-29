import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { runTestCase } from '@/lib/agents-tests';
import { agentError, notFound, realUserId, runErrorCode, unauthorized, visibleAgentRow } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; tid: string }> };

/**
 * Corre un caso de prueba (simulación + juez). Uno por request: la UI los
 * corre de a uno para no chocar con el timeout de la función.
 */
export async function POST(_req: NextRequest, props: Ctx) {
  const { id, tid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const agent = await visibleAgentRow(user, id);
  if (!agent) return notFound();
  try {
    const res = await runTestCase(agent, tid, realUserId(user));
    if (!res.ok) return notFound();
    return NextResponse.json({ test: res.test });
  } catch (err) {
    const { code, status } = runErrorCode(err);
    return agentError(status, code);
  }
}
