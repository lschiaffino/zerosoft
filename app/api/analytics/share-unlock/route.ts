import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { matchSharePassword, shareAccessCookie, shareByToken, shareCookieName } from '@/lib/analytics/records-more';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().max(64), password: z.string().min(1).max(200) });

/** Contraseña de un link público: si coincide, ese navegador entra por 24 horas. */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const ip = clientIp(req);
  const byIp = await rateLimit(`ashare-pw:${ip}`, 20, 600);
  const byLink = await rateLimit(`ashare-pw:${parsed.data.token}`, 60, 600);
  if ((!byIp.ok || !byLink.ok) && process.env.RATE_LIMIT_DISABLED !== 'true') return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const share = await shareByToken(parsed.data.token);
  // La misma respuesta si el link no existe: no sirve para averiguar cuáles hay.
  const passwordId = share ? await matchSharePassword(share.id, parsed.data.password) : null;
  if (!share || !passwordId) return NextResponse.json({ error: 'wrong_password' }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  // SameSite=None: un link embebido en otro sitio también tiene que recordarlo.
  const secure = req.nextUrl.protocol === 'https:';
  res.cookies.set(shareCookieName(share.id), shareAccessCookie(share.id, passwordId), { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/', maxAge: 24 * 3600 });
  return res;
}
