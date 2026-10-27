import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { upsertIntegration } from '@/lib/integrations';
import { graphMe, microsoftTokenRequest } from '@/lib/microsoft';
import {
  OUTLOOK_CALENDAR_PROVIDER,
  OUTLOOK_CALENDAR_SCOPES,
  invalidateOutlookBusyCache,
  outlookCalendarRedirectUri,
} from '@/lib/outlook-calendar';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-ocal-state';

/** Callback OAuth de Microsoft para Cal: valida state, cambia el code por tokens (cifrados). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  function out(result: string): NextResponse {
    const r = NextResponse.redirect(new URL(`/app/calendar/settings?tab=connections&outlook=${result}`, req.url));
    r.cookies.delete(STATE_COOKIE);
    return r;
  }

  if (sp.get('error')) return out('denied');
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${personId}.`)) return out('error');

  const tokens = await microsoftTokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: outlookCalendarRedirectUri(),
    scope: OUTLOOK_CALENDAR_SCOPES.join(' '),
  });
  if (!tokens.access_token) return out('error');
  // Sin escribir en el calendario no sirve: el usuario rechazó el permiso.
  if (!/calendars\.readwrite/i.test(tokens.scope ?? '')) return out('scopes');
  const me = await graphMe(tokens.access_token).catch(() => null);
  if (!me?.email) return out('error');

  await upsertIntegration({
    userId: personId,
    provider: OUTLOOK_CALENDAR_PROVIDER,
    email: me.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope ?? '',
  });
  invalidateOutlookBusyCache(personId);
  await logCalActivity(user.id, personId, 'integration.connected', { type: 'integration', id: 'outlook', summary: 'Outlook' });
  return out('connected');
}
