import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { notFound, unauthorized } from '@/lib/crm-http';
import { applyItem, getRun } from '@/lib/crm-ai-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Aplica todos los ítems listos de una corrida de datos. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const run = await getRun(user.id, id, scope);
  if (!run || run.run.agent === 'outreach') return notFound();
  let applied = 0;
  for (const item of run.items) {
    if (item.status !== 'ready') continue;
    await applyItem({ workspaceId: user.id, runId: id, itemId: item.id, scope, actorEmail: user.actingUser?.email ?? user.email }).catch(() => null);
    applied++;
  }
  const fresh = await getRun(user.id, id, scope);
  return NextResponse.json({ applied, ...fresh });
}
