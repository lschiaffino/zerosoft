import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { roleAtLeast } from '@/lib/teams';
import { limitWrites } from '@/lib/write-limit';
import { delegatedIdentity } from '@/lib/mcp/identity';
import { internalGet, internalPatch, internalPost } from '@/lib/internal-contacts-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contactos internos desde Inbox (lib/internal-contacts.ts): son del workspace activo, los mismos que en Lines.
 * Leer la lista y cambiarla es de admins; sin sesión, 401. Nunca con un token delegado (MCP).
 */
async function admin(write: boolean): Promise<{ ws: string; me: string; role: Parameters<typeof internalGet>[2] } | NextResponse> {
  if (delegatedIdentity()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!roleAtLeast(user.role, 'admin')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const me = user.actingUser?.id ?? user.id;
  if (write) {
    const limited = await limitWrites('inbox', me);
    if (limited) return limited;
  }
  return { ws: user.id, me, role: user.role };
}

export async function GET() {
  const s = await admin(false);
  if (s instanceof NextResponse) return s;
  return internalGet(s.ws, s.me, s.role);
}

export async function PATCH(req: Request) {
  const s = await admin(true);
  if (s instanceof NextResponse) return s;
  const body = await req.json().catch(() => null);
  return internalPatch(s.ws, s.me, s.role, body && typeof body === 'object' && !Array.isArray(body) ? body : {});
}

export async function POST(req: Request) {
  const s = await admin(true);
  if (s instanceof NextResponse) return s;
  const body = await req.json().catch(() => null);
  return internalPost(s.ws, s.me, s.role, body && typeof body === 'object' && !Array.isArray(body) ? body : {});
}
