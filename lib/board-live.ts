/**
 * Board: tiempo real sobre el feed compartido (lib/realtime.ts), como Talk.
 *
 * Cada pestaña abierta en una pizarra manda, cada ~120 ms mientras pasa algo,
 * un evento a `board_events`: su cursor, lo que tiene seleccionado, la parte
 * del lienzo que ve (para que la puedan seguir) y los elementos que cambió
 * desde el último envío. Una sola lectura indexada del feed por instancia del
 * servidor reparte lo nuevo a todas las conexiones SSE; cada conexión deja
 * pasar solo los eventos de su pizarra y revalida su acceso cuando cambia el
 * acceso de la pizarra (evento `access`) y cada 10 s.
 *
 * La identidad (persona, nombre, invitado) la pone el servidor, nunca el
 * navegador. El guardado sigue siendo el PUT de la escena con versión: el
 * evento `saved` avisa a los demás para que traigan la versión guardada.
 * Server-only.
 */
import { getDb } from './db';
import { sharedFeed, sseLiveResponse, type SharedFeed } from './realtime';
import { accessAtLeast, boardViewer, getBoardAccess, type BoardAccessLevel, type BoardViewer } from './board-access';
import type { TeamRole } from './teams';
import { sanitizeElements } from './board-import';

export const BOARD_FEED_INTERVAL_MS = 200;
/** Eventos que el atraso de una conexión manda antes de pedir recargar. */
const BACKLOG_LIMIT = 300;
/** Tope del JSON de un evento (los elementos cambiados de un tick). */
export const BOARD_LIVE_MAX_BYTES = 256 * 1024;
/** Los eventos son efímeros: lo de hace más de esto se borra. */
export const BOARD_EVENTS_TTL_MS = 10 * 60 * 1000;

export type BoardLiveKind = 'update' | 'summon' | 'leave' | 'saved' | 'access';

export interface BoardLiveUser {
  /** Persona (null = invitado del link de edición). */
  id: string | null;
  name: string | null;
  guest: boolean;
}

export interface BoardLiveEvent {
  id: number;
  kind: BoardLiveKind;
  socketId: string;
  user: BoardLiveUser | null;
  payload: Record<string, unknown>;
  at: string;
}

interface RawEvent extends BoardLiveEvent {
  boardId: string;
  workspaceId: string;
}

/** Quién está conectado: una persona del workspace o un invitado con el token. */
export type BoardLiveActor =
  | { kind: 'member'; viewer: BoardViewer; boardId: string; workspaceId: string; user: BoardLiveUser; level: BoardAccessLevel }
  | { kind: 'guest'; token: string; boardId: string; workspaceId: string; user: BoardLiveUser; level: 'edit' };

