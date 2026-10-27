import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext, notFound, runErrorCode } from '@/lib/agents-http';
import { listReplayCandidates, replayConversation } from '@/lib/agents-sim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Conversaciones reales recientes que se pueden repetir contra el borrador. */
export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 10);
  return NextResponse.json({ conversations: await listReplayCandidates(ctx.user.id, id, Number.isFinite(limit) ? limit : 10) });
}

const schema = z.object({ conversationId: z.string().min(1).max(100) });

/** Repite una conversación (de a una por request, como los tests). */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    const result = await replayConversation(ctx.row, parsed.data.conversationId, ctx.personId);
    if (!result) return notFound();
    return NextResponse.json({ result });
  } catch (err) {
    const { code, status } = runErrorCode(err);
    return agentError(status, code);
  }
}
