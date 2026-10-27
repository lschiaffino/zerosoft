import { NextRequest, NextResponse } from 'next/server';
import { agentRouteContext, notFound } from '@/lib/agents-http';
import { deleteMemory } from '@/lib/agents-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Olvidar un dato que el agente recordaba de un visitante. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; mid: string }> }) {
  const { id, mid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  if (!(await deleteMemory(ctx.user.id, id, mid))) return notFound();
  return NextResponse.json({ ok: true });
}
