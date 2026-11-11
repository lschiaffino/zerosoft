import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId, userCanUseApp } from '@/lib/session';
import { microsoftConfigured, outlookAuthUrl } from '@/lib/microsoft';
import { signInToConnect } from '@/lib/oauth-signin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-outlook-state';

/** Inicia el OAuth de Microsoft 365: state en cookie httpOnly + redirect a Microsoft. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return signInToConnect(req);
  // El correo se sincroniza en el CRM del workspace: sin CRM, no.
  if (!userCanUseApp(user, 'crm')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!microsoftConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });

  const state = `${realUserId(user)}.${crypto.randomUUID()}`;
  const res = NextResponse.redirect(outlookAuthUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
