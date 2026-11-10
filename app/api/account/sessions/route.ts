import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { listSessions, recordSecurityEvent, revokeOtherSessions, revokeSession } from '@/lib/account-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dispositivos con sesión abierta de la persona (la real, no el dueño del workspace). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ sessions: await listSessions(realUserId(user), user.sid ?? null) });
}

const schema = z.union([z.object({ id: z.string().min(1).max(64) }), z.object({ others: z.literal(true) })]);

/** Cierra una sesión (`id`) o todas menos esta (`others`). */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const me = realUserId(user);
  if ('others' in parsed.data) {
    const n = await revokeOtherSessions(me, user.sid ?? null);
    await recordSecurityEvent({ userId: me, action: 'session.revoke_others', meta: { count: n } });
    return NextResponse.json({ ok: true, revoked: n });
  }
  const ok = await revokeSession(me, parsed.data.id);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await recordSecurityEvent({ userId: me, action: 'session.revoke', meta: { current: parsed.data.id === user.sid } });
  return NextResponse.json({ ok: true });
}
