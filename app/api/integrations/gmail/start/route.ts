import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId, userCanUseApp } from '@/lib/session';
import { gmailAuthUrl } from '@/lib/integrations';
import { rememberReturn } from '@/lib/oauth-return';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-gmail-state';

/** Inicia el OAuth de Gmail: state en cookie httpOnly + redirect a Google. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // El correo se sincroniza en el CRM del workspace: sin CRM, no.
  if (!userCanUseApp(user, 'crm')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  }

  const state = `${realUserId(user)}.${crypto.randomUUID()}`;
  const res = NextResponse.redirect(gmailAuthUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  rememberReturn(req, res);
  return res;
}