const SOCKET_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validSocketId(raw: unknown): raw is string {
  return typeof raw === 'string' && SOCKET_RE.test(raw);
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type Row = { id: number; board_id: string; workspace_id: string; socket_id: string; kind: BoardLiveKind; payload: string; created_at: string };

function toRaw(r: Row): RawEvent {
  const payload = parseJson(r.payload);
  const user = (payload.user as BoardLiveUser | undefined) ?? null;
  delete payload.user;
  return {
    id: Number(r.id),
    boardId: r.board_id,
    workspaceId: r.workspace_id,
    socketId: r.socket_id,
    kind: r.kind,
    user,
    payload,
    at: r.created_at,
  };
}

const strip = ({ boardId: _b, workspaceId: _w, ...rest }: RawEvent): BoardLiveEvent => {
  void _b;
  void _w;
  return rest;
};

let feed: SharedFeed<RawEvent> | null = null;

export function boardFeed(): SharedFeed<RawEvent> {
  feed ??= sharedFeed<RawEvent>('boards', {
    intervalMs: BOARD_FEED_INTERVAL_MS,
    start: latestBoardEventId,
    fetchSince: async (cursor) => {
      const rows = (await getDb()
        .prepare('SELECT id, board_id, workspace_id, socket_id, kind, payload, created_at FROM board_events WHERE id > ? ORDER BY id LIMIT 500')
        .all(cursor)) as Row[];
      return rows.map(toRaw);
    },
  });
  return feed;
}

export async function latestBoardEventId(): Promise<number> {
  const row = (await getDb().prepare('SELECT MAX(id) AS id FROM board_events').get()) as { id: number | null } | undefined;
  return Number(row?.id ?? 0);
}

let inserts = 0;

/** Agrega un evento al feed. `user` lo pone el servidor. */
export async function publishBoardEvent(e: {
  boardId: string;
  workspaceId: string;
  socketId: string;
  kind: BoardLiveKind;
  user?: BoardLiveUser | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const json = JSON.stringify({ ...(e.payload ?? {}), user: e.user ?? null });
  await getDb()
    .prepare('INSERT INTO board_events (board_id, workspace_id, socket_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(e.boardId, e.workspaceId, e.socketId, e.kind, json, new Date().toISOString());
  // De vez en cuando se poda acá también (además del cron), así la tabla no crece si el cron no corre.
  inserts += 1;
  if (inserts % 500 === 0) void pruneBoardEvents().catch(() => undefined);
}

/** Borra los eventos viejos (son efímeros). */
export async function pruneBoardEvents(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - BOARD_EVENTS_TTL_MS).toISOString();
  const res = await getDb().prepare('DELETE FROM board_events WHERE created_at < ?').run(cutoff);
  return res.changes;
}

/** Aviso a las conexiones de la pizarra para que revaliden su acceso ya (cambió el modo, un invitado, el link). */
export async function publishBoardAccessChanged(workspaceId: string, boardId: string): Promise<void> {
  await publishBoardEvent({ boardId, workspaceId, socketId: 'server', kind: 'access' }).catch(() => undefined);
}

// ---------- Actores ----------

type SessionLike = { id: string; actingUser?: { id: string; name?: string | null; email?: string | null } | null; role?: TeamRole; name?: string | null; email?: string | null };

/** Persona del workspace con acceso a la pizarra (null = no la puede ver). */
export async function memberLiveActor(user: SessionLike, boardId: string): Promise<BoardLiveActor | null> {
  const viewer = boardViewer(user);
  const level = await getBoardAccess(viewer, boardId);
  if (!level) return null;
  const person = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(viewer.personId)) as
    | { name: string | null; email: string | null }
    | undefined;
  const name = person?.name?.trim() || person?.email?.split('@')[0] || null;
  return { kind: 'member', viewer, boardId, workspaceId: viewer.workspaceId, user: { id: viewer.personId, name, guest: false }, level };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

/** Invitado del link de edición (null = el link no existe o se apagó). */
export async function guestLiveActor(token: string): Promise<BoardLiveActor | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = (await getDb()
    .prepare('SELECT id, workspace_id FROM boards WHERE edit_token = ? AND deleted_at IS NULL')
    .get(token)) as { id: string; workspace_id: string } | undefined;
  if (!row) return null;
  return { kind: 'guest', token, boardId: row.id, workspaceId: row.workspace_id, user: { id: null, name: null, guest: true }, level: 'edit' };
}

/** ¿Sigue teniendo acceso? (red de seguridad periódica y tras un evento `access`). */
export async function stillAllowed(actor: BoardLiveActor): Promise<boolean> {
  if (actor.kind === 'guest') {
    const again = await guestLiveActor(actor.token);
    return again?.boardId === actor.boardId;
  }
  const level = await getBoardAccess(actor.viewer, actor.boardId);
  return level !== null;
}

// ---------- Envío (POST) ----------

/** Puntero, selección y vista de quien manda (todo opcional y acotado). */
export interface LivePresence {
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  button?: 'up' | 'down';
  selected?: string[];
  /** Parte del lienzo que ve: [x1, y1, x2, y2] en coordenadas de la escena. */
  bounds?: [number, number, number, number];
  idle?: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e9;

export function cleanPresence(raw: unknown): LivePresence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: LivePresence = {};
  const p = r.pointer as Record<string, unknown> | undefined;
  if (p && finite(p.x) && finite(p.y)) out.pointer = { x: p.x, y: p.y, tool: p.tool === 'laser' ? 'laser' : 'pointer' };
  if (r.button === 'down' || r.button === 'up') out.button = r.button;
  if (Array.isArray(r.selected)) out.selected = r.selected.filter((s): s is string => typeof s === 'string' && s.length <= 128).slice(0, 200);
  if (Array.isArray(r.bounds) && r.bounds.length === 4 && r.bounds.every(finite)) {
    const [x1, y1, x2, y2] = r.bounds as number[];
    if (x2 > x1 && y2 > y1) out.bounds = [x1, y1, x2, y2];
  }
  if (r.idle === true) out.idle = true;
  return out;
}

/** Elementos cambiados: objetos con id y tipo, como mucho 2000. null si no hay o no son válidos. */
export function cleanElements(raw: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2000) return null;
  const out: Array<Record<string, unknown>> = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const el = e as Record<string, unknown>;
    if (typeof el.id !== 'string' || el.id.length > 128 || typeof el.type !== 'string' || el.type.length > 32) return null;
    out.push(el);
  }
  return sanitizeElements(out);
}

export type LiveSendResult = { ok: true } | { ok: false; status: number; code: string };

