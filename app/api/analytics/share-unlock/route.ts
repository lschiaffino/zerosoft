import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { matchSharePassword, shareAccessCookie, shareAccessOk, shareByToken, shareCookieName } from '@/lib/analytics/records-more';
import { clientIp, hashedIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().max(64), password: z.string().min(1).max(200) });

/** ¿Este navegador conservó el acceso? Un embed con cookies de terceros bloqueadas no lo conserva. */
export async function GET(req: NextRequest) {
  const share = await shareByToken(req.nextUrl.searchParams.get('token') ?? '');
  if (!share) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: await shareAccessOk(share.id, req.cookies.get(shareCookieName(share.id))?.value) });
}

/** Contraseña de un link público: si coincide, ese navegador entra por 24 horas. */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  // El tope es por IP: muchos intentos de otros no pueden dejar afuera a quien tiene la contraseña.
  const byIp = await rateLimit(`ashare-pw:${hashedIp(clientIp(req))}`, 20, 600);
  if (!byIp.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  // Por link solo una demora: frena a quien prueba desde muchas IP, y la contraseña correcta igual entra.
  const byLink = await rateLimit(`ashare-pw-link:${parsed.data.token.slice(0, 16)}`, 60, 600);
  if (!byLink.ok && process.env.RATE_LIMIT_DISABLED !== 'true') await new Promise((r) => setTimeout(r, 1500));
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
