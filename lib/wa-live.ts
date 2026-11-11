/**
 * Inbox y Lines: aviso en vivo de la lista de chats, barato en lecturas.
 *
 * Los triggers de lib/schema/wa-live-triggers.ts anotan en wa_live_events cada
 * cambio de un chat que mueve la lista (un mensaje nuevo que lo saca de
 * Archivados, archivar desde el teléfono, leído, fijar…), escriba quien
 * escriba (webhook, cron, otra pestaña). La pantalla consulta cada pocos
 * segundos solo lo suyo y desde su cursor, por el índice (app, scope_id, id):
 * sin cambios la consulta no lee filas. Con un aviso relee la lista por sus
 * rutas de siempre (con su acceso); así la lista deja de consultarse cada
 * pocos segundos. Solo ids: nada del contenido. Server-only.
 *
 * Sin SSE a propósito: un lector compartido leería los avisos de todos los
 * workspaces en cada vuelta.
 */
import { getDb } from './db';

/** Avisos por consulta: más que esto es un hueco grande y la pantalla relee todo. */
const PAGE = 200;

export type LiveApp = 'inbox' | 'lines';

export interface LiveRaw {
  id: number;
  chat_id: string;
  number_id: string;
}

export interface LiveEvent {
  id: number;
  /** '' = releer toda la lista. */
  chatId: string;
}

/** Quién mira: Inbox (la persona) o Lines (el workspace, con las líneas que ve; null = todas). */
export type LiveViewer = { app: 'inbox'; owner: string } | { app: 'lines'; ws: string; numbers: Set<string> | null };

function scopeOf(viewer: LiveViewer): [LiveApp, string] {
  return viewer.app === 'inbox' ? ['inbox', viewer.owner] : ['lines', viewer.ws];
}

/** El último aviso de este dueño (una fila por el índice). */
export async function latestLiveId(viewer: LiveViewer): Promise<number> {
  const [app, scope] = scopeOf(viewer);
  const row = (await getDb().prepare('SELECT MAX(id) AS id FROM wa_live_events WHERE app = ? AND scope_id = ?').get(app, scope)) as { id: number | null } | undefined;
  return Number(row?.id ?? 0);
}

/** Lo nuevo de este dueño desde `cursor` (lee solo esas filas). */
export async function fetchLive(viewer: LiveViewer, cursor: number, limit = PAGE): Promise<LiveRaw[]> {
  const [app, scope] = scopeOf(viewer);
  const rows = (await getDb()
    .prepare('SELECT id, chat_id, number_id FROM wa_live_events WHERE app = ? AND scope_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(app, scope, cursor, limit)) as LiveRaw[];
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Pura: lo de un lote que ve esta persona, una vez por chat (el último aviso). */
export function liveBatch(rows: LiveRaw[], viewer: LiveViewer): LiveEvent[] {
  const last = new Map<string, number>();
  for (const r of rows) {
    if (viewer.app === 'lines' && viewer.numbers && !viewer.numbers.has(r.number_id)) continue;
    last.set(r.chat_id, r.id);
  }
  return [...last.entries()].map(([chatId, id]) => ({ id, chatId }));
}

/** La consulta de la pantalla: lo nuevo desde `cursor`; sin cursor, solo el cursor actual. */
export async function livePoll(
  viewer: LiveViewer,
  cursor: number,
  /** Lines: las líneas que ve la persona, pedidas solo si hay avisos (null = todas). */
  numbers?: () => Promise<Set<string> | null>,
): Promise<{ events: LiveEvent[]; cursor: number }> {
  if (cursor <= 0) return { events: [], cursor: await latestLiveId(viewer) };
  const rows = await fetchLive(viewer, cursor);
  if (!rows.length) return { events: [], cursor };
  const next = rows[rows.length - 1].id;
  // Mucho atraso: un aviso sin chat pide releer la lista entera.
  if (rows.length >= PAGE) return { events: [{ id: next, chatId: '' }], cursor: next };
  const v = viewer.app === 'lines' && numbers ? { ...viewer, numbers: await numbers() } : viewer;
  return { events: liveBatch(rows, v), cursor: next };
}

/** Limpia el feed: lo de más de una hora ya no sirve (por el índice de created_at: lee solo lo que borra). */
export async function pruneLiveEvents(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  const res = await getDb().prepare('DELETE FROM wa_live_events WHERE created_at < ?').run(before);
  return res.changes;
}
