import { NextResponse } from 'next/server';
import { handleNotesRpc, type RpcResponse } from '@/lib/notes-mcp';
import { notesApi } from '@/lib/notes-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Servidor MCP de Notes. Authorization: Bearer zs_… con notes:read (y notes:write para escribir). */
export async function POST(req: Request) {
  const ctx = await notesApi(req, 'notes:read');
  if ('res' in ctx) return ctx.res;
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  const batch = Array.isArray(body);
  if (batch && body.length > 20) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch too large.' } }, { status: 400 });
  const out: RpcResponse[] = [];
  for (const msg of (batch ? body : [body]) as Array<Record<string, unknown>>) {
    const res = await handleNotesRpc({ owner: ctx.owner, scopes: ctx.auth.scopes }, msg && typeof msg === 'object' ? msg : {});
    if (res) out.push(res);
  }
  if (!out.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? out : out[0], { headers: { 'cache-control': 'no-store' } });
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } });
}
