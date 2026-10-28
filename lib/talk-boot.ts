/**
 * Talk: lo que necesita la pantalla al abrir (y al refrescar el sidebar):
 * yo, las personas, los grupos, mis canales con sin leer y menciones,
 * presencia, preferencias, secciones, perfiles, huddles en vivo, comandos y
 * el cursor del feed de tiempo real. Un invitado solo ve a quienes comparten
 * canal con él.
 */
import { getDb } from './db';
import type { SessionUser } from './session';
import {
  listUnreadThreadIds,
  ensureGeneral,
  latestEventId,
  listMyChannels,
  listTalkGroups,
  listTalkPeople,
  sharedPeople,
  type TalkActor,
  type TalkChannelDto,
  type TalkPerson,
} from './talk';
import { getPrefs, heartbeat, listPresence, type TalkPrefs, type TalkPresenceDto } from './talk-extras';
import { listSections, type TalkSectionDto } from './talk-sections';
import { listProfileFields, listProfiles, type TalkProfileDto, type TalkProfileField } from './talk-profile';
import { listLiveHuddles } from './talk-huddles';
import { listCommands, type TalkCommandDto } from './talk-commands';
import { talkWorkspaces, type TalkWorkspaceOption } from './talk-guests';
import { vapidKeys } from './groups-push';

export interface TalkBootstrap {
  me: string;
  workspaceId: string;
  isAdmin: boolean;
  /** Soy invitado en este workspace (solo mis canales). */
  guest: boolean;
  /** Workspaces de Talk entre los que puedo cambiar (el mío y donde soy invitado). */
  workspaces: TalkWorkspaceOption[];
  people: TalkPerson[];
  groups: Array<{ id: string; name: string; handle: string; members: string[] }>;
  channels: TalkChannelDto[];
  presence: TalkPresenceDto[];
  prefs: TalkPrefs;
  sections: TalkSectionDto[];
  profiles: TalkProfileDto[];
  profileFields: TalkProfileField[];
  huddles: Array<{ channelId: string; huddleId: string; userIds: string[] }>;
  commands: TalkCommandDto[];
  /** El servidor tiene push del navegador configurado (VAPID). */
  pushAvailable: boolean;
  cursor: number;
  unreadThreads: number;
  unreadThreadIds: string[];
  /** Personas que estaban en mis DMs y ya no están en el workspace. */
  formerPeople: TalkPerson[];
  counts: { drafts: number; scheduled: number; later: number };
}

export async function loadTalkBootstrap(actor: TalkActor, opts: { locale?: string; heartbeat?: boolean; user?: SessionUser } = {}): Promise<TalkBootstrap> {
  await ensureGeneral(actor);
  if (opts.locale) {
    await getDb()
      .prepare('UPDATE talk_prefs SET locale = ? WHERE workspace_id = ? AND user_id = ?')
      .run(opts.locale, actor.workspaceId, actor.personId)
      .catch(() => undefined);
  }
  if (opts.heartbeat) await heartbeat(actor).catch(() => undefined);
  const db = getDb();
  const [allPeople, groups, channels, allPresence, prefs, cursor, unreadThreadIds, counts, sections, profiles, profileFields, huddles, commands, workspaces] = await Promise.all([
    listTalkPeople(actor.workspaceId),
    actor.guest ? Promise.resolve([]) : listTalkGroups(actor.workspaceId),
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
    listSections(actor),
    listProfiles(actor),
    listProfileFields(actor.workspaceId),
    listLiveHuddles(actor),
    listCommands(actor),
    opts.user ? talkWorkspaces(opts.user) : Promise.resolve([] as TalkWorkspaceOption[]),
  ]);
  // Un invitado ve a las personas de sus canales y DMs, no todo el directorio.
  const visible = actor.guest ? await sharedPeople(actor) : null;
  const people = visible ? allPeople.filter((p) => visible.has(p.id)) : allPeople;
  const presence = visible ? allPresence.filter((p) => visible.has(p.userId)) : allPresence;
  return {
    me: actor.personId,
    workspaceId: actor.workspaceId,
    isAdmin: !actor.guest && (actor.role === 'owner' || actor.role === 'admin'),
    guest: !!actor.guest,
    workspaces,
    people,
    groups,
    channels,
    presence,
    prefs,
    sections,
    profiles,
    profileFields,
    huddles,
    commands,
    pushAvailable: !!vapidKeys(),
    cursor,
    unreadThreads: unreadThreadIds.length,
    unreadThreadIds,
    formerPeople: await formerPeople(actor.workspaceId, channels.flatMap((c) => c.inactiveIds)),
    counts: { drafts: Number(counts.drafts), scheduled: Number(counts.scheduled), later: Number(counts.later) },
  };
}

async function formerPeople(workspaceId: string, ids: string[]): Promise<TalkPerson[]> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return [];
  const rows = (await getDb()
    .prepare(
      `SELECT u.id, u.name, u.email, u.image,
         EXISTS (SELECT 1 FROM talk_guest_invites i WHERE i.workspace_id = ? AND i.accepted_user_id = u.id) AS was_guest
       FROM users u WHERE u.id IN (${unique.map(() => '?').join(', ')})`,
    )
    .all(workspaceId, ...unique)) as Array<{ id: string; name: string | null; email: string; image: string | null; was_guest: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name?.trim() || r.email.split('@')[0], email: r.email, image: r.image, ...(Number(r.was_guest) ? { formerGuest: true } : {}) }));
}
