import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { addMcpServer, listMcpServers, McpError } from '@/lib/agents-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Servidores MCP del agente (sin el valor del header de autenticación). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ servers: listMcpServers(ctx.row) });
}

const schema = z.object({
  name: z.string().trim().max(60).default(''),
  url: z.string().trim().url().max(2000),
  headerName: z.string().trim().max(64).optional(),
  headerValue: z.string().max(4000).optional(),
});

/** Conecta un servidor: si no responde initialize y tools/list, no se guarda. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    return NextResponse.json({ servers: await addMcpServer(ctx.row, parsed.data, ctx.personId) }, { status: 201 });
  } catch (err) {
    if (err instanceof McpError) return agentError(400, err.code);
    throw err;
  }
}
