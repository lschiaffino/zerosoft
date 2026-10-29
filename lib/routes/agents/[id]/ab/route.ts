import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { AB_MAX_PERCENT, AB_MIN_PERCENT, abResults, startAbTest, stopAbTest } from '@/lib/agents-ab';
import { getAgentRow } from '@/lib/agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Test A/B en curso y la comparación de A (lo publicado) y B (la versión en prueba). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ results: await abResults(ctx.row) });
}

const schema = z.object({
  versionId: z.string().min(1).max(100),
  percent: z.number().int().min(AB_MIN_PERCENT).max(AB_MAX_PERCENT),
});

/** Empieza un test A/B con una versión guardada. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const res = await startAbTest(ctx.row, parsed.data.versionId, parsed.data.percent, ctx.personId);
  if (!res.ok) return agentError(res.error === 'not_found' ? 404 : 400, res.error);
  const row = await getAgentRow(ctx.user.id, id);
  return NextResponse.json({ results: row ? await abResults(row) : null });
}

/** Termina el test. ?promote=1 pone la versión B en vivo. */
export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const res = await stopAbTest(ctx.row, ctx.personId, req.nextUrl.searchParams.get('promote') === '1');
  if (!res.ok) return agentError(res.error === 'not_found' ? 404 : 400, res.error);
  const row = await getAgentRow(ctx.user.id, id);
  return NextResponse.json({ results: row ? await abResults(row) : null });
}
