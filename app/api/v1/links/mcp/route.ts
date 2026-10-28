import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { handleLinkRpc } from '@/lib/link-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Servidor MCP de Link (streamable HTTP, respuestas JSON). Cada POST lleva un
 * mensaje JSON-RPC (sin lotes). Autenticación: Authorization: Bearer zs_… con
 * links:read (y links:write para crear, editar y borrar).
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;
  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batching is not supported' } }, { status: 400 });
  }
  const ctx = { ws: auth.user.id, personId: auth.personId, scopes: auth.scopes, role: auth.role };
  const res = await handleLinkRpc(ctx, (body && typeof body === 'object' ? body : {}) as Parameters<typeof handleLinkRpc>[1]);
  if (!res) return new NextResponse(null, { status: 202 });
  return NextResponse.json(res, { headers: { 'cache-control': 'no-store' } });
}

/** Sin stream de eventos del servidor: el cliente usa solo POST. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } });
}
