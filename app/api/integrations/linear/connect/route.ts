import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { signOAuthState } from '@/lib/track-integrations';
import { linearAuthorizeUrl, linearOAuthConfigured } from '@/lib/track-linear-sync';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Login with Linear": manda a autorizar la app OAuth de Linear (scopes read,write). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  if (!linearOAuthConfigured()) return trackError(503, 'linear_not_configured');
  const workspaceId = trackWorkspaceId(user.team?.id ?? null, user.id);
  return NextResponse.redirect(linearAuthorizeUrl(signOAuthState(workspaceId, realUserId(user))));
}
