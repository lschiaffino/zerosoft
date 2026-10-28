import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { handleVoiceRpc } from '@/lib/voice-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Servidor MCP de Voice (streamable HTTP, respuestas JSON). Cada POST lleva un
 * mensaje JSON-RPC (sin lotes). Autenticación: Authorization: Bearer zs_… con
 * voice:read (solo las reuniones y dictados de quien creó la key).
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'voice:read');
  if ('res' in auth) return auth.res;
  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batching is not supported' } }, { status: 400 });
  }
  const ctx = { owner: { workspaceId: auth.user.id, personId: auth.personId }, scopes: auth.scopes };
  const res = await handleVoiceRpc(ctx, (body && typeof body === 'object' ? body : {}) as Parameters<typeof handleVoiceRpc>[1]);
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
