import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createDesktopLoginCode, isValidChallenge, isValidState } from '@/lib/desktop-auth';
import { confirmPage, DESKTOP_LOGIN_HEADERS, invalidPage, returnPage } from '@/lib/desktop-login-page';
import { requestLocale } from '@/lib/request-locale';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickLocale(req: NextRequest, raw: unknown): string {
  return typeof raw === 'string' && ['en', 'es', 'pt'].includes(raw)
    ? raw
    : requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
}

function html(body: string, status = 200) {
  return new NextResponse(body, { status, headers: DESKTOP_LOGIN_HEADERS });
}

/**
 * Login de la app de escritorio, en el navegador del sistema (ver
 * lib/desktop-auth.ts). GET: sin sesión manda al login con Google y vuelve
 * acá; con sesión muestra la cuenta y un botón para confirmar.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const challenge = sp.get('challenge');
  const state = sp.get('state');
  const locale = pickLocale(req, sp.get('locale'));
  if (!isValidChallenge(challenge) || !isValidState(state)) return html(invalidPage(locale), 400);
  const user = await getCurrentUser();
  if (!user) {
    const back = `/api/desktop/login?${new URLSearchParams({ challenge, state, locale })}`;
    return NextResponse.redirect(new URL(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(back)}`, req.url), 307);
  }
  const email = user.actingUser?.email ?? user.email;
  return html(confirmPage(locale, { email, challenge, state }));
}

/** El formulario es del mismo origen (Origin o Sec-Fetch-Site): otra página no puede disparar un código. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin && origin !== 'null') {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

/** POST (confirmar): crea el código de un solo uso y vuelve a la app por zerosoft://auth/callback. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const locale = pickLocale(req, form?.get('locale'));
  if (!sameOrigin(req)) return html(invalidPage(locale), 403);
  const limited = await limitByIp(req, 'desktop-login', 20, 60);
  if (limited) return limited;
  const challenge = form?.get('challenge');
  const state = form?.get('state');
  if (!isValidChallenge(challenge) || !isValidState(state)) return html(invalidPage(locale), 400);
  const user = await getCurrentUser();
  if (!user) return html(invalidPage(locale), 401);
  const code = await createDesktopLoginCode(realUserId(user), challenge);
  const link = `zerosoft://auth/callback?${new URLSearchParams({ code, state })}`;
  return html(returnPage(locale, link));
}
