import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { AGENT_QA_MAX_VARIANTS, createQa, importQaCsv, KnowledgeError, listQa } from '@/lib/agents-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ qa: await listQa(id) });
}

const schema = z.union([
  z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(4000),
    variants: z.array(z.string().max(500)).max(AGENT_QA_MAX_VARIANTS).optional(),
  }),
  z.object({ csv: z.string().min(1).max(2_000_000) }),
]);

/** Agrega un par, o varios desde un CSV ({ csv }). */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    if ('csv' in parsed.data) {
      const res = await importQaCsv(ctx.row, parsed.data.csv, ctx.personId);
      return NextResponse.json({ ...res, qa: await listQa(id) });
    }
    const qa = await createQa(ctx.row, parsed.data, ctx.personId);
    return NextResponse.json({ qa }, { status: 201 });
  } catch (err) {
    if (err instanceof KnowledgeError) return agentError(err.status, err.code);
    throw err;
  }
}
