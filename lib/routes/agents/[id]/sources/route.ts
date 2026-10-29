import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { addSource, listSources, removeSource, resyncSource, SourceError } from '@/lib/agents-sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ sources: await listSources(id) });
}

const schema = z.union([
  z.object({ kind: z.literal('zendesk'), target: z.string().trim().min(2).max(300) }),
  z.object({ resync: z.string().min(1).max(100) }),
]);

/** Agrega un centro de ayuda de Zendesk ({ kind, target }) o lo vuelve a leer ({ resync: id }). */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    if ('resync' in parsed.data) {
      const sources = await resyncSource(ctx.row, parsed.data.resync);
      return sources ? NextResponse.json({ sources }) : agentError(404, 'not_found');
    }
    return NextResponse.json({ sources: await addSource(ctx.row, parsed.data.kind, parsed.data.target, ctx.personId) }, { status: 201 });
  } catch (err) {
    if (err instanceof SourceError) return agentError(err.status, err.code);
    throw err;
  }
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const sourceId = req.nextUrl.searchParams.get('source') ?? '';
  const sources = sourceId ? await removeSource(ctx.row, sourceId, ctx.personId) : null;
  return sources ? NextResponse.json({ sources }) : agentError(404, 'not_found');
}
