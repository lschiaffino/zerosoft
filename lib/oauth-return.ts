/**
 * Volver a donde estaba la persona después de conectar una cuenta (Google
 * Calendar, Gmail) desde el onboarding: el inicio del OAuth guarda `?return=`
 * en una cookie y el callback vuelve ahí con `connected=<cuál>&result=<cómo>`
 * en vez de a los ajustes de la app. Solo rutas propias de la app con locale.
 */
import type { NextRequest, NextResponse } from 'next/server';

export const OAUTH_RETURN_COOKIE = 'zs-oauth-return';

const SAFE = /^\/(?:en|es|pt)\/app(?:\/[a-z0-9_-]+)*$/;

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 120) return null;
  return SAFE.test(raw) ? raw : null;
}

/** En el inicio del OAuth: guarda la vuelta (10 minutos, como el state). */
export function rememberReturn(req: NextRequest, res: NextResponse): void {
  const path = safeReturnPath(req.nextUrl.searchParams.get('return'));
  if (!path) return;
  res.cookies.set(OAUTH_RETURN_COOKIE, path, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
}

/** En el callback: la URL de vuelta con el resultado, o null si no había. */
export function returnUrl(req: NextRequest, connected: string, result: string): URL | null {
  const path = safeReturnPath(req.cookies.get(OAUTH_RETURN_COOKIE)?.value);
  if (!path) return null;
  return new URL(`${path}?${new URLSearchParams({ connected, result }).toString()}`, req.url);
}
