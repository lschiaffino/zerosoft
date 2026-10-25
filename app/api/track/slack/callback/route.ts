import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { exchangeSlackCode, saveSlackConnection } from '@/lib/track-slack';
import { verifyOAuthState } from '@/lib/track-integrations';
import { recordAudit } from '@/lib/track-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: Request, status: string): NextResponse {
  return NextResponse.redirect(new URL(`/app/track/settings?tab=integrations&slack=${status}`, req.url));
}

/** Vuelta del OAuth de Slack: guarda el token del bot cifrado. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/app', req.url));
  if (!isWorkspaceAdmin(user)) return back(req, 'forbidden');
  if (url.searchParams.get('error')) return back(req, 'denied');
  const state = verifyOAuthState(url.searchParams.get('state'));
  const workspaceId = trackWorkspaceId(user.team?.id ?? null, user.id);
  if (!state || state.workspaceId !== workspaceId || state.personId !== realUserId(user)) return back(req, 'invalid_state');
  const code = url.searchParams.get('code');
  if (!code) return back(req, 'denied');
  try {
    const redirectUri = new URL('/api/track/slack/callback', req.url).toString();
    const res = await exchangeSlackCode(code, redirectUri);
    await saveSlackConnection(workspaceId, { ...res, installedBy: realUserId(user) });
    await recordAudit({ workspaceId, actorId: realUserId(user), action: 'integration.connected', entityType: 'integration', entityLabel: `Slack (${res.teamName})` });
    return back(req, 'connected');
  } catch {
    return back(req, 'failed');
  }
}
