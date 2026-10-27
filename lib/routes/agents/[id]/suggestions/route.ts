import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { dismissSuggestions, listSuggestions } from '@/lib/agents-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Preguntas que el agente no pudo responder con su conocimiento (últimos 30 días). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ suggestions: await listSuggestions(ctx.user.id, id) });
}

const schema = z.object({ dismiss: z.array(z.string().min(1).max(100)).min(1).max(500) });

/** Descarta una sugerencia (sus corridas) o la marca como resuelta al agregar la respuesta. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  await dismissSuggestions(ctx.user.id, id, parsed.data.dismiss);
  return NextResponse.json({ suggestions: await listSuggestions(ctx.user.id, id) });
}
