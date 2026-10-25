import { NextResponse } from 'next/server';
import { handleDocsRpc, type RpcResponse } from '@/lib/docs-mcp';
import { docsApi } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Servidor MCP de Docs (streamable HTTP, respuestas JSON). Cada POST lleva
 * un mensaje JSON-RPC (o un lote). Las notificaciones devuelven 202 sin
 * cuerpo. Autenticación: Authorization: Bearer zs_… con docs:read (y
 * docs:write para las herramientas que crean y editan).
 */
export async function POST(req: Request) {
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const list = (batch ? body : [body]).slice(0, 20) as Array<Record<string, unknown>>;
  const out: RpcResponse[] = [];
  for (const msg of list) {
    const res = await handleDocsRpc({ actor: ctx.actor, scopes: ctx.auth.scopes }, (msg && typeof msg === 'object' ? msg : {}) as Parameters<typeof handleDocsRpc>[1]);
    if (res) out.push(res);
  }
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? out : out[0], { headers: { 'cache-control': 'no-store' } });
}

/** Sin stream de eventos del servidor: el cliente usa solo POST. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } });
}
