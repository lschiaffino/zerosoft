/**
 * Talk: huddles (llamadas de audio, con pantalla compartida) en canales y DMs.
 *
 * El audio y la pantalla viajan de navegador a navegador por WebRTC (malla:
 * cada persona con cada una, hasta HUDDLE_MAX). El servidor solo guarda quién
 * está (talk_huddle_peers, una fila por pestaña) y pasa la señalización (SDP)
 * por el feed de Talk (lib/realtime.ts) como eventos 'signal' dirigidos a una
 * persona: el filtro por conexión de lib/talk-realtime.ts ya garantiza que
 * solo los recibe ella y solo si sigue leyendo el canal.
 *
 * ICE: STUN/TURN por env (iceServers). Detrás de NAT estrictos o firewalls
 * corporativos hace falta un TURN propio (coturn con use-auth-secret):
 *   TALK_TURN_URLS="turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349"
 *   TALK_TURN_SECRET=<static-auth-secret>   (credenciales de 1 hora por persona)
 * o TALK_TURN_USERNAME / TALK_TURN_CREDENTIAL fijos. TALK_STUN_URLS cambia el
 * STUN (por defecto stun:stun.l.google.com:19302; "none" lo apaga) y
 * TALK_ICE_SERVERS (JSON de RTCIceServer[]) reemplaza todo.
 *
 * Una pestaña que deja de latir (HUDDLE_STALE_MS) sale sola; el huddle
 * termina cuando no queda nadie. Server-only.
 */
import { createHmac } from 'crypto';
import { getDb } from './db';
import {
  TalkError,
  afterPost,
  emitTalkEvent,
  nowIso,
  postMessage,
  readableChannel,
  writableChannel,
  type TalkActor,
} from './talk';
import en from '@/messages/en/talk.json';
import es from '@/messages/es/talk.json';
import pt from '@/messages/pt/talk.json';

