import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { microsoftConfigured, outlookAuthUrl } from '@/lib/microsoft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-outlook-state';

/** Inicia el OAuth de Microsoft 365: state en cookie httpOnly + redirect a Microsoft. */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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
