/**
 * Chat: aviso en tiempo real. Triggers de la base anotan en chat_events cada
 * cambio de mensajes, conversación, escritura y presencia, así cualquier
 * escritura se ve sin tocar quien escribe. Un solo lector por instancia del
 * servidor (sharedFeed) reparte a las conexiones, que filtran con su acceso. El
 * stream lleva solo ids: el cliente relee por las rutas de siempre. Al
 * reconectar, Last-Event-ID trae lo perdido. Server-only.
 */
import { getDb } from './db';
import { sharedFeed, sseLiveResponse, type SharedFeed } from './realtime';

export const STREAM_MAX_MS = 240_000;
const FEED_INTERVAL_MS = 1000;
/** Conexiones abiertas por persona en esta instancia (cada navegador usa una por pestaña visible). */
export const STREAM_MAX_PER_PERSON = 4;

interface RawEvent {
  id: number;
  conversation_id: string;
  widget_id: string;
}

export interface ChatStreamEvent {
  id: number;
  conversationId: string;
}

let feed: SharedFeed<RawEvent> | null = null;

function chatFeed(): SharedFeed<RawEvent> {
  feed ??= sharedFeed<RawEvent>('chat', {
    intervalMs: FEED_INTERVAL_MS,
    start: async () => {
      const row = (await getDb().prepare('SELECT MAX(id) AS id FROM chat_events').get()) as { id: number | null } | undefined;
      return Number(row?.id ?? 0);
    },
    fetchSince: async (cursor) => fetchEvents(cursor),
  });
  return feed;
}

async function fetchEvents(cursor: number): Promise<RawEvent[]> {
  const rows = (await getDb()
    .prepare('SELECT id, conversation_id, widget_id FROM chat_events WHERE id > ? ORDER BY id LIMIT 500')
    .all(cursor)) as RawEvent[];
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Pura: lo de un lote que esta conexión puede ver, una vez por conversación. */
export function filterBatch(events: RawEvent[], allowed: (e: RawEvent) => boolean): ChatStreamEvent[] {
  const last = new Map<string, number>();
  for (const e of events) if (allowed(e)) last.set(e.conversation_id, e.id);
  return [...last.entries()].map(([conversationId, id]) => ({ id, conversationId }));
}

const open = new Map<string, number>();

/** Reserva un lugar para esta persona; false si ya tiene el máximo abierto. */
function takeSlot(key: string): boolean {
  const n = open.get(key) ?? 0;
  if (n >= STREAM_MAX_PER_PERSON) return false;
  open.set(key, n + 1);
  return true;
}

function freeSlot(key: string) {
  const n = (open.get(key) ?? 1) - 1;
  if (n <= 0) open.delete(key);
  else open.set(key, n);
}

interface StreamOptions {
  key: string;
  cursor: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Decide si la conexión ve el evento. */
  allowed: (e: RawEvent) => boolean | Promise<boolean>;
  /** Revalida el acceso cada tanto (y refresca lo que tenga en caché); false corta. */
  check: () => Promise<boolean>;
}

/** null si la persona ya tiene demasiadas conexiones. */
export function chatStream(opts: StreamOptions): Response | null {
  if (!takeSlot(opts.key)) return null;
  const filter = async (events: RawEvent[]): Promise<RawEvent[]> => {
    const out: RawEvent[] = [];
    for (const e of events) if (await opts.allowed(e)) out.push(e);
    return out;
  };
  const f = chatFeed();
  const res = sseLiveResponse<ChatStreamEvent>({
    cursor: opts.cursor,
    maxMs: STREAM_MAX_MS,
    heartbeatMs: 20_000,
    checkMs: 30_000,
    check: opts.check,
    signal: opts.signal,
    backlog: async (cursor) => {
      // Sin cursor no hay nada que recuperar: el cliente acaba de leer los datos.
      if (cursor <= 0) return { events: [], cursor: f.cursor() };
      const events = await fetchEvents(cursor);
      // Más de una página de atraso: que relea todo.
      if (events.length >= 500) return { events: [], cursor: events[events.length - 1].id, gap: true };
      const visible = await filter(events);
      return { events: filterBatch(visible, () => true), cursor: events.length ? events[events.length - 1].id : cursor };
    },
    subscribe: (push) => {
      const off = f.subscribe(async (events) => {
        const visible = await filter(events);
        push({ events: filterBatch(visible, () => true), cursor: events[events.length - 1].id });
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
  for (const [k, v] of Object.entries(opts.headers ?? {})) res.headers.set(k, v);
  return res;
}

/** Conversaciones de este visitante, con caché: una conversación desconocida del widget se consulta una vez. */
export function visitorConversationFilter(widgetId: string, visitorId: string) {
  const known = new Map<string, boolean>();
  return async (e: RawEvent): Promise<boolean> => {
    if (e.widget_id !== widgetId) return false;
    const hit = known.get(e.conversation_id);
    if (hit !== undefined) return hit;
    const row = await getDb().prepare('SELECT 1 AS ok FROM chat_conversations WHERE id = ? AND visitor_id = ?').get(e.conversation_id, visitorId);
    if (known.size > 500) known.clear();
    known.set(e.conversation_id, Boolean(row));
    return Boolean(row);
  };
}

/** Limpia el feed: lo de más de una hora ya no sirve para reconectar. */
export async function pruneChatEvents(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const res = await getDb()
    .prepare('DELETE FROM chat_events WHERE id IN (SELECT id FROM chat_events ORDER BY id LIMIT 5000) AND created_at < ?')
    .run(before);
  return res.changes;
}
