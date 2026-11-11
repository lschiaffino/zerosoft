/**
 * Inbox y Lines: aviso en vivo de la lista de chats. Los triggers de
 * lib/schema/wa-live-triggers.ts anotan en wa_live_events cada cambio de un
 * chat que mueve la lista (un mensaje nuevo que lo saca de Archivados, archivar
 * desde el teléfono, leído, fijar…), escriba quien escriba (webhook, cron,
 * otra pestaña). Un solo lector por instancia del servidor (sharedFeed) reparte
 * a las conexiones, que filtran por su dueño (Inbox: la persona; Lines: el
 * workspace y las líneas que ve). El stream lleva solo ids: la pantalla relee
 * la lista por sus rutas de siempre, con su acceso. Server-only.
 */
import { getDb } from './db';
import { sharedFeed, sseLiveResponse, type SharedFeed } from './realtime';

export const LIVE_MAX_MS = 240_000;
const FEED_INTERVAL_MS = 700;
/** Conexiones abiertas por persona y app en esta instancia (una por pestaña visible). */
export const LIVE_MAX_PER_PERSON = 6;
const PAGE = 500;

export type LiveApp = 'inbox' | 'lines';

export interface LiveRaw {
  id: number;
  app: LiveApp;
  scope_id: string;
  chat_id: string;
  number_id: string;
}

export interface LiveEvent {
  id: number;
  chatId: string;
}

let feed: SharedFeed<LiveRaw> | null = null;

function liveFeed(): SharedFeed<LiveRaw> {
  feed ??= sharedFeed<LiveRaw>('wa-live', {
    intervalMs: FEED_INTERVAL_MS,
    start: async () => latestLiveId(),
    fetchSince: async (cursor) => fetchLive(cursor),
  });
  return feed;
}

export async function latestLiveId(): Promise<number> {
  const row = (await getDb().prepare('SELECT MAX(id) AS id FROM wa_live_events').get()) as { id: number | null } | undefined;
  return Number(row?.id ?? 0);
}

export async function fetchLive(cursor: number, limit = PAGE): Promise<LiveRaw[]> {
  const rows = (await getDb()
    .prepare('SELECT id, app, scope_id, chat_id, number_id FROM wa_live_events WHERE id > ? ORDER BY id LIMIT ?')
    .all(cursor, limit)) as LiveRaw[];
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Pura: lo de un lote que ve esta conexión, una vez por chat (el último aviso). */
export function liveBatch(events: LiveRaw[], allowed: (e: LiveRaw) => boolean): LiveEvent[] {
  const last = new Map<string, number>();
  for (const e of events) if (allowed(e)) last.set(e.chat_id, e.id);
  return [...last.entries()].map(([chatId, id]) => ({ id, chatId }));
}

/** Quién mira: Inbox (la persona) o Lines (el workspace, con las líneas que ve; null = todas). */
export type LiveViewer = { app: 'inbox'; owner: string } | { app: 'lines'; ws: string; numbers: Set<string> | null };

export function liveFilter(viewer: LiveViewer): (e: LiveRaw) => boolean {
  if (viewer.app === 'inbox') return (e) => e.app === 'inbox' && e.scope_id === viewer.owner;
  return (e) => e.app === 'lines' && e.scope_id === viewer.ws && (!viewer.numbers || viewer.numbers.has(e.number_id));
}

/** Polling (si SSE no anda): lo nuevo desde `cursor`; sin cursor, solo el cursor actual. */
export async function livePoll(viewer: LiveViewer, cursor: number): Promise<{ events: LiveEvent[]; cursor: number }> {
  if (cursor <= 0) return { events: [], cursor: await latestLiveId() };
  const rows = await fetchLive(cursor);
  const next = rows.length ? rows[rows.length - 1].id : cursor;
  // Mucho atraso: un aviso sin chat pide releer la lista entera.
  if (rows.length >= PAGE) return { events: [{ id: next, chatId: '' }], cursor: next };
  return { events: liveBatch(rows, liveFilter(viewer)), cursor: next };
}

const open = new Map<string, number>();

function takeSlot(key: string): boolean {
  const n = open.get(key) ?? 0;
  if (n >= LIVE_MAX_PER_PERSON) return false;
  open.set(key, n + 1);
  return true;
}

function freeSlot(key: string) {
  const n = (open.get(key) ?? 1) - 1;
  if (n <= 0) open.delete(key);
  else open.set(key, n);
}

/** Stream SSE de la lista. null si la persona ya tiene demasiadas conexiones abiertas. */
export function liveStream(opts: {
  key: string;
  cursor: number;
  signal?: AbortSignal;
  viewer: LiveViewer;
  /** Revalida el acceso cada tanto (y devuelve el viewer al día); null corta. */
  check: () => Promise<LiveViewer | null>;
}): Response | null {
  if (!takeSlot(opts.key)) return null;
  let allowed = liveFilter(opts.viewer);
  const f = liveFeed();
  return sseLiveResponse<LiveEvent>({
    cursor: opts.cursor,
    maxMs: LIVE_MAX_MS,
    heartbeatMs: 20_000,
    checkMs: 60_000,
    check: async () => {
      const v = await opts.check();
      if (!v) return false;
      allowed = liveFilter(v);
      return true;
    },
    signal: opts.signal,
    backlog: async (cursor) => {
      // Sin cursor no hay nada que recuperar: la pantalla acaba de leer la lista.
      if (cursor <= 0) return { events: [], cursor: f.cursor() || (await latestLiveId()) };
      const rows = await fetchLive(cursor);
      if (rows.length >= PAGE) return { events: [], cursor: rows[rows.length - 1].id, gap: true };
      return { events: liveBatch(rows, allowed), cursor: rows.length ? rows[rows.length - 1].id : cursor };
    },
    subscribe: (push) => {
      const off = f.subscribe((events) => {
        push({ events: liveBatch(events, allowed), cursor: events[events.length - 1].id });
      });
      let freed = false;
      return () => {
        off();
        if (!freed) {
          freed = true;
          freeSlot(opts.key);
        }
      };
    },
  });
}

/** Limpia el feed: lo de más de una hora ya no sirve para reconectar. */
export async function pruneLiveEvents(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const res = await getDb()
    .prepare('DELETE FROM wa_live_events WHERE id IN (SELECT id FROM wa_live_events ORDER BY id LIMIT 5000) AND created_at < ?')
    .run(before);
  return res.changes;
}
