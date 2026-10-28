/**
 * Board: tiempo real sobre el feed compartido (lib/realtime.ts), como Talk.
 *
 * Dos canales:
 *  - Presencia (cursor, selección, láser, la parte del lienzo que se ve):
 *    efímera, NO va a board_events. Vive en memoria de cada instancia y se
 *    reparte al instante a las conexiones de esa instancia. Para las demás
 *    instancias, cada una escribe a lo sumo 4 veces por segundo UNA fila por
 *    pizarra en board_presence (upsert, sin crecer) con lo de sus pestañas, y
 *    lee las filas de las otras instancias para las pizarras que tiene abiertas.
 *  - Eventos que importan (elementos cambiados, traer a todos, guardado,
 *    cambio de acceso): van a board_events, con tope de 32 KB por evento y de
 *    bytes por minuto por persona o invitado. Lo grande viaja por el guardado.
 *
 * La identidad la pone el servidor: el id de pestaña que manda el navegador
 * se ata a quien lo manda (prefijo con el hash de la persona o del token), así
 * nadie puede hablar, irse o mover la vista "en nombre" de otra pestaña. Cada
 * conexión revalida desde la base (membresía, rol, acceso a la pizarra)
 * cuando cambia el acceso y cada 10 s. Server-only.
 */
import { createHash } from 'node:crypto';
import { getDb } from './db';
import { sharedFeed, sseLiveResponse, type SharedFeed } from './realtime';
import { accessAtLeast, boardViewer, freshBoardViewer, getBoardAccess, type BoardAccessLevel, type BoardViewer } from './board-access';
import type { TeamRole } from './teams';
import { sanitizeElements } from './board-import';

export const BOARD_FEED_INTERVAL_MS = 200;
/** Eventos que el atraso de una conexión manda antes de pedir recargar. */
const BACKLOG_LIMIT = 300;
/** Tope del JSON de un evento: lo que no entra se lo lleva el guardado (los demás lo traen al guardarse). */
export const BOARD_LIVE_MAX_BYTES = 32 * 1024;
/** Bytes de elementos por minuto por persona o invitado. */
export const BOARD_LIVE_BYTES_PER_MIN = 1024 * 1024;
/** Lo que lee el feed por vuelta, como mucho (además del tope de filas). */
const FEED_MAX_BYTES = 1024 * 1024;
/** Los eventos son efímeros: lo de hace más de esto se borra. */
export const BOARD_EVENTS_TTL_MS = 10 * 60 * 1000;
/** Sin noticias de una pestaña en este tiempo, deja de figurar. */
export const PRESENCE_TTL_MS = 30_000;
/** Cada cuánto una instancia escribe su fila de presencia (≤ 4 Hz por pizarra). */
export const PRESENCE_FLUSH_MS = 250;

export type BoardLiveKind = 'update' | 'summon' | 'leave' | 'saved' | 'access' | 'presence';

export interface BoardLiveUser {
  /** Persona (null = invitado del link de edición). */
  id: string | null;
  name: string | null;
  guest: boolean;
}

export interface BoardLiveEvent {
  id?: number;
  kind: BoardLiveKind;
  socketId: string;
  user: BoardLiveUser | null;
  payload: Record<string, unknown>;
  at: string;
}

interface RawEvent extends BoardLiveEvent {
  id: number;
  boardId: string;
  workspaceId: string;
}

/** Quién está conectado: una persona del workspace o un invitado con el token. */
export type BoardLiveActor =
  | { kind: 'member'; viewer: BoardViewer; boardId: string; workspaceId: string; user: BoardLiveUser; level: BoardAccessLevel }
  | { kind: 'guest'; token: string; boardId: string; workspaceId: string; user: BoardLiveUser; level: 'edit' };

const CLIENT_SOCKET_RE = /^[A-Za-z0-9_-]{8,40}$/;
const BOUND_SOCKET_RE = /^[a-f0-9]{10}-[A-Za-z0-9_-]{8,40}$/;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Clave estable de quien manda: la persona, o el token del invitado (hasheado). */
export function actorKey(a: Pick<BoardLiveActor, 'kind'> & { viewer?: BoardViewer; token?: string }): string {
  return a.kind === 'member' ? `u:${a.viewer!.personId}` : `g:${hash(a.token ?? '').slice(0, 24)}`;
}

