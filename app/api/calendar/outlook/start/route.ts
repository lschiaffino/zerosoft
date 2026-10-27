import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { microsoftAuthUrl, microsoftConfigured } from '@/lib/microsoft';
import { OUTLOOK_CALENDAR_SCOPES, outlookCalendarRedirectUri } from '@/lib/outlook-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-ocal-state';

/** Conecta el Outlook / Microsoft 365 de la persona logueada a Cal (solo calendario). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!microsoftConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 500 });
  const state = `${realUserId(user)}.${crypto.randomUUID()}`;
  const res = NextResponse.redirect(
    microsoftAuthUrl({ redirectUri: outlookCalendarRedirectUri(), scopes: OUTLOOK_CALENDAR_SCOPES, state }),
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