export const HUDDLE_MAX = 15;
export const HUDDLE_STALE_MS = 45_000;
export const SIGNAL_MAX_BYTES = 48_000;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Servidores ICE para esta persona (TURN con credencial temporal si hay secreto). */
export function iceServers(personId: string, now = Date.now()): IceServer[] {
  const raw = process.env.TALK_ICE_SERVERS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((s): s is IceServer => !!s && typeof s === 'object' && 'urls' in s);
    } catch {
      /* JSON inválido: se sigue con el resto */
    }
  }
  const out: IceServer[] = [];
  const stun = process.env.TALK_STUN_URLS?.trim();
  if (stun !== 'none') out.push({ urls: (stun || 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean) });
  const turn = process.env.TALK_TURN_URLS?.trim();
  if (turn) {
    const urls = turn.split(',').map((s) => s.trim()).filter(Boolean);
    const secret = process.env.TALK_TURN_SECRET?.trim();
    if (secret) {
      // REST API de coturn: usuario "<vencimiento>:<persona>", clave HMAC-SHA1 del usuario.
      const username = `${Math.floor(now / 1000) + 3600}:${personId}`;
      out.push({ urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') });
    } else if (process.env.TALK_TURN_USERNAME && process.env.TALK_TURN_CREDENTIAL) {
      out.push({ urls, username: process.env.TALK_TURN_USERNAME, credential: process.env.TALK_TURN_CREDENTIAL });
    }
  }
  return out;
}

export function hasTurn(): boolean {
  return !!process.env.TALK_TURN_URLS?.trim() || /turns?:/.test(process.env.TALK_ICE_SERVERS ?? '');
}

export interface HuddlePeerDto {
  peerId: string;
  userId: string;
  muted: boolean;
  sharing: boolean;
  video: boolean;
  joinedAt: string;
}

export interface HuddleDto {
  id: string;
  channelId: string;
  startedBy: string;
  startedAt: string;
  messageId: string | null;
  peers: HuddlePeerDto[];
}

type HuddleRow = { id: string; workspace_id: string; channel_id: string; started_by: string; message_id: string | null; started_at: string; ended_at: string | null };

const validPeer = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

/** Saca pestañas que dejaron de latir y cierra los huddles vacíos. Devuelve cuántos terminaron. */
export async function sweepHuddles(now = Date.now(), channelId?: string): Promise<number> {
  const db = getDb();
  const cutoff = new Date(now - HUDDLE_STALE_MS).toISOString();
  const stale = (await db
    .prepare(
      `SELECT p.huddle_id, p.peer_id, p.user_id, h.workspace_id, h.channel_id FROM talk_huddle_peers p JOIN talk_huddles h ON h.id = p.huddle_id
       WHERE p.seen_at < ?${channelId ? ' AND h.channel_id = ?' : ''} LIMIT 500`,
    )
    .all(...(channelId ? [cutoff, channelId] : [cutoff]))) as Array<{ huddle_id: string; peer_id: string; user_id: string; workspace_id: string; channel_id: string }>;
  for (const s of stale) {
    const del = await db.prepare('DELETE FROM talk_huddle_peers WHERE huddle_id = ? AND peer_id = ? AND seen_at < ?').run(s.huddle_id, s.peer_id, cutoff);
    if (del.changes) await emitTalkEvent(s.workspace_id, 'huddle', { channelId: s.channel_id, payload: { huddleId: s.huddle_id, change: 'left', peerId: s.peer_id, userId: s.user_id } });
  }
  return endEmptyHuddles(channelId);
}

async function endEmptyHuddles(channelId?: string): Promise<number> {
  const db = getDb();
  const empty = (await db
    .prepare(
      `SELECT * FROM talk_huddles h WHERE h.ended_at IS NULL${channelId ? ' AND h.channel_id = ?' : ''}
         AND NOT EXISTS (SELECT 1 FROM talk_huddle_peers p WHERE p.huddle_id = h.id) LIMIT 200`,
    )
    .all(...(channelId ? [channelId] : []))) as HuddleRow[];
  let ended = 0;
  for (const h of empty) {
    // Claim: dos corridas no cierran (ni avisan) dos veces.
    const res = await db
      .prepare('UPDATE talk_huddles SET ended_at = ? WHERE id = ? AND ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM talk_huddle_peers p WHERE p.huddle_id = ?)')
      .run(nowIso(), h.id, h.id);
    if (!res.changes) continue;
    ended++;
    await emitTalkEvent(h.workspace_id, 'huddle', { channelId: h.channel_id, payload: { huddleId: h.id, change: 'ended' } });
  }
  return ended;
}

async function liveHuddle(channelId: string): Promise<HuddleRow | null> {
  const row = (await getDb().prepare('SELECT * FROM talk_huddles WHERE channel_id = ? AND ended_at IS NULL').get(channelId)) as HuddleRow | undefined;
  return row ?? null;
}

async function peersOf(huddleId: string): Promise<HuddlePeerDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM talk_huddle_peers WHERE huddle_id = ? ORDER BY joined_at').all(huddleId)) as Array<{
    peer_id: string;
    user_id: string;
    muted: number;
    sharing: number;
    video: number;
    joined_at: string;
  }>;
  return rows.map((r) => ({ peerId: r.peer_id, userId: r.user_id, muted: !!r.muted, sharing: !!r.sharing, video: !!r.video, joinedAt: r.joined_at }));
}

function toDto(h: HuddleRow, peers: HuddlePeerDto[]): HuddleDto {
  return { id: h.id, channelId: h.channel_id, startedBy: h.started_by, startedAt: h.started_at, messageId: h.message_id, peers };
}

/** El huddle en vivo de un canal que puedo leer (o null). */
export async function getHuddle(actor: TalkActor, channelId: string): Promise<HuddleDto | null> {
  const access = await readableChannel(actor, channelId);
  if (!access) throw new TalkError('not_found', 404);
  await sweepHuddles(Date.now(), channelId);
  const h = await liveHuddle(channelId);
  return h ? toDto(h, await peersOf(h.id)) : null;
}

