import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionGate } from '@/lib/session';
import { recordSecurityEvent, verifyMfa } from '@/lib/account-security';
import { limitByIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().min(6).max(20) });

/**
 * Segundo paso del login: el código del autenticador (o uno de recuperación) para la sesión
 * que entró con Google o con el código por email y quedó pendiente.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'mfa-ip', 30, 900);
  if (limited) return limited;
  const gate = await sessionGate();
  if (gate.state !== 'mfa_pending' || !gate.user || !gate.sid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  // Por persona: 6 intentos cada 15 minutos, como mucho (un código tiene 10^6 valores).
  const perUser = await rateLimit(`mfa:${gate.user.id}`, 6, 900);
  if (!perUser.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const res = await verifyMfa(gate.user.id, parsed.data.code, gate.sid);
  if (!res.ok) {
    await recordSecurityEvent({ userId: gate.user.id, action: 'login.failed_mfa' });
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }
  if (res.usedRecovery) await recordSecurityEvent({ userId: gate.user.id, action: 'mfa.recovery_used', meta: { left: res.recoveryLeft } });
  return NextResponse.json({ ok: true, recoveryLeft: res.usedRecovery ? res.recoveryLeft : undefined });
}
