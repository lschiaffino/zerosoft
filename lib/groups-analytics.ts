/**
 * Groups: métricas del período (por defecto 30 días). Volumen por día,
 * primera respuesta (mediana, por persona y por grupo), tickets y su
 * resolución. Se calcula en el servidor con los mensajes del período.
 * Server-only.
 */
import { getDb } from './db';
import { chatDisplayName } from './groups';

export interface Analytics {
  days: number;
  totals: { inbound: number; outbound: number; activeChats: number; awaiting: number; flagged: number };
  firstResponse: { medianMin: number | null; samples: number };
  tickets: { created: number; open: number; resolved: number; breached: number; medianResolutionMin: number | null };
  perDay: Array<{ day: string; inbound: number; outbound: number }>;
  perAgent: Array<{ id: string; name: string; replies: number; medianFirstResponseMin: number | null; ticketsResolved: number }>;
  perChat: Array<{ id: string; name: string; kind: 'dm' | 'group'; inbound: number; outbound: number; medianFirstResponseMin: number | null }>;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

interface Msg {
  chat_id: string;
  direction: 'in' | 'out';
  author_id: string | null;
  author_kind: string;
  created_at: string;
}

/**
 * Primera respuesta: por cada tanda de mensajes del cliente, minutos hasta el
 * primer mensaje nuestro después de la tanda. Devuelve quién respondió.
 */
export function firstResponses(messages: Msg[]): Array<{ chatId: string; minutes: number; by: string | null }> {
  const out: Array<{ chatId: string; minutes: number; by: string | null }> = [];
  const waiting = new Map<string, number>();
  for (const m of messages) {
    const t = Date.parse(m.created_at);
    if (m.direction === 'in') {
      if (!waiting.has(m.chat_id)) waiting.set(m.chat_id, t);
    } else if (waiting.has(m.chat_id)) {
      if (m.author_kind === 'broadcast') continue;
      out.push({ chatId: m.chat_id, minutes: Math.max(0, Math.round((t - (waiting.get(m.chat_id) as number)) / 60_000)), by: m.author_id });
      waiting.delete(m.chat_id);
    }
  }
  return out;
}

export async function groupsAnalytics(ws: string, days = 30, people: Array<{ id: string; name: string; email: string }> = []): Promise<Analytics> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const msgs = (await db
    .prepare(
      `SELECT chat_id, direction, author_id, author_kind, created_at FROM groups_messages
       WHERE user_id = ? AND direction IN ('in', 'out') AND created_at >= ? ORDER BY created_at ASC LIMIT 100000`,
    )
    .all(ws, since)) as Msg[];
  const chats = (await db
    .prepare('SELECT id, name, phone, provider_chat_id, kind, awaiting_since, flagged_at FROM groups_chats WHERE user_id = ?')
    .all(ws)) as Array<{ id: string; name: string; phone: string; provider_chat_id: string; kind: 'dm' | 'group'; awaiting_since: string | null; flagged_at: string | null }>;
  const tickets = (await db
    .prepare('SELECT status, assignee_id, created_at, resolved_at, breached_at FROM groups_tickets WHERE user_id = ? AND created_at >= ?')
    .all(ws, since)) as Array<{ status: string; assignee_id: string | null; created_at: string; resolved_at: string | null; breached_at: string | null }>;

  const perDayMap = new Map<string, { inbound: number; outbound: number }>();
  for (let i = days - 1; i >= 0; i--) perDayMap.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), { inbound: 0, outbound: 0 });
  const perChatMap = new Map<string, { inbound: number; outbound: number }>();
  const replies = new Map<string, number>();
  let inbound = 0;
  let outbound = 0;
  for (const m of msgs) {
    const d = perDayMap.get(m.created_at.slice(0, 10));
    const c = perChatMap.get(m.chat_id) ?? { inbound: 0, outbound: 0 };
    if (m.direction === 'in') {
      inbound++;
      c.inbound++;
      if (d) d.inbound++;
    } else {
      outbound++;
      c.outbound++;
      if (d) d.outbound++;
      if (m.author_id && m.author_kind === 'person') replies.set(m.author_id, (replies.get(m.author_id) ?? 0) + 1);
    }
    perChatMap.set(m.chat_id, c);
  }
  const fr = firstResponses(msgs);
  const resolution = tickets
    .filter((t) => t.resolved_at)
    .map((t) => Math.max(0, Math.round((Date.parse(t.resolved_at as string) - Date.parse(t.created_at)) / 60_000)));

  const nameOf = new Map(people.map((p) => [p.id, p.name || p.email]));
  const agentIds = new Set<string>([...replies.keys(), ...fr.map((f) => f.by).filter((x): x is string => !!x)]);
  const perAgent = [...agentIds].map((id) => ({
    id,
    name: nameOf.get(id) ?? id.slice(0, 8),
    replies: replies.get(id) ?? 0,
    medianFirstResponseMin: median(fr.filter((f) => f.by === id).map((f) => f.minutes)),
    ticketsResolved: tickets.filter((t) => t.assignee_id === id && t.resolved_at).length,
  }));
  perAgent.sort((a, b) => b.replies - a.replies);

  const chatById = new Map(chats.map((c) => [c.id, c]));
  const perChat = [...perChatMap.entries()]
    .map(([id, v]) => {
      const c = chatById.get(id);
      return {
        id,
        name: c ? chatDisplayName(c) : id,
        kind: c?.kind ?? 'group',
        inbound: v.inbound,
        outbound: v.outbound,
        medianFirstResponseMin: median(fr.filter((f) => f.chatId === id).map((f) => f.minutes)),
      };
    })
    .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound))
    .slice(0, 25);

  return {
    days,
    totals: {
      inbound,
      outbound,
      activeChats: perChatMap.size,
      awaiting: chats.filter((c) => c.awaiting_since).length,
      flagged: chats.filter((c) => c.flagged_at).length,
    },
    firstResponse: { medianMin: median(fr.map((f) => f.minutes)), samples: fr.length },
    tickets: {
      created: tickets.length,
      open: tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
      resolved: tickets.filter((t) => t.resolved_at).length,
      breached: tickets.filter((t) => t.breached_at).length,
      medianResolutionMin: median(resolution),
    },
    perDay: [...perDayMap.entries()].map(([day, v]) => ({ day, ...v })),
    perAgent,
    perChat,
  };
}
