/**
 * Talk: API v1 (Bearer zs_…). La key actúa como la persona que la creó: ve
 * los canales que esa persona ve y escribe donde es miembro (en un público,
 * se une sola al escribir, como haría desde la app).
 */
import type { ApiKeyAuth } from './api-auth';
import { joinChannel, readableChannel, type TalkActor, type TalkChannelDto, type TalkMessageDto } from './talk';
import { findChannel } from './talk-bot';

export function v1Actor(auth: ApiKeyAuth): TalkActor {
  return { workspaceId: auth.user.id, personId: auth.personId, role: auth.role, teamId: null };
}

/** Canal por id o nombre, si la persona de la key lo puede leer. */
export async function v1Channel(actor: TalkActor, ref: string): Promise<string | null> {
  // findChannel solo devuelve canales (públicos o privados): los DMs no salen por la API.
  const found = await findChannel(actor.workspaceId, ref);
  if (!found) return null;
  return (await readableChannel(actor, found.id)) ? found.id : null;
}

export async function ensureCanPost(actor: TalkActor, channelId: string): Promise<void> {
  const access = await readableChannel(actor, channelId);
  if (access && !access.member && access.channel.kind === 'public' && !access.channel.archived_at) await joinChannel(actor, channelId);
}

export function channelV1(c: TalkChannelDto) {
  return { id: c.id, name: c.name, kind: c.kind, topic: c.topic, description: c.description, archived: c.archived, member_count: c.memberCount, is_member: c.isMember, created_at: c.createdAt };
}

export function messageV1(m: TalkMessageDto) {
  return {
    id: m.id,
    channel_id: m.channelId,
    thread_id: m.parentId,
    user_id: m.userId,
    bot_name: m.botName,
    text: m.body,
    files: m.files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })),
    reactions: m.reactions.map((r) => ({ emoji: r.emoji, count: r.count, users: r.users })),
    reply_count: m.replyCount,
    edited_at: m.editedAt,
    pinned: m.pinned,
    created_at: m.createdAt,
  };
}
