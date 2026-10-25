import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { groupsViewer } from '@/lib/groups-access';
import { handleRpc, type RpcResponse } from '@/lib/groups-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Servidor MCP de Groups (streamable HTTP, respuestas JSON). Cada POST lleva
 * un mensaje JSON-RPC (o un lote). Las notificaciones devuelven 202 sin
 * cuerpo. Autenticación: Authorization: Bearer zs_… con groups:read (y
 * groups:write para las herramientas que mandan o cambian).
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  const ctx = {
    ws: auth.user.id,
    personId: auth.personId,
    scopes: auth.scopes,
    viewer: await groupsViewer(auth.user.id, auth.personId, auth.role),
  };
  const batch = Array.isArray(body);
  const list = (batch ? body : [body]).slice(0, 20) as Array<Record<string, unknown>>;
  const out: RpcResponse[] = [];
  for (const msg of list) {
    const res = await handleRpc(ctx, (msg && typeof msg === 'object' ? msg : {}) as Parameters<typeof handleRpc>[1]);
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
