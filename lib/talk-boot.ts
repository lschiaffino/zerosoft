/**
 * Talk: lo que necesita la pantalla al abrir (y al refrescar el sidebar):
 * yo, las personas, los grupos, mis canales con sin leer y menciones,
 * presencia, preferencias y el cursor del feed de tiempo real.
 */
import { getDb } from './db';
import { listUnreadThreadIds, ensureGeneral, latestEventId, listMyChannels, listTalkGroups, listTalkPeople, type TalkActor, type TalkChannelDto, type TalkPerson } from './talk';
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
  unreadThreadIds: string[];
  /** Personas que estaban en mis DMs y ya no están en el workspace. */
  formerPeople: TalkPerson[];
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
  const [people, groups, channels, presence, prefs, cursor, unreadThreadIds, counts] = await Promise.all([
    listTalkPeople(actor.workspaceId),
    listTalkGroups(actor.workspaceId),
    listMyChannels(actor),
    listPresence(actor.workspaceId),
    getPrefs(actor.workspaceId, actor.personId),
    latestEventId(actor.workspaceId),
    listUnreadThreadIds(actor),
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
    unreadThreads: unreadThreadIds.length,
    unreadThreadIds,
    formerPeople: await formerPeople(channels.flatMap((c) => c.inactiveIds)),
    counts: { drafts: Number(counts.drafts), scheduled: Number(counts.scheduled), later: Number(counts.later) },
  };
}

async function formerPeople(ids: string[]): Promise<TalkPerson[]> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return [];
  const rows = (await getDb()
    .prepare(`SELECT id, name, email, image FROM users WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .all(...unique)) as Array<{ id: string; name: string | null; email: string; image: string | null }>;
  return rows.map((r) => ({ id: r.id, name: r.name?.trim() || r.email.split('@')[0], email: r.email, image: r.image }));
}
