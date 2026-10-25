/**
 * Talk: lo que necesita la pantalla al abrir (y al refrescar el sidebar):
 * yo, las personas, los grupos, mis canales con sin leer y menciones,
 * presencia, preferencias y el cursor del feed de tiempo real.
 */
import { getDb } from './db';
import { countUnreadThreads, ensureGeneral, latestEventId, listMyChannels, listTalkGroups, listTalkPeople, type TalkActor, type TalkChannelDto, type TalkPerson } from './talk';
import { getPrefs, heartbeat, listPresence, type TalkPrefs, type TalkPresenceDto } from './talk-extras';

export interface TalkBootstrap {
  me: string;
  workspaceId: string;
  isAdmin: boolean;
  people: TalkPerson[];
  groups: Array<{ id: string; name: string; handle: string; members: string[] }>;
  channels: TalkChannelDto[];
  presence: TalkPresenceDto[];
  prefs: TalkPrefs;
  cursor: number;
  unreadThreads: number;
  counts: { drafts: number; scheduled: number; later: number };
}

export async function loadTalkBootstrap(actor: TalkActor, opts: { locale?: string; heartbeat?: boolean } = {}): Promise<TalkBootstrap> {
  await ensureGeneral(actor);
  if (opts.locale) {
    await getDb()
      .prepare('UPDATE talk_prefs SET locale = ? WHERE workspace_id = ? AND user_id = ?')
      .run(opts.locale, actor.workspaceId, actor.personId)
      .catch(() => undefined);
  }
  if (opts.heartbeat) await heartbeat(actor).catch(() => undefined);
  const db = getDb();
  const [people, groups, channels, presence, prefs, cursor, unreadThreads, counts] = await Promise.all([
    listTalkPeople(actor.workspaceId),
    listTalkGroups(actor.workspaceId),
    listMyChannels(actor),
    listPresence(actor.workspaceId),
    getPrefs(actor.workspaceId, actor.personId),
    latestEventId(actor.workspaceId),
    countUnreadThreads(actor),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM talk_drafts d JOIN talk_channels c ON c.id = d.channel_id WHERE d.user_id = ? AND c.workspace_id = ?) AS drafts,
           (SELECT COUNT(*) FROM talk_scheduled WHERE user_id = ? AND workspace_id = ? AND status IN ('pending', 'failed')) AS scheduled,
           (SELECT COUNT(*) FROM talk_saved WHERE user_id = ? AND workspace_id = ? AND done_at IS NULL) AS later`,
      )
      .get(actor.personId, actor.workspaceId, actor.personId, actor.workspaceId, actor.personId, actor.workspaceId) as Promise<{ drafts: number; scheduled: number; later: number }>,
  ]);
  return {
    me: actor.personId,
    workspaceId: actor.workspaceId,
    isAdmin: actor.role === 'owner' || actor.role === 'admin',
    people,
    groups,
    channels,
    presence,
    prefs,
    cursor,
    unreadThreads,
    counts: { drafts: Number(counts.drafts), scheduled: Number(counts.scheduled), later: Number(counts.later) },
  };
}
