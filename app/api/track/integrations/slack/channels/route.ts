import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { trackWorkspaceId } from '@/lib/track-labels';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { deleteChannelSub, getSlackConnection, listChannelSubs, listSlackChannels, saveChannelSub, SLACK_CHANNEL_EVENTS } from '@/lib/track-slack';
import { recordAudit } from '@/lib/track-audit';
import { trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function admin() {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  if (!isWorkspaceAdmin(user)) return { res: trackError(403, 'forbidden') } as const;
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  if (!(await getSlackConnection(ws))) return { res: trackError(409, 'slack_not_connected') } as const;
  return { user, ws } as const;
}

/** Canales de Slack disponibles para avisos. */
export async function GET() {
  const a = await admin();
  if ('res' in a) return a.res;
  try {
    return NextResponse.json({ channels: await listSlackChannels(a.ws) });
  } catch {
    return trackError(502, 'slack_error');
  }
}

const schema = z.object({
  projectId: z.string().trim().min(1).max(64),
  channelId: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/i),
  channelName: z.string().trim().max(80).default(''),
  events: z.array(z.enum(SLACK_CHANNEL_EVENTS)).min(1),
});

/** Crea o edita el aviso de un proyecto a un canal. */
export async function POST(req: NextRequest) {
  const a = await admin();
  if ('res' in a) return a.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return trackError(400, 'invalid_input');
  const project = await getProject(parsed.data.projectId);
  if (!project || !(await canAccessTrackProject(project, a.user.team?.id ?? null, a.user.id))) return trackError(400, 'invalid_project');
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
  return NextResponse.json({ subs: await listChannelSubs(a.ws) });
}

export async function DELETE(req: NextRequest) {
  const a = await admin();
  if ('res' in a) return a.res;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!(await deleteChannelSub(a.ws, id))) return trackError(404, 'not_found');
  return NextResponse.json({ subs: await listChannelSubs(a.ws) });
}
