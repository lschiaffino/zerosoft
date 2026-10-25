import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { saveSlackConnection, slackAuthorizeUrl, slackConfigured, slackFake } from '@/lib/track-slack';
import { signOAuthState } from '@/lib/track-integrations';
import { recordAudit } from '@/lib/track-audit';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Empieza el OAuth de Slack (o conecta el Slack de prueba con SLACK_FAKE=1). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  if (!slackConfigured()) return trackError(503, 'slack_not_configured');
  const workspaceId = trackWorkspaceId(user.team?.id ?? null, user.id);
  if (slackFake()) {
    await saveSlackConnection(workspaceId, { teamId: 'T_FAKE', teamName: 'Fake Slack', botToken: 'xoxb-fake', botUserId: 'U_BOT', installedBy: realUserId(user) });
    await recordAudit({ workspaceId, actorId: realUserId(user), action: 'integration.connected', entityType: 'integration', entityLabel: 'Slack (Fake Slack)' });
    return NextResponse.redirect(new URL('/app/track/settings?tab=integrations&slack=connected', req.url));
  }
  const redirectUri = new URL('/api/track/slack/callback', req.url).toString();
  return NextResponse.redirect(slackAuthorizeUrl(signOAuthState(workspaceId, realUserId(user)), redirectUri));
}
