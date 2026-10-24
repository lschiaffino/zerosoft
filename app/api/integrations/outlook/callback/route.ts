import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { upsertIntegration } from '@/lib/integrations';
import { exchangeOutlookCode, graphMe, OUTLOOK_PROVIDER } from '@/lib/microsoft';
import { registerOutlookMailbox } from '@/lib/crm-outlook-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-outlook-state';

/** Callback OAuth de Microsoft: valida state, cambia el code por tokens (cifrados) y registra el buzón. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  // El buzón es de la persona (no del workspace): en un team cada miembro conecta el suyo.
  const personId = realUserId(user);
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  function out(param: string): NextResponse {
    const r = NextResponse.redirect(new URL(`/app/crm/settings?tab=integrations&outlook=${param}`, req.url));
    r.cookies.delete(STATE_COOKIE);
    return r;
  }

  if (sp.get('error')) return out('denied');
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${personId}.`)) {
    return out('error');
  }

  const tokens = await exchangeOutlookCode(code);
  if (!tokens.access_token) return out('error');
  const me = await graphMe(tokens.access_token).catch(() => null);
  if (!me?.email) return out('error');

  await upsertIntegration({
    userId: personId,
    provider: OUTLOOK_PROVIDER,
    email: me.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope ?? '',
  });
  await registerOutlookMailbox(user.id, personId);
  return out('connected');
}
