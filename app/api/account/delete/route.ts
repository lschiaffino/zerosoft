import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDb, getUserById } from '@/lib/db';
import { cancelErasure, pendingErasure, requestErasure } from '@/lib/privacy';
import { recordSecurityEvent, revokeOtherSessions } from '@/lib/account-security';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['account', 'workspace']),
  /** El email de la cuenta (borrar cuenta) o el nombre del workspace (borrar workspace), tipeado. */
  confirm: z.string().min(1).max(200),
});

/**
 * Pide borrar la cuenta (con su workspace) o solo el workspace propio. Queda programado a 30
 * días (lib/privacy.ts); hasta entonces se puede cancelar y exportar. Borrar la cuenta además
 * cierra todas sus sesiones.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const me = await getUserById(realUserId(user));
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limit = await rateLimit(`account-delete:${me.id}`, 10, 3600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const { kind, confirm } = parsed.data;
  const typed = confirm.trim().toLowerCase();
  if (kind === 'account' && typed !== me.email.trim().toLowerCase()) return NextResponse.json({ error: 'confirm_mismatch' }, { status: 400 });
  if (kind === 'workspace') {
    const ws = (await getDb().prepare('SELECT id, name FROM teams WHERE owner_id = ? ORDER BY created_at, id LIMIT 1').get(me.id)) as { id: string; name: string } | undefined;
    if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (typed !== ws.name.trim().toLowerCase()) return NextResponse.json({ error: 'confirm_mismatch' }, { status: 400 });
  }
  const row = await requestErasure(me.id, kind, me.id);
  await recordSecurityEvent({ userId: me.id, action: kind === 'account' ? 'account.delete_requested' : 'workspace.delete_requested', meta: { dueAt: row.due_at, scheduled: true } });
  if (kind === 'account') await revokeOtherSessions(me.id, null);
  return NextResponse.json({ ok: true, kind: row.kind, dueAt: row.due_at });
}

/** Cancela el borrado pendiente (cuenta o workspace) mientras no haya empezado. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const me = realUserId(user);
  const pending = await pendingErasure(me);
  if (!pending || !(await cancelErasure(me))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await recordSecurityEvent({ userId: me, action: 'account.delete_cancelled', meta: { kind: pending.kind } });
  return NextResponse.json({ ok: true });
}
