import { NextRequest, NextResponse } from 'next/server';
import { DESKTOP_SESSION_MAX_AGE, exchangeDesktopLoginCode, mintSessionToken, sessionCookieInfo } from '@/lib/desktop-auth';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El pedido viene de una página de este mismo sitio (la app móvil carga zerosoft.ai). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || origin === 'null') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Canje del código del login de escritorio o móvil: { code, verifier }.
 *
 * - Escritorio (proceso main de Electron, sin cookies ni CORS): devuelve el
 *   JWT de sesión y cómo se llama la cookie; la app la pone en su cookie store.
 * - Móvil (la página de zerosoft dentro de Capacitor, mismo origen) manda
 *   setCookie: true y el servidor pone la cookie httpOnly; el token no vuelve
 *   en el cuerpo.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'desktop-token', 30, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { code?: unknown; verifier?: unknown; setCookie?: unknown } | null;
  const asCookie = body?.setCookie === true;
  if (asCookie && !sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await exchangeDesktopLoginCode(body?.code, body?.verifier);
  if (!user) return NextResponse.json({ error: 'invalid_grant' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  const token = await mintSessionToken(user);
  const cookie = sessionCookieInfo();
  if (asCookie) {
    const res = NextResponse.json({ ok: true, user: { email: user.email, name: user.name } }, { headers: { 'cache-control': 'no-store' } });
    res.cookies.set(cookie.name, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: cookie.secure,
      maxAge: DESKTOP_SESSION_MAX_AGE,
      ...(cookie.domain ? { domain: cookie.domain } : {}),
    });
    return res;
  }
  return NextResponse.json(
    {
      token,
      cookie: { name: cookie.name, domain: cookie.domain, secure: cookie.secure, maxAge: DESKTOP_SESSION_MAX_AGE },
      user: { email: user.email, name: user.name },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