/** Id de pestaña del navegador (sin prefijo). */
export function validClientSocket(raw: unknown): raw is string {
  return typeof raw === 'string' && CLIENT_SOCKET_RE.test(raw);
}

/** Id de pestaña atado a quien la usa: hash(actor) + lo que eligió el navegador. */
export function bindSocket(key: string, clientId: string): string {
  return `${hash(key).slice(0, 10)}-${clientId}`;
}

export function isBoundSocket(raw: unknown): raw is string {
  return typeof raw === 'string' && BOUND_SOCKET_RE.test(raw);
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
  return { id: Number(r.id), boardId: r.board_id, workspaceId: r.workspace_id, socketId: r.socket_id, kind: r.kind, user, payload, at: r.created_at };
}

const strip = ({ boardId: _b, workspaceId: _w, ...rest }: RawEvent): BoardLiveEvent => {
  void _b;
  void _w;
  return rest;
};

// ---------- Feed de eventos (board_events) ----------

let feed: SharedFeed<RawEvent> | null = null;

/** Lo nuevo del feed, paginado por filas y por bytes (ningún lote trae megas). */
export async function fetchEventsSince(cursor: number, maxBytes = FEED_MAX_BYTES): Promise<RawEvent[]> {
  const rows = (await getDb()
    .prepare('SELECT id, board_id, workspace_id, socket_id, kind, payload, created_at FROM board_events WHERE id > ? ORDER BY id LIMIT 100')
    .all(cursor)) as Row[];
  const out: RawEvent[] = [];
  let bytes = 0;
  for (const r of rows) {
    bytes += (r.payload?.length ?? 0) + 200;
    if (out.length && bytes > maxBytes) break;
    out.push(toRaw(r));
  }
  return out;
}

export function boardFeed(): SharedFeed<RawEvent> {
  feed ??= sharedFeed<RawEvent>('boards', {
    intervalMs: BOARD_FEED_INTERVAL_MS,
    start: async () => {
      const row = (await getDb().prepare('SELECT MAX(id) AS id FROM board_events').get()) as { id: number | null } | undefined;
      return Number(row?.id ?? 0);
    },
    fetchSince: (cursor) => fetchEventsSince(cursor),
  });
  return feed;
}

/**
 * Cursor de arranque: el último id de la pizarra. Si la pizarra todavía no
 * tiene eventos, el último id de la tabla (por la clave primaria, sin
 * recorrerla), así lo que llegue después tiene un id mayor y no se pierde.
 */
async function latestBoardEventId(boardId: string): Promise<number> {
  const row = (await getDb().prepare('SELECT MAX(id) AS id FROM board_events WHERE board_id = ?').get(boardId)) as { id: number | null } | undefined;
  if (row?.id) return Number(row.id);
  const any = (await getDb().prepare('SELECT MAX(id) AS id FROM board_events').get()) as { id: number | null } | undefined;
  return Number(any?.id ?? 0);
}

let inserts = 0;

