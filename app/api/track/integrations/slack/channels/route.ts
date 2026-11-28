import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { deleteChannelSub, getSlackConnection, listChannelSubs, listSlackChannels, saveChannelSub, SLACK_CHANNEL_EVENTS } from '@/lib/track-slack';
import { recordAudit } from '@/lib/track-audit';
import { teamCanById } from '@/lib/track-team-guard';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Avisos de Slack por team. Los admins del workspace manejan todos; el dueño
 * de un team, los de su team (lib/track-team-roles). Conectar Slack sigue
 * siendo del workspace (/api/track/integrations/slack).
 */
async function slackCtx() {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  return { user, ws, admin: isWorkspaceAdmin(user) } as const;
}

async function mayManage(user: SessionUser, admin: boolean, projectId: string | null | undefined): Promise<boolean> {
  return admin || (await teamCanById(user, projectId, 'owner'));
}

/** Canales de Slack disponibles. Con ?projectId, también los avisos de ese team. */
export async function GET(req: NextRequest) {
  const a = await slackCtx();
  if ('res' in a) return a.res;
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!(await mayManage(a.user, a.admin, projectId))) return trackError(403, 'forbidden');
  const conn = await getSlackConnection(a.ws);
  if (!conn) return projectId ? NextResponse.json({ connected: false, channels: [], subs: [] }) : trackError(409, 'slack_not_connected');
  let channels: Array<{ id: string; name: string }>;
  try {
    channels = await listSlackChannels(a.ws);
  } catch {
    return trackError(502, 'slack_error');
  }
  if (!projectId) return NextResponse.json({ channels });
  const subs = (await listChannelSubs(a.ws, { forViewer: true })).filter((s) => s.projectId === projectId);
  return NextResponse.json({ connected: true, channels, subs });
}

const schema = z.object({
  projectId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/i),
  channelName: z.string().trim().max(80).default(''),
  events: z.array(z.enum(SLACK_CHANNEL_EVENTS)).min(1),
});

/** Crea o edita el aviso de un team a un canal. */
export async function POST(req: NextRequest) {
  const a = await slackCtx();
  if ('res' in a) return a.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, 'invalid_input');
  const project = await getProject(parsed.data.projectId);
  if (!project || !(await canAccessTrackProject(project, a.user.team?.id ?? null, a.user.id))) return trackError(400, 'invalid_project');
  if (!(await mayManage(a.user, a.admin, project.id))) return trackError(403, 'forbidden');
  if (!(await getSlackConnection(a.ws))) return trackError(409, 'slack_not_connected');
  await saveChannelSub(a.ws, parsed.data);
  await recordAudit({
    workspaceId: a.ws,
    actorId: realUserId(a.user),
    action: 'integration.updated',
    entityType: 'integration',
    entityLabel: `Slack #${parsed.data.channelName || parsed.data.channelId} · ${project.name}`,
    projectId: project.id,
    data: { events: parsed.data.events },
  });
  const subs = await listChannelSubs(a.ws, { forViewer: true });
  return NextResponse.json({ subs: a.admin ? subs : subs.filter((s) => s.projectId === project.id) });
}

export async function DELETE(req: NextRequest) {
  const a = await slackCtx();
  if ('res' in a) return a.res;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const subs = await listChannelSubs(a.ws, { forViewer: true });
  const sub = subs.find((s) => s.id === id);
  // Un aviso que no ve (team privado ajeno) cuenta como inexistente.
  if (!sub) return trackError(404, 'not_found');
  if (!(await mayManage(a.user, a.admin, sub.projectId))) return trackError(403, 'forbidden');
  if (!(await deleteChannelSub(a.ws, id))) return trackError(404, 'not_found');
  const rest = subs.filter((s) => s.id !== id);
  return NextResponse.json({ subs: a.admin ? rest : rest.filter((s) => s.projectId === sub.projectId) });
}
