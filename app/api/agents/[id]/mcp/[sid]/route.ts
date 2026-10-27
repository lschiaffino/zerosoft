import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext, notFound } from '@/lib/agents-http';
import { McpError, removeMcpServer, updateMcpServer } from '@/lib/agents-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; sid: string }> };

const schema = z.object({
  name: z.string().trim().max(60).optional(),
  allowed: z.array(z.string().max(64)).max(50).optional(),
  refresh: z.boolean().optional(),
  headerValue: z.string().max(4000).nullable().optional(),
});

/** Renombrar, elegir herramientas, volver a leer la lista o cambiar el token. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, sid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    const servers = await updateMcpServer(ctx.row, sid, parsed.data, ctx.personId);
    if (!servers) return notFound();
    return NextResponse.json({ servers });
  } catch (err) {
    if (err instanceof McpError) return agentError(400, err.code);
    throw err;
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id, sid } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const servers = await removeMcpServer(ctx.row, sid, ctx.personId);
  if (!servers) return notFound();
  return NextResponse.json({ servers });
}