/** Huddles en vivo en mis canales (para el sidebar). */
export async function listLiveHuddles(actor: TalkActor): Promise<Array<{ channelId: string; huddleId: string; userIds: string[] }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT h.id, h.channel_id, (SELECT group_concat(DISTINCT p.user_id) FROM talk_huddle_peers p WHERE p.huddle_id = h.id AND p.seen_at >= ?) AS users
       FROM talk_huddles h JOIN talk_members m ON m.channel_id = h.channel_id AND m.user_id = ?
       WHERE h.workspace_id = ? AND h.ended_at IS NULL`,
    )
    .all(new Date(Date.now() - HUDDLE_STALE_MS).toISOString(), actor.personId, actor.workspaceId)) as Array<{ id: string; channel_id: string; users: string | null }>;
  return rows.filter((r) => r.users).map((r) => ({ channelId: r.channel_id, huddleId: r.id, userIds: r.users!.split(',') }));
}

function huddleLocale(raw: string | null | undefined) {
  return raw === 'es' ? es.huddle : raw === 'pt' ? pt.huddle : en.huddle;
}

/** Empieza el huddle del canal o se suma al que está en vivo. */
export async function joinHuddle(actor: TalkActor, channelId: string, peerId: string): Promise<{ huddle: HuddleDto; iceServers: IceServer[]; turn: boolean }> {
  if (!validPeer(peerId)) throw new TalkError('invalid_input');
  const { channel } = await writableChannel(actor, channelId);
  const db = getDb();
  await sweepHuddles(Date.now(), channelId);
  let h = await liveHuddle(channelId);
  let started = false;
  if (!h) {
    const id = crypto.randomUUID();
    // El índice único (un huddle en vivo por canal) resuelve dos personas empezando a la vez.
    const res = await db
      .prepare('INSERT OR IGNORE INTO talk_huddles (id, workspace_id, channel_id, started_by, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, actor.workspaceId, channelId, actor.personId, nowIso());
    started = res.changes > 0;
    h = await liveHuddle(channelId);
    if (!h) throw new TalkError('server_error', 500);
  }
  const peers = await peersOf(h.id);
  if (!peers.some((p) => p.peerId === peerId) && new Set([...peers.map((p) => p.userId), actor.personId]).size > HUDDLE_MAX) throw new TalkError('huddle_full', 409);
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO talk_huddle_peers (huddle_id, peer_id, user_id, joined_at, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(huddle_id, peer_id) DO UPDATE SET seen_at = excluded.seen_at`,
    )
    .run(h.id, peerId, actor.personId, now, now);
  if (started) {
    // El mensaje del huddle en el canal: su hilo es el lugar para notas y links (como en Slack).
    const loc = (await db.prepare('SELECT locale FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId)) as { locale: string | null } | undefined;
    try {
      const posted = await postMessage(actor, { channelId: channel.id, body: `:headphones: ${huddleLocale(loc?.locale).startedMessage}` });
      await db.prepare('UPDATE talk_huddles SET message_id = ? WHERE id = ?').run(posted.row.id, h.id);
      h = { ...h, message_id: posted.row.id };
      void afterPost(actor, posted).catch(() => undefined);
    } catch {
      /* sin mensaje igual hay huddle */
    }
  }
  await emitTalkEvent(actor.workspaceId, 'huddle', { channelId, actorId: actor.personId, payload: { huddleId: h.id, change: 'joined', peerId, userId: actor.personId } });
  return { huddle: toDto(h, await peersOf(h.id)), iceServers: iceServers(actor.personId), turn: hasTurn() };
}

async function ownPeer(actor: TalkActor, huddleId: string, peerId: string): Promise<HuddleRow> {
  if (!validPeer(peerId)) throw new TalkError('invalid_input');
  const h = (await getDb().prepare('SELECT * FROM talk_huddles WHERE id = ? AND workspace_id = ? AND ended_at IS NULL').get(huddleId, actor.workspaceId)) as HuddleRow | undefined;
  if (!h) throw new TalkError('huddle_ended', 404);
  const mine = await getDb().prepare('SELECT 1 AS x FROM talk_huddle_peers WHERE huddle_id = ? AND peer_id = ? AND user_id = ?').get(huddleId, peerId, actor.personId);
  if (!mine) throw new TalkError('huddle_ended', 404);
  // Sigue pudiendo estar ahí (si salió del canal, la conexión se corta).
  if (!(await readableChannel(actor, h.channel_id))?.member) {
    await getDb().prepare('DELETE FROM talk_huddle_peers WHERE huddle_id = ? AND user_id = ?').run(huddleId, actor.personId);
    throw new TalkError('not_found', 404);
  }
  return h;
}

/** Latido de la pestaña en el huddle, con su estado (micrófono, pantalla). */
export async function beatHuddle(actor: TalkActor, huddleId: string, peerId: string, state: { muted?: boolean; sharing?: boolean; video?: boolean } = {}): Promise<HuddleDto> {
  const h = await ownPeer(actor, huddleId, peerId);
  const db = getDb();
  const prev = (await db.prepare('SELECT muted, sharing, video FROM talk_huddle_peers WHERE huddle_id = ? AND peer_id = ?').get(huddleId, peerId)) as { muted: number; sharing: number; video: number };
  const next = { muted: state.muted ?? !!prev.muted, sharing: state.sharing ?? !!prev.sharing, video: state.video ?? !!prev.video };
  await db
    .prepare('UPDATE talk_huddle_peers SET seen_at = ?, muted = ?, sharing = ?, video = ? WHERE huddle_id = ? AND peer_id = ?')
    .run(nowIso(), next.muted ? 1 : 0, next.sharing ? 1 : 0, next.video ? 1 : 0, huddleId, peerId);
  if (next.muted !== !!prev.muted || next.sharing !== !!prev.sharing || next.video !== !!prev.video) {
    await emitTalkEvent(actor.workspaceId, 'huddle', { channelId: h.channel_id, actorId: actor.personId, payload: { huddleId, change: 'state', peerId, userId: actor.personId, ...next } });
  }
  await sweepHuddles(Date.now(), h.channel_id);
  return toDto(h, await peersOf(huddleId));
}

export async function leaveHuddle(actor: TalkActor, huddleId: string, peerId: string): Promise<void> {
  if (!validPeer(peerId)) throw new TalkError('invalid_input');
  const db = getDb();
  const h = (await db.prepare('SELECT * FROM talk_huddles WHERE id = ? AND workspace_id = ?').get(huddleId, actor.workspaceId)) as HuddleRow | undefined;
  if (!h) return;
  const res = await db.prepare('DELETE FROM talk_huddle_peers WHERE huddle_id = ? AND peer_id = ? AND user_id = ?').run(huddleId, peerId, actor.personId);
  if (res.changes) await emitTalkEvent(actor.workspaceId, 'huddle', { channelId: h.channel_id, actorId: actor.personId, payload: { huddleId, change: 'left', peerId, userId: actor.personId } });
  await endEmptyHuddles(h.channel_id);
}

/**
 * Señalización WebRTC de una pestaña a otra del mismo huddle. El evento va
 * dirigido a la persona destino (user_id) y atado al canal: el feed no se lo
 * pasa a nadie más.
 */
export async function signalHuddle(actor: TalkActor, huddleId: string, from: string, to: string, data: unknown): Promise<void> {
  const h = await ownPeer(actor, huddleId, from);
  if (!validPeer(to)) throw new TalkError('invalid_input');
  const target = (await getDb().prepare('SELECT user_id FROM talk_huddle_peers WHERE huddle_id = ? AND peer_id = ?').get(huddleId, to)) as { user_id: string } | undefined;
  if (!target) throw new TalkError('peer_gone', 404);
  const encoded = JSON.stringify(data ?? null);
  if (encoded.length > SIGNAL_MAX_BYTES) throw new TalkError('invalid_input');
  await emitTalkEvent(actor.workspaceId, 'signal', { channelId: h.channel_id, userId: target.user_id, actorId: actor.personId, payload: { huddleId, from, to, data } });
}
