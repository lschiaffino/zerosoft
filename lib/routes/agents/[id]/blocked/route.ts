import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext, notFound } from '@/lib/agents-http';
import { listBlockedVisitors, unblockVisitor } from '@/lib/agents-privacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Visitantes bloqueados (desde Conversaciones). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ blocked: await listBlockedVisitors(ctx.user.id, id) });
}

const schema = z.object({ unblock: z.string().min(1).max(100) });

export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  if (!(await unblockVisitor(ctx.user.id, id, parsed.data.unblock))) return notFound();
  return NextResponse.json({ blocked: await listBlockedVisitors(ctx.user.id, id) });
}
