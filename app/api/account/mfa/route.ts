import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDb, getUserById } from '@/lib/db';
import { confirmMfaSetup, disableMfa, recordSecurityEvent, regenerateRecoveryCodes, startMfaSetup } from '@/lib/account-security';
import { renderQrSvg, DEFAULT_QR_STYLE } from '@/lib/link-qr';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('confirm'), code: z.string().min(6).max(20) }),
  z.object({ action: z.literal('disable'), code: z.string().min(6).max(20) }),
  z.object({ action: z.literal('recovery'), code: z.string().min(6).max(20) }),
]);

/**
 * Ajustes › Seguridad › Verificación en dos pasos, siempre sobre la persona real (no el
 * dueño del workspace activo): start (secreto y QR), confirm (activa y devuelve los códigos
 * de recuperación una vez), disable y recovery (códigos nuevos), estas tres con un código.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const me = await getUserById(realUserId(user));
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = parsed.data;
  if (body.action !== 'start') {
    const limit = await rateLimit(`mfa-settings:${me.id}`, 10, 900);
    if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (body.action === 'start') {
    if (me.mfa_enabled_at) return NextResponse.json({ error: 'already_enabled' }, { status: 409 });
    const { secret, uri } = await startMfaSetup(me);
    return NextResponse.json({ secret, uri, qr: renderQrSvg(uri, DEFAULT_QR_STYLE) });
  }
  if (body.action === 'confirm') {
    const res = await confirmMfaSetup(me.id, body.code, user.sid ?? null);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    await recordSecurityEvent({ userId: me.id, action: 'mfa.enable' });
    // Una sesión de antes de las sesiones del servidor no se puede marcar: tras guardar los códigos, volver a entrar.
    return NextResponse.json({ ok: true, recoveryCodes: res.recoveryCodes, signInAgain: !user.sid && !process.env.DEMO_MODE });
  }
  if (body.action === 'disable') {
    // Quien exige dos pasos en su workspace no los puede apagar: se quedaría afuera de su propia regla.
    const owns = (await getDb().prepare('SELECT 1 FROM teams WHERE owner_id = ? AND require_mfa = 1 LIMIT 1').get(me.id)) as unknown;
    if (owns) return NextResponse.json({ error: 'required_by_workspace' }, { status: 409 });
    const res = await disableMfa(me.id, body.code);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    await recordSecurityEvent({ userId: me.id, action: 'mfa.disable' });
    return NextResponse.json({ ok: true });
  }
  const res = await regenerateRecoveryCodes(me.id, body.code);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  await recordSecurityEvent({ userId: me.id, action: 'mfa.recovery_regenerated' });
  return NextResponse.json({ ok: true, recoveryCodes: res.recoveryCodes });
}
