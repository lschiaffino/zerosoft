import { NextRequest, NextResponse } from 'next/server';
import { socialSession } from '@/lib/social-http';
import { discardOAuthState, finishOAuth, SocialError } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vuelta del OAuth de cada red (la URL exacta que se registra en las apps de
 * desarrollador: <NEXTAUTH_URL>/api/social/oauth/callback). El state tiene
 * que ser de esta persona y este workspace, y se usa una sola vez.
 */
export async function GET(req: NextRequest) {
  const locale = ['en', 'es', 'pt'].includes(req.cookies.get('NEXT_LOCALE')?.value ?? '') ? req.cookies.get('NEXT_LOCALE')!.value : 'en';
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/${locale}/app/social/accounts?${new URLSearchParams(q).toString()}`, req.url), 303);
  const ctx = await socialSession();
  if (ctx instanceof NextResponse) return NextResponse.redirect(new URL(`/${locale}/app`, req.url), 303);
  const sp = req.nextUrl.searchParams;
  const state = sp.get('state') ?? '';
  const code = sp.get('code') ?? '';
  if (sp.get('error') || !code) {
    // La persona canceló en la red (o la red devolvió un error): se descarta el state.
    if (state) await discardOAuthState(ctx.actor, state.slice(0, 200)).catch(() => undefined);
    return back({ error: 'cancelled' });
  }
  try {
    const res = await finishOAuth(ctx.actor, state, code.slice(0, 2000));
    return back({ connected: res.network, count: String(res.count) });
  } catch (err) {
    return back({ error: err instanceof SocialError ? err.code : 'oauth_failed' });
  }
}
