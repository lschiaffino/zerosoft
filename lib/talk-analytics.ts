/**
 * Talk, analítica con el kit (el formato de Lines): mensajes, respuestas en
 * hilos, quién escribe y cuándo, reacciones y huddles de los canales que la
 * persona puede leer (los públicos y aquellos donde está; un invitado, solo
 * los suyos), en un período contra el anterior.
 *
 * Nunca lee el texto de los mensajes: solo canal, autor y hora. Los mensajes
 * de bots y los borrados no cuentan.
 */
import { getDb } from './db';
import { workspacePersonKind, type TalkActor, type TalkChannelKind } from './talk';
import { heatAdd, stampMs } from './analytics-kit/stamps';
import { analyticsRange, daySeries, localDay, rangeInfo, type AnalyticsRange, type Kpi, type RangeInfo, type RangeInput } from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

export interface TalkChannelIn {
  id: string;
  kind: TalkChannelKind;
  name: string;
  members: number;
  archived: boolean;
}

export interface TalkMessageIn {
  channel_id: string;
  user_id: string;
  reply: boolean;
  at: number;
}

export interface TalkReactionIn {
  channel_id: string;
  user_id: string;
  at: number;
}

export interface TalkHuddleIn {
  channel_id: string;
  started: number;
  /** null: sigue en curso. */
  ended: number | null;
}

export interface TalkDay {
  day: string;
  messages: number;
  replies: number;
  reactions: number;
}

export interface TalkPersonStat {
  id: string;
  name: string;
  messages: number;
  replies: number;
  channels: number;
  reactions: number;
  prevMessages: number;
}

export interface TalkChannelStat {
  id: string;
  name: string;
  kind: TalkChannelKind;
  messages: number;
  posters: number;
  replies: number;
  reactions: number;
  members: number;
  lastAt: number | null;
}

export interface TalkKindStat {
  kind: TalkChannelKind;
  messages: number;
  channels: number;
}

export interface TalkAnalytics {
  range: RangeInfo;
  kpis: { messages: Kpi; replies: Kpi; people: Kpi; reactions: Kpi; huddles: Kpi; huddleMinutes: Kpi };
  perDay: TalkDay[];
  heat: number[][];
  people: TalkPersonStat[];
  channels: TalkChannelStat[];
  kinds: TalkKindStat[];
  /** Canales (públicos y privados, sin archivar) para el filtro. */
  channelList: Array<{ id: string; name: string }>;
  channelCount: number;
}

export interface TalkAnalyticsInput {
  channels: TalkChannelIn[];
  messages: TalkMessageIn[];
  reactions: TalkReactionIn[];
  huddles: TalkHuddleIn[];
  names: Map<string, string>;
}

const KIND_ORDER: TalkChannelKind[] = ['public', 'private', 'dm', 'group'];
const isNamed = (kind: TalkChannelKind) => kind === 'public' || kind === 'private';

