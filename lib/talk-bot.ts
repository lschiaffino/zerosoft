/**
 * Talk: mensajes de integraciones (Flow, webhooks entrantes). Publican como
 * bot con un nombre en canales del workspace (nunca en DMs), y solo donde la
 * persona dueña de la integración es miembro. Server-only.
 */
import { getDb } from './db';
import { afterPost, getMembership, isWorkspacePerson, postMessage, TalkError, type TalkActor, type TalkMessageDto } from './talk';
import { normalizeChannelName } from './talk-markdown';

/** Canal por id o por nombre (#general / general). Solo canales, no DMs. */
export async function findChannel(workspaceId: string, ref: string): Promise<{ id: string; name: string } | null> {
  const raw = ref.trim();
  if (!raw) return null;
  const db = getDb();
  const byId = (await db
    .prepare("SELECT id, name FROM talk_channels WHERE workspace_id = ? AND id = ? AND kind IN ('public', 'private')")
    .get(workspaceId, raw)) as { id: string; name: string } | undefined;
  if (byId) return byId;
  const name = normalizeChannelName(raw);
  const byName = (await db
    .prepare("SELECT id, name FROM talk_channels WHERE workspace_id = ? AND name = ? AND kind IN ('public', 'private')")
    .get(workspaceId, name)) as { id: string; name: string } | undefined;
  return byName ?? null;
}

export async function postAsBot(
  workspaceId: string,
  input: { channel: string; body: string; threadId?: string | null; botName: string; memberId: string },
): Promise<TalkMessageDto> {
  const channel = await findChannel(workspaceId, input.channel);
  if (!channel) throw new TalkError('not_found', 404);
  // Publica solo donde la persona dueña de la integración (quien creó el flow
  // o el webhook) sigue en el workspace y es miembro del canal.
  if (!(await isWorkspacePerson(workspaceId, input.memberId)) || !(await getMembership(channel.id, input.memberId))) {
    throw new TalkError('not_member', 403);
  }
  const actor: TalkActor = { workspaceId, personId: workspaceId, role: 'owner', teamId: null };
  const result = await postMessage(
    actor,
    { channelId: channel.id, body: input.body, parentId: input.threadId || null, botName: input.botName.slice(0, 60) || 'Bot' },
    { asBot: true },
  );
  await afterPost(actor, result, { asBot: true });
  return result.message;
}
