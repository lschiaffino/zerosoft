import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sameSiteRequest } from '@/lib/oauth/consent';
import { listConnectedClients, revokeOwnGrant } from '@/lib/oauth/store';
import { getCurrentUser, realUserId } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustes › API: las conexiones de la persona. Cada una ve y corta solo las suyas. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ clients: await listConnectedClients(realUserId(user)) });
}

export async function DELETE(req: NextRequest) {
  if (!sameSiteRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = z.object({ id: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const ok = await revokeOwnGrant(realUserId(user), parsed.data.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