/** Agrega lo leído (puro: lo prueban los tests). `channel` filtra a uno solo. */
export function aggregateTalk(range: AnalyticsRange, input: TalkAnalyticsInput, channel?: string, now = Date.now()): TalkAnalytics {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const prevSince = Date.parse(range.prevSince);
  const channels = new Map(input.channels.filter((c) => !channel || c.id === channel).map((c) => [c.id, c]));
  const byDay = new Map<string, Omit<TalkDay, 'day'>>();
  const bump = (ms: number, k: keyof Omit<TalkDay, 'day'>) => {
    const day = localDay(ms, range.tz);
    const v = byDay.get(day) ?? { messages: 0, replies: 0, reactions: 0 };
    v[k] += 1;
    byDay.set(day, v);
  };
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const stats = new Map<string, TalkChannelStat & { posterSet: Set<string> }>();
  const stat = (c: TalkChannelIn) => {
    let s = stats.get(c.id);
    if (!s) stats.set(c.id, (s = { id: c.id, name: c.name, kind: c.kind, messages: 0, posters: 0, replies: 0, reactions: 0, members: c.members, lastAt: null, posterSet: new Set() }));
    return s;
  };
  const kinds = new Map<TalkChannelKind, { messages: number; set: Set<string> }>();
  const people = new Map<string, TalkPersonStat & { channelSet: Set<string> }>();
  const person = (id: string) => {
    let s = people.get(id);
    if (!s) people.set(id, (s = { id, name: input.names.get(id) ?? '', messages: 0, replies: 0, channels: 0, reactions: 0, prevMessages: 0, channelSet: new Set() }));
    return s;
  };
  const messages = { cur: 0, prev: 0 };
  const replies = { cur: 0, prev: 0 };
  const who = { cur: new Set<string>(), prev: new Set<string>() };
  for (const m of input.messages) {
    const c = channels.get(m.channel_id);
    if (!c || !(m.at >= prevSince && m.at < until)) continue;
    bump(m.at, 'messages');
    if (m.reply) bump(m.at, 'replies');
    if (m.at < since) {
      messages.prev += 1;
      if (m.reply) replies.prev += 1;
      if (m.user_id) {
        who.prev.add(m.user_id);
        person(m.user_id).prevMessages += 1;
      }
      continue;
    }
    messages.cur += 1;
    if (m.reply) replies.cur += 1;
    heatAdd(heat, m.at, range.tz);
    const s = stat(c);
    s.messages += 1;
    if (m.reply) s.replies += 1;
    s.lastAt = Math.max(s.lastAt ?? 0, m.at);
    const k = kinds.get(c.kind) ?? { messages: 0, set: new Set<string>() };
    k.messages += 1;
    k.set.add(c.id);
    kinds.set(c.kind, k);
    if (m.user_id) {
      s.posterSet.add(m.user_id);
      who.cur.add(m.user_id);
      const p = person(m.user_id);
      p.messages += 1;
      if (m.reply) p.replies += 1;
      p.channelSet.add(c.id);
    }
  }
  const reactions = { cur: 0, prev: 0 };
  for (const r of input.reactions) {
    const c = channels.get(r.channel_id);
    if (!c || !(r.at >= prevSince && r.at < until)) continue;
    bump(r.at, 'reactions');
    if (r.at < since) {
      reactions.prev += 1;
      continue;
    }
    reactions.cur += 1;
    stat(c).reactions += 1;
    if (r.user_id) person(r.user_id).reactions += 1;
  }
  const huddles = { cur: 0, prev: 0 };
  const huddleMin = { cur: 0, prev: 0 };
  for (const h of input.huddles) {
    if (!channels.has(h.channel_id) || !(h.started >= prevSince && h.started < until)) continue;
    // Uno en curso cuenta hasta ahora; nunca más de un día (uno que quedó abierto).
    const end = Math.min(h.ended ?? now, h.started + 86_400_000);
    const min = Math.max(0, (end - h.started) / 60_000);
    const bucket = h.started < since ? 'prev' : 'cur';
    huddles[bucket] += 1;
    huddleMin[bucket] += min;
  }
  const { cur: perDay } = daySeries(range, byDay, () => ({ messages: 0, replies: 0, reactions: 0 }));
  const all = [...channels.values()];
  return {
    range: rangeInfo(range),
    kpis: {
      messages: { value: messages.cur, prev: messages.prev },
      replies: { value: replies.cur, prev: replies.prev },
      people: { value: who.cur.size, prev: who.prev.size },
      reactions: { value: reactions.cur, prev: reactions.prev },
      huddles: { value: huddles.cur, prev: huddles.prev },
      huddleMinutes: { value: Math.round(huddleMin.cur), prev: Math.round(huddleMin.prev) },
    },
    perDay,
    heat,
    people: [...people.values()]
      .filter((p) => p.messages + p.reactions + p.prevMessages > 0)
      .map(({ channelSet, ...p }) => ({ ...p, channels: channelSet.size }))
      .sort((a, b) => b.messages - a.messages || b.reactions - a.reactions || a.name.localeCompare(b.name)),
    // La tabla nombra solo canales (los DMs y grupos cuentan en los totales y por tipo).
    channels: [...stats.values()]
      .filter((s) => isNamed(s.kind))
      .map(({ posterSet, ...s }) => ({ ...s, posters: posterSet.size }))
      .sort((a, b) => b.messages - a.messages || b.reactions - a.reactions || a.name.localeCompare(b.name))
      .slice(0, 50),
    kinds: KIND_ORDER.filter((k) => kinds.has(k)).map((k) => ({ kind: k, messages: kinds.get(k)!.messages, channels: kinds.get(k)!.set.size })),
    channelList: input.channels.filter((c) => isNamed(c.kind) && !c.archived).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    channelCount: all.length,
  };
}

