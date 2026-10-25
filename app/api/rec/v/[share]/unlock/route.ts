import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPublicVideoRow, unlockCookieName, unlockToken, verifyPassword } from '@/lib/rec';
import { clientIp, peekCount, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ password: z.string().min(1).max(200) });

const WINDOW = 600;
/** Fallos por IP en 10 min antes de bloquear esa IP. */
const IP_FAILS = 20;
/** Fallos por video en 10 min (de cualquier IP): pasado eso, solo prueban IPs sin fallos recientes. */
const SHARE_FAILS = 50;

const tooMany = (resetSec: number) =>
  NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': String(Math.max(1, resetSec)) } });

/**
 * Contraseña de un video: con la correcta deja una cookie firmada (cambia si
 * cambia la contraseña). Solo cuentan los fallos: espera progresiva por IP
 * (cada fallo seguido demora más la respuesta) y tope por IP; el tope por
 * video frena a quien prueba claves desde muchas IPs, pero no bloquea a una IP
 * sin fallos recientes que trae la clave correcta.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const { share } = await ctx.params;
  const v = await getPublicVideoRow(share);
  if (!v) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (!v.password_hash) return NextResponse.json({ ok: true });

  const limits = process.env.RATE_LIMIT_DISABLED !== 'true';
  const ipKey = `rec:unlockfail:ip:${clientIp(req)}:${share}`;
  const shareKey = `rec:unlockfail:share:${share}`;
  if (limits) {
    const ipFails = await peekCount(ipKey, WINDOW);
    if (ipFails >= IP_FAILS) return tooMany(WINDOW);
    if (ipFails > 0 && (await peekCount(shareKey, WINDOW)) >= SHARE_FAILS) return tooMany(WINDOW);
    // Espera progresiva: 0, 0, 0,5 s, 1 s, 2 s… hasta 5 s según los fallos recientes de esta IP.
    if (ipFails >= 2) await new Promise((r) => setTimeout(r, Math.min(5000, 250 * 2 ** (ipFails - 1))));
  }

  if (!(await verifyPassword(parsed.data.password, v.password_hash))) {
    if (limits) {
      await rateLimit(ipKey, IP_FAILS, WINDOW);
      await rateLimit(shareKey, SHARE_FAILS, WINDOW);
    }
    return NextResponse.json({ error: 'wrong_password' }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(unlockCookieName(v.share_id), unlockToken(v), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 86400,
  });
  return res;
}