/** Agrega un evento al feed. `user` lo pone el servidor. */
export async function publishBoardEvent(e: {
  boardId: string;
  workspaceId: string;
  socketId: string;
  kind: Exclude<BoardLiveKind, 'presence' | 'leave'>;
  user?: BoardLiveUser | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const json = JSON.stringify({ ...(e.payload ?? {}), user: e.user ?? null });
  await getDb()
    .prepare('INSERT INTO board_events (board_id, workspace_id, socket_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(e.boardId, e.workspaceId, e.socketId, e.kind, json, new Date().toISOString());
  inserts += 1;
  if (inserts % 500 === 0) void pruneBoardEvents().catch(() => undefined);
}

/** Borra los eventos y filas de presencia viejos (son efímeros). */
export async function pruneBoardEvents(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - BOARD_EVENTS_TTL_MS).toISOString();
  const res = await getDb().prepare('DELETE FROM board_events WHERE created_at < ?').run(cutoff);
  await getDb()
    .prepare('DELETE FROM board_presence WHERE updated_at < ?')
    .run(new Date(now - 2 * PRESENCE_TTL_MS).toISOString())
    .catch(() => undefined);
  return res.changes;
}

/** Aviso a las conexiones de la pizarra para que revaliden su acceso ya (cambió el modo, un invitado, el link). */
export async function publishBoardAccessChanged(workspaceId: string, boardId: string): Promise<void> {
  await publishBoardEvent({ boardId, workspaceId, socketId: 'server', kind: 'access' }).catch(() => undefined);
}

// ---------- Presencia efímera ----------

/** Puntero, selección y vista de quien manda (todo opcional y acotado). */
export interface LivePresence {
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  button?: 'up' | 'down';
  selected?: string[];
  /** Parte del lienzo que ve: [x1, y1, x2, y2] en coordenadas de la escena. */
  bounds?: [number, number, number, number];
  idle?: boolean;
}

interface PresenceEntry {
  socketId: string;
  user: BoardLiveUser;
  presence: LivePresence;
  at: number;
}

type PresenceListener = (events: BoardLiveEvent[]) => void;

interface PresenceState {
  instance: string;
  local: Map<string, Map<string, PresenceEntry>>;
  /** Lo último leído de otras instancias: board → instance → { seq, entries }. */
  remote: Map<string, Map<string, { seq: number; entries: PresenceEntry[] }>>;
  listeners: Map<string, Set<PresenceListener>>;
  dirty: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Filas de presencia escritas por esta instancia (lo miden los tests de carga). */
  writes: number;
}

const PRESENCE_KEY = Symbol.for('zerosoft.board.presence');

function presenceState(): PresenceState {
  const g = globalThis as unknown as Record<symbol, PresenceState>;
  g[PRESENCE_KEY] ??= {
    instance: hash(`${process.pid}:${Date.now()}:${Math.random()}`).slice(0, 16),
    local: new Map(),
    remote: new Map(),
    listeners: new Map(),
    dirty: new Set(),
    timer: null,
    writes: 0,
  };
  return g[PRESENCE_KEY];
}

const presenceEvent = (e: PresenceEntry): BoardLiveEvent => ({
  kind: 'presence',
  socketId: e.socketId,
  user: e.user,
  payload: { presence: e.presence },
  at: new Date(e.at).toISOString(),
});
const leaveEvent = (socketId: string): BoardLiveEvent => ({ kind: 'leave', socketId, user: null, payload: {}, at: new Date().toISOString() });

function emit(boardId: string, events: BoardLiveEvent[]) {
  if (!events.length) return;
  for (const fn of presenceState().listeners.get(boardId) ?? []) {
    try {
      fn(events);
    } catch {
      /* una conexión rota no corta a las demás */
    }
  }
}

function ensureLoop() {
  const s = presenceState();
  if (s.timer) return;
  const tick = async () => {
    s.timer = null;
    try {
      await flushPresence();
      await readRemotePresence();
    } catch {
      /* reintenta en la próxima vuelta */
    }
    if (s.dirty.size || s.listeners.size || [...s.local.values()].some((m) => m.size)) s.timer = setTimeout(() => void tick(), PRESENCE_FLUSH_MS);
  };
  s.timer = setTimeout(() => void tick(), PRESENCE_FLUSH_MS);
}

/** Una fila por pizarra y por instancia, a lo sumo cada PRESENCE_FLUSH_MS (upsert: la tabla no crece). */
export async function flushPresence(now = Date.now()): Promise<void> {
  const s = presenceState();
  // Lo que venció se va (y se avisa a las conexiones locales).
  for (const [boardId, map] of s.local) {
    const gone: string[] = [];
    for (const [sid, e] of map) if (now - e.at > PRESENCE_TTL_MS) gone.push(sid);
    for (const sid of gone) map.delete(sid);
    if (gone.length) {
      s.dirty.add(boardId);
      emit(boardId, gone.map(leaveEvent));
    }
  }
  const boards = [...s.dirty];
  s.dirty.clear();
  for (const boardId of boards) {
    const entries = [...(s.local.get(boardId)?.values() ?? [])];
    if (!entries.length) {
      s.local.delete(boardId);
      await getDb().prepare('DELETE FROM board_presence WHERE board_id = ? AND instance_id = ?').run(boardId, s.instance);
      s.writes++;
      continue;
    }
    await getDb()
      .prepare(
        `INSERT INTO board_presence (board_id, instance_id, payload, seq, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(board_id, instance_id) DO UPDATE SET payload = excluded.payload, seq = board_presence.seq + 1, updated_at = excluded.updated_at`,
      )
      .run(boardId, s.instance, JSON.stringify(entries), new Date(now).toISOString());
    s.writes++;
  }
}

/** Presencia de las otras instancias para las pizarras abiertas acá (avisa altas, cambios y bajas). */
export async function readRemotePresence(now = Date.now()): Promise<void> {
  const s = presenceState();
  const boards = [...s.listeners.keys()];
  if (!boards.length) return;
  const rows = (await getDb()
    .prepare(`SELECT board_id, instance_id, payload, seq, updated_at FROM board_presence WHERE instance_id != ? AND board_id IN (${boards.map(() => '?').join(',')})`)
    .all(s.instance, ...boards)) as Array<{ board_id: string; instance_id: string; payload: string; seq: number; updated_at: string }>;
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    if (now - Date.parse(r.updated_at) > PRESENCE_TTL_MS) continue;
    (seen.get(r.board_id) ?? seen.set(r.board_id, new Set()).get(r.board_id)!).add(r.instance_id);
    const byInstance = s.remote.get(r.board_id) ?? s.remote.set(r.board_id, new Map()).get(r.board_id)!;
    const prev = byInstance.get(r.instance_id);
    if (prev && prev.seq === Number(r.seq)) continue;
    let entries: PresenceEntry[] = [];
    try {
      entries = (JSON.parse(r.payload) as PresenceEntry[]).filter((e) => isBoundSocket(e.socketId));
    } catch {
      entries = [];
    }
    byInstance.set(r.instance_id, { seq: Number(r.seq), entries });
    const now2 = new Set(entries.map((e) => e.socketId));
    emit(r.board_id, [...entries.map(presenceEvent), ...(prev?.entries ?? []).filter((e) => !now2.has(e.socketId)).map((e) => leaveEvent(e.socketId))]);
  }
  // Instancias que dejaron de escribir: sus pestañas se van.
  for (const [boardId, byInstance] of s.remote) {
    for (const [inst, snap] of byInstance) {
      if (seen.get(boardId)?.has(inst)) continue;
      byInstance.delete(inst);
      emit(boardId, snap.entries.map((e) => leaveEvent(e.socketId)));
    }
  }
}