/** La analítica de Talk de los canales que lee quien mira (o de uno). */
export async function talkAnalytics(actor: TalkActor, channel: string | undefined, query: RangeInput = {}, now = new Date()): Promise<TalkAnalytics> {
  const range = analyticsRange(query, now);
  const db = getDb();
  const ws = actor.workspaceId;
  const kind = await workspacePersonKind(ws, actor.personId);
  const empty: TalkAnalyticsInput = { channels: [], messages: [], reactions: [], huddles: [], names: new Map() };
  if (!kind) return aggregateTalk(range, empty, undefined, now.getTime());
  const guest = kind === 'guest' || !!actor.guest;
  // Los que puede leer: donde es miembro, o los públicos (un invitado, solo los suyos).
  const visibleWhere = `c.workspace_id = ? AND (EXISTS (SELECT 1 FROM talk_members mm WHERE mm.channel_id = c.id AND mm.user_id = ?)${guest ? '' : " OR c.kind = 'public'"})`;
  const visArgs = [ws, actor.personId];
  const visible = `SELECT c.id FROM talk_channels c WHERE ${visibleWhere}`;
  const from = new Date(Date.parse(range.prevSince) - 86_400_000).toISOString();
  const [channels, messages, reactions, huddles] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.kind, c.name, c.archived_at, (SELECT COUNT(*) FROM talk_members mm WHERE mm.channel_id = c.id) AS members
         FROM talk_channels c WHERE ${visibleWhere} LIMIT 5000`,
      )
      .all(...visArgs) as Promise<Array<{ id: string; kind: TalkChannelKind; name: string; archived_at: string | null; members: number }>>,
    db
      .prepare(
        `SELECT m.channel_id, m.user_id, m.parent_id IS NOT NULL AS reply, m.created_at FROM talk_messages m
         WHERE m.workspace_id = ? AND m.created_at >= ? AND m.deleted_at IS NULL AND m.user_id IS NOT NULL AND m.bot_name IS NULL
           AND m.id NOT IN (SELECT h.message_id FROM talk_huddles h WHERE h.workspace_id = ? AND h.message_id IS NOT NULL)
           AND m.channel_id IN (${visible}) LIMIT 200000`,
      )
      .all(ws, from, ws, ...visArgs) as Promise<Array<{ channel_id: string; user_id: string; reply: number; created_at: string }>>,
    db
      .prepare(
        `SELECT m.channel_id, r.user_id, r.created_at FROM talk_reactions r JOIN talk_messages m ON m.id = r.message_id
         WHERE m.workspace_id = ? AND r.created_at >= ? AND m.deleted_at IS NULL AND m.channel_id IN (${visible}) LIMIT 200000`,
      )
      .all(ws, from, ...visArgs) as Promise<Array<{ channel_id: string; user_id: string; created_at: string }>>,
    db
      .prepare(`SELECT h.channel_id, h.started_at, h.ended_at FROM talk_huddles h WHERE h.workspace_id = ? AND h.started_at >= ? AND h.channel_id IN (${visible}) LIMIT 50000`)
      .all(ws, from, ...visArgs) as Promise<Array<{ channel_id: string; started_at: string; ended_at: string | null }>>,
  ]);
  const ids = [...new Set([...messages.map((m) => m.user_id), ...reactions.map((r) => r.user_id)].filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) as Array<{ id: string; name: string | null; email: string }>;
    for (const r of rows) names.set(r.id, r.name?.trim() || r.email.split('@')[0]);
  }
  const channelIn = channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, members: Number(c.members) || 0, archived: !!c.archived_at }));
  const channelId = channel && channelIn.some((c) => c.id === channel && isNamed(c.kind)) ? channel : undefined;
  return aggregateTalk(
    range,
    {
      channels: channelIn,
      messages: messages.map((m) => ({ channel_id: m.channel_id, user_id: m.user_id, reply: !!Number(m.reply), at: stampMs(m.created_at) })),
      reactions: reactions.map((r) => ({ channel_id: r.channel_id, user_id: r.user_id, at: stampMs(r.created_at) })),
      huddles: huddles.map((h) => ({ channel_id: h.channel_id, started: stampMs(h.started_at), ended: h.ended_at ? stampMs(h.ended_at) : null })),
      names,
    },
    channelId,
    now.getTime(),
  );
}

export function isTalkAnalyticsEmpty(d: TalkAnalytics): boolean {
  const k = d.kpis;
  return d.channelCount === 0 || !(k.messages.value || k.reactions.value || k.huddles.value || k.messages.prev || k.reactions.prev || k.huddles.prev);
}

const cache = shortCache<TalkAnalytics>();

/** Con la caché corta del kit. La clave lleva el workspace, quién mira (ve otros canales), el canal y el rango. */
export function cachedTalkAnalytics(actor: TalkActor, channel: string | undefined, query: RangeInput = {}): Promise<TalkAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([actor.workspaceId, actor.personId, !!actor.guest, channel ?? '', r.since, r.until, r.tz]), () => talkAnalytics(actor, channel, query, now));
}

export function clearTalkAnalyticsCache(): void {
  cache.clear();
}
