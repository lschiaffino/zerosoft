import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { githubAppConfigured, githubAppInstallUrl } from '@/lib/track-github-app';
import { signOAuthState } from '@/lib/track-integrations';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Manda a instalar la GitHub App con un state firmado (workspace + persona). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  if (!githubAppConfigured()) return trackError(503, 'github_app_not_configured');
  const state = signOAuthState(trackWorkspaceId(user.team?.id ?? null, user.id), realUserId(user));
  return NextResponse.redirect(new URL(githubAppInstallUrl(state), req.url));
}