/** Lo que manda una pestaña: presencia y/o elementos, traer a todos, o salir. */
export async function handleLiveSend(actor: BoardLiveActor, body: unknown): Promise<LiveSendResult> {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, code: 'invalid_input' };
  const b = body as Record<string, unknown>;
  if (!validSocketId(b.socketId)) return { ok: false, status: 400, code: 'invalid_input' };
  const base = { boardId: actor.boardId, workspaceId: actor.workspaceId, socketId: b.socketId, user: actor.user };
  if (b.leave === true) {
    await publishBoardEvent({ ...base, kind: 'leave' });
    return { ok: true };
  }
  const presence = cleanPresence(b.presence);
  if (b.summon === true) {
    // Traer a todos a mi vista: solo quien edita (un lector no maneja el taller).
    if (!accessAtLeast(actor.level, 'edit')) return { ok: false, status: 403, code: 'forbidden' };
    if (!presence?.bounds) return { ok: false, status: 400, code: 'invalid_input' };
    await publishBoardEvent({ ...base, kind: 'summon', payload: { presence, presenting: b.presenting === true } });
    return { ok: true };
  }
  let elements: Array<Record<string, unknown>> | null = null;
  if (b.elements !== undefined) {
    if (!accessAtLeast(actor.level, 'edit')) return { ok: false, status: 403, code: 'forbidden' };
    elements = cleanElements(b.elements);
    if (!elements) return { ok: false, status: 400, code: 'invalid_input' };
  }
  if (!presence && !elements) return { ok: false, status: 400, code: 'invalid_input' };
  const payload: Record<string, unknown> = {};
  if (presence) payload.presence = presence;
  if (elements) payload.elements = elements;
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > BOARD_LIVE_MAX_BYTES) return { ok: false, status: 413, code: 'too_large' };
  await publishBoardEvent({ ...base, kind: 'update', payload });
  return { ok: true };
}

/**
 * Límite en memoria por pestaña (por instancia): el cliente manda como mucho
 * ~8 por segundo; esto corta a uno que se vuelva loco sin tocar la base.
 */
const buckets = new Map<string, { tokens: number; at: number }>();
export function liveAllowed(key: string, now = Date.now(), perSecond = 15, burst = 30): boolean {
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
  b.at = now;
  if (buckets.size > 5000) buckets.clear();
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

// ---------- Lectura (SSE y polling) ----------

/** Eventos de la pizarra después de `cursor` (atraso o polling). */
export async function boardEventsSince(boardId: string, cursor: number, limit = BACKLOG_LIMIT): Promise<{ events: BoardLiveEvent[]; cursor: number; gap?: boolean }> {
  if (!cursor) return { events: [], cursor: await latestBoardEventId() };
  const rows = (await getDb()
    .prepare('SELECT id, board_id, workspace_id, socket_id, kind, payload, created_at FROM board_events WHERE board_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(boardId, cursor, limit)) as Row[];
  if (rows.length >= limit) return { events: [], cursor: await latestBoardEventId(), gap: true };
  const latest = await latestBoardEventId();
  return { events: rows.map(toRaw).map(strip), cursor: Math.max(cursor, latest) };
}

/** Filtro de una conexión: solo su pizarra; ante un evento `access` revalida y corta si lo perdió. */
export function liveConnectionFilter(actor: BoardLiveActor, onRevoked: () => void) {
  let revoked = false;
  return async (events: RawEvent[]): Promise<BoardLiveEvent[]> => {
    if (revoked) return [];
    const mine = events.filter((e) => e.boardId === actor.boardId && e.workspaceId === actor.workspaceId);
    if (!mine.length) return [];
    if (mine.some((e) => e.kind === 'access') && !(await stillAllowed(actor))) {
      revoked = true;
      onRevoked();
      return [];
    }
    return mine.map(strip);
  };
}

/** Stream SSE de la pizarra para esta persona o invitado. */
export function boardLiveStream(actor: BoardLiveActor, cursor: number, signal?: AbortSignal): Response {
  let revoke: ((reason: string) => void) | null = null;
  const filter = liveConnectionFilter(actor, () => revoke?.('revoked'));
  return sseLiveResponse<BoardLiveEvent>({
    cursor,
    backlog: (c) => boardEventsSince(actor.boardId, c),
    subscribe: (push, close) => {
      revoke = close;
      return boardFeed().subscribe(async (events) => {
        const visible = await filter(events);
        push({ events: visible, cursor: events[events.length - 1]?.id ?? 0 });
      });
    },
    check: () => stillAllowed(actor),
    checkMs: 10_000,
    heartbeatMs: 15_000,
    // Como Talk: la ruta declara maxDuration 300 y el navegador reconecta solo.
    maxMs: 240_000,
    signal,
  });
}