/** Lo que se sabe ahora de quién está en la pizarra (para una conexión nueva o el polling). */
export function presenceSnapshot(boardId: string, now = Date.now()): BoardLiveEvent[] {
  const s = presenceState();
  const local = [...(s.local.get(boardId)?.values() ?? [])];
  const remote = [...(s.remote.get(boardId)?.values() ?? [])].flatMap((x) => x.entries);
  return [...local, ...remote].filter((e) => now - e.at <= PRESENCE_TTL_MS).map(presenceEvent);
}

/** Polling sin conexión SSE: lee la presencia de otras instancias de esta pizarra. */
export async function pollPresence(boardId: string, now = Date.now()): Promise<BoardLiveEvent[]> {
  const s = presenceState();
  const rows = (await getDb()
    .prepare('SELECT payload, updated_at FROM board_presence WHERE board_id = ? AND instance_id != ?')
    .all(boardId, s.instance)) as Array<{ payload: string; updated_at: string }>;
  const remote: PresenceEntry[] = [];
  for (const r of rows) {
    if (now - Date.parse(r.updated_at) > PRESENCE_TTL_MS) continue;
    try {
      remote.push(...(JSON.parse(r.payload) as PresenceEntry[]).filter((e) => isBoundSocket(e.socketId)));
    } catch {
      /* fila rota */
    }
  }
  const local = [...(s.local.get(boardId)?.values() ?? [])];
  return [...local, ...remote].filter((e) => now - e.at <= PRESENCE_TTL_MS).map(presenceEvent);
}

