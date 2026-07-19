import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { exchangeCode, gmailProfileEmail, upsertIntegration } from '@/lib/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-gmail-state';

function redirectToSettings(req: NextRequest, params: string): NextResponse {
  return NextResponse.redirect(new URL(`/app/crm/settings?${params}`, req.url));
}

/** Callback OAuth: valida state, cambia el code por tokens y guarda la integración. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  function out(params: string): NextResponse {
    const r = redirectToSettings(req, params);
    r.cookies.delete(STATE_COOKIE);
    return r;
  }

  if (sp.get('error')) return out('gmail=denied');
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${user.id}.`)) {
    return out('gmail=error');
  }

  const tokens = await exchangeCode(code);
  if (!tokens.access_token) return out('gmail=error');

  const email = await gmailProfileEmail(tokens.access_token);
  await upsertIntegration({
    userId: user.id,
    provider: 'gmail',
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope ?? '',
  });

  return out('gmail=connected');
}
