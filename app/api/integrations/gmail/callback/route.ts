import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { registerMailbox } from '@/lib/crm-email-sync';
import { exchangeCode, gmailProfileEmail, upsertIntegration } from '@/lib/integrations';
import { completeGmailConnect, INBOX_STATE_COOKIE, INBOX_STATE_PREFIX } from '@/lib/inbox/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-gmail-state';

function redirectToSettings(req: NextRequest, params: string): NextResponse {
  return NextResponse.redirect(new URL(`/app/crm/settings?tab=integrations&${params}`, req.url));
}

/** Callback OAuth: valida state, cambia el code por tokens y guarda la integración. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  // Gmail personal de Inbox: mismo redirect URI, otro state y otra cookie.
  if (state?.startsWith(INBOX_STATE_PREFIX)) return inboxCallback(req, realUserId(user), code, state);
  // El Gmail es de la persona (no del workspace): en un team cada miembro conecta el suyo.
  const personId = realUserId(user);
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  function out(params: string): NextResponse {
    const r = redirectToSettings(req, params);
    r.cookies.delete(STATE_COOKIE);
    return r;
  }

  if (sp.get('error')) return out('gmail=denied');
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${personId}.`)) {
    return out('gmail=error');
  }

  const tokens = await exchangeCode(code);
  if (!tokens.access_token) return out('gmail=error');

  const email = await gmailProfileEmail(tokens.access_token);
  await upsertIntegration({
    userId: personId,
    provider: 'gmail',
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope ?? '',
  });

  await registerMailbox(user.id, personId);
  return out('gmail=connected');
}

/** Vuelta de Google para Inbox: valida el state contra su cookie y guarda la cuenta personal. */
async function inboxCallback(req: NextRequest, personId: string, code: string | null, state: string): Promise<NextResponse> {
  const cookieState = req.cookies.get(INBOX_STATE_COOKIE)?.value;
  const done = (result: string) => {
    const r = NextResponse.redirect(new URL(`/app/inbox/settings?gmail=${result}`, req.url));
    r.cookies.delete(INBOX_STATE_COOKIE);
    return r;
  };
  if (req.nextUrl.searchParams.get('error')) return done('denied');
  if (!code || !cookieState || state !== cookieState || !state.startsWith(`${INBOX_STATE_PREFIX}${personId}.`)) return done('error');
  try {
    await completeGmailConnect(personId, code);
  } catch (err) {
    return done(err instanceof Error && err.message === 'gmail_scope' ? 'scope' : 'error');
  }
  return done('connected');
}