export function subscribePresence(boardId: string, fn: PresenceListener): () => void {
  const s = presenceState();
  const set = s.listeners.get(boardId) ?? s.listeners.set(boardId, new Set()).get(boardId)!;
  set.add(fn);
  ensureLoop();
  return () => {
    set.delete(fn);
    if (!set.size) {
      s.listeners.delete(boardId);
      s.remote.delete(boardId);
    }
  };
}

function setPresence(boardId: string, entry: PresenceEntry) {
  const s = presenceState();
  const map = s.local.get(boardId) ?? s.local.set(boardId, new Map()).get(boardId)!;
  map.set(entry.socketId, entry);
  s.dirty.add(boardId);
  emit(boardId, [presenceEvent(entry)]);
  ensureLoop();
}

function dropPresence(boardId: string, socketId: string) {
  const s = presenceState();
  if (s.local.get(boardId)?.delete(socketId)) {
    s.dirty.add(boardId);
    ensureLoop();
  }
  emit(boardId, [leaveEvent(socketId)]);
}

/** Cuántas filas de presencia escribió esta instancia (medición). */
export function presenceWrites(): number {
  return presenceState().writes;
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

/**
 * ¿Sigue teniendo acceso? Desde la base, no desde la sesión con la que se
 * conectó: membresía del workspace, rol (admin o no) y acceso a la pizarra.
 */
export async function stillAllowed(actor: BoardLiveActor): Promise<boolean> {
  if (actor.kind === 'guest') {
    const again = await guestLiveActor(actor.token);
    return again?.boardId === actor.boardId;
  }
  const viewer = await freshBoardViewer(actor.workspaceId, actor.viewer.personId);
  if (!viewer) return false;
  const level = await getBoardAccess(viewer, actor.boardId);
  if (!level) return false;
  actor.viewer = viewer;
  actor.level = level;
  return true;
}

// ---------- Envío (POST) ----------

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
  // En vivo no viaja HTML generado por IA (solo lo ve quien lo generó, en su pestaña).
  return sanitizeElements(out, { dropGenerated: true });
}

export type LiveSendResult = { ok: true; socketId: string } | { ok: false; status: number; code: string };

// ---------- Límites (en memoria, LRU) ----------

interface Bucket {
  tokens: number;
  at: number;
}

const BUCKETS_KEY = Symbol.for('zerosoft.board.buckets');
const MAX_BUCKETS = 20_000;

function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as Record<symbol, Map<string, Bucket>>;
  g[BUCKETS_KEY] ??= new Map();
  return g[BUCKETS_KEY];
}

/**
 * Cubeta de fichas por clave (LRU: la usada pasa al final; si hay demasiadas,
 * se descartan las más viejas, nunca todas de golpe). `cost` permite medir bytes.
 */
export function takeTokens(key: string, cost: number, perSecond: number, burst: number, now = Date.now()): boolean {
  const map = buckets();
  const b = map.get(key) ?? { tokens: burst, at: now };
  map.delete(key);
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
  b.at = now;
  const ok = b.tokens >= cost;
  if (ok) b.tokens -= cost;
  map.set(key, b);
  while (map.size > MAX_BUCKETS) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return ok;
}

/** Pedidos por actor (persona o token) y por IP: ~8 por segundo es lo normal de una pestaña. */
export function liveAllowed(actor: string, ip: string, now = Date.now()): boolean {
  return takeTokens(`a:${actor}`, 1, 20, 40, now) && takeTokens(`ip:${ip}`, 1, 60, 120, now);
}

