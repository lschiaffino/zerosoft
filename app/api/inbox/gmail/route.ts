import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { delegatedIdentity } from '@/lib/mcp/identity';
import { accountDto, getAccount } from '@/lib/inbox/core';
import { connectFakeGmail, gmailAvailable, inboxFakeAllowed, inboxGmailAuthUrl, INBOX_STATE_COOKIE, INBOX_STATE_PREFIX, syncGmail } from '@/lib/inbox/gmail';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { InboxError } from '@/lib/inbox/types';
import { z } from 'zod';
import { signInToConnect } from '@/lib/oauth-signin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Conectar Gmail: redirige a Google con el state en una cookie httpOnly. La
 * vuelta llega al callback de Gmail de la suite (mismo redirect URI ya
 * registrado), que reconoce el prefijo "inbox." y la pasa a Inbox.
 */
export async function GET(req: Request) {
  if (delegatedIdentity()) return iJson({ error: 'unauthorized' }, 401);
  const user = await getCurrentUser();
  if (!user) return signInToConnect(req);
  const owner = realUserId(user);
  const settings = new URL('/app/inbox/settings', req.url);
  if (inboxFakeAllowed()) {
    await connectFakeGmail(owner);
    settings.searchParams.set('gmail', 'connected');
    return NextResponse.redirect(settings);
  }
  if (!gmailAvailable()) {
    settings.searchParams.set('gmail', 'unavailable');
    return NextResponse.redirect(settings);
  }
  const state = `${INBOX_STATE_PREFIX}${owner}.${crypto.randomUUID()}`;
  const res = NextResponse.redirect(inboxGmailAuthUrl(state));
  res.cookies.set(INBOX_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
  return res;
}

/** Sincronizar ahora una cuenta de Gmail. */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const { accountId } = await parseBody(req, z.object({ accountId: z.string().max(60) }));
    const account = await getAccount(owner, accountId);
    if (account.kind !== 'gmail') throw new InboxError('invalid_account', 400);
    const threads = await syncGmail(account, { maxThreads: 40 });
    return iJson({ threads, account: accountDto(await getAccount(owner, accountId)) });
  });
}
