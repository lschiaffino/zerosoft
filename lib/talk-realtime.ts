/**
 * Talk: tiempo real sobre el feed compartido (lib/realtime.ts). Una sola
 * consulta indexada (`id > ?`) cada ~700 ms por instancia del servidor, para
 * todas las pestañas; cada conexión filtra con su acceso cacheado (canales
 * donde es miembro y los públicos del workspace), que se refresca cuando
 * llega un evento de canal (altas, bajas, privados nuevos). Server-only.
 */
import { getDb } from './db';
import { sharedFeed, sseLiveResponse, type SharedFeed } from './realtime';
import { isWorkspacePerson, latestEventId, listEventsSince, type TalkActor, type TalkEvent, type TalkEventKind } from './talk';
import { heartbeat } from './talk-extras';

export const TALK_FEED_INTERVAL_MS = 700;
const BACKLOG_LIMIT = 200;

interface RawEvent extends TalkEvent {
  workspaceId: string;
  userId: string | null;
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

let feed: SharedFeed<RawEvent> | null = null;

export function talkFeed(): SharedFeed<RawEvent> {
  feed ??= sharedFeed<RawEvent>('talk', {
    intervalMs: TALK_FEED_INTERVAL_MS,
    start: async () => {
      const row = (await getDb().prepare('SELECT MAX(id) AS id FROM talk_events').get()) as { id: number | null } | undefined;
      return Number(row?.id ?? 0);
    },
    fetchSince: async (cursor) => {
      const rows = (await getDb()
        .prepare('SELECT id, workspace_id, channel_id, user_id, actor_id, kind, payload, created_at FROM talk_events WHERE id > ? ORDER BY id LIMIT 500')
        .all(cursor)) as Array<{ id: number; workspace_id: string; channel_id: string | null; user_id: string | null; actor_id: string | null; kind: TalkEventKind; payload: string; created_at: string }>;
      return rows.map((r) => ({
        id: Number(r.id),
        workspaceId: r.workspace_id,
        channelId: r.channel_id,
        userId: r.user_id,
        actorId: r.actor_id,
        kind: r.kind,
        payload: parseJson(r.payload),
        at: r.created_at,
      }));
    },
  });
  return feed;
}

/** Canales cuyos eventos ve esta persona: donde es miembro y los públicos del workspace. */
export async function visibleChannels(actor: TalkActor): Promise<Set<string>> {
  if (!(await isWorkspacePerson(actor.workspaceId, actor.personId))) return new Set();
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM talk_channels WHERE workspace_id = ? AND (kind = 'public' OR id IN (SELECT channel_id FROM talk_members WHERE user_id = ?))`,
    )
    .all(actor.workspaceId, actor.personId)) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/** Filtra un lote del feed para esta conexión (refresca el acceso si cambió algún canal). */
export function connectionFilter(actor: TalkActor, onRevoked?: () => void) {
  let access: Set<string> | null = null;
  let revoked = false;
  return async (events: RawEvent[]): Promise<TalkEvent[]> => {
    if (revoked) return [];
    const mine = events.filter((e) => e.workspaceId === actor.workspaceId);
    if (!mine.length) return [];
    // La persona salió del workspace: no pasa nada más por esta conexión y se corta.
    if (mine.some((e) => e.kind === 'access' && e.userId === actor.personId) && !(await isWorkspacePerson(actor.workspaceId, actor.personId))) {
      revoked = true;
      onRevoked?.();
      return [];
    }
    if (!access || mine.some((e) => e.kind === 'channel')) access = await visibleChannels(actor);
    const seen = access;
    return mine
      .filter((e) => (e.userId === null || e.userId === actor.personId) && (e.channelId === null || seen.has(e.channelId)))
      .map(({ workspaceId: _w, userId: _u, ...rest }) => {
        void _w;
        void _u;
        return rest;
      });
  };
}

/** Stream SSE de Talk para esta persona. */
export function talkStream(actor: TalkActor, cursor: number, signal?: AbortSignal): Response {
  let revoke: ((reason: string) => void) | null = null;
  const filter = connectionFilter(actor, () => revoke?.('revoked'));
  return sseLiveResponse<TalkEvent>({
    cursor,
    backlog: async (c) => {
      if (!c) return { events: [], cursor: await latestEventId(actor.workspaceId) };
      const back = await listEventsSince(actor, c, BACKLOG_LIMIT);
      // Demasiado atrasado: mejor que el navegador recargue el estado.
      return back.events.length >= BACKLOG_LIMIT ? { events: [], cursor: await latestEventId(actor.workspaceId), gap: true } : back;
    },
    subscribe: (push, close) => {
      revoke = close;
      return talkFeed().subscribe(async (events) => {
        const visible = await filter(events);
        push({ events: visible, cursor: events[events.length - 1]?.id ?? 0 });
      });
    },
    // Red de seguridad: cada 15 s se revalida que siga en el workspace.
    check: () => isWorkspacePerson(actor.workspaceId, actor.personId),
    checkMs: 15_000,
    heartbeatMs: 15_000,
    maxMs: 240_000,
    // Presencia mientras la pestaña está conectada (heartbeat deduplica por persona).
    tick: () => heartbeat(actor),
    tickMs: 60_000,
    signal,
  });
}
