import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { googleAuthUrl, googleCalendarRedirectUri, googleOAuthConfigured } from '@/lib/integrations';
import { GOOGLE_CALENDAR_SCOPE } from '@/lib/google-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-gcal-state';

/** Conecta el Google Calendar de la persona logueada (no del workspace). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!googleOAuthConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });

  const state = `${realUserId(user)}.${crypto.randomUUID()}`;
  const res = NextResponse.redirect(
    googleAuthUrl({ redirectUri: googleCalendarRedirectUri(), scope: GOOGLE_CALENDAR_SCOPE, state }),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
