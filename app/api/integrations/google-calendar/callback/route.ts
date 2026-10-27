import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { exchangeCode, googleAccountEmail, googleCalendarRedirectUri, upsertIntegration } from '@/lib/integrations';
import { GOOGLE_CALENDAR_PROVIDER, invalidateBusyCache } from '@/lib/google-calendar';
import { FAKE_GOOGLE_EMAIL, fakeGoogleCalendarAllowed, fakeGoogleTokens } from '@/lib/google-calendar-fake';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-gcal-state';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const me = realUserId(user);

  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  function out(result: string): NextResponse {
    const r = NextResponse.redirect(new URL(`/app/calendar/settings?gcal=${result}`, req.url));
    r.cookies.delete(STATE_COOKIE);
    return r;
  }

  if (sp.get('error')) return out('denied');
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${me}.`)) return out('error');

  const fake = fakeGoogleCalendarAllowed() && code === 'fake-gcal';
  const tokens = fake ? fakeGoogleTokens() : await exchangeCode(code, googleCalendarRedirectUri());
  if (!tokens.access_token) return out('error');
  // Sin los dos scopes de Calendar no sirve: el usuario destildó permisos.
  const granted = tokens.scope ?? '';
  if (!granted.includes('calendar.events') || !granted.includes('calendar.freebusy')) return out('scopes');

  await upsertIntegration({
    userId: me,
    provider: GOOGLE_CALENDAR_PROVIDER,
    email: fake ? FAKE_GOOGLE_EMAIL : await googleAccountEmail(tokens.access_token),
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: granted,
  });
  invalidateBusyCache(me);
  await logCalActivity(user.id, me, 'integration.connected', { type: 'integration', id: 'google', summary: 'Google Calendar' });
  return out('connected');
}
