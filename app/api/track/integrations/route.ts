import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { getIntegrationRow, integrationView, listIntegrationEvents, type IntegrationProvider } from '@/lib/track-integrations';
import { getSlackConnection, listChannelSubs, slackConfigured } from '@/lib/track-slack';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORT: IntegrationProvider[] = ['sentry', 'zendesk', 'intercom'];

/** Estado de Slack, Sentry, Zendesk e Intercom del workspace (sin tokens ni secretos). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  const admin = isWorkspaceAdmin(user);
  const origin = new URL(req.url).origin;
  const support: Record<string, unknown> = {};
  for (const p of SUPPORT) {
    const row = await getIntegrationRow(ws, p);
    support[p] = row
      ? {
          ...integrationView(row),
          webhookUrl: p === 'sentry' ? `${origin}/api/track/sentry/webhook/${row.id}` : null,
          log: admin ? await listIntegrationEvents(ws, p, 10) : [],
        }
      : null;
  }
  const slack = await getSlackConnection(ws);
  return NextResponse.json({
    isAdmin: admin,
    slack: {
      configured: slackConfigured(),
      connection: slack,
      subs: slack ? await listChannelSubs(ws) : [],
      log: slack && admin ? await listIntegrationEvents(ws, 'slack', 10) : [],
      urls: {
        commands: `${origin}/api/track/slack/commands`,
        interactions: `${origin}/api/track/slack/interactions`,
        events: `${origin}/api/track/slack/events`,
      },
    },
    ...support,
  });
}