/** Lo que manda una pestaña: presencia y/o elementos, traer a todos, o salir. */
export async function handleLiveSend(actor: BoardLiveActor, body: unknown, now = Date.now()): Promise<LiveSendResult> {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, code: 'invalid_input' };
  const b = body as Record<string, unknown>;
  if (!validClientSocket(b.socketId)) return { ok: false, status: 400, code: 'invalid_input' };
  const key = actorKey(actor);
  const socketId = bindSocket(key, b.socketId);
  if (b.leave === true) {
    dropPresence(actor.boardId, socketId);
    return { ok: true, socketId };
  }
  const presence = cleanPresence(b.presence);
  if (b.summon === true) {
    // Traer a todos a mi vista: solo quien edita (un lector no maneja el taller).
    if (!accessAtLeast(actor.level, 'edit')) return { ok: false, status: 403, code: 'forbidden' };
    if (!presence?.bounds) return { ok: false, status: 400, code: 'invalid_input' };
    await publishBoardEvent({ boardId: actor.boardId, workspaceId: actor.workspaceId, socketId, kind: 'summon', user: actor.user, payload: { presence: { bounds: presence.bounds }, presenting: b.presenting === true } });
    setPresence(actor.boardId, { socketId, user: actor.user, presence, at: now });
    return { ok: true, socketId };
  }
  let elements: Array<Record<string, unknown>> | null = null;
  if (b.elements !== undefined) {
    if (!accessAtLeast(actor.level, 'edit')) return { ok: false, status: 403, code: 'forbidden' };
    elements = cleanElements(b.elements);
    if (!elements) return { ok: false, status: 400, code: 'invalid_input' };
  }
  if (!presence && !elements) return { ok: false, status: 400, code: 'invalid_input' };
  if (elements) {
    const json = JSON.stringify({ elements });
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > BOARD_LIVE_MAX_BYTES) return { ok: false, status: 413, code: 'too_large' };
    // Tope de bytes por minuto por actor (aunque cambie de pestaña o de IP).
    if (!takeTokens(`bytes:${key}`, bytes, BOARD_LIVE_BYTES_PER_MIN / 60, BOARD_LIVE_BYTES_PER_MIN / 2, now)) {
      return { ok: false, status: 429, code: 'rate_limited' };
    }
    await publishBoardEvent({ boardId: actor.boardId, workspaceId: actor.workspaceId, socketId, kind: 'update', user: actor.user, payload: { elements } });
  }
  if (presence) setPresence(actor.boardId, { socketId, user: actor.user, presence, at: now });
  return { ok: true, socketId };
}

// ---------- Lectura (SSE y polling) ----------

/** Eventos de la pizarra después de `cursor` (atraso o polling); el cursor es de la pizarra. */
export async function boardEventsSince(boardId: string, cursor: number, limit = BACKLOG_LIMIT): Promise<{ events: BoardLiveEvent[]; cursor: number; gap?: boolean }> {
  if (!cursor) return { events: [], cursor: await latestBoardEventId(boardId) };
  const rows = (await getDb()
    .prepare('SELECT id, board_id, workspace_id, socket_id, kind, payload, created_at FROM board_events WHERE board_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(boardId, cursor, limit)) as Row[];
  if (rows.length >= limit) return { events: [], cursor: await latestBoardEventId(boardId), gap: true };
  const events = rows.map(toRaw).map(strip);
  return { events, cursor: Math.max(cursor, ...events.map((e) => e.id ?? 0)) };
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
    // El atraso trae además quién está ahora (presencia en memoria y de otras instancias).
    backlog: async (c) => {
      const back = await boardEventsSince(actor.boardId, c);
      return { ...back, events: [...presenceSnapshot(actor.boardId), ...back.events] };
    },
    subscribe: (push, close) => {
      revoke = close;
      const offFeed = boardFeed().subscribe(async (events) => {
        const visible = await filter(events);
        push({ events: visible, cursor: events[events.length - 1]?.id ?? 0 });
      });
      const offPresence = subscribePresence(actor.boardId, (events) => push({ events, cursor: 0 }));
      return () => {
        offFeed();
        offPresence();
      };
    },
    check: () => stillAllowed(actor),
    checkMs: 10_000,
    heartbeatMs: 15_000,
    // Como Talk: la ruta declara maxDuration 300 y el navegador reconecta solo.
    maxMs: 240_000,
    signal,
  });
}
