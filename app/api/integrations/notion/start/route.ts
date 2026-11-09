import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId, userCanUseApp } from '@/lib/session';
import { notionAuthUrl, notionOAuthConfigured } from '@/lib/notion-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-notion-state';

/**
 * "Conectar con Notion": state en cookie httpOnly y redirect al consentimiento
 * de Notion (ahí se eligen las páginas y bases que se comparten).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!userCanUseApp(user, 'docs') || !isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!notionOAuthConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 501 });
  const state = `${user.id}.${realUserId(user)}.${crypto.randomUUID()}`;
  const res = NextResponse.redirect(notionAuthUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
