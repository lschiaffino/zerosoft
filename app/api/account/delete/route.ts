import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DEMO_EMAIL, DEMO_MODE, getCurrentUser, realUserId } from '@/lib/session';
import { getDb, getUserById } from '@/lib/db';
import { cancelErasure, requestErasure } from '@/lib/privacy';
import { mfaEnabled, recordSecurityEvent, revokeOtherSessions, verifyMfa } from '@/lib/account-security';
import { rateLimit } from '@/lib/rate-limit';
import { sendErasureNotice } from '@/lib/privacy-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['account', 'workspace']),
  /** El email de la cuenta (borrar cuenta) o el nombre del workspace (borrar workspace), tipeado. */
  confirm: z.string().min(1).max(200),
  /** Con dos pasos activados: un código de la app o de recuperación. */
  code: z.string().max(20).optional(),
});

/** Solo desde la propia app (no un formulario de otro sitio) y con cuerpo JSON. */
function sameOriginJson(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  return (req.headers.get('content-type') ?? '').startsWith('application/json');
}

/**
 * Pide borrar la cuenta (con su workspace) o solo el workspace propio. Queda programado a 30
 * días (lib/privacy.ts); hasta entonces se puede cancelar y exportar. Con dos pasos pide un
 * código, avisa por email y, si es la cuenta, cierra todas sus sesiones.
 */
export async function POST(req: NextRequest) {
  if (!sameOriginJson(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const me = await getUserById(realUserId(user));
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // La cuenta demo compartida no se borra.
  if (DEMO_MODE && me.email === DEMO_EMAIL) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const limit = await rateLimit(`account-delete:${me.id}`, 10, 3600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const { kind, confirm, code } = parsed.data;
  const typed = confirm.trim().toLowerCase();
  if (kind === 'account' && typed !== me.email.trim().toLowerCase()) return NextResponse.json({ error: 'confirm_mismatch' }, { status: 400 });
  if (kind === 'workspace') {
    // El workspace que se ve en pantalla, si es propio; si no, la ficha propia.
    const ws =
      user.role === 'owner' && user.workspace?.owner_id === me.id
        ? user.workspace
        : ((await getDb().prepare('SELECT id, name, owner_id FROM teams WHERE owner_id = ? ORDER BY created_at, id LIMIT 1').get(me.id)) as { name: string } | undefined);
    if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (typed !== ws.name.trim().toLowerCase()) return NextResponse.json({ error: 'confirm_mismatch' }, { status: 400 });
  }
  if (mfaEnabled(me)) {
    if (!code) return NextResponse.json({ error: 'mfa_required' }, { status: 400 });
    const ok = await verifyMfa(me.id, code, null);
    if (!ok.ok) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }
  const row = await requestErasure(me.id, kind, me.id);
  await recordSecurityEvent({ userId: me.id, action: kind === 'account' ? 'account.delete_requested' : 'workspace.delete_requested', meta: { dueAt: row.due_at } });
  await sendErasureNotice(me, row.kind, row.due_at).catch(() => undefined);
  if (kind === 'account') await revokeOtherSessions(me.id, null);
  return NextResponse.json({ ok: true, kind: row.kind, dueAt: row.due_at });
}

/** Cancela el borrado pendiente (cuenta o workspace) mientras no haya empezado. */
export async function DELETE(req: NextRequest) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const me = realUserId(user);
  const cancelled = await cancelErasure(me);
  if (!cancelled) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await recordSecurityEvent({ userId: me, action: cancelled.kind === 'account' ? 'account.delete_cancelled' : 'workspace.delete_cancelled' });
  return NextResponse.json({ ok: true });
}
