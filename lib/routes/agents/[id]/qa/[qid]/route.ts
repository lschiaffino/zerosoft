import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext, notFound } from '@/lib/agents-http';
import { AGENT_QA_MAX_VARIANTS, deleteQa, KnowledgeError, updateQa } from '@/lib/agents-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; qid: string }> };

const schema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(4000),
  variants: z.array(z.string().max(500)).max(AGENT_QA_MAX_VARIANTS).optional(),
});

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, qid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    const qa = await updateQa(ctx.user.id, id, qid, parsed.data, ctx.personId);
    if (!qa) return notFound();
    return NextResponse.json({ qa });
  } catch (err) {
    if (err instanceof KnowledgeError) return agentError(err.status, err.code);
    throw err;
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id, qid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  if (!(await deleteQa(ctx.user.id, id, qid, ctx.personId))) return notFound();
  return NextResponse.json({ ok: true });
}
